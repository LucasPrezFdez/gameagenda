// Ficha básica de M1 (RF-20, RF-21; CA1.12): datos del núcleo y todos los campos de la entrada,
// editables y con Deshacer. Junto a la lista desde 1 280 px, superpuesta entre 768 y 1 279 px y a
// pantalla completa en móvil (ver §9.3).
import type { GameDetailsView } from '@gameagenda/core/catalog-format';
import { isValidDay, linkCandidate } from '@gameagenda/core/entries';
import { useEffect, useId, useState } from 'react';
import { useCommands } from '../../agenda/commands.ts';
import {
  type AgendaEntry,
  appidOf,
  DATE_FIELDS,
  type DateField,
  type EntryPatch,
  FLAGS,
  PLATFORMS,
  type Platform,
  STATUSES,
  steamId,
} from '../../agenda/types.ts';
import {
  useAgendaEntries,
  useCatalogStatus,
  useEntriesById,
  useServices,
} from '../../app/services.tsx';
import { Cover } from '../../components/bits.tsx';
import { CatalogNotice } from '../../components/CatalogNotice.tsx';
import { ChoiceMenu } from '../../components/ChoiceMenu.tsx';
import { Icon } from '../../components/icons.tsx';
import { MenuButton } from '../../components/MenuButton.tsx';
import { ScreenHeading } from '../../components/ScreenHeading.tsx';
import { useGameDetails } from '../../details/details-context.tsx';
import type { DetailsState } from '../../details/details-store.ts';
import { localToday, releaseFromDetails } from '../../details/release.ts';
import { releaseText } from '../../details/release-text.ts';
import { es } from '../../i18n/es.ts';
import { isEditableTarget } from '../../lib/hooks.ts';
import { CaptureButton } from '../../palette/palette-context.tsx';
import { displayName } from '../../palette/palette-model.ts';
import { goBack, navigate } from '../../router/router.tsx';
import { gamePath } from '../../router/routes.ts';
import { type CoreGame, GAME_FLAGS } from '../../search-client/index.ts';
import { priorityOf } from '../my-list/list-model.ts';

type CoreState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly appid: number; readonly game: CoreGame | null };

function useCoreGame(appid: number | null): CoreState {
  const { search } = useServices();
  const { state } = useCatalogStatus();
  const [core, setCore] = useState<CoreState>({ kind: 'loading' });
  // biome-ignore lint/correctness/useExhaustiveDependencies: con otro estado del catálogo la fila puede aparecer (p. ej., de `none` a `scan`).
  useEffect(() => {
    if (appid === null) return;
    let current = true;
    search
      .game(appid)
      .then((game) => {
        if (current) setCore({ kind: 'ready', appid, game });
      })
      .catch(() => {
        if (current) setCore({ kind: 'ready', appid, game: null });
      });
    return () => {
      current = false;
    };
  }, [appid, search, state]);
  return core.kind === 'ready' && core.appid === appid ? core : { kind: 'loading' };
}

function steamUrl(appid: number): string {
  return `https://store.steampowered.com/app/${appid}/`;
}

const PLATFORM_BITS = [
  [1, es.game.platformName.windows],
  [2, es.game.platformName.mac],
  [4, es.game.platformName.linux],
] as const satisfies ReadonlyArray<readonly [number, string]>;

function reviewsText(details: GameDetailsView): string {
  const summary = es.game.reviewScore[details.reviewScore];
  // `review_score` 0: Steam no da valoración (sin reseñas o muy pocas).
  if (!summary) return es.game.fewReviews(details.reviewCount);
  return es.game.reviewsDetail(summary, details.reviewPercent, details.reviewCount);
}

/** Lanzamiento de la ficha: del *shard* y, si no está, el año del núcleo. */
function releaseOf(game: CoreGame | null, details: GameDetailsView | null): string | null {
  if (details) {
    const info = {
      release: releaseFromDetails(details.releaseTime, details.releasePrecision),
      comingSoon: game ? (game.flags & GAME_FLAGS.comingSoon) !== 0 : null,
    };
    return releaseText(info, localToday(new Date()));
  }
  if (game && (game.flags & GAME_FLAGS.dateTba) !== 0) return es.release.tbd;
  return game?.year != null ? String(game.year) : null;
}

