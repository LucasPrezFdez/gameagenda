import { createHlcClock, randomNode } from '@gameagenda/core/sync';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { v7 as uuidv7 } from 'uuid';
import { App } from './App.tsx';
import { createAgenda } from './agenda/agenda.ts';
import { startCatalogRefresh } from './agenda/catalog-refresh.ts';
import { type AppServices, ServicesProvider } from './app/services.tsx';
import { createDexieAgendaStorage } from './db/agenda-storage.ts';
import { openDatabase } from './db/database.ts';
import { createDexieErrorLogStorage } from './db/error-log-storage.ts';
import { type LocalState, loadLocalState } from './db/local-state.ts';
import { createDexieSettingsStorage } from './db/settings-storage.ts';
import { connectErrorLog, installGlobalErrorHandlers, logError } from './errors/error-log.ts';
import { es } from './i18n/es.ts';
import { createNoticeCenter, type NoticeAction } from './notices/notice-center.ts';
import { warmFallbackFonts } from './perf/fallback-fonts.ts';
import { registerServiceWorker } from './pwa/register-sw.ts';
import { startRouter } from './router/router.tsx';
import { createAppSearchClient } from './search-client/index.ts';
import { createSettingsStore, parseSettings } from './settings/settings-store.ts';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/palette.css';
import './styles/list.css';
import './styles/sheet.css';

/** Si IndexedDB no contesta en este tiempo, la app arranca solo en memoria y lo avisa. */
const OPEN_TIMEOUT_MS = 8000;
/** Un aviso de «Guardado fallido» como mucho cada tanto (§9.6). */
const STORAGE_NOTICE_MS = 30_000;

installGlobalErrorHandlers();
startRouter();
// Antes de esperar a Dexie: registra el Service Worker en `load`, que puede llegar antes.
registerServiceWorker();

const notices = createNoticeCenter();
const search = createAppSearchClient();

/** Aleatorio criptográfico en [0, 1) para el nodo de la HLC (uno por pestaña, §7.4). */
function secureRandom(): number {
  return (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32;
}

/** Botones de «Guardado fallido» (§9.6): se conectan cuando existe la agenda. */
let storageActions: readonly NoticeAction[] = [];

let lastStorageNotice = Number.NEGATIVE_INFINITY;
function showStorageNotice(): void {
  const now = performance.now();
  if (now - lastStorageNotice < STORAGE_NOTICE_MS) return;
  lastStorageNotice = now;
  notices.notify(es.notices.storageFailed, { actions: storageActions });
}

function onStorageError(error: unknown): void {
  logError('storage', error);
  showStorageNotice();
}

async function openLocalData() {
  const db = openDatabase();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('IndexedDB no ha contestado a tiempo')),
      OPEN_TIMEOUT_MS,
    );
  });
  try {
    const state: LocalState = await Promise.race([loadLocalState(db), timeout]);
    return { db, state };
  } catch (error) {
    // El aviso sale cuando ya hay agenda que exportar (ver `start`).
    logError('storage', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function start(): Promise<void> {
  // Mi lista y los ajustes salen de Dexie antes de pintar y de tocar la red (§9.5, regla 6).
  const local = await openLocalData();

  const settingsStorage = local ? createDexieSettingsStorage(local.db, onStorageError) : undefined;
  const settings = createSettingsStore(parseSettings(local?.state.settings ?? {}), settingsStorage);
  settingsStorage?.watch(settings);
  // El tema, antes del primer pintado (sin parpadeo).
  const { theme, showAdult } = settings.getSnapshot();
  if (theme !== 'system') document.documentElement.dataset.theme = theme;

  const clock = createHlcClock({
    now: Date.now,
    node: randomNode(secureRandom),
    snapshot: local?.state.clock,
  });
  const agenda = createAgenda({
    entries: local?.state.entries,
    clock,
    newId: uuidv7,
    storage: local ? createDexieAgendaStorage(local.db, uuidv7) : null,
    onStorageError,
  });
  if (local) connectErrorLog(createDexieErrorLogStorage(local.db));

  const exportList: NoticeAction = {
    label: es.notices.export,
    run() {
      import('./data/data-actions.ts')
        .then((data) => data.exportJson({ agenda, settings, appVersion: __APP_VERSION__ }))
        .catch((error: unknown) => logError('storage', error));
    },
  };
  // Sin IndexedDB no hay nada que reintentar: la agenda vive solo en memoria.
  storageActions = local
    ? [exportList, { label: es.notices.retry, run: () => void agenda.retryStorage() }]
    : [exportList];
  if (!local) showStorageNotice();

  const services: AppServices = { agenda, search, settings, notices };
  search.init({ catalogVersion: null, showAdult });
  startCatalogRefresh(search, agenda);

  const root = document.getElementById('root');
  if (!root) throw new Error('Falta el elemento #root');
  createRoot(root).render(
    <StrictMode>
      <ServicesProvider services={services}>
        <App />
      </ServicesProvider>
    </StrictMode>,
  );
  // Cuando ya se puede buscar (antes, la paleta no enseña nombres del catálogo) y en ratos
  // ociosos: así no retrasa el primer pintado de Mi lista.
  const stopWarmup = search.subscribeStatus(() => {
    if (search.getStatus().state === 'none') return;
    stopWarmup();
    warmFallbackFonts();
  });
}

void start();
