// Ajustes › Cuenta y sincronización (M4; §9.1, §9.6, §11.2 y §11.4; ADR-011; las cuentas con
// email y contraseña, ADR-014, en `AccountPanel.tsx`). Va en el *chunk* diferido de
// Ajustes, sin Zod: de `@gameagenda/core/api` solo usa las constantes y los códigos, que no lo
// importan. El motor (con Zod) lo carga la fachada al activar o emparejar, y el QR (`qr.ts`, con
// `uqr`) va en su propio *chunk*, que se descarga al pedir un código. Cuatro vistas, según el
// estado de `SyncService`:
// - sin sincronizar: «Iniciar sesión» y «Crear cuenta» (con qué se guarda y la declaración de
//   edad), el nombre del dispositivo y, en «Otras formas de entrar», canjear un código de
//   emparejamiento o el de recuperación, entrar con una llave y sincronizar sin email;
// - recién activada (o con un código de recuperación nuevo): el código, una sola vez;
// - emparejada: el estado, la cuenta, «Emparejar otro dispositivo» (código y QR de 10 min), los dispositivos,
//   las llaves de acceso (ADR-013), el *token* del Atajo de iOS (se ve una vez, con los pasos para crear el atajo), un código de
//   recuperación nuevo y «Desemparejar este dispositivo»;
// - desemparejada (por el servidor o sin cookies): lo dice y ofrece iniciar sesión otra vez o el
//   código de recuperación.
// La sincronización en sí nunca pregunta (RF-26): aquí solo hay gestos explícitos. Las
// confirmaciones van en el sitio, nunca en un modal (§9.6), y el foco sigue a cada cambio de vista,
// también cuando la cambia el servidor (un 401). Lo que llega solo, sin un gesto (otro dispositivo
// se ha emparejado), sale en el aviso de la app (`NoticeCenter`), que no empuja nada (§9.5).
import {
  API_BASE,
  CODE_INPUT_MAX,
  DEFAULT_INBOX_LABEL,
  DEFAULT_MIN_AGE,
  PASSKEYS_MAX,
  type PasskeyInfo,
} from '@gameagenda/core/api';
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
import { syncFirstLayer } from '../../legal/first-layer.ts';
import { LegalParts } from '../../legal/LegalParts.tsx';
import { peekPendingPairingCode, takePendingPairingCode } from '../../router/pairing-link.ts';
import { pairingUrl } from '../../router/routes.ts';
import { LABEL_MAX } from '../../sync/device-label.ts';
import type { DeviceInfo, SyncService, SyncState } from '../../sync/types.ts';
import { AccountForms, AccountSection } from './AccountPanel.tsx';
import { accountTexts } from './account-texts.ts';
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
  passkeyDetails,
  passkeysAvailable,
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
import { attempt, ConfirmAction, describedBy, focusWhenReady } from './sync-ui.tsx';

const t = es.syncPanel;
const loadQr = () => import('./qr.ts');
/** Mientras se ve un código de emparejamiento, cada cuánto se mira si el otro ya lo ha canjeado. */
const PAIRING_POLL_MS = 5000;