/**
 * Datos de los *shards* (CA2.8): Steam Deck, plataformas y reseñas. Mientras llegan, su hueco
 * (§9.5, regla 4); sin detalles (sin índice, con el *kill switch* o sin red), la ficha básica.
 */
function SteamFacts({ state }: { state: DetailsState }) {
  if (state.kind === 'unavailable') return null;
  if (state.kind === 'loading') {
    return (
      <div className="sheet__details" aria-busy="true">
        <span className="visually-hidden">{es.game.detailsLoading}</span>
        <span className="skeleton skeleton--line" />
        <span className="skeleton skeleton--line" />
        <span className="skeleton skeleton--line" />
      </div>
    );
  }
  const { details } = state;
  if (!details) return null;
  const platforms = PLATFORM_BITS.filter(([bit]) => (details.platforms & bit) !== 0).map(
    ([, name]) => name,
  );
  return (
    <ul className="sheet__details" aria-label={es.game.details}>
      <li>{es.game.deck(es.game.deckOption[details.deck] ?? es.game.deckOption[0] ?? '')}</li>
      {platforms.length > 0 && <li>{platforms.join(' · ')}</li>}
      <li>{es.game.reviews(reviewsText(details))}</li>
    </ul>
  );
}

function CoreFacts({ game, release }: { game: CoreGame; release: string | null }) {
  const badges = (
    [
      [GAME_FLAGS.free, es.game.free],
      [GAME_FLAGS.earlyAccess, es.game.earlyAccess],
      [GAME_FLAGS.comingSoon, es.game.comingSoon],
      [GAME_FLAGS.retired, es.game.retired],
      [GAME_FLAGS.adult, es.game.adult],
    ] as const
  )
    .filter(([bit]) => (game.flags & bit) !== 0)
    .map(([, label]) => label);
  return (
    <p className="sheet__facts">
      {release !== null && <span className="sheet__release">{release}</span>}
      {game.nameEs !== null && <span>{game.name}</span>}
      {badges.map((badge) => (
        <span key={badge} className="badge">
          {badge}
        </span>
      ))}
    </p>
  );
}

function DateInput({
  entry,
  field,
  onSave,
}: {
  entry: AgendaEntry;
  field: DateField;
  onSave: (field: DateField, value: string | null, timeStamp: number) => void;
}) {
  const id = useId();
  const stored = entry[field] ?? '';
  const [value, setValue] = useState(stored);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setValue(stored);
    setInvalid(false);
  }, [stored]);
  return (
    <div className="date-field">
      <label htmlFor={id}>{es.game.date[field]}</label>
      <input
        id={id}
        className="field"
        inputMode="numeric"
        placeholder={es.game.datePlaceholder}
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
        onBlur={(event) => {
          const next = value.trim();
          if (next === stored) return;
          if (next !== '' && !isValidDay(next)) {
            setInvalid(true);
            return;
          }
          onSave(field, next === '' ? null : next, event.timeStamp);
        }}
      />
      {invalid && (
        <p id={`${id}-error`} className="field-error">
          {es.game.dateInvalid}
        </p>
      )}
    </div>
  );
}

