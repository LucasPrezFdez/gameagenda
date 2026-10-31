// Lado Worker del protocolo de la §8.7 sobre `@gameagenda/core`, sin `self` ni E/S propias (las
// recibe en `HostDeps`), para probarlo en Vitest. Estados `none` → `scan` → `full` (§8.8): el
// núcleo se lee y se indexa a bloques de ≈6 ms que ceden el turno, así que una consulta espera
// como mucho un bloque; en `scan` ya se busca en todo el catálogo. El índice se construye sobre el
// núcleo con `recent` ya aplicado (§7.6).
//
// Actualización (§5.3 y §5.4): tras arrancar con la caché se comprueba el *manifest*; una versión
// nueva se descarga (regla de los 7 días en `catalog-store.ts`) y se indexa en segundo plano. Si
// falla, sigue el catálogo vigente: un *manifest* rechazado (firma, navegador o app) se anuncia en
// `status.error`; un fichero que da 404 hace releer el *manifest* una vez y, si sigue igual (o
// falla la red), se reintenta más tarde con una espera que se dobla.
import {
  type AliasPair,
  applyRecent,
  CatalogFlag,
  CatalogFormatError,
  type CatalogManifest,
  type CooperativeTask,
  type CoreCatalog,
  createCoreReader,
  parseAliases,
  parseCore,
} from '@gameagenda/core/catalog-format';
import {
  type BrowseResult,
  canSuggest,
  createIndexBuilder,
  type FuzzyMatcher,
  type IndexBuilder,
  type Searcher,
  type SuggestTask,
} from '@gameagenda/core/search';
import type {
  BrowseFilters,
  CatalogError,
  CatalogInfo,
  CatalogState,
  ReplyMessage,
  RequestMessage,
  StatusMessage,
  UiToWorkerMessage,
  WorkerToUiMessage,
} from '../search-client/protocol.ts';
import {
  type CatalogErrorCode,
  CatalogLoadError,
  type CatalogStore,
  type CatalogTexts,
  type CoreFile,
  compareCatalogVersions,
} from './catalog-store.ts';

/** Lo que la interfaz ve del catálogo en uso (M2): edad, *kill switches* e índice de *shards*. */
function catalogInfo(manifest: CatalogManifest): CatalogInfo {
  return {
    version: manifest.version,
    generatedAt: manifest.generatedAt,
    enrichmentAgeDays: manifest.enrichmentAgeDays,
    killSwitches: manifest.killSwitches ?? { covers: false, details: false },
    detailsIndex: manifest.files.details ?? null,
  };
}

/** Ganchos de los E2E (solo en el *build* del modo `e2e`; ver `e2e-hooks.ts`). */
export interface HostTestHooks {
  /** Estado en el que la construcción debe quedarse quieta, o `null`. */
  hold(): 'none' | 'scan' | null;
  /** Antes de cada carga del catálogo; puede lanzar un error de red simulado. */
  beforeLoad(): void;
}

export interface HostDeps {
  post(message: WorkerToUiMessage): void;
  /** Reloj monótono en ms (`performance.now`). */
  now(): number;
  /** Ejecuta `task` en otra tarea, cediendo el turno (en el Worker, con un `MessageChannel`). */
  schedule(task: () => void): void;
  /** Ejecuta `task` dentro de `ms` (`setTimeout`): los reintentos de una actualización fallida. */
  setTimer?(task: () => void, ms: number): void;
  readonly store: CatalogStore;
  loadFuzzy(): Promise<FuzzyMatcher>;
  /** Plazo de cada bloque de trabajo: ≈6 ms da bloques de ≤8 ms (§8.8). */
  readonly sliceMs?: number;
  /** Separación mínima entre dos `status` de progreso. */
  readonly progressIntervalMs?: number;
  readonly testHooks?: HostTestHooks | null;
}

export interface SearchHost {
  handle(message: UiToWorkerMessage): void;
  /** Ha vuelto la red: repite la carga fallida o busca un catálogo nuevo. */
  online(): void;
  /** Reanuda el trabajo en pausa (ganchos de prueba). */
  resume(): void;
}

/** Reparto de `progress` en `none`: descarga, lectura del TSV y claves hasta `scan`. */
const DOWNLOAD_SHARE = 0.5;
const READ_SHARE = 0.1;
/** `progress` del constructor al llegar a `scan` (pesos de `builder.ts`). */
const BUILDER_SCAN_AT = 0.5;

