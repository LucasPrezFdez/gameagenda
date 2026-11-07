// Ajustes › Sincronización (M4; §9.1, §9.6, §11.2 y §11.4; ADR-011). Va en el *chunk* diferido de
// Ajustes, sin Zod: de `@gameagenda/core/api` solo usa las constantes y los códigos, que no lo
// importan. El motor (con Zod) lo carga la fachada al activar o emparejar, y el QR (`qr.ts`, con
// `uqr`) va en su propio *chunk*, que se descarga al pedir un código. Cuatro vistas, según el
// estado de `SyncService`:
// - sin sincronizar: qué guarda, el nombre del dispositivo, la declaración de edad y «Activar
//   sincronización»; aparte, canjear un código de emparejamiento o el de recuperación;
// - recién activada (o con un código de recuperación nuevo): el código, una sola vez;
// - emparejada: el estado, «Emparejar otro dispositivo» (código y QR de 10 min), los dispositivos,
//   un código de recuperación nuevo y «Desemparejar este dispositivo»;
// - desemparejada (por el servidor o sin cookies): lo dice y ofrece el código de recuperación.
// La sincronización en sí nunca pregunta (RF-26): aquí solo hay gestos explícitos. Las
// confirmaciones van en el sitio, nunca en un modal (§9.6), y el foco sigue a cada cambio de vista,
// también cuando la cambia el servidor (un 401). Lo que llega solo, sin un gesto (otro dispositivo
// se ha emparejado), sale en el aviso de la app (`NoticeCenter`), que no empuja nada (§9.5).
import { CODE_INPUT_MAX, DEFAULT_MIN_AGE } from '@gameagenda/core/api';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useServices, useSyncState } from '../../app/services.tsx';
import { logError } from '../../errors/error-log.ts';
import { es } from '../../i18n/es.ts';
import { peekPendingPairingCode, takePendingPairingCode } from '../../router/pairing-link.ts';
import { pairingUrl } from '../../router/routes.ts';
import { LABEL_MAX } from '../../sync/device-label.ts';
import {
  type DeviceInfo,
  SyncError,
  type SyncErrorCode,
  type SyncService,
  type SyncState,
} from '../../sync/types.ts';
import type { QrDrawing } from './qr.ts';
import {
  cleanDeviceLabel,
  codeGroups,
  deviceDetails,
  focusLost,
  formatClock,
  formatCountdown,
  isDesktopApp,
  isIosBrowserTab,
  isLastAppDevice,
  messageAfterViewChange,
  newDevices,
  nextPairingLink,
  type PairingLink,
  type PanelMessage,
  type PanelView,
  pairingDeadline,
  pendingText,
  readCode,
  remainingMs,
  sortDevices,
  statusLine,
  suggestedDeviceLabel,
  syncErrorText,
  syncedWhen,
  syncViewOf,
  viewHeading,
} from './sync-model.ts';

const t = es.syncPanel;
const loadQr = () => import('./qr.ts');
/** Mientras se ve un código de emparejamiento, cada cuánto se mira si el otro ya lo ha canjeado. */
const PAIRING_POLL_MS = 5000;

type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: SyncErrorCode };

/** Una operación de `SyncService`: un `SyncError` es un resultado; lo demás va al registro. */
async function attempt<T>(run: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof SyncError) return { ok: false, code: error.code };
    logError('storage', error);
    return { ok: false, code: 'internal' };
  }
}

/**
 * Lleva el foco a `id` en cuanto exista (tras un cambio de vista puede tardar un fotograma). Los
 * encabezados que lo reciben llevan `tabIndex={-1}` (WCAG 2.4.3).
 */
function focusWhenReady(id: string, tries = 10): void {
  const element = document.getElementById(id);
  if (element) {
    element.focus();
    return;
  }
  if (tries > 0) requestAnimationFrame(() => focusWhenReady(id, tries - 1));
}

/** Vuelve a pintar cada `ms` (para «hace 5 minutos» y la cuenta atrás). */
function useTick(ms: number, enabled = true): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms, enabled]);
}

function describedBy(...ids: (string | false | null | undefined)[]): string | undefined {
  const list = ids.filter((id): id is string => typeof id === 'string' && id !== '');
  return list.length > 0 ? list.join(' ') : undefined;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Un código en grupos de 4, en monoespaciada, que se selecciona entero con un toque; va justo
 * debajo de su encabezado. Quien lo usa le pone `key={code}`: con otro código, el aviso de copiado
 * ya no vale.
 */
function CodeBox({ code, expired = false }: { code: string; expired?: boolean }) {
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const groups = codeGroups(code);
  return (
    <div className="sync__codebox">
      <p className="sync__code" data-sync-code="" data-expired={expired ? 'true' : undefined}>
        {groups.map((group, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: los grupos de un código no cambian de sitio.
          <span key={i} className="sync__code-group">
            {i < groups.length - 1 ? `${group}-` : group}
            {i < groups.length - 1 && <wbr />}
          </span>
        ))}
      </p>
      <div className="settings__buttons">
        <button
          type="button"
          className="btn"
          onClick={() => void copyText(code).then((ok) => setCopy(ok ? 'copied' : 'failed'))}
        >
          {t.copy}
        </button>
      </div>
      <div className="settings__import-result" role="status">
        {copy === 'copied' && <p>{t.copied}</p>}
        {copy === 'failed' && <p>{t.copyFailed}</p>}
      </div>
    </div>
  );
}

export interface LabelProps {
  readonly labelId: string;
  readonly label: string;
  readonly labelError: string | null;
  readonly onLabel: (value: string) => void;
  /** El nombre limpio, o `null` (con el error en el campo y el foco en él) si queda vacío. */
  readonly takeLabel: () => string | null;
}

function DeviceNameField({ labelId: id, label, labelError: error, onLabel }: LabelProps) {
  return (
    <div className="sync__field">
      <label htmlFor={id} className="sync__label">
        {t.deviceName}
      </label>
      <input
        id={id}
        className="field"
        value={label}
        maxLength={LABEL_MAX}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error !== null ? true : undefined}
        aria-describedby={describedBy(`${id}-hint`, error !== null && `${id}-error`)}
        onChange={(event) => onLabel(event.target.value)}
      />
      <p id={`${id}-hint`} className="muted">
        {t.deviceNameHint}
      </p>
      {error !== null && (
        <p id={`${id}-error`} className="sync__error">
          {error}
        </p>
      )}
    </div>
  );
}

