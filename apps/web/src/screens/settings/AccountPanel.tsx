// Ajustes › Cuenta y sincronización: la cuenta con email y contraseña (ADR-014). La cuenta es la
// agenda sincronizada (ADR-011) con un email y una contraseña, así que estas piezas van dentro de
// `SyncPanel.tsx`:
// - sin sesión (`AccountForms`): «Iniciar sesión» y «Crear cuenta», con «He olvidado mi
//   contraseña», que explica cómo entrar sin ella (no se envían correos);
// - con sesión (`AccountSection`): con qué email se entró, cambiar la contraseña o el email,
//   añadirlos a una agenda que no los tenía, y quitarlos.
// Son formularios de verdad (`<form>`, `autocomplete` `username`, `current-password` y
// `new-password`), para que los gestores de contraseñas los guarden y los rellenen. La contraseña
// nunca sale del dispositivo: la fachada calcula con ella `authKey` (PBKDF2), en el motor.
import { ACCOUNT_PASSWORD_MIN, DEFAULT_MIN_AGE, normalizeEmail } from '@gameagenda/core/api';
import { type ReactNode, useCallback, useEffect, useId, useState } from 'react';
import { es } from '../../i18n/es.ts';
import type { AccountInfo, SyncService } from '../../sync/types.ts';
import { accountTexts } from './account-texts.ts';
import { SteamLinkSection } from './SteamLinkSection.tsx';
import { type FieldProblem, loginProblems, syncErrorText } from './sync-model.ts';
import { attempt, ConfirmAction, describedBy, focusWhenReady } from './sync-ui.tsx';

const t = es.syncPanel;
const a = accountTexts;

type AccountMode = 'logIn' | 'signUp';

/** Los errores de los campos, por campo. */
function problemOf(problems: readonly FieldProblem[], field: FieldProblem['field']) {
  return problems.find((p) => p.field === field)?.message ?? null;
}

function EmailField({
  id,
  value,
  error,
  onChange,
}: {
  id: string;
  value: string;
  error: string | null;
  onChange: (value: string) => void;
}) {
  return (
    <div className="sync__field">
      <label htmlFor={id} className="sync__label">
        {a.email}
      </label>
      <input
        id={id}
        className="field"
        type="email"
        inputMode="email"
        // `username`: los gestores de contraseñas lo emparejan con la contraseña de al lado.
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        aria-invalid={error !== null ? true : undefined}
        aria-describedby={error !== null ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error !== null && (
        <p id={`${id}-error`} className="sync__error">
          {error}
        </p>
      )}
    </div>
  );
}

