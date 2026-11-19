// «Importar desde Steam» en Ajustes › Datos (Fase 2, parte 2; §10; ADR-012). La pantalla pinta el
// estado de `steam/steam-flow.ts`, que sigue vivo aunque se salga de Ajustes. En esta parte solo
// resume lo traído: revisar y aplicar es la parte 3. Los estados van en `role="status"` (§9.7), y
// el botón oficial de Steam lleva su nombre accesible en español. Sus textos van en
// `steam/texts.ts`, fuera del JS inicial.

import { type JSX, useId, useSyncExternalStore } from 'react';
import { type SteamImportState, steamImportFlow } from '../../steam/steam-flow.ts';
import { steamTexts as t } from '../../steam/texts.ts';

/** La privacidad de la cuenta en Steam: la guía del perfil privado (§10.1). */
const STEAM_PRIVACY_URL = 'https://steamcommunity.com/my/edit/settings';
/**
 * El botón oficial de Steam («Sign in through Steam», de https://steamcommunity.com/dev), en
 * `public/`: importado, Vite lo publicaría aunque la importación esté apagada, y el Service Worker
 * lo precachearía.
 */
const SIGN_IN_IMAGE = '/steam/sign-in-through-steam.png';

function statusText(state: SteamImportState): string {
  switch (state.kind) {
    case 'idle':
      return '';
    case 'starting':
      return t.starting;
    case 'ready':
      return t.signInHint;
    case 'waiting':
      return state.stillPending ? t.stillPending : t.waiting;
    case 'loading':
      return t.loading;
    case 'done': {
      const { library } = state;
      if (library.visibility === 'private') return t.private;
      const wishes = library.wishlist?.length ?? null;
      return library.owned.length === 0 ? t.empty(wishes) : t.summary(library.owned.length, wishes);
    }
    case 'failed':
      return t[state.reason];
  }
}

export function SteamImport(): JSX.Element {
  const flow = steamImportFlow();
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot);
  const id = useId();
  const busy = state.kind === 'starting' || state.kind === 'loading';

  let actions: JSX.Element | null = null;
  switch (state.kind) {
    case 'idle':
      actions = (
        <button type="button" className="btn" onClick={() => void flow.start()}>
          {t.start}
        </button>
      );
      break;
    case 'ready':
    case 'waiting':
      actions = (
        <>
          {/* Un enlace de verdad, en otra ventana: no lo bloquea ningún navegador (ADR-012). */}
          <a
            className="settings__steam-signin"
            href={state.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => flow.opened()}
          >
            <img src={SIGN_IN_IMAGE} width={180} height={35} alt={t.signIn} />
          </a>
          {state.kind === 'waiting' && (
            <button type="button" className="btn" onClick={() => void flow.redeem(true)}>
              {t.continue}
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => flow.reset()}>
            {t.cancel}
          </button>
        </>
      );
      break;
    case 'done':
      actions =
        state.library.visibility === 'private' ? (
          <>
            <a className="btn" href={STEAM_PRIVACY_URL} target="_blank" rel="noopener noreferrer">
              {t.privacySettings}
            </a>
            <button type="button" className="btn" onClick={() => void flow.start()}>
              {t.restart}
            </button>
          </>
        ) : (
          <button type="button" className="btn" onClick={() => flow.reset()}>
            {t.restart}
          </button>
        );
      break;
    case 'failed':
      actions = (
        <>
          {state.retry ? (
            <button type="button" className="btn" onClick={() => void flow.redeem(true)}>
              {t.retry}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => void flow.start()}>
              {t.restart}
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => flow.reset()}>
            {t.cancel}
          </button>
        </>
      );
      break;
    default:
      actions = null;
  }

  const done = state.kind === 'done' ? state.library : null;
  return (
    <section
      className="settings__steam"
      aria-labelledby={`${id}-title`}
      aria-busy={busy}
      data-steam-import={state.kind}
    >
      <h3 id={`${id}-title`} className="settings__subtitle">
        {t.title}
      </h3>
      <p className="muted">{t.intro}</p>
      <div className="settings__steam-status" role="status">
        {statusText(state) !== '' && <p>{statusText(state)}</p>}
        {done?.visibility === 'private' && <p>{t.privateGuide}</p>}
        {done !== null && done.visibility === 'public' && (
          <>
            <p className="muted">{t.hiddenGames}</p>
            <p className="muted">{t.noChanges}</p>
          </>
        )}
      </div>
      {actions !== null && <div className="settings__buttons">{actions}</div>}
    </section>
  );
}