type JoinKind = 'pair' | 'recover';

/**
 * Qué se guarda, las dos cookies que crea el gesto y el hueco de los textos legales (§11.2): junto
 * a cada forma de crearlas (activar, emparejar o recuperar), sin sincronizar y desemparejado.
 */
function SyncDisclosure() {
  return (
    <>
      <p>{t.stored}</p>
      <p>{t.cookie}</p>
      {/* El hueco de los textos legales (CA4.7): aquí irá el enlace a la política. */}
      <p className="muted" data-sync-legal="">
        {t.legal}
      </p>
    </>
  );
}

/**
 * Canjear un código de emparejamiento o el de recuperación (sin sincronizar o desemparejado).
 * `idPrefix` da los `id` estables: `-title`, `-code`, `-pair` y `-recover`.
 */
export function JoinForm({
  sync,
  idPrefix,
  title,
  intro,
  primary,
  initialCode,
  fromLink,
  iosTab,
  takeLabel,
  onJoined,
}: {
  sync: SyncService;
  idPrefix: string;
  title: string;
  intro: string;
  primary: JoinKind;
  initialCode: string;
  fromLink: boolean;
  /** Safari de iPhone o iPad fuera de la pantalla de inicio (`isIosBrowserTab`). */
  iosTab: boolean;
  takeLabel: () => string | null;
  onJoined: () => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState<JoinKind | null>(null);
  const inputId = `${idPrefix}-code`;
  const noteId = `${idPrefix}-link`;

  // Desde el enlace del QR, el foco va al botón que lo canjea: nunca se canjea solo.
  useEffect(() => {
    if (fromLink) focusWhenReady(`${idPrefix}-pair`);
  }, [fromLink, idPrefix]);

  async function join(kind: JoinKind): Promise<void> {
    if (busy !== null) return;
    setFailure(null);
    const label = takeLabel();
    if (label === null) return;
    if (readCode(code) === null) {
      setFieldError(t.codeInvalid);
      focusWhenReady(inputId);
      return;
    }
    setFieldError(null);
    setBusy(kind);
    const input = { code, label };
    const result = await attempt(() =>
      kind === 'pair' ? sync.redeemPairingCode(input) : sync.redeemRecoveryCode(input),
    );
    setBusy(null);
    if (result.ok) {
      onJoined();
      return;
    }
    const message = syncErrorText(result.code, kind);
    if (result.code === 'invalid_code') {
      setFieldError(message);
      focusWhenReady(inputId);
    } else setFailure(message);
  }

  const secondary: JoinKind = primary === 'pair' ? 'recover' : 'pair';
  const buttonText = (kind: JoinKind) => (kind === 'pair' ? t.pairThis : t.useRecovery);
  const titleId = `${idPrefix}-title`;

  return (
    <section className="sync__block" aria-labelledby={titleId}>
      <h3 id={titleId} tabIndex={-1} className="settings__subtitle">
        {title}
      </h3>
      <p>{intro}</p>
      {fromLink && (
        <p id={noteId} className="sync__note">
          {/* La cámara del iPhone abre el enlace en Safari, no en la app de la pantalla de inicio. */}
          {iosTab ? `${t.fromLink} ${t.fromLinkSafari}` : t.fromLink}
        </p>
      )}
      <form
        className="sync__form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void join(primary);
        }}
      >
        <div className="sync__field">
          <label htmlFor={inputId} className="sync__label">
            {t.code}
          </label>
          <input
            id={inputId}
            className="field sync__code-input"
            value={code}
            maxLength={CODE_INPUT_MAX}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={fieldError !== null ? true : undefined}
            aria-describedby={describedBy(
              `${idPrefix}-hint`,
              fieldError !== null && `${idPrefix}-error`,
            )}
            onChange={(event) => setCode(event.target.value)}
          />
          <p id={`${idPrefix}-hint`} className="muted">
            {t.codeHint}
          </p>
          {fieldError !== null && (
            <p id={`${idPrefix}-error`} className="sync__error">
              {fieldError}
            </p>
          )}
        </div>
        <div className="settings__buttons">
          {(['pair', 'recover'] as const).map((kind) =>
            kind === primary ? (
              <button
                key={kind}
                id={`${idPrefix}-${kind}`}
                type="submit"
                className="btn btn--primary"
                aria-disabled={busy !== null}
                aria-describedby={fromLink && kind === 'pair' ? noteId : undefined}
              >
                {buttonText(kind)}
              </button>
            ) : (
              <button
                key={kind}
                id={`${idPrefix}-${kind}`}
                type="button"
                className="btn"
                aria-disabled={busy !== null}
                aria-describedby={fromLink && kind === 'pair' ? noteId : undefined}
                onClick={() => void join(secondary)}
              >
                {buttonText(kind)}
              </button>
            ),
          )}
        </div>
        <div className="settings__import-result" role="status">
          {busy !== null && <p>{t.joining}</p>}
          {failure !== null && <p className="sync__error">{failure}</p>}
        </div>
      </form>
    </section>
  );
}