function PasswordField({
  id,
  label,
  value,
  fresh,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  /** Una contraseña nueva (crear la cuenta o cambiarla): con sus reglas y `new-password`. */
  fresh: boolean;
  error: string | null;
  onChange: (value: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="sync__field">
      <label htmlFor={id} className="sync__label">
        {label}
      </label>
      <div className="sync__password">
        <input
          id={id}
          className="field"
          type={shown ? 'text' : 'password'}
          autoComplete={fresh ? 'new-password' : 'current-password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={describedBy(fresh && `${id}-hint`, error !== null && `${id}-error`)}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          type="button"
          className="btn sync__password-toggle"
          aria-pressed={shown}
          aria-controls={id}
          onClick={() => setShown((s) => !s)}
        >
          {a.showPassword}
        </button>
      </div>
      {fresh && (
        <p id={`${id}-hint`} className="muted">
          {a.passwordHint(ACCOUNT_PASSWORD_MIN)}
        </p>
      )}
      {error !== null && (
        <p id={`${id}-error`} className="sync__error">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * El email y la contraseña, comprobados en el sitio: el primer campo que no vale recibe el foco.
 * Devuelve `null` si los dos valen.
 */
function useLoginFields(prefix: string, fresh: boolean, initialEmail = '') {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [problems, setProblems] = useState<readonly FieldProblem[]>([]);
  const emailId = `${prefix}-email`;
  const passwordId = `${prefix}-password`;
  return {
    email,
    password,
    emailId,
    passwordId,
    emailError: problemOf(problems, 'email'),
    passwordError: problemOf(problems, 'password'),
    setEmail: (value: string) => {
      setEmail(value);
      if (problemOf(problems, 'email') !== null) {
        setProblems(problems.filter((p) => p.field !== 'email'));
      }
    },
    setPassword: (value: string) => {
      setPassword(value);
      if (problemOf(problems, 'password') !== null) {
        setProblems(problems.filter((p) => p.field !== 'password'));
      }
    },
    /** Un error del servidor que es de un campo (`invalid_login` va a la contraseña). */
    blame: (field: FieldProblem['field'], message: string) => {
      setProblems([{ field, message }]);
      focusWhenReady(field === 'email' ? emailId : passwordId);
    },
    check(): boolean {
      const found = loginProblems(email, password, fresh);
      setProblems(found);
      const first = found[0];
      if (first !== undefined) focusWhenReady(first.field === 'email' ? emailId : passwordId);
      return found.length === 0;
    },
    clearPassword: () => setPassword(''),
  };
}

/**
 * Sin sesión: «Iniciar sesión» y «Crear cuenta». `takeLabel` da el nombre del dispositivo (o `null`
 * si falta, y entonces el foco va a su campo). Crear la cuenta enseña el código de recuperación
 * (`onSignedUp`), como activar la sincronización.
 */
export function AccountForms({
  sync,
  headingId,
  initialEmail,
  allowSignUp,
  takeLabel,
  onBusy,
  onSignedUp,
  onLoggedIn,
  otherWaysId,
  disclosure,
}: {
  sync: SyncService;
  headingId: string;
  initialEmail: string;
  /** Desemparejado no se crea otra cuenta: solo se vuelve a entrar. */
  allowSignUp: boolean;
  takeLabel: () => string | null;
  /** Mientras se crea la cuenta, la vista no cambia: al acabar sale el código de recuperación. */
  onBusy: (busy: boolean) => void;
  onSignedUp: (recoveryCode: string) => void;
  onLoggedIn: () => void;
  /** El encabezado de «Otras formas de entrar», al que lleva «He olvidado mi contraseña». */
  otherWaysId: string;
  /** Qué se guarda y las cookies, con la primera capa de los textos legales (§11.2). */
  disclosure: ReactNode;
}) {
  const id = useId();
  const [chosen, setMode] = useState<AccountMode>(initialEmail === '' ? 'signUp' : 'logIn');
  const mode: AccountMode = allowSignUp ? chosen : 'logIn';
  return (
    <section className="sync__block" aria-labelledby={headingId}>
      <h3 id={headingId} tabIndex={-1} className="settings__subtitle">
        {allowSignUp ? a.accountTitle : a.logInAgainTitle}
      </h3>
      <p>{allowSignUp ? a.accountIntro : a.logInAgainIntro}</p>
      {allowSignUp && (
        // biome-ignore lint/a11y/useSemanticElements: dos botones conmutables, no un formulario.
        <div className="view-toggle sync__modes" role="group" aria-label={a.accountModes}>
          {(['logIn', 'signUp'] as const).map((m) => (
            <button
              key={m}
              id={`${id}-${m}-tab`}
              type="button"
              className="btn sync__mode"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {m === 'logIn' ? a.logInTab : a.signUpTab}
            </button>
          ))}
        </div>
      )}
      {mode === 'logIn' ? (
        <LogInForm
          key="logIn"
          sync={sync}
          prefix={`${id}-login`}
          initialEmail={initialEmail}
          takeLabel={takeLabel}
          onLoggedIn={onLoggedIn}
          otherWaysId={otherWaysId}
          disclosure={disclosure}
        />
      ) : (
        <SignUpForm
          key="signUp"
          sync={sync}
          prefix={`${id}-signup`}
          takeLabel={takeLabel}
          onBusy={onBusy}
          onSignedUp={onSignedUp}
          disclosure={disclosure}
        />
      )}
    </section>
  );
}

function LogInForm({
  sync,
  prefix,
  initialEmail,
  takeLabel,
  onLoggedIn,
  otherWaysId,
  disclosure,
}: {
  sync: SyncService;
  prefix: string;
  initialEmail: string;
  takeLabel: () => string | null;
  onLoggedIn: () => void;
  otherWaysId: string;
  /** Entrar también crea las cookies: el aviso va junto al botón (§11.2). */
  disclosure: ReactNode;
}) {
  const fields = useLoginFields(prefix, false, initialEmail);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [forgot, setForgot] = useState(false);

  async function logIn(): Promise<void> {
    if (busy) return;
    setFailure(null);
    const label = takeLabel();
    if (label === null || !fields.check()) return;
    setBusy(true);
    const result = await attempt(() =>
      sync.logIn({ email: fields.email, password: fields.password, label }),
    );
    setBusy(false);
    if (result.ok) {
      onLoggedIn();
      return;
    }
    const message = syncErrorText(result.code, 'logIn');
    if (result.code === 'invalid_login') {
      fields.clearPassword();
      fields.blame('password', message);
    } else setFailure(message);
  }

  return (
    <form
      className="sync__form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void logIn();
      }}
    >
      <EmailField
        id={fields.emailId}
        value={fields.email}
        error={fields.emailError}
        onChange={fields.setEmail}
      />
      <PasswordField
        id={fields.passwordId}
        label={a.password}
        value={fields.password}
        fresh={false}
        error={fields.passwordError}
        onChange={fields.setPassword}
      />
      <p className="muted">{a.logInJoins}</p>
      {disclosure}
      <div className="settings__buttons">
        <button type="submit" className="btn btn--primary" aria-disabled={busy}>
          {busy ? a.loggingIn : a.logIn}
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          aria-expanded={forgot}
          aria-controls={`${prefix}-forgot`}
          onClick={() => setForgot((f) => !f)}
        >
          {a.forgot}
        </button>
      </div>
      <div id={`${prefix}-forgot`} hidden={!forgot}>
        <p className="sync__note">
          {a.forgotHelp}{' '}
          <a
            href={`#${otherWaysId}`}
            onClick={(event) => {
              event.preventDefault();
              focusWhenReady(otherWaysId);
            }}
          >
            {a.otherWaysTitle}
          </a>
        </p>
      </div>
      <div className="settings__import-result" role="status">
        {busy && <p>{a.loggingIn}</p>}
        {failure !== null && <p className="sync__error">{failure}</p>}
      </div>
    </form>
  );
}

function SignUpForm({
  sync,
  prefix,
  takeLabel,
  onBusy,
  onSignedUp,
  disclosure,
}: {
  sync: SyncService;
  prefix: string;
  takeLabel: () => string | null;
  onBusy: (busy: boolean) => void;
  onSignedUp: (recoveryCode: string) => void;
  disclosure: ReactNode;
}) {
  const fields = useLoginFields(prefix, true);
  const [age, setAge] = useState(false);
  const [ageError, setAgeError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const ageId = `${prefix}-age`;

  async function signUp(): Promise<void> {
    if (busy) return;
    setFailure(null);
    const label = takeLabel();
    if (label === null || !fields.check()) return;
    if (!age) {
      setAgeError(true);
      focusWhenReady(ageId);
      return;
    }
    setBusy(true);
    onBusy(true);
    const result = await attempt(() =>
      sync.createAccount({
        email: fields.email,
        password: fields.password,
        label,
        minAge: DEFAULT_MIN_AGE,
      }),
    );
    setBusy(false);
    onBusy(false);
    if (result.ok) {
      onSignedUp(result.value.recoveryCode);
      return;
    }
    const message = syncErrorText(result.code, 'signUp');
    if (result.code === 'email_taken') fields.blame('email', message);
    else setFailure(message);
  }

  return (
    <form
      className="sync__form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void signUp();
      }}
    >
      <EmailField
        id={fields.emailId}
        value={fields.email}
        error={fields.emailError}
        onChange={fields.setEmail}
      />
      <PasswordField
        id={fields.passwordId}
        label={a.password}
        value={fields.password}
        fresh
        error={fields.passwordError}
        onChange={fields.setPassword}
      />
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
      <p className="muted">{a.signUpStored}</p>
      {disclosure}
      <div className="settings__buttons">
        <button type="submit" className="btn btn--primary" aria-disabled={busy}>
          {busy ? a.signingUp : a.signUp}
        </button>
      </div>
      <div className="settings__import-result" role="status">
        {busy && <p>{a.signingUp}</p>}
        {failure !== null && <p className="sync__error">{failure}</p>}
      </div>
    </form>
  );
}

type AccountState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly info: AccountInfo; readonly email: string | null };

/** Qué formulario está abierto con sesión: añadir, cambiar la contraseña o cambiar el email. */
type Editing = 'add' | 'password' | 'email' | null;

/** Con sesión: lo que tiene la cuenta y, detrás, Steam vinculado (`SteamLinkSection`). */
export function AccountSection({
  sync,
  headingId,
  notify,
}: {
  sync: SyncService;
  headingId: string;
  notify: (message: string) => void;
}) {
  const id = useId();
  const [state, setState] = useState<AccountState>({ kind: 'loading' });
  const [editing, setEditing] = useState<Editing>(null);

  const load = useCallback(async () => {
    const [result, local] = await Promise.all([attempt(() => sync.account()), sync.localAccount()]);
    if (result.ok) setState({ kind: 'ready', info: result.value, email: local.email });
    else setState({ kind: 'error', message: syncErrorText(result.code, 'account') });
  }, [sync]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback((info: AccountInfo, email?: string | null) => {
    setState((current) => ({
      kind: 'ready',
      info,
      email: email !== undefined ? email : current.kind === 'ready' ? current.email : null,
    }));
  }, []);

  let body: ReactNode;
  if (state.kind === 'loading') {
    body = (
      <p className="muted" aria-busy="true">
        {a.accountLoading}
      </p>
    );
  } else if (state.kind === 'error') {
    body = (
      <>
        <p className="sync__error">{state.message}</p>
        <div className="settings__buttons">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setState({ kind: 'loading' });
              void load();
            }}
          >
            {a.accountRetry}
          </button>
        </div>
      </>
    );
  } else {
    const { info, email } = state;
    const close = (to: string) => {
      setEditing(null);
      focusWhenReady(to);
    };
    body = (
      <>
        <p data-account-login={info.hasLogin ? 'yes' : 'no'}>
          {info.hasLogin
            ? email !== null
              ? a.accountAs(email)
              : a.accountWithLogin
            : a.accountWithoutLogin}
        </p>
        {editing === null ? (
          <div className="settings__buttons">
            {info.hasLogin ? (
              <>
                <button
                  id={`${id}-password`}
                  type="button"
                  className="btn"
                  onClick={() => setEditing('password')}
                >
                  {a.changePassword}
                </button>
                <button
                  id={`${id}-email`}
                  type="button"
                  className="btn"
                  onClick={() => setEditing('email')}
                >
                  {a.changeEmail}
                </button>
              </>
            ) : (
              <button
                id={`${id}-add`}
                type="button"
                className="btn btn--primary"
                onClick={() => setEditing('add')}
              >
                {a.addLogin}
              </button>
            )}
          </div>
        ) : (
          <LoginDetailsForm
            sync={sync}
            prefix={`${id}-edit`}
            editing={editing}
            email={email ?? ''}
            onCancel={() => close(`${id}-${editing}`)}
            onSaved={(saved, savedEmail) => {
              update(saved, savedEmail);
              notify(a.loginSaved);
              close(headingId);
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <section className="sync__block" aria-labelledby={headingId}>
        <h3 id={headingId} tabIndex={-1} className="settings__subtitle">
          {a.accountTitle}
        </h3>
        {body}
      </section>
      {state.kind === 'ready' && (
        <SteamLinkSection
          sync={sync}
          info={state.info}
          onInfo={(info) => update(info)}
          notify={notify}
          headingId={headingId}
        />
      )}
      {state.kind === 'ready' && state.info.hasLogin && (
        <ConfirmAction
          headingId={`${id}-remove`}
          title={a.removeLoginTitle}
          intro={a.removeLoginIntro}
          action={a.removeLoginTitle}
          question={a.removeLoginConfirm}
          confirm={a.removeLoginDo}
          busyLabel={a.removingLogin}
          danger
          run={async () => {
            const result = await attempt(() => sync.removeLoginDetails());
            if (!result.ok) return syncErrorText(result.code, 'loginDetails');
            update(result.value, null);
            notify(a.loginRemoved);
            focusWhenReady(headingId);
            return null;
          }}
        />
      )}
    </>
  );
}

/** Añadir, o cambiar, el email y la contraseña. Con «Cambiar la contraseña», el email es el de ahora. */
function LoginDetailsForm({
  sync,
  prefix,
  editing,
  email,
  onCancel,
  onSaved,
}: {
  sync: SyncService;
  prefix: string;
  editing: Exclude<Editing, null>;
  email: string;
  onCancel: () => void;
  onSaved: (info: AccountInfo, email: string) => void;
}) {
  const fields = useLoginFields(prefix, true, editing === 'email' ? '' : email);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    focusWhenReady(editing === 'password' && email !== '' ? fields.passwordId : fields.emailId);
  }, [editing, email, fields.passwordId, fields.emailId]);

  async function save(): Promise<void> {
    if (busy) return;
    setFailure(null);
    if (!fields.check()) return;
    setBusy(true);
    const result = await attempt(() =>
      sync.setLoginDetails({ email: fields.email, password: fields.password }),
    );
    setBusy(false);
    if (result.ok) {
      onSaved(result.value, normalizeEmail(fields.email) ?? fields.email);
      return;
    }
    const message = syncErrorText(result.code, 'loginDetails');
    if (result.code === 'email_taken') fields.blame('email', message);
    else setFailure(message);
  }

  // Cambiar la contraseña sin saber el email (se entró con un código): hay que escribirlo.
  const showEmail = editing !== 'password' || email === '';
  return (
    <form
      className="sync__form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {showEmail ? (
        <EmailField
          id={fields.emailId}
          value={fields.email}
          error={fields.emailError}
          onChange={fields.setEmail}
        />
      ) : (
        // El email, oculto, para que el gestor de contraseñas sepa de qué cuenta es la nueva.
        <input type="email" autoComplete="username" value={fields.email} readOnly hidden />
      )}
      {editing === 'email' && <p className="muted">{a.changeEmailHint}</p>}
      <PasswordField
        id={fields.passwordId}
        label={editing === 'add' ? a.password : a.newPassword}
        value={fields.password}
        fresh
        error={fields.passwordError}
        onChange={fields.setPassword}
      />
      <div className="settings__buttons">
        <button type="button" className="btn" onClick={onCancel}>
          {t.cancel}
        </button>
        <button type="submit" className="btn btn--primary" aria-disabled={busy}>
          {busy ? a.savingLogin : a.saveLogin}
        </button>
      </div>
      <div className="settings__import-result" role="status">
        {failure !== null && <p className="sync__error">{failure}</p>}
      </div>
    </form>
  );
}