/** Vuelve a pintar cada `ms` (para «hace 5 minutos» y la cuenta atrás). */
function useTick(ms: number, enabled = true): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(timer);
  }, [ms, enabled]);
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
      {/* La primera capa de los textos legales (CA4.7; art. 11 LOPDGDD), con su enlace. */}
      <p className="muted" data-sync-legal="">
        <LegalParts parts={syncFirstLayer()} />
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
  knownEmail,
  onActivating,
  onActivated,
  onJoined,
  onLoggedIn,
}: {
  sync: SyncService;
  ids: PanelIds;
  linkCode: string | null;
  iosTab: boolean;
  labelProps: LabelProps;
  /** El email con que se entró en este dispositivo la última vez (`meta.account`), o `''`. */
  knownEmail: string;
  onActivating: (busy: boolean) => void;
  onActivated: (recoveryCode: string) => void;
  onJoined: () => void;
  onLoggedIn: () => void;
}) {
  const id = useId();
  const [age, setAge] = useState(false);
  // «Sincronizar sin email»: lo de dentro solo existe abierto (así no hay dos casillas de edad).
  const [noEmailOpen, setNoEmailOpen] = useState(false);
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
      <AccountForms
        key={knownEmail}
        sync={sync}
        headingId={ids.off}
        initialEmail={knownEmail}
        allowSignUp
        takeLabel={labelProps.takeLabel}
        onBusy={onActivating}
        onSignedUp={onActivated}
        onLoggedIn={onLoggedIn}
        otherWaysId={ids.otherWays}
        disclosure={<SyncDisclosure />}
      />
      <DeviceNameField {...labelProps} />
      <section className="sync__block" aria-labelledby={ids.otherWays}>
        <h3 id={ids.otherWays} tabIndex={-1} className="settings__subtitle">
          {accountTexts.otherWaysTitle}
        </h3>
        <p>{accountTexts.otherWaysIntro}</p>
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
      <PasskeyJoin
        sync={sync}
        headingId={ids.passkeyJoin}
        takeLabel={labelProps.takeLabel}
        onJoined={onJoined}
      />
      {/* Cerrado: es la forma menos habitual, y así la edad y el aviso no salen dos veces. */}
      <details
        className="sync__block sync__details"
        open={noEmailOpen}
        onToggle={(event) => setNoEmailOpen(event.currentTarget.open)}
      >
        <summary id={ids.activate} className="settings__subtitle">
          {t.activateTitle}
        </summary>
        {noEmailOpen && (
          <>
            <p>{t.intro}</p>
            <SyncDisclosure />
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
          </>
        )}
      </details>
    </>
  );
}

/** El código de recuperación, una sola vez (§11.4), con el foco en su encabezado. */
function RecoveryReveal({
  sync,
  code,
  headingId,
  offerPasskey,
  onDone,
}: {
  sync: SyncService;
  code: string;
  headingId: string;
  /** Al activar: ofrece guardar también una llave de acceso (ADR-013). */
  offerPasskey: boolean;
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
      {offerPasskey && <PasskeyOffer sync={sync} afterId={`${headingId}-done`} />}
      <div className="settings__buttons">
        <button
          id={`${headingId}-done`}
          type="button"
          className="btn btn--primary"
          onClick={onDone}
        >
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

/**
 * «Entrar con una llave de acceso» (sin sincronizar o desemparejado; ADR-013): el navegador enseña
 * las llaves de este sitio y la elegida une este dispositivo a su agenda, como el código de
 * recuperación. Cerrar el diálogo no es un error. Sin WebAuthn, no sale.
 */
function PasskeyJoin({
  sync,
  headingId,
  takeLabel,
  onJoined,
}: {
  sync: SyncService;
  headingId: string;
  takeLabel: () => string | null;
  onJoined: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!passkeysAvailable()) return null;

  async function join(): Promise<void> {
    if (busy) return;
    setFailure(null);
    const label = takeLabel();
    if (label === null) return;
    setBusy(true);
    const result = await attempt(() => sync.redeemPasskey(label));
    setBusy(false);
    if (result.ok) onJoined();
    else if (result.code !== 'passkey_cancelled') {
      setFailure(syncErrorText(result.code, 'passkeyJoin'));
    }
  }

  return (
    <section className="sync__block" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1} className="settings__subtitle">
        {t.passkeyJoinTitle}
      </h3>
      <p>{t.passkeyJoinIntro}</p>
      <div className="settings__buttons">
        <button type="button" className="btn" aria-disabled={busy} onClick={() => void join()}>
          {busy ? t.passkeyJoining : t.passkeyJoin}
        </button>
      </div>
      <div className="settings__import-result" role="status">
        {failure !== null && <p className="sync__error">{failure}</p>}
      </div>
    </section>
  );
}

/**
 * Tras el código de recuperación, al activar: guardar también una llave de acceso, por si se pierde
 * el código. Al guardarla, el foco va a `afterId` («Ya lo he guardado»).
 */
function PasskeyOffer({ sync, afterId }: { sync: SyncService; afterId: string }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!passkeysAvailable()) return null;

  async function create(): Promise<void> {
    if (busy || done) return;
    setBusy(true);
    setFailure(null);
    const result = await attempt(() => sync.createPasskey());
    setBusy(false);
    if (result.ok) {
      setDone(true);
      focusWhenReady(afterId);
    } else if (result.code !== 'passkey_cancelled') {
      setFailure(syncErrorText(result.code, 'passkeyCreate'));
    }
  }

  return (
    <div className="sync__offer">
      <p>{t.passkeyOffer}</p>
      {!done && (
        <div className="settings__buttons">
          <button type="button" className="btn" aria-disabled={busy} onClick={() => void create()}>
            {busy ? t.passkeyCreating : t.passkeyCreate}
          </button>
        </div>
      )}
      <div className="settings__import-result" role="status">
        {done && <p>{t.passkeyCreated}</p>}
        {failure !== null && <p className="sync__error">{failure}</p>}
      </div>
    </div>
  );
}