/** Reintentos de una actualización fallida: 1 min, 2, 4… hasta 1 h. */
export const RETRY_MIN_MS = 60_000;
export const RETRY_MAX_MS = 3_600_000;

/**
 * Fallos de la actualización que se anuncian en `status.error` aunque se siga buscando con el
 * catálogo vigente: piden algo a la interfaz (un catálogo bueno, otro navegador u otra app).
 */
const SHOWN_UPDATE_ERRORS: ReadonlySet<CatalogErrorCode> = new Set([
  'signature',
  'browser-too-old',
  'client-too-old',
]);

/** De dónde sale un catálogo: su *manifest* y el núcleo que se usa (sin los textos). */
interface Source {
  readonly manifest: CatalogManifest;
  readonly coreFile: CoreFile;
}

interface BuildJob {
  /** El *manifest* puede cambiar a mitad (otra versión con el mismo índice; ver `adopt`). */
  texts: CatalogTexts;
  /** El primer catálogo publica `scan`; una actualización solo sustituye al anterior en `full`. */
  readonly foreground: boolean;
  readonly aliases: readonly AliasPair[];
  /** `recent` leído, que se aplica al núcleo antes del índice; `null` si no hay. */
  readonly recent: CoreCatalog | null;
  reader: CooperativeTask<CoreCatalog> | null;
  builder: IndexBuilder | null;
  adults: number;
}

interface SuggestJob {
  readonly seq: number;
  readonly q: string;
  readonly exclude: readonly number[];
  task: SuggestTask | null;
}

interface View {
  readonly q: string;
  readonly filters: BrowseFilters;
  showAdult: boolean;
  searcher: Searcher;
  result: BrowseResult;
}

type ReplyOf<T extends RequestMessage['type']> = Extract<ReplyMessage, { type: T }>;

function countAdults(catalog: CoreCatalog): number {
  let n = 0;
  for (let g = 0; g < catalog.count; g++) {
    if (((catalog.flags[g] as number) & CatalogFlag.adult) !== 0) n++;
  }
  return n;
}

function asLoadError(error: unknown): CatalogLoadError {
  if (error instanceof CatalogLoadError) return error;
  if (error instanceof CatalogFormatError) return new CatalogLoadError('format', error.message);
  return new CatalogLoadError('network', error instanceof Error ? error.message : String(error));
}

const FILE_KINDS = ['core', 'recent', 'aliases', 'details'] as const;

/** ¿Citan los dos *manifest* algún fichero distinto? */
function filesDiffer(a: CatalogManifest, b: CatalogManifest): boolean {
  return FILE_KINDS.some((kind) => a.files[kind]?.sha256 !== b.files[kind]?.sha256);
}

/** ¿Se construye el mismo índice? Mismo núcleo, mismos recientes y mismos alias. */
function sameIndex(a: Source, b: Source): boolean {
  return (
    a.coreFile.sha256 === b.coreFile.sha256 &&
    a.manifest.files.recent?.sha256 === b.manifest.files.recent?.sha256 &&
    a.manifest.files.aliases.sha256 === b.manifest.files.aliases.sha256
  );
}

/**
 * ¿Hay que pasar a `next`? Una versión anterior a la vigente se rechaza (§11.3). Con la misma
 * versión, solo si cambia algún fichero (en desarrollo, al cambiar `CATALOG_DIR`) o si `force`
 * («Actualizar catálogo») y el núcleo en uso no es el del *manifest* (regla de los 7 días).
 */
function isUpdate(next: CatalogManifest, active: Source | null, force: boolean): boolean {
  if (!active) return true;
  const order = compareCatalogVersions(next.version, active.manifest.version);
  if (order !== 0) return order > 0;
  return (
    filesDiffer(next, active.manifest) ||
    (force && next.files.core.sha256 !== active.coreFile.sha256)
  );
}