/** Sin sincronizar: qué hace y qué guarda, activar y unirse a una agenda que ya existe. */
export function OffView({
  sync,
  ids,
  linkCode,
  iosTab,
  labelProps,
  onActivating,
  onActivated,
  onJoined,
}: {
  sync: SyncService;
  ids: PanelIds;
  linkCode: string | null;
  iosTab: boolean;
  labelProps: LabelProps;
  onActivating: (busy: boolean) => void;
  onActivated: (recoveryCode: string) => void;
  onJoined: () => void;
}) {
  const id = useId();
  const [age, setAge] = useState(false);
  const [ageError, setAgeError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const ageId = `${id}-age`;

  async function activate(): Promise<void> {
    if (busy) return;
    setFailure(null);
    const label = labelProps.takeLabel();
    if (label === null) return;
    if (!age) {
      setAgeError(true);
      focusWhenReady(ageId);
      return;
    }
    setBusy(true);
    onActivating(true);
    const result = await attempt(() => sync.activate({ label, minAge: DEFAULT_MIN_AGE }));
    setBusy(false);
    onActivating(false);
    if (result.ok) onActivated(result.value.recoveryCode);
    else setFailure(syncErrorText(result.code, 'activate'));
  }

  return (
    <>
      <div className="sync__block">
        <p>{t.intro}</p>
        <SyncDisclosure />
      </div>
      <DeviceNameField {...labelProps} />
      <section className="sync__block" aria-labelledby={ids.off}>
        <h3 id={ids.off} tabIndex={-1} className="settings__subtitle">
          {t.activateTitle}
        </h3>
        <form
          className="sync__form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void activate();
          }}
        >
          <label className="settings__choice">
            <input
              id={ageId}
              type="checkbox"
              checked={age}
              aria-invalid={ageError ? true : undefined}
              aria-describedby={ageError ? `${ageId}-error` : undefined}
              onChange={(event) => {
                setAge(event.target.checked);
                if (event.target.checked) setAgeError(false);
              }}
            />
            {t.age(DEFAULT_MIN_AGE)}
          </label>
          {ageError && (
            <p id={`${ageId}-error`} className="sync__error">
              {t.ageMissing(DEFAULT_MIN_AGE)}
            </p>
          )}
          <div className="settings__buttons">
            <button type="submit" className="btn btn--primary" aria-disabled={busy}>
              {busy ? t.activating : t.activate}
            </button>
          </div>
          <div className="settings__import-result" role="status">
            {failure !== null && <p className="sync__error">{failure}</p>}
          </div>
        </form>
      </section>
      <JoinForm
        sync={sync}
        idPrefix={ids.join}
        title={t.joinTitle}
        intro={t.joinIntro}
        primary="pair"
        initialCode={linkCode ?? ''}
        fromLink={linkCode !== null}
        iosTab={iosTab}
        takeLabel={labelProps.takeLabel}
        onJoined={onJoined}
      />
    </>
  );
}

/** El código de recuperación, una sola vez (§11.4), con el foco en su encabezado. */
function RecoveryReveal({
  code,
  headingId,
  onDone,
}: {
  code: string;
  headingId: string;
  onDone: () => void;
}) {
  useEffect(() => focusWhenReady(headingId), [headingId]);
  return (
    <section className="sync__block sync__reveal" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1} className="settings__subtitle">
        {t.recoveryTitle}
      </h3>
      <p>{t.recoveryWhy}</p>
      <p className="sync__note">
        <strong>{t.recoveryOnce}</strong>
      </p>
      <h4 className="sync__label">{t.recoveryCode}</h4>
      <CodeBox key={code} code={code} />
      <div className="settings__buttons">
        <button type="button" className="btn btn--primary" onClick={onDone}>
          {t.saved}
        </button>
      </div>
    </section>
  );
}

type DevicesState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly devices: readonly DeviceInfo[] }
  | { readonly kind: 'error'; readonly message: string };

