// «Importar desde Steam» en Ajustes › Datos (Fase 2, partes 2 y 3; §10; ADR-012). La pantalla pinta
// el estado de `steam/steam-flow.ts`, que sigue vivo aunque se salga de Ajustes: el login, los
// logros, el resumen (sin tocar la agenda hasta «Aplicar») y el «Deshacer». Los estados van en
// `role="status"` (§9.7), y el botón oficial de Steam lleva su nombre accesible en español. Sus
// textos van en `steam/texts.ts`, fuera del JS inicial.

import { type JSX, useId, useState, useSyncExternalStore } from 'react';
import { useServices, useSyncState } from '../../app/services.tsx';
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

/**
 * El orden de las líneas del resumen: el de las secciones de Mi lista. Los juegos de la biblioteca
 * nunca van a Quiero jugar (eso lo decide el usuario); los sin jugar, a Sin empezar, y los
 * programas, a Software (§10.57).
 */
const REVIEW_ORDER = ['playing', 'on_hold', 'completed', 'not_started', 'software'] as const;

function statusText(state: SteamImportState): string {
  switch (state.kind) {
    case 'idle':
    case 'review':
      return '';
    case 'starting':
      return t.starting;
    case 'ready':
      return t.signInHint;
    case 'waiting':
      return state.stillPending ? t.stillPending : t.waiting;
    case 'loading':
      return t.loading;
    case 'checking':
      return t.checking(state.done, state.total);
    case 'applying':
      return t.applying(state.done, state.total);
    case 'applied':
      return t.applied(state.counts);
    case 'undone':
      return t.undone;
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

/** El resumen de lo que va a cambiar (parte 3): por estado, las marcas y lo que ya estaba. */
function Review({ state }: { state: Extract<SteamImportState, { kind: 'review' }> }): JSX.Element {
  const flow = steamImportFlow();
  const { counts } = state.plan;
  const added = REVIEW_ORDER.reduce((sum, status) => sum + counts.added[status], 0);
  const platinumMarked = counts.platinum - counts.added.completed;
  const nothing = state.plan.items.length === 0;
  return (
    <div className="settings__steam-review">
      {nothing ? (
        <p>{t.reviewNothing}</p>
      ) : (
        <>
          {added > 0 && (
            <>
              <p>{t.reviewAdded(added)}</p>
              <ul className="settings__steam-counts">
                {REVIEW_ORDER.filter((status) => counts.added[status] > 0).map((status) => (
                  <li key={status} data-steam-count={status}>
                    {t.reviewStatus[status](counts.added[status])}
                  </li>
                ))}
              </ul>
            </>
          )}
          {counts.markedOwned > 0 && <p>{t.reviewMarked(counts.markedOwned)}</p>}
          {counts.toSoftware > 0 && <p>{t.reviewToSoftware(counts.toSoftware)}</p>}
          {platinumMarked > 0 && <p>{t.reviewPlatinum(platinumMarked)}</p>}
          {counts.wishes > 0 && <p>{t.reviewWishes(counts.wishes)}</p>}
        </>
      )}
      {counts.unchanged > 0 && <p className="muted">{t.reviewUnchanged(counts.unchanged)}</p>}
      {counts.removed > 0 && <p className="muted">{t.reviewRemoved(counts.removed)}</p>}
      {(state.wishes > 0 || state.withWishlist) && (
        <label className="settings__choice">
          <input
            type="checkbox"
            checked={state.withWishlist}
            onChange={(event) => flow.setWishlist(event.target.checked)}
          />
          {t.wishlistLabel(state.wishes)}
        </label>
      )}
      {state.unknown > 0 && <p className="muted">{t.unknownAchievements(state.unknown)}</p>}
      <p className="muted">{t.hiddenGames}</p>
    </div>
  );
}

export function SteamImport(): JSX.Element {
  const { agenda, search, sync } = useServices();
  const syncState = useSyncState();
  // Steam vinculado (ADR-014): solo con la sincronización activa, y marcado por defecto.
  const canLink = syncState.status === 'paired';
  const [link, setLink] = useState(true);
  const flow = steamImportFlow({
    agenda,
    onLinked: () => void sync.updateLocalAccount({ steamLinked: true, steamCheckedAt: Date.now() }),
    catalogTitles: async (appids) => {
      const { found } = await search.lookup(appids);
      // Como `displayName` de la paleta (no se importa: partiría el JS inicial en *chunks*).
      return new Map(found.map((game) => [game.appid, game.nameEs ?? game.name]));
    },
    fallbackTitle: t.steamGame,
  });
  const state = useSyncExternalStore(flow.subscribe, flow.getSnapshot);
  const id = useId();
  const busy =
    state.kind === 'starting' ||
    state.kind === 'loading' ||
    state.kind === 'checking' ||
    state.kind === 'applying';

  let actions: JSX.Element | null = null;
  switch (state.kind) {
    case 'idle':
      actions = (
        <button type="button" className="btn" onClick={() => void flow.start(canLink && link)}>
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
    case 'review':
      actions = (
        <>
          {state.plan.items.length > 0 && (
            <button type="button" className="btn btn--primary" onClick={() => void flow.apply()}>
              {t.apply}
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => flow.reset()}>
            {state.plan.items.length > 0 ? t.cancel : t.finish}
          </button>
        </>
      );
      break;
    case 'applied':
      actions = (
        <>
          {state.canUndo && (
            <button type="button" className="btn" onClick={() => flow.undo()}>
              {t.undo}
            </button>
          )}
          <button type="button" className="btn btn--ghost" onClick={() => flow.reset()}>
            {t.finish}
          </button>
        </>
      );
      break;
    case 'undone':
      actions = (
        <button type="button" className="btn" onClick={() => flow.reset()}>
          {t.finish}
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
  const text = statusText(state);
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
      {state.kind === 'idle' && canLink && (
        <div className="sync__field">
          <label className="settings__choice">
            <input
              type="checkbox"
              checked={link}
              aria-describedby={`${id}-link-hint`}
              onChange={(event) => setLink(event.target.checked)}
            />
            {t.linkLabel}
          </label>
          <p id={`${id}-link-hint`} className="muted">
            {t.linkHint}
          </p>
        </div>
      )}
      <div className="settings__steam-status" role="status">
        {text !== '' && <p>{text}</p>}
        {state.kind === 'applied' && flow.isLinking() && <p>{t.linked}</p>}
        {state.kind === 'review' && <Review state={state} />}
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