export function createSearchHost(deps: HostDeps): SearchHost {
  const sliceMs = deps.sliceMs ?? 6;
  const progressIntervalMs = deps.progressIntervalMs ?? 100;
  const hooks = deps.testHooks ?? null;

  let started = false;
  let showAdult = false;
  /** El buscador que responde: el de escaneo en `scan` y el índice en `full`. */
  let searcher: Searcher | null = null;
  let searcherSource: Source | null = null;
  let searcherAdults = 0;
  let job: BuildJob | null = null;
  /** Catálogo nuevo que espera a que acabe la construcción en curso. */
  let pendingUpdate: CatalogTexts | null = null;
  let loading = false;
  let downloadProgress = 0;
  /** Error de la carga del primer catálogo (sin catálogo, en `none`). */
  let error: CatalogError | null = null;
  /** Error de la última comprobación, si hay que anunciarlo con el catálogo vigente. */
  let updateError: CatalogError | null = null;
  let checking: Promise<void> | null = null;
  let retryPending = false;
  let retryAttempts = 0;

  let latestSeq = 0;
  let lastQuery: { seq: number; q: string; strong: number; appids: number[] } | null = null;
  let suggestJob: SuggestJob | null = null;
  let fuzzy: Promise<FuzzyMatcher> | null = null;
  const views = new Map<string, View>();
  /** Peticiones que necesitan catálogo y llegan antes de `scan`. */
  const waiting: RequestMessage[] = [];

  let scheduled = false;
  let lastStatus = '';
  let lastStatusAt = Number.NEGATIVE_INFINITY;

  function state(): CatalogState {
    return searcher?.state ?? 'none';
  }

  /** El catálogo más nuevo que ya responde, se está indexando o espera su turno. */
  function activeSource(): Source | null {
    return pendingUpdate ?? job?.texts ?? searcherSource;
  }

  function progress(): number {
    if (!searcher) {
      if (!job?.foreground) return DOWNLOAD_SHARE * downloadProgress;
      if (job.reader) return DOWNLOAD_SHARE + READ_SHARE * job.reader.progress;
      const built = Math.min(1, (job.builder?.progress ?? 0) / BUILDER_SCAN_AT);
      return DOWNLOAD_SHARE + READ_SHARE + (1 - DOWNLOAD_SHARE - READ_SHARE) * built;
    }
    if (searcher.state === 'scan' && job?.foreground && job.builder) return job.builder.progress;
    return 1;
  }

  function emitStatus(force: boolean): void {
    const visible = searcher ? searcher.count - (showAdult ? 0 : searcherAdults) : 0;
    const message: StatusMessage = {
      type: 'status',
      state: state(),
      version: searcher ? (searcherSource?.manifest.version ?? searcher.version) : null,
      count: visible,
      progress: Math.round(progress() * 100) / 100,
      // El de la actualización solo con catálogo: sin él, la interfaz aún dice «Preparando…».
      error: error ?? (searcher ? updateError : null),
      catalog: searcher && searcherSource ? catalogInfo(searcherSource.manifest) : null,
    };
    const key = JSON.stringify(message);
    if (key === lastStatus) return;
    const now = deps.now();
    if (!force && now - lastStatusAt < progressIntervalMs) return;
    lastStatus = key;
    lastStatusAt = now;
    deps.post(message);
  }

  function schedule(): void {
    if (scheduled) return;
    scheduled = true;
    deps.schedule(tick);
  }

  function holdOf(current: BuildJob): 'none' | 'scan' | null {
    return hooks && current.foreground ? hooks.hold() : null;
  }

  function isPaused(current: BuildJob): boolean {
    const hold = holdOf(current);
    return hold !== null && hold === (current.builder ? current.builder.state : 'none');
  }

  function needsTick(): boolean {
    return (job !== null && !isPaused(job)) || suggestJob?.task != null;
  }

  // --- Construcción ----------------------------------------------------------

  function startJob(texts: CatalogTexts, foreground: boolean): void {
    let aliases: readonly AliasPair[];
    let recent: CoreCatalog | null;
    try {
      aliases = parseAliases(texts.aliases).pairs;
      // ≈4 000 filas: menos de 2 ms, de una vez.
      recent = texts.recent === null ? null : parseCore(texts.recent, 'recent');
    } catch (cause) {
      if (foreground) fail(cause);
      return;
    }
    job = {
      texts,
      foreground,
      aliases,
      recent,
      reader: createCoreReader(texts.core, { kind: 'core', now: deps.now }),
      builder: null,
      adults: 0,
    };
    emitStatus(true);
    schedule();
  }

  function use(next: Searcher, from: BuildJob): void {
    const changed = searcher !== next;
    searcher = next;
    searcherSource = { manifest: from.texts.manifest, coreFile: from.texts.coreFile };
    searcherAdults = from.adults;
    error = null;
    if (changed) {
      // Las vistas del Catálogo pasan al buscador nuevo: así se suelta el de escaneo.
      for (const view of views.values()) refreshView(view);
      emitStatus(true);
      flushWaiting();
    }
  }

  /** Avanza la lectura y el índice hasta `deadline`. */
  function advance(current: BuildJob, deadline: number): void {
    if (isPaused(current)) return;
    if (current.reader) {
      if (!current.reader.step(deadline)) return;
      const base = current.reader.result as CoreCatalog;
      current.reader = null;
      // Los recientes, de una vez (≈16 ms con el catálogo completo, sin estrangular).
      const catalog = current.recent ? applyRecent(base, current.recent) : base;
      current.adults = countAdults(catalog);
      current.builder = createIndexBuilder(catalog, current.aliases, { now: deps.now });
      if (isPaused(current)) return;
    }
    const builder = current.builder as IndexBuilder;
    let done = false;
    if (holdOf(current) === 'scan') {
      // Trozo a trozo, para pararse justo en `scan`: con el mini-catálogo, un bloque llega a `full`.
      while (!done && builder.state !== 'scan' && deps.now() < deadline) {
        done = builder.step(deps.now());
      }
    } else {
      done = builder.step(deadline);
    }
    if (current.foreground && builder.searcher) use(builder.searcher, current);
    if (done) {
      use(builder.result as Searcher, current);
      job = null;
      const update = pendingUpdate;
      pendingUpdate = null;
      if (update) startJob(update, false);
    }
  }

  function tick(): void {
    scheduled = false;
    const deadline = deps.now() + sliceMs;
    stepSuggest();
    const current = job;
    if (current) {
      try {
        advance(current, deadline);
      } catch (cause) {
        job = null;
        if (current.foreground) fail(cause);
      }
    }
    emitStatus(false);
    if (needsTick()) schedule();
  }

  // --- Carga del catálogo ----------------------------------------------------

  function fail(cause: unknown): void {
    if (searcher) return; // ya hay catálogo: una actualización fallida no lo quita
    const loadError = asLoadError(cause);
    error = { code: loadError.code, retryable: loadError.retryable };
    job = null;
    emitStatus(true);
    flushWaiting();
  }

  /**
   * Los ficheros de `manifest`. Si un fichero con *hash* da un error HTTP (un 404 tras un
   * despliegue), relee el *manifest* una vez y, si es otro, sigue con ese (§5.4, principio 8):
   * `fetchFile` ya ha reintentado sin la caché HTTP. `null` si el *manifest* releído no es una
   * actualización.
   *
   * Un fallo de red no relee al momento: sin red tampoco llegaría el *manifest*, y al cerrar la
   * página WebKit corta las descargas del Worker y daría por un error la petición nueva. Lo relee
   * el reintento (`scheduleRetry`), que empieza siempre por el *manifest*. Un 404 sin CORS se vería
   * así, pero `ga-catalog` manda CORS también en los 404 (ADR-003).
   */
  async function downloadNewest(
    manifest: CatalogManifest,
    force: boolean,
    onProgress?: (fraction: number) => void,
  ): Promise<CatalogTexts | null> {
    const options = () => ({
      current: activeSource()?.coreFile ?? null,
      forceCore: force,
      onProgress,
    });
    try {
      return await deps.store.download(manifest, options());
    } catch (cause) {
      const failure = asLoadError(cause);
      if (failure.path === null || failure.code !== 'http') throw cause;
      const again = await deps.store.fetchManifest();
      if (!filesDiffer(again, manifest)) throw cause;
      if (!isUpdate(again, activeSource(), force)) return null;
      return deps.store.download(again, options());
    }
  }

  async function load(): Promise<void> {
    hooks?.beforeLoad();
    const cached = await deps.store.readCached().catch(() => null);
    if (cached) {
      downloadProgress = 1;
      startJob(cached, true);
      // El *manifest* se comprueba después, sin retrasar la búsqueda (§5.3).
      void checkForUpdate().catch(() => undefined);
      return;
    }
    const manifest = await deps.store.fetchManifest();
    const texts = await downloadNewest(manifest, false, (fraction) => {
      downloadProgress = fraction;
      emitStatus(false);
    });
    // Sin catálogo en uso, cualquier *manifest* válido es una actualización: `null` no llega.
    if (!texts) throw new CatalogLoadError('manifest', 'El manifest releído no sirve');
    downloadProgress = 1;
    startJob(texts, true);
  }

  function startLoad(): void {
    if (loading || job || searcher) return;
    loading = true;
    error = null;
    downloadProgress = 0;
    emitStatus(true);
    load()
      .catch(fail)
      .finally(() => {
        loading = false;
      });
  }

  function setUpdateError(next: CatalogError | null): void {
    if (next?.code === updateError?.code && next?.retryable === updateError?.retryable) return;
    updateError = next;
    emitStatus(true);
  }

  /** Reintento de una actualización fallida, con una espera que se dobla (1 min … 1 h). */
  function scheduleRetry(): void {
    if (retryPending || !deps.setTimer) return;
    const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** retryAttempts);
    retryAttempts++;
    retryPending = true;
    deps.setTimer(() => {
      retryPending = false;
      void checkForUpdate().catch(() => undefined);
    }, delay);
  }

  /** Una comprobación fallida: el catálogo vigente sigue; se anuncia o se reintenta más tarde. */
  function updateFailed(cause: unknown): void {
    const failure = asLoadError(cause);
    if (SHOWN_UPDATE_ERRORS.has(failure.code)) {
      setUpdateError({ code: failure.code, retryable: failure.retryable });
    }
    // Sin red ni para el *manifest*: lo repite `online()`. Sin Ed25519 o con la app vieja, no.
    const offline = failure.code === 'network' && failure.path === null;
    if (failure.retryable && !offline) scheduleRetry();
  }

  async function update(force: boolean): Promise<void> {
    const manifest = await deps.store.fetchManifest();
    // Firma válida: lo que se anunciaba de una comprobación anterior ya no vale.
    setUpdateError(null);
    if (isUpdate(manifest, activeSource(), force)) {
      const texts = await downloadNewest(manifest, force);
      if (texts && isUpdate(texts.manifest, activeSource(), force)) adopt(texts);
    }
    retryAttempts = 0;
  }

  /** Pasa al catálogo descargado: indexándolo en segundo plano o, si da el mismo índice, ya. */
  function adopt(texts: CatalogTexts): void {
    const active = activeSource();
    if (active && sameIndex(texts, active)) {
      // Otra versión con el mismo núcleo, recientes y alias (p. ej., solo cambia un *kill
      // switch*): cambia el *manifest* del más nuevo, sin reconstruir nada.
      const source: Source = { manifest: texts.manifest, coreFile: texts.coreFile };
      if (pendingUpdate) pendingUpdate = { ...pendingUpdate, ...source };
      else if (job) job.texts = { ...job.texts, ...source };
      else searcherSource = source;
      emitStatus(true);
      return;
    }
    if (!searcher) startJob(texts, true);
    else if (job) pendingUpdate = texts;
    else startJob(texts, false);
  }

  /**
   * Comprueba el *manifest* y, si hay versión nueva, la descarga y la indexa en segundo plano.
   * `force` («Actualizar catálogo») baja también el núcleo nuevo aunque el local tenga ≤7 días.
   */
  function checkForUpdate(force = false): Promise<void> {
    if (checking) {
      return force ? checking.catch(() => undefined).then(() => checkForUpdate(true)) : checking;
    }
    checking = update(force)
      .catch((cause: unknown) => {
        updateFailed(cause);
        throw cause;
      })
      .finally(() => {
        checking = null;
      });
    return checking;
  }

  // --- Peticiones ------------------------------------------------------------

  function refreshView(view: View): void {
    if (!searcher) return;
    view.searcher = searcher;
    view.showAdult = showAdult;
    view.result = searcher.browse(view.q, { ...view.filters, showAdult });
  }

  function reply(message: ReplyMessage): void {
    deps.post(message);
  }

  /** Respuesta sin catálogo (la carga ha fallado): vacía, para no dejar a nadie esperando. */
  function emptyReply(m: RequestMessage): ReplyMessage | null {
    switch (m.type) {
      case 'browse':
        return { type: 'browse', reqId: m.reqId, count: 0 };
      case 'rows':
        return { type: 'rows', reqId: m.reqId, items: [] };
      case 'game':
        return { type: 'game', reqId: m.reqId, game: null };
      case 'lookup':
        return { type: 'lookup', reqId: m.reqId, found: [], missing: [...m.appids] };
      case 'matchExact':
        return { type: 'matchExact', reqId: m.reqId, appids: [] };
      default:
        return null;
    }
  }

  function replyFor(m: RequestMessage, s: Searcher): WorkerToUiMessage | null {
    switch (m.type) {
      case 'browse': {
        const view: View = {
          q: m.q,
          filters: { flagsAll: m.filters.flagsAll ?? 0, flagsNone: m.filters.flagsNone ?? 0 },
          showAdult,
          searcher: s,
          result: s.browse(m.q, { ...m.filters, showAdult }),
        };
        views.set(m.viewId, view);
        return { type: 'browse', reqId: m.reqId, count: view.result.count };
      }
      case 'rows': {
        const view = views.get(m.viewId);
        if (!view) return { type: 'error', reqId: m.reqId, code: 'unknown-view' };
        if (view.searcher !== s || view.showAdult !== showAdult) refreshView(view);
        const items = view.result.slice(m.from, m.to);
        return { type: 'rows', reqId: m.reqId, items } satisfies ReplyOf<'rows'>;
      }
      case 'game':
        return { type: 'game', reqId: m.reqId, game: s.game(m.appid) };
      case 'lookup': {
        const { found, missing } = s.lookup(m.appids);
        return { type: 'lookup', reqId: m.reqId, found, missing };
      }
      case 'matchExact':
        return { type: 'matchExact', reqId: m.reqId, appids: s.matchExact(m.title) };
      default:
        return null;
    }
  }

  function answer(m: RequestMessage): void {
    const message = searcher ? replyFor(m, searcher) : emptyReply(m);
    if (message) deps.post(message);
  }

  function flushWaiting(): void {
    for (const m of waiting.splice(0)) answer(m);
  }

  function handleRequest(m: RequestMessage): void {
    switch (m.type) {
      case 'options':
        showAdult = m.showAdult;
        reply({ type: 'options', reqId: m.reqId });
        emitStatus(true);
        return;
      case 'retry':
        reply({ type: 'retry', reqId: m.reqId });
        startLoad();
        return;
      case 'refresh':
        // «Actualizar catálogo» (§5.3): también el núcleo nuevo, aunque el local tenga ≤7 días.
        checkForUpdate(true).then(
          () => reply({ type: 'refresh', reqId: m.reqId }),
          (cause: unknown) =>
            deps.post({ type: 'error', reqId: m.reqId, code: asLoadError(cause).code }),
        );
        return;
      default:
        break;
    }
    if (searcher || error) answer(m);
    else waiting.push(m);
  }

  // --- Consultas y nivel 4 ---------------------------------------------------

  function query(seq: number, q: string, limit: number): void {
    latestSeq = Math.max(latestSeq, seq);
    if (suggestJob && suggestJob.seq < latestSeq) suggestJob = null;
    const started = deps.now();
    if (!searcher) {
      deps.post({ type: 'results', seq, items: [], strong: 0, ms: 0 });
      return;
    }
    const result = searcher.query(q, { limit, showAdult });
    lastQuery = { seq, q, strong: result.strong, appids: result.items.map((i) => i.appid) };
    deps.post({
      type: 'results',
      seq,
      items: result.items,
      strong: result.strong,
      ms: deps.now() - started,
    });
  }

  function suggest(seq: number): void {
    const last = lastQuery;
    if (!searcher || !last || last.seq !== seq || seq < latestSeq) return;
    if (!canSuggest(last.q, last.strong)) {
      deps.post({ type: 'suggestions', seq, items: [] });
      return;
    }
    const next: SuggestJob = { seq, q: last.q, exclude: last.appids, task: null };
    suggestJob = next;
    fuzzy ??= deps.loadFuzzy();
    fuzzy.then(
      (matcher) => {
        if (suggestJob !== next || !searcher) return;
        next.task = searcher.suggest(next.q, matcher, { exclude: next.exclude, showAdult });
        schedule();
      },
      () => {
        fuzzy = null;
        if (suggestJob === next) suggestJob = null;
      },
    );
  }

  /** Un bloque de 20 000 nombres del nivel 4 por turno; si llega otra consulta, se abandona. */
  function stepSuggest(): void {
    const current = suggestJob;
    if (!current?.task) return;
    if (current.seq < latestSeq) {
      suggestJob = null;
      return;
    }
    if (!current.task.step()) return;
    suggestJob = null;
    deps.post({ type: 'suggestions', seq: current.seq, items: current.task.items });
  }

  return {
    handle(message) {
      switch (message.type) {
        case 'init':
          showAdult = message.showAdult;
          if (started) {
            emitStatus(true);
            return;
          }
          started = true;
          startLoad();
          return;
        case 'query':
          query(message.seq, message.q, message.limit);
          return;
        case 'suggest':
          suggest(message.seq);
          return;
        default:
          handleRequest(message);
      }
    },
    online() {
      if (!started) return;
      if (!searcher && error) startLoad();
      else if (searcher) void checkForUpdate().catch(() => undefined);
    },
    resume() {
      if (needsTick()) schedule();
    },
  };
}