/** La línea de estado (§9.6), en `role="status"`, y «Sincronizar ahora». */
export function StatusSection({
  sync,
  state,
  headingId,
}: {
  sync: SyncService;
  state: SyncState;
  headingId: string;
}) {
  useTick(30_000);
  const now = Date.now();
  const line = statusLine(state, now);
  const pending = pendingText(state.pending);
  // Lo que se ve avanza («hace 5 minutos»); lo que oye el lector no cambia hasta otra ronda.
  const lastSyncAt =
    state.status === 'paired' && state.activity === 'idle' ? state.lastSyncAt : null;
  return (
    <section className="sync__block" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1} className="settings__subtitle">
        {t.statusTitle}
      </h3>
      <div className="sync__status" role="status" data-tone={line.tone} data-sync-status="">
        <span className="sync__dot" aria-hidden="true" />
        <div className="sync__status-text">
          {lastSyncAt !== null ? (
            <p>
              <span aria-hidden="true">{line.text}</span>
              <span className="visually-hidden">{t.synced(syncedWhen(lastSyncAt, now))}</span>
            </p>
          ) : (
            <p>{line.text}</p>
          )}
          {/* Siempre montada, con su hueco: si no, «Sincronizar ahora» subiría y bajaría con cada
              subida (§9.5, regla 3). Sin cambios pendientes no se ve ni se anuncia. */}
          <p className="muted sync__pending" data-shown={pending !== null ? '' : undefined}>
            {pending ?? t.pending(1)}
          </p>
        </div>
      </div>
      <div className="settings__buttons">
        <button type="button" className="btn" onClick={() => void sync.syncNow()}>
          {t.syncNow}
        </button>
      </div>
    </section>
  );
}

interface ShownCode {
  readonly code: string;
  /** Hasta cuándo vale, con el reloj de este dispositivo (`pairingDeadline`), no el del servidor. */
  readonly deadline: number;
  readonly drawing: QrDrawing | null;
}

interface PairingState {
  /** El código a la vista, o `null`. */
  readonly shown: ShownCode | null;
  readonly busy: boolean;
  readonly error: string | null;
}

/** «Emparejar otro dispositivo»: un código de 10 min como texto y como QR, con su cuenta atrás. */
function PairingSection({
  sync,
  headingId,
  knownIds,
  onPaired,
}: {
  sync: SyncService;
  headingId: string;
  /** Los dispositivos de la lista, o `null` si aún no ha llegado. */
  knownIds: ReadonlySet<string> | null;
  /** `moveFocus`: el foco estaba en el código, que desaparece (o ya se había perdido). */
  onPaired: (
    devices: readonly DeviceInfo[],
    added: readonly DeviceInfo[],
    moveFocus: boolean,
  ) => void;
}) {
  const id = useId();
  const [pairing, setPairing] = useState<PairingState>({ shown: null, busy: false, error: null });
  const generation = useRef(0);
  const codeBlock = useRef<HTMLDivElement>(null);
  /** Los dispositivos que había al crear el código: uno nuevo es el que lo ha canjeado. */
  const baseline = useRef<ReadonlySet<string> | null>(null);
  const { shown } = pairing;
  const left = shown ? remainingMs(shown.deadline, Date.now()) : 0;
  const expired = shown !== null && left === 0;
  useTick(1000, shown !== null && !expired);

  async function create(): Promise<void> {
    if (pairing.busy) return;
    const current = ++generation.current;
    const first = pairing.shown === null;
    setPairing((prev) => ({ ...prev, busy: true, error: null }));
    const qr = loadQr();
    // Antes de pedirlo: el plazo, con el reloj de este dispositivo, empieza a contar aquí.
    const sentAt = Date.now();
    const result = await attempt(() => sync.createPairingCode());
    if (current !== generation.current) return;
    if (!result.ok) {
      setPairing((prev) => ({
        ...prev,
        busy: false,
        error: syncErrorText(result.code, 'createPairing'),
      }));
      return;
    }
    const { code } = result.value;
    baseline.current = knownIds;
    setPairing({
      shown: { code, deadline: pairingDeadline(sentAt), drawing: null },
      busy: false,
      error: null,
    });
    // La primera vez, el botón desaparece: el foco va al código. Con «Otro código», se queda.
    if (first) focusWhenReady(`${id}-code-title`);
    try {
      const drawing = (await qr).qrDrawing(pairingUrl(window.location.origin, code));
      if (current !== generation.current) return;
      setPairing((prev) =>
        prev.shown?.code === code ? { ...prev, shown: { ...prev.shown, drawing } } : prev,
      );
    } catch (error) {
      // Sin QR sigue valiendo el código escrito.
      logError('storage', error);
    }
  }

  function hide(): void {
    generation.current += 1;
    setPairing({ shown: null, busy: false, error: null });
    focusWhenReady(`${id}-create`);
  }

  // Mientras se ve el código: si el otro dispositivo ya lo ha canjeado, se dice y se oculta.
  const polling = shown !== null && !expired;
  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const current = generation.current;
      void attempt(() => sync.listDevices()).then((result) => {
        if (!result.ok || current !== generation.current) return;
        if (baseline.current === null) {
          baseline.current = new Set(result.value.map((d) => d.id));
          return;
        }
        const added = newDevices(baseline.current, result.value);
        if (added.length === 0) return;
        // Llega sin un gesto: solo se mueve el foco si estaba en el código, que desaparece.
        const active = document.activeElement;
        const moveFocus =
          focusLost(active, document.body) || codeBlock.current?.contains(active) === true;
        generation.current += 1;
        setPairing({ shown: null, busy: false, error: null });
        onPaired(result.value, added, moveFocus);
      });
    }, PAIRING_POLL_MS);
    return () => clearInterval(timer);
  }, [polling, sync, onPaired]);

  const status = (
    <div className="settings__import-result" role="status">
      {pairing.error !== null && <p className="sync__error">{pairing.error}</p>}
    </div>
  );

  return (
    <section className="sync__block" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1} className="settings__subtitle">
        {t.pairTitle}
      </h3>
      <p>{t.pairIntro}</p>
      {shown === null ? (
        <>
          <div className="settings__buttons">
            <button
              id={`${id}-create`}
              type="button"
              className="btn btn--primary"
              aria-disabled={pairing.busy}
              onClick={() => void create()}
            >
              {pairing.busy ? t.pairCreating : t.pairCreate}
            </button>
          </div>
          {status}
        </>
      ) : (
        <div className="sync__pairing" ref={codeBlock}>
          <div className="sync__qr-slot">
            {shown.drawing !== null && !expired ? (
              <svg
                className="sync__qr"
                viewBox={shown.drawing.viewBox}
                role="img"
                aria-label={t.pairQr}
                shapeRendering="crispEdges"
                data-sync-qr=""
              >
                <rect
                  className="sync__qr-light"
                  x={shown.drawing.offset}
                  y={shown.drawing.offset}
                  width={shown.drawing.side}
                  height={shown.drawing.side}
                />
                <path className="sync__qr-dark" d={shown.drawing.path} />
              </svg>
            ) : (
              <span className="sync__qr sync__qr--empty" aria-hidden="true" />
            )}
          </div>
          <div className="sync__pairing-code">
            <h4 id={`${id}-code-title`} tabIndex={-1} className="sync__label">
              {t.pairCode}
            </h4>
            <CodeBox key={shown.code} code={shown.code} expired={expired} />
            <div role="status">
              {expired ? (
                <p className="sync__error">{t.pairExpired}</p>
              ) : (
                <p>
                  {/* La cuenta atrás no se anuncia cada segundo: el lector oye la hora límite. */}
                  <span aria-hidden="true" data-sync-countdown="">
                    {t.pairExpiresIn(formatCountdown(left))}.
                  </span>{' '}
                  <span className="muted">{t.pairValidUntil(formatClock(shown.deadline))}</span>
                </p>
              )}
            </div>
            <div className="settings__buttons">
              <button
                type="button"
                className={expired ? 'btn btn--primary' : 'btn'}
                aria-disabled={pairing.busy}
                onClick={() => void create()}
              >
                {pairing.busy ? t.pairCreating : t.pairAnother}
              </button>
              <button type="button" className="btn btn--ghost" onClick={hide}>
                {t.pairHide}
              </button>
            </div>
            {status}
          </div>
        </div>
      )}
      <p className="muted">{t.pairHome}</p>
    </section>
  );
}