function EntryEditor({ entry }: { entry: AgendaEntry }) {
  const commands = useCommands();
  const entries = useAgendaEntries();
  const id = useId();
  const [note, setNote] = useState(entry.note);
  useEffect(() => setNote(entry.note), [entry.note]);
  const priority = priorityOf(entries, entry);
  const ranked = entry.status === 'want_to_play' || entry.flags.next === true;
  const timing = (event: { timeStamp: number }) => ({ feedbackStart: event.timeStamp });

  return (
    <div className="sheet__editor">
      {/* biome-ignore lint/a11y/useSemanticElements: grupo de botones de alternar. */}
      <div className="sheet__group" role="group" aria-labelledby={`${id}-status`}>
        <span id={`${id}-status`} className="sheet__label">
          {es.game.status}
        </span>
        <div className="sheet__options">
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`chip-button status-text status-text--${status}`}
              aria-pressed={entry.status === status}
              onClick={(event) => commands.setStatus(entry.id, status, timing(event))}
            >
              <Icon name={status} />
              {es.status[status]}
            </button>
          ))}
        </div>
      </div>

      {/* biome-ignore lint/a11y/useSemanticElements: grupo de botones de alternar. */}
      <div className="sheet__group" role="group" aria-labelledby={`${id}-flags`}>
        <span id={`${id}-flags`} className="sheet__label">
          {es.game.flags}
        </span>
        <div className="sheet__options">
          {FLAGS.map((flag) => (
            <button
              key={flag}
              type="button"
              className={`chip-button status-text status-text--${flag}`}
              aria-pressed={entry.flags[flag] === true}
              onClick={(event) =>
                commands.setFlag(entry.id, flag, entry.flags[flag] !== true, timing(event))
              }
            >
              <Icon name={flag} />
              {es.flag[flag]}
            </button>
          ))}
        </div>
      </div>

      <div className="sheet__row">
        <ChoiceMenu<Platform | 'none'>
          className="sheet__field"
          label={es.game.platform}
          value={entry.platform ?? 'none'}
          options={[
            { value: 'none', label: es.game.choose },
            ...PLATFORMS.map((platform) => ({ value: platform, label: es.platform[platform] })),
          ]}
          onChange={(platform, event) =>
            commands.update(
              entry.id,
              { platform: platform === 'none' ? null : platform },
              timing(event),
            )
          }
        />
        {ranked && (
          // biome-ignore lint/a11y/useSemanticElements: grupo de botones, no un formulario.
          <div className="sheet__priority" role="group" aria-labelledby={`${id}-priority`}>
            <span id={`${id}-priority`} className="sheet__label">
              {es.game.priority(priority.position, priority.total)}
            </span>
            <div className="sheet__options">
              {(
                [
                  ['up', es.list.moveUp, priority.position <= 1],
                  ['down', es.list.moveDown, priority.position >= priority.total],
                  ['top', es.list.moveTop, priority.position <= 1],
                  ['bottom', es.list.moveBottom, priority.position >= priority.total],
                ] as const
              ).map(([to, label, disabled]) => (
                <button
                  key={to}
                  type="button"
                  className="btn"
                  disabled={disabled}
                  onClick={(event) => commands.move(entry.id, to, timing(event))}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <label className="sheet__field">
        <span className="sheet__label">{es.game.note}</span>
        <textarea
          className="field sheet__note"
          rows={3}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onBlur={(event) => {
            if (note !== entry.note) commands.update(entry.id, { note }, timing(event));
          }}
        />
      </label>

      <fieldset className="sheet__dates">
        <legend className="sheet__label">{es.game.dates}</legend>
        {DATE_FIELDS.map((field) => (
          <DateInput
            key={field}
            entry={entry}
            field={field}
            onSave={(name, value, timeStamp) =>
              commands.update(entry.id, { [name]: value } as EntryPatch, {
                feedbackStart: timeStamp,
              })
            }
          />
        ))}
      </fieldset>
    </div>
  );
}

function LinkProposal({ entry }: { entry: AgendaEntry }) {
  const { search } = useServices();
  const commands = useCommands();
  const [match, setMatch] = useState<CoreGame | null>(null);
  useEffect(() => {
    let current = true;
    search
      .matchExact(entry.title)
      .then(async (appids) => {
        // Solo se propone ante una única coincidencia exacta tras normalizar (ver §7.3).
        const only = linkCandidate(appids);
        return only === null ? null : search.game(only);
      })
      .then((game) => {
        if (current) setMatch(game);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [entry.title, search]);
  if (!match) return null;
  const title = displayName(match);
  return (
    <div className="notice">
      <p>{es.game.linkQuestion(title)}</p>
      <button
        type="button"
        className="btn"
        onClick={(event) => {
          const id = steamId(match.appid);
          const effect = commands.link(entry.id, { id, title }, { feedbackStart: event.timeStamp });
          // El manual queda como lápida: la ficha pasa a ser la del juego de Steam.
          if (effect.kind === 'linked') navigate(gamePath(id), { replace: true });
        }}
      >
        {es.game.link}
      </button>
    </div>
  );
}

export function GameScreen({ id }: { id: string }) {
  const commands = useCommands();
  const entry = useEntriesById().get(id);
  const appid = appidOf(id);
  const core = useCoreGame(appid);
  const game = core.kind === 'ready' ? core.game : null;
  const details = useGameDetails(appid);
  const view = details.kind === 'ready' ? details.details : null;
  const loading = appid !== null && core.kind === 'loading';
  const title = entry?.title ?? (game ? displayName(game) : '');
  const missing = !loading && !entry && !game;
  const close = () => goBack('/');

  // Esc cierra la ficha desde cualquier sitio (en Safari, un clic no enfoca los botones); la
  // paleta y los menús lo paran antes si están abiertos.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // En un campo, Esc primero lo guarda (al perder el foco); el segundo Esc cierra.
      if (isEditableTarget(event.target)) {
        (event.target as HTMLElement).blur();
        return;
      }
      event.preventDefault();
      goBack('/');
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const timing = (event: { timeStamp: number }) => ({ feedbackStart: event.timeStamp });

  return (
    <section
      className="sheet"
      aria-labelledby={loading ? undefined : `sheet-${id}`}
      aria-label={loading ? es.game.sheet : undefined}
    >
      <header className="sheet__header">
        <button
          type="button"
          className="icon-btn sheet__back"
          aria-label={es.game.back}
          onClick={close}
        >
          <Icon name="back" />
        </button>
        <span className="sheet__kicker">{es.game.sheet}</span>
        <CaptureButton className="sheet__capture" />
        <button type="button" className="btn btn--ghost sheet__close" onClick={close}>
          {es.game.close} <kbd>{es.palette.escKey}</kbd>
        </button>
      </header>

      {loading ? (
        <div className="sheet__top" aria-busy="true">
          <span className="cover cover--sheet skeleton" />
          <div className="sheet__heading">
            <span className="skeleton skeleton--title" />
            <span className="visually-hidden">{es.game.loading}</span>
          </div>
        </div>
      ) : missing ? (
        <div className="sheet__top">
          <div className="sheet__heading">
            <ScreenHeading id={`sheet-${id}`} documentTitle={es.game.sheet}>
              {es.game.notFound}
            </ScreenHeading>
          </div>
        </div>
      ) : (
        <div className="sheet__top">
          <Cover title={title} appid={game ? appid : null} size="sheet" />
          <div className="sheet__heading">
            <ScreenHeading id={`sheet-${id}`} documentTitle={title}>
              {title}
            </ScreenHeading>
            {game && <CoreFacts game={game} release={releaseOf(game, view)} />}
            {!game && entry && (
              <p className="sheet__facts">
                <span className="badge">
                  {appid === null ? es.game.manual : es.game.provisional}
                </span>
              </p>
            )}
            {game && <SteamFacts state={details} />}
          </div>
        </div>
      )}

      {!loading && !game && appid !== null && <CatalogNotice />}
      {entry && appid === null && <LinkProposal entry={entry} />}

      {entry ? (
        <EntryEditor key={entry.id} entry={entry} />
      ) : (
        game && (
          <div className="sheet__capture-actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={(event) =>
                commands.capture({ id, title: displayName(game) }, undefined, timing(event))
              }
            >
              {es.game.capture}
            </button>
            <MenuButton
              label={es.game.captureAs}
              buttonClassName="btn"
              align="start"
              items={STATUSES.map((status) => ({
                key: status,
                label: es.status[status],
                icon: status,
                tone: `status-text--${status}`,
                onSelect: (event) =>
                  commands.capture({ id, title: displayName(game) }, { status }, timing(event)),
              }))}
            >
              {es.game.captureAs}
              <Icon name="chevronDown" />
            </MenuButton>
          </div>
        )
      )}

      <footer className="sheet__footer">
        {appid !== null && (
          <a className="btn" href={steamUrl(appid)} target="_blank" rel="noopener">
            {es.game.viewOnSteam}
          </a>
        )}
        {entry && (
          <button
            type="button"
            className="btn btn--danger"
            onClick={(event) => commands.remove(entry.id, timing(event))}
          >
            {es.game.remove}
          </button>
        )}
      </footer>
    </section>
  );
}