type PasskeysState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly passkeys: readonly PasskeyInfo[] }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'disabled' };

/**
 * Las llaves de acceso de la agenda (sincronizada; ADR-013): la lista, crear otra y quitar, con la
 * confirmación en el sitio, como los dispositivos. Con las llaves apagadas en el servidor no sale;
 * sin WebAuthn en este navegador, solo la lista (para poder quitarlas), si hay alguna.
 */
function PasskeysSection({ sync, headingId }: { sync: SyncService; headingId: string }) {
  const id = useId();
  const [state, setState] = useState<PasskeysState>({ kind: 'loading' });
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeFailure, setRemoveFailure] = useState<string | null>(null);
  useTick(60_000);
  const now = Date.now();

  const load = useCallback(async () => {
    const result = await attempt(() => sync.listPasskeys());
    if (result.ok) setState({ kind: 'ready', passkeys: result.value });
    else if (result.code === 'passkeys_disabled') setState({ kind: 'disabled' });
    else setState({ kind: 'error', message: syncErrorText(result.code, 'passkeys') });
  }, [sync]);

  useEffect(() => {
    void load();
  }, [load]);

  const supported = passkeysAvailable();
  const list = state.kind === 'ready' ? state.passkeys : null;
  if (state.kind === 'disabled') return null;
  if (!supported && list !== null && list.length === 0) return null;
  const full = list !== null && list.length >= PASSKEYS_MAX;

  async function create(): Promise<void> {
    if (creating || full) return;
    setCreating(true);
    setMessage(null);
    const result = await attempt(() => sync.createPasskey());
    setCreating(false);
    if (result.ok) {
      setState({ kind: 'ready', passkeys: result.value });
      setMessage({ text: t.passkeyCreated, error: false });
    } else if (result.code !== 'passkey_cancelled') {
      setMessage({ text: syncErrorText(result.code, 'passkeyCreate'), error: true });
    }
  }

  async function remove(passkey: PasskeyInfo): Promise<void> {
    if (removing) return;
    setRemoving(true);
    setRemoveFailure(null);
    const result = await attempt(() => sync.removePasskey(passkey.id));
    setRemoving(false);
    if (result.ok || result.code === 'not_found') {
      setConfirming(null);
      setState({
        kind: 'ready',
        passkeys: result.ok ? result.value : (list ?? []).filter((p) => p.id !== passkey.id),
      });
      setMessage({ text: t.passkeyRemoved, error: false });
      focusWhenReady(headingId);
      return;
    }
    setRemoveFailure(syncErrorText(result.code, 'passkeyRemove'));
  }

  return (
    <section className="sync__block" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1} className="settings__subtitle">
        {t.passkeysTitle}
      </h3>
      <p>{t.passkeysIntro}</p>
      {state.kind === 'loading' && (
        <p className="muted" aria-busy="true">
          {t.passkeysLoading}
        </p>
      )}
      {state.kind === 'error' && (
        <div className="settings__import-result" role="status">
          <p className="sync__error">{state.message}</p>
          <button
            type="button"
            className="btn"
            onClick={() => {
              focusWhenReady(headingId);
              setState({ kind: 'loading' });
              void load();
            }}
          >
            {t.devicesRetry}
          </button>
        </div>
      )}
      {list !== null && list.length === 0 && <p className="muted">{t.passkeysNone}</p>}
      {list !== null && list.length > 0 && (
        <ul className="sync__devices" aria-labelledby={headingId}>
          {list.map((passkey) => {
            const confirmId = `${id}-confirm-${passkey.id}`;
            const startId = `${id}-remove-${passkey.id}`;
            return (
              <li key={passkey.id} className="sync__device" data-passkey-id={passkey.id}>
                <div className="sync__device-main">
                  <p className="sync__device-name">
                    <span>{t.passkeyName(passkey.label)}</span>
                  </p>
                  <p className="muted">{passkeyDetails(passkey, now)}</p>
                </div>
                {confirming === passkey.id ? (
                  // biome-ignore lint/a11y/useSemanticElements: una confirmación con su pregunta y dos botones, no un formulario.
                  <div className="sync__confirm" role="group" aria-labelledby={confirmId}>
                    <p id={confirmId}>{t.passkeyRemoveConfirm(passkey.label)}</p>
                    <div className="settings__buttons">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setConfirming(null);
                          setRemoveFailure(null);
                          focusWhenReady(startId);
                        }}
                      >
                        {t.cancel}
                      </button>
                      <button
                        id={`${confirmId}-do`}
                        type="button"
                        className="btn btn--danger"
                        aria-disabled={removing}
                        aria-label={removing ? undefined : t.passkeyRemoveLabel(passkey.label)}
                        onClick={() => void remove(passkey)}
                      >
                        {removing ? t.passkeyRemoving : t.passkeyRemove}
                      </button>
                    </div>
                    <div className="settings__import-result" role="status">
                      {removeFailure !== null && <p className="sync__error">{removeFailure}</p>}
                    </div>
                  </div>
                ) : (
                  <button
                    id={startId}
                    type="button"
                    className="btn btn--danger"
                    aria-label={t.passkeyRemoveLabel(passkey.label)}
                    onClick={() => {
                      setConfirming(passkey.id);
                      setRemoveFailure(null);
                      focusWhenReady(`${confirmId}-do`);
                    }}
                  >
                    {t.passkeyRemove}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {supported && list !== null && (
        <div className="settings__buttons">
          <button
            type="button"
            className="btn"
            aria-disabled={creating || full}
            aria-describedby={full ? `${id}-full` : undefined}
            onClick={() => void create()}
          >
            {creating ? t.passkeyCreating : t.passkeyCreate}
          </button>
        </div>
      )}
      {full && (
        <p id={`${id}-full`} className="muted">
          {t.passkeysFullNote(PASSKEYS_MAX)}
        </p>
      )}
      <div className="settings__import-result" role="status">
        {message !== null && (
          <p className={message.error ? 'sync__error' : undefined}>{message.text}</p>
        )}
      </div>
    </section>
  );
}

/** Un valor para copiar en el atajo (la dirección o el encabezado), en monoespaciada. */
function CopyValue({
  id,
  label,
  value,
  copyLabel,
  onCopy,
}: {
  id: string;
  label: string;
  value: string;
  copyLabel: string;
  onCopy: (ok: boolean) => void;
}) {
  return (
    <div className="sync__field">
      <h5 id={`${id}-label`} className="sync__label">
        {label}
      </h5>
      <p className="sync__value" data-sync-value={id}>
        {value}
      </p>
      <div className="settings__buttons">
        <button
          type="button"
          className="btn"
          aria-describedby={`${id}-label`}
          onClick={() => void copyText(value).then(onCopy)}
        >
          {copyLabel}
        </button>
      </div>
    </div>
  );
}

/**
 * «Atajo de iOS» (CA4.5; §11.4): crea un *token* de solo escritura para el buzón, que se ve una
 * sola vez junto con la dirección y los pasos para crear el atajo en la app Atajos. El *token*
 * nuevo sale en «Dispositivos» (`onCreated` vuelve a cargar la lista).
 */
function InboxSection({
  sync,
  headingId,
  onCreated,
}: {
  sync: SyncService;
  headingId: string;
  onCreated: () => void;
}) {
  const id = useId();
  const [label, setLabel] = useState<string>(DEFAULT_INBOX_LABEL);
  const [labelError, setLabelError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<'address' | 'header' | 'failed' | null>(null);
  // Solo con el token a la vista (las pruebas pintan el panel en Node, sin `window`).
  const address = token === null ? '' : `${window.location.origin}${API_BASE}/inbox`;
  const nameId = `${id}-name`;
  const revealId = `${id}-reveal`;
  const createId = `${id}-create`;

  async function create(): Promise<void> {
    if (busy) return;
    setFailure(null);
    const clean = cleanDeviceLabel(label);
    if (clean === '') {
      setLabelError(true);
      focusWhenReady(nameId);
      return;
    }
    setBusy(true);
    const result = await attempt(() => sync.createInboxToken(clean));
    setBusy(false);
    if (!result.ok) {
      setFailure(syncErrorText(result.code, 'createInbox'));
      return;
    }
    setCopied(null);
    setToken(result.value.token);
    onCreated();
    focusWhenReady(revealId);
  }

  function done(): void {
    setToken(null);
    setCopied(null);
    focusWhenReady(createId);
  }

  return (
    <section className="sync__block" aria-labelledby={headingId} data-sync-inbox="">
      <h3 id={headingId} tabIndex={-1} className="settings__subtitle">
        {t.inboxTitle}
      </h3>
      <p>{t.inboxIntro}</p>
      <p className="muted">{t.inboxSafe}</p>
      {token === null ? (
        <form
          className="sync__form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="sync__field">
            <label htmlFor={nameId} className="sync__label">
              {t.inboxName}
            </label>
            <input
              id={nameId}
              className="field"
              value={label}
              maxLength={LABEL_MAX}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={labelError ? true : undefined}
              aria-describedby={describedBy(`${nameId}-hint`, labelError && `${nameId}-error`)}
              onChange={(event) => {
                setLabel(event.target.value);
                setLabelError(false);
              }}
            />
            <p id={`${nameId}-hint`} className="muted">
              {t.inboxNameHint}
            </p>
            {labelError && (
              <p id={`${nameId}-error`} className="sync__error">
                {t.inboxNameMissing}
              </p>
            )}
          </div>
          <div className="settings__buttons">
            <button id={createId} type="submit" className="btn" aria-disabled={busy}>
              {busy ? t.inboxCreating : t.inboxCreate}
            </button>
          </div>
          <div className="settings__import-result" role="status">
            {failure !== null && <p className="sync__error">{failure}</p>}
          </div>
        </form>
      ) : (
        <div className="sync__inbox-reveal" data-sync-inbox-reveal="">
          <h4 id={revealId} tabIndex={-1} className="sync__label">
            {t.inboxRevealTitle}
          </h4>
          <p className="sync__note">
            <strong>{t.inboxOnce}</strong>
          </p>
          <CopyValue
            id={`${id}-address`}
            label={t.inboxAddress}
            value={address}
            copyLabel={t.inboxCopyAddress}
            onCopy={(ok) => setCopied(ok ? 'address' : 'failed')}
          />
          <CopyValue
            id={`${id}-header`}
            label={t.inboxHeader}
            value={`Bearer ${token}`}
            copyLabel={t.inboxCopyHeader}
            onCopy={(ok) => setCopied(ok ? 'header' : 'failed')}
          />
          <div className="settings__import-result" role="status">
            {copied === 'address' && <p>{t.inboxCopiedAddress}</p>}
            {copied === 'header' && <p>{t.inboxCopiedHeader}</p>}
            {copied === 'failed' && <p>{t.inboxCopyFailed}</p>}
          </div>
          <h5 id={`${id}-steps`} className="sync__label">
            {t.inboxStepsTitle}
          </h5>
          <ol className="sync__steps" aria-labelledby={`${id}-steps`}>
            {t.inboxSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <div className="settings__buttons">
            <button type="button" className="btn btn--primary" onClick={done}>
              {t.inboxDone}
            </button>
          </div>
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
      <AccountSection sync={sync} headingId={ids.account} notify={notify} />
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
      <InboxSection sync={sync} headingId={ids.inbox} onCreated={() => void load()} />
      <PasskeysSection sync={sync} headingId={ids.passkeys} />
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
        busyLabel={t.leaving}
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
  knownEmail,
  onJoined,
  onLoggedIn,
  onForgot,
}: {
  sync: SyncService;
  state: SyncState;
  ids: PanelIds;
  linkCode: string | null;
  iosTab: boolean;
  labelProps: LabelProps;
  knownEmail: string;
  onJoined: () => void;
  onLoggedIn: () => void;
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
      <AccountForms
        key={knownEmail}
        sync={sync}
        headingId={ids.account}
        initialEmail={knownEmail}
        allowSignUp={false}
        takeLabel={labelProps.takeLabel}
        onBusy={() => {}}
        onSignedUp={() => {}}
        onLoggedIn={onLoggedIn}
        otherWaysId={ids.join}
        disclosure={null}
      />
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
      <PasskeyJoin
        sync={sync}
        headingId={ids.passkeyJoin}
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
  readonly inbox: string;
  readonly recovery: string;
  readonly leave: string;
  readonly unpaired: string;
  readonly forget: string;
  readonly reveal: string;
  readonly passkeys: string;
  readonly passkeyJoin: string;
  readonly account: string;
  readonly otherWays: string;
  readonly activate: string;
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
      inbox: `${base}-inbox`,
      recovery: `${base}-recovery`,
      leave: `${base}-leave`,
      unpaired: `${base}-unpaired`,
      forget: `${base}-forget`,
      reveal: `${base}-reveal`,
      passkeys: `${base}-passkeys`,
      passkeyJoin: `${base}-passkey-join`,
      account: `${base}-account`,
      otherWays: `${base}-other-ways`,
      activate: `${base}-activate`,
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
  // El código de recuperación recién activada (no uno nuevo): con la oferta de la llave.
  const [offerPasskey, setOfferPasskey] = useState(false);
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const messageCount = useRef(0);
  // El email con que se entró aquí la última vez (ADR-014), para rellenar «Iniciar sesión».
  const [knownEmail, setKnownEmail] = useState('');
  useEffect(() => {
    if (state.status === 'paired') return;
    let live = true;
    void sync.localAccount().then((account) => {
      if (live) setKnownEmail(account.email ?? '');
    });
    return () => {
      live = false;
    };
  }, [sync, state.status]);

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
  const onLoggedIn = () => {
    setLink(null);
    show(accountTexts.loggedIn, 'paired');
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
          sync={sync}
          code={revealed ?? ''}
          headingId={ids.reveal}
          offerPasskey={offerPasskey}
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
          knownEmail={knownEmail}
          onActivating={setActivating}
          onActivated={(code) => {
            setMessage(null);
            setOfferPasskey(true);
            setRevealed(code);
          }}
          onJoined={onJoined}
          onLoggedIn={onLoggedIn}
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
            setOfferPasskey(false);
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
          knownEmail={knownEmail}
          onJoined={onJoined}
          onLoggedIn={onLoggedIn}
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