/**
 * Mientras llega la lista: la fila de este dispositivo, que siempre está, con su altura (dos
 * líneas), para que lo de debajo no baje al llegar (§9.5, reglas 3 y 4). Los demás, si los hay,
 * añaden su fila al llegar.
 */
function DevicesSkeleton() {
  return (
    <div className="sync__devices" aria-busy="true">
      <div className="sync__device">
        <div className="sync__device-main">
          <p className="sync__device-name">
            <span className="muted sync__loading">{t.devicesLoading}</span>
          </p>
          <p className="muted" aria-hidden="true">
            <span className="skeleton sync__skeleton">&nbsp;</span>
          </p>
        </div>
      </div>
    </div>
  );
}

/** Los dispositivos de la agenda, con «Desemparejar» y su confirmación en el sitio. */
function DevicesSection({
  sync,
  headingId,
  devices,
  onReload,
  onRevoked,
}: {
  sync: SyncService;
  headingId: string;
  devices: DevicesState;
  onReload: () => void;
  onRevoked: (device: DeviceInfo) => void;
}) {
  const id = useId();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  useTick(60_000);
  const now = Date.now();

  async function revoke(device: DeviceInfo): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const result = await attempt(() => sync.revokeDevice(device.id));
    setBusy(false);
    if (result.ok || result.code === 'not_found') {
      setConfirming(null);
      onRevoked(device);
      focusWhenReady(headingId);
      return;
    }
    setFailure(syncErrorText(result.code, 'revoke'));
  }

  return (
    <section className="sync__block" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1} className="settings__subtitle">
        {t.devicesTitle}
      </h3>
      {devices.kind === 'loading' && <DevicesSkeleton />}
      {devices.kind === 'error' && (
        <div className="settings__import-result" role="status">
          <p className="sync__error">{devices.message}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              // El botón desaparece mientras recarga: el foco va antes al encabezado.
              focusWhenReady(headingId);
              onReload();
            }}
          >
            {t.devicesRetry}
          </button>
        </div>
      )}
      {devices.kind === 'ready' && (
        <ul className="sync__devices" aria-labelledby={headingId}>
          {sortDevices(devices.devices).map((device) => {
            const confirmId = `${id}-confirm-${device.id}`;
            const startId = `${id}-unpair-${device.id}`;
            return (
              <li key={device.id} className="sync__device" data-device-id={device.id}>
                <div className="sync__device-main">
                  <p className="sync__device-name">
                    <span>{device.label}</span>
                    {device.current && <span className="sync__badge">{t.thisDevice}</span>}
                    {device.kind === 'inbox' && <span className="sync__badge">{t.inbox}</span>}
                  </p>
                  <p className="muted">{deviceDetails(device, now)}</p>
                </div>
                {!device.current &&
                  (confirming === device.id ? (
                    // biome-ignore lint/a11y/useSemanticElements: una confirmación con su pregunta y dos botones, no un formulario.
                    <div className="sync__confirm" role="group" aria-labelledby={confirmId}>
                      <p id={confirmId}>
                        {device.kind === 'inbox'
                          ? t.unpairInboxConfirm(device.label)
                          : t.unpairConfirm(device.label)}
                      </p>
                      <div className="settings__buttons">
                        <button
                          type="button"
                          className="btn"
                          onClick={() => {
                            setConfirming(null);
                            setFailure(null);
                            focusWhenReady(startId);
                          }}
                        >
                          {t.cancel}
                        </button>
                        <button
                          id={`${confirmId}-do`}
                          type="button"
                          className="btn btn--danger"
                          aria-disabled={busy}
                          // Ocupado, el nombre es el texto visible, «Desemparejando…» (2.5.3).
                          aria-label={busy ? undefined : t.unpairLabel(device.label)}
                          onClick={() => void revoke(device)}
                        >
                          {busy ? t.unpairing : t.unpair}
                        </button>
                      </div>
                      <div className="settings__import-result" role="status">
                        {failure !== null && <p className="sync__error">{failure}</p>}
                      </div>
                    </div>
                  ) : (
                    <button
                      id={startId}
                      type="button"
                      className="btn btn--danger"
                      aria-label={t.unpairLabel(device.label)}
                      onClick={() => {
                        setConfirming(device.id);
                        setFailure(null);
                        focusWhenReady(`${confirmId}-do`);
                      }}
                    >
                      {t.unpair}
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Una acción con confirmación en el sitio (sin modal, §9.6). `run` devuelve el error, o `null`. */
function ConfirmAction({
  headingId,
  title,
  intro,
  action,
  question,
  confirm,
  busyLabel,
  danger,
  run,
}: {
  headingId: string;
  title: string;
  intro: string;
  action: string;
  question: string;
  confirm: string;
  /** El texto del botón de confirmar mientras espera («Desemparejando…»). */
  busyLabel: string;
  danger: boolean;
  run: () => Promise<string | null>;
}) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function go(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const error = await run();
    setBusy(false);
    if (error !== null) setFailure(error);
    else setConfirming(false);
  }

  return (
    <section className="sync__block" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1} className="settings__subtitle">
        {title}
      </h3>
      <p>{intro}</p>
      {confirming ? (
        // biome-ignore lint/a11y/useSemanticElements: una confirmación con su pregunta y dos botones, no un formulario.
        <div className="sync__confirm" role="group" aria-labelledby={`${id}-question`}>
          <p id={`${id}-question`}>{question}</p>
          <div className="settings__buttons">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setConfirming(false);
                setFailure(null);
                focusWhenReady(`${id}-start`);
              }}
            >
              {t.cancel}
            </button>
            <button
              id={`${id}-do`}
              type="button"
              className={danger ? 'btn btn--danger' : 'btn btn--primary'}
              aria-disabled={busy}
              onClick={() => void go()}
            >
              {busy ? busyLabel : confirm}
            </button>
          </div>
          <div className="settings__import-result" role="status">
            {failure !== null && <p className="sync__error">{failure}</p>}
          </div>
        </div>
      ) : (
        <div className="settings__buttons">
          <button
            id={`${id}-start`}
            type="button"
            className={danger ? 'btn btn--danger' : 'btn'}
            onClick={() => {
              setConfirming(true);
              focusWhenReady(`${id}-do`);
            }}
          >
            {action}
          </button>
        </div>
      )}
    </section>
  );
}

/** Emparejada (o restaurando, CA4.3): estado, emparejar otro, dispositivos y lo demás. */
export function PairedView({
  sync,
  state,
  ids,
  fromLink,
  onNewRecovery,
  onLeft,
  notify,
}: {
  sync: SyncService;
  state: SyncState;
  ids: PanelIds;
  fromLink: boolean;
  onNewRecovery: (code: string) => void;
  onLeft: () => void;
  /** El aviso de la app (`NoticeCenter`): no empuja nada y repite el mismo texto si llega dos veces. */
  notify: (message: string) => void;
}) {
  const [devices, setDevices] = useState<DevicesState>({ kind: 'loading' });
  const loads = useRef(0);

  const load = useCallback(async () => {
    const current = ++loads.current;
    const result = await attempt(() => sync.listDevices());
    if (current !== loads.current) return;
    setDevices(
      result.ok
        ? { kind: 'ready', devices: result.value }
        : { kind: 'error', message: syncErrorText(result.code, 'devices') },
    );
  }, [sync]);

  useEffect(() => {
    void load();
  }, [load]);

  const list = devices.kind === 'ready' ? devices.devices : null;
  const knownIds = useMemo(() => (list === null ? null : new Set(list.map((d) => d.id))), [list]);

  const onPaired = useCallback(
    (all: readonly DeviceInfo[], added: readonly DeviceInfo[], moveFocus: boolean) => {
      loads.current += 1;
      setDevices({ kind: 'ready', devices: all });
      // Llega solo, mientras se mira el código: en el aviso de la app, sin empujar el panel.
      notify(added.map((d) => t.paired(d.label)).join(' '));
      if (moveFocus) focusWhenReady(ids.devices);
    },
    [notify, ids.devices],
  );

  return (
    <>
      {fromLink && <p className="sync__note">{t.fromLinkPaired}</p>}
      <StatusSection sync={sync} state={state} headingId={ids.status} />
      <PairingSection sync={sync} headingId={ids.pairing} knownIds={knownIds} onPaired={onPaired} />
      <DevicesSection
        sync={sync}
        headingId={ids.devices}
        devices={devices}
        onReload={() => {
          setDevices({ kind: 'loading' });
          void load();
        }}
        onRevoked={(device) => {
          notify(t.unpaired(device.label));
          if (list) setDevices({ kind: 'ready', devices: list.filter((d) => d.id !== device.id) });
          void load();
        }}
      />
      <ConfirmAction
        headingId={ids.recovery}
        title={t.newRecoveryTitle}
        intro={t.newRecoveryIntro}
        action={t.newRecovery}
        question={t.newRecoveryConfirm}
        confirm={t.newRecoveryDo}
        busyLabel={t.newRecoveryCreating}
        danger={false}
        run={async () => {
          const result = await attempt(() => sync.createRecoveryCode());
          if (!result.ok) return syncErrorText(result.code, 'createRecovery');
          onNewRecovery(result.value.recoveryCode);
          return null;
        }}
      />
      <ConfirmAction
        headingId={ids.leave}
        title={t.leaveTitle}
        intro={t.leaveIntro}
        action={t.leave}
        // El último con la agenda: su copia sincronizada se queda en el servidor, y se dice.
        question={isLastAppDevice(list) ? t.leaveConfirmLast : t.leaveConfirm}
        confirm={t.leave}
        busyLabel={t.unpairing}
        danger
        run={async () => {
          // El propio id: el de la lista o, si aún no ha llegado, el que se guardó al emparejar.
          let self = list?.find((d) => d.current)?.id ?? state.deviceId;
          if (self === null) {
            const fresh = await attempt(() => sync.listDevices());
            if (!fresh.ok) return syncErrorText(fresh.code, 'leave');
            self = fresh.value.find((d) => d.current)?.id ?? null;
          }
          if (self === null) return syncErrorText('internal', 'leave');
          const selfId = self;
          const result = await attempt(() => sync.revokeDevice(selfId));
          if (!result.ok) return syncErrorText(result.code, 'leave');
          onLeft();
          return null;
        }}
      />
    </>
  );
}

/** Desemparejado (§11.4): lo dice, ofrece el código de recuperación y dejarlo así. */
export function UnpairedView({
  sync,
  state,
  ids,
  linkCode,
  iosTab,
  labelProps,
  onJoined,
  onForgot,
}: {
  sync: SyncService;
  state: SyncState;
  ids: PanelIds;
  linkCode: string | null;
  iosTab: boolean;
  labelProps: LabelProps;
  onJoined: () => void;
  onForgot: () => void;
}) {
  return (
    <>
      <section className="sync__block" aria-labelledby={ids.unpaired}>
        <h3 id={ids.unpaired} tabIndex={-1} className="settings__subtitle">
          {t.unpairedTitle}
        </h3>
        <p className="sync__note" data-sync-unpaired={state.unpairedReason ?? ''}>
          {state.unpairedReason === 'cookies' ? t.unpairedCookies : t.unpairedServer}
        </p>
      </section>
      {/* Volver a emparejar o recuperar crea otra vez las cookies: se avisa aquí también (§11.2). */}
      <div className="sync__block">
        <SyncDisclosure />
      </div>
      <DeviceNameField {...labelProps} />
      <JoinForm
        sync={sync}
        idPrefix={ids.join}
        title={t.rejoinTitle}
        intro={t.unpairedHow}
        primary="recover"
        initialCode={linkCode ?? ''}
        fromLink={linkCode !== null}
        iosTab={iosTab}
        takeLabel={labelProps.takeLabel}
        onJoined={onJoined}
      />
      <ConfirmAction
        headingId={ids.forget}
        title={t.forget}
        intro={t.forgetIntro}
        action={t.forget}
        question={t.forgetConfirm}
        confirm={t.forget}
        busyLabel={t.forgetting}
        danger
        run={async () => {
          const result = await attempt(() => sync.forget());
          if (!result.ok) return syncErrorText(result.code, 'leave');
          onForgot();
          return null;
        }}
      />
    </>
  );
}

export interface PanelIds {
  readonly off: string;
  readonly join: string;
  readonly status: string;
  readonly pairing: string;
  readonly devices: string;
  readonly recovery: string;
  readonly leave: string;
  readonly unpaired: string;
  readonly forget: string;
  readonly reveal: string;
}

export function SyncPanel() {
  const { sync, notices } = useServices();
  const state = useSyncState();
  const base = useId();
  const ids = useMemo<PanelIds>(
    () => ({
      off: `${base}-off`,
      join: `${base}-join`,
      status: `${base}-status`,
      pairing: `${base}-pairing`,
      devices: `${base}-devices`,
      recovery: `${base}-recovery`,
      leave: `${base}-leave`,
      unpaired: `${base}-unpaired`,
      forget: `${base}-forget`,
      reveal: `${base}-reveal`,
    }),
    [base],
  );
  // El código de `/emparejar#…`: se lee al pintar y se gasta al montar (una sola vez). Solo vale en
  // la vista en que se abrió: al cambiar de vista se olvida (`nextPairingLink`).
  const [link, setLink] = useState<PairingLink | null>(() => {
    const code = peekPendingPairingCode();
    return code === null ? null : { code, view: null };
  });
  useEffect(() => {
    takePendingPairingCode();
  }, []);
  const [iosTab] = useState(() => isIosBrowserTab(globalThis.navigator));
  const [label, setLabel] = useState(() =>
    suggestedDeviceLabel(globalThis.navigator?.userAgent ?? '', isDesktopApp()),
  );
  const [labelError, setLabelError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const messageCount = useRef(0);

  const labelId = `${base}-label`;
  const labelProps: LabelProps = {
    labelId,
    label,
    labelError,
    onLabel: (value) => {
      setLabel(value);
      if (labelError !== null && cleanDeviceLabel(value) !== '') setLabelError(null);
    },
    takeLabel: () => {
      const clean = cleanDeviceLabel(label);
      if (clean !== '') return clean;
      setLabelError(t.deviceNameMissing);
      focusWhenReady(labelId);
      return null;
    },
  };

  /** El aviso de arriba, para la vista a la que lleva el gesto; con otro `id`, se repite. */
  function show(text: string, target: PanelView): void {
    messageCount.current += 1;
    setMessage({ id: messageCount.current, text, view: target });
  }
  const notify = useCallback((text: string) => notices.notify(text), [notices]);
  // Mientras se activa, la vista no cambia: al acabar sale el código de recuperación.
  const view: PanelView = revealed !== null ? 'reveal' : activating ? 'off' : syncViewOf(state);

  // Al cambiar de vista, durante el pintado (así la vista nueva ya no ve lo viejo): el aviso de
  // otra vista se borra y el enlace se olvida (ni rellena el campo ni mueve el foco).
  const [lastView, setLastView] = useState(view);
  if (lastView !== view) {
    setLastView(view);
    const kept = messageAfterViewChange(message, view);
    if (kept !== message) setMessage(kept);
  }
  const currentLink = nextPairingLink(link, view);
  if (currentLink !== link) setLink(currentLink);
  const linkCode = currentLink?.view === view ? currentLink.code : null;
  const shownMessage = message?.view === view ? message : null;

  // Si la vista cambia y el foco se ha perdido (estaba en lo que ya no existe; p. ej., un 401 del
  // servidor en una ronda o en una operación), va al encabezado de la vista nueva, que el lector
  // lee. Si estaba fuera de la sección, no se toca. Los gestos de la sección lo llevan al mismo
  // sitio por su cuenta.
  const committedView = useRef(view);
  useLayoutEffect(() => {
    const from = committedView.current;
    if (from === view) return;
    committedView.current = view;
    // De «cargando» a la primera vista: al abrir la sección, el foco lo pone la pantalla (o el
    // enlace del QR, en «Emparejar este dispositivo»).
    if (from === 'loading') return;
    const heading = viewHeading(view);
    if (heading !== null && focusLost(document.activeElement, document.body)) {
      focusWhenReady(ids[heading]);
    }
  }, [view, ids]);

  const onJoined = () => {
    // El código del enlace ya está gastado.
    setLink(null);
    show(t.joined, 'paired');
    focusWhenReady(ids.status);
  };
  const onLeft = () => {
    show(t.left, 'off');
    focusWhenReady(ids.off);
  };

  let content: ReactNode;
  switch (view) {
    case 'loading':
      content = (
        <p className="muted" aria-busy="true">
          {t.loading}
        </p>
      );
      break;
    case 'reveal':
      content = (
        <RecoveryReveal
          code={revealed ?? ''}
          headingId={ids.reveal}
          onDone={() => {
            setRevealed(null);
            focusWhenReady(ids.status);
          }}
        />
      );
      break;
    case 'off':
      content = (
        <OffView
          sync={sync}
          ids={ids}
          linkCode={linkCode}
          iosTab={iosTab}
          labelProps={labelProps}
          onActivating={setActivating}
          onActivated={(code) => {
            setMessage(null);
            setRevealed(code);
          }}
          onJoined={onJoined}
        />
      );
      break;
    case 'paired':
      content = (
        <PairedView
          sync={sync}
          state={state}
          ids={ids}
          fromLink={linkCode !== null}
          onNewRecovery={(code) => {
            setMessage(null);
            setRevealed(code);
          }}
          onLeft={onLeft}
          notify={notify}
        />
      );
      break;
    case 'unpaired':
      content = (
        <UnpairedView
          sync={sync}
          state={state}
          ids={ids}
          linkCode={linkCode}
          iosTab={iosTab}
          labelProps={labelProps}
          onJoined={onJoined}
          onForgot={onLeft}
        />
      );
      break;
  }

  return (
    <div className="sync" data-sync-view={view}>
      <div className="sync__message" role="status">
        {/* Con `key`, el mismo texto otra vez se vuelve a montar y el lector lo anuncia. */}
        {shownMessage !== null && (
          <p key={shownMessage.id} className="sync__note">
            {shownMessage.text}
          </p>
        )}
      </div>
      {content}
    </div>
  );
}
