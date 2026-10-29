// Paleta de captura (RF-01–RF-03, RF-06; ver §9.2–§9.5): *combobox* + *listbox* del APG.
// El campo está siempre montado: en móvil, el toque en la barra lo enfoca sin esperar a React
// (si no, iOS no abre el teclado).
import { manualEntryId } from '@gameagenda/core/entries';
import {
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type Ref,
  type UIEvent,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { v7 as uuidv7 } from 'uuid';
import type { AgendaEntry, CaptureOptions, CaptureTarget } from '../agenda/types.ts';
import { steamId } from '../agenda/types.ts';
import { useCatalogStatus, useEntriesById, useQueryState, useServices } from '../app/services.tsx';
import { Icon } from '../components/icons.tsx';
import { es } from '../i18n/es.ts';
import { isEditableTarget } from '../lib/hooks.ts';
import { type FeedbackTiming, measureToNextFrame } from '../perf/measures.ts';
import { type CoreGame, canSearchCatalog } from '../search-client/index.ts';
import { CaptureAsPanel } from './CaptureAsPanel.tsx';
import { ManualForm } from './ManualForm.tsx';
import {
  buildPaletteModel,
  displayName,
  linkInText,
  type PaletteModel,
  type PaletteOption,
  type PastedLink,
} from './palette-model.ts';

type LinkOption = Extract<PaletteOption, { kind: 'link' }>;

/** Intro espera como mucho esto a los resultados del texto escrito (ver §8.7). */
export const ENTER_WAIT_MS = 500;

export interface PaletteActions {
  /** Apunta un juego; devuelve `false` si ya estaba en la lista. */
  capture(target: CaptureTarget, options: CaptureOptions | undefined, timing: FeedbackTiming): void;
  /** Abre la ficha (`Mayús+Intro`, o Intro sobre un juego que ya está en la lista). */
  openGame(id: string): void;
  /** «Ver más resultados en el Catálogo». */
  openCatalog(text: string): void;
}

export interface PaletteHandle {
  /** Abre la paleta y enfoca el campo en la misma tarea del evento (`timeStamp` del evento). */
  open(timeStamp: number): void;
  close(): void;
}

export interface PaletteProps {
  readonly actions: PaletteActions;
  /** En móvil, la barra solo se ve en Mi lista; en las demás pantallas se abre con `(+)`. */
  readonly showBar: boolean;
  readonly onClose?: () => void;
  readonly ref?: Ref<PaletteHandle>;
}

type Mode =
  | { readonly kind: 'results' }
  | { readonly kind: 'captureAs'; readonly target: CaptureTarget }
  | { readonly kind: 'manual'; readonly title: string };

type EnterKind = 'enter' | 'continue' | 'other' | 'sheet';

function enterKind(event: KeyboardEvent): EnterKind {
  if (event.shiftKey) return 'sheet';
  if (event.altKey) return 'other';
  if (event.ctrlKey || event.metaKey) return 'continue';
  return 'enter';
}

function targetOf(option: PaletteOption): { target: CaptureTarget; entry?: AgendaEntry } | null {
  switch (option.kind) {
    case 'game':
    case 'suggestion':
      return {
        target: { id: steamId(option.game.appid), title: displayName(option.game) },
        entry: option.entry,
      };
    case 'entry':
      return { target: { id: option.entry.id, title: option.entry.title }, entry: option.entry };
    case 'link':
      return {
        target: { id: steamId(option.appid), title: option.title, provisional: option.provisional },
        entry: option.entry,
      };
    default:
      return null;
  }
}

/** Lo que dé el catálogo en `ms` como mucho; `undefined` si no llega a tiempo. */
function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(resolve, ms))]);
}

function optionId(base: string, key: string): string {
  return `${base}-${key.replace(/[^a-z0-9]/gi, '-')}`;
}

function isGameRow(option: PaletteOption): boolean {
  return option.kind === 'game' || option.kind === 'entry' || option.kind === 'link';
}

export function Palette({ actions, showBar, onClose, ref }: PaletteProps) {
  const { search } = useServices();
  const status = useCatalogStatus();
  const query = useQueryState();
  const entriesById = useEntriesById();

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<Mode>({ kind: 'results' });
  const [hint, setHint] = useState<string | null>(null);
  const [keepOpen, setKeepOpen] = useState(false);
  const [choice, setChoice] = useState<{ seq: number; key: string } | null>(null);

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  /** ¿Se ha desplazado la lista? Lo actualiza `onPopupScroll`, sin leer el DOM al pintar. */
  const popupScrolled = useRef(false);
  const openRef = useRef(false);
  const openedAt = useRef(0);
  const origin = useRef<Element | null>(null);
  const enterPending = useRef(false);
  const measuredSeq = useRef(0);

  // Enlace pegado (RF-04): su `appid` se busca en el catálogo local para dar el título.
  const searchable = canSearchCatalog(status.state);
  const found = useMemo(() => linkInText(text), [text]);
  const linkAppid = found?.link.appid ?? null;
  const [linkGame, setLinkGame] = useState<{ appid: number; game: CoreGame | null } | null>(null);
  useEffect(() => {
    if (linkAppid === null || !searchable) return;
    let current = true;
    search
      .game(linkAppid)
      .catch(() => null)
      .then((game) => {
        if (current) setLinkGame({ appid: linkAppid, game });
      });
    return () => {
      current = false;
    };
  }, [linkAppid, searchable, search]);
  const pasted: PastedLink | null = found && {
    ...found,
    game: linkGame?.appid === found.link.appid ? linkGame.game : undefined,
  };

  const model = buildPaletteModel(query, status, entriesById, pasted);
  const chosenIndex =
    choice !== null && choice.seq === query.seq
      ? model.options.findIndex((option) => option.key === choice.key)
      : -1;
  const activeIndex = chosenIndex >= 0 ? chosenIndex : model.defaultIndex;
  const activeOption = model.options[activeIndex];

  // Los últimos valores, para la espera de Intro (que termina en otra tarea).
  const latest = useRef({ actions, entriesById, status, keepOpen, pasted });
  latest.current = { actions, entriesById, status, keepOpen, pasted };

  function openPalette(timeStamp: number, from: Element | null): void {
    if (openRef.current) return;
    openRef.current = true;
    openedAt.current = timeStamp;
    origin.current = from;
    setOpen(true);
  }

  function close(restoreFocus = true): void {
    if (!openRef.current) return;
    openRef.current = false;
    setOpen(false);
    setText('');
    setMode({ kind: 'results' });
    setHint(null);
    setChoice(null);
    search.setQuery('');
    if (popupScrolled.current && popupRef.current) popupRef.current.scrollTop = 0;
    popupScrolled.current = false;
    const from = origin.current;
    origin.current = null;
    if (
      restoreFocus &&
      from instanceof HTMLElement &&
      from.isConnected &&
      from !== inputRef.current &&
      from !== document.body
    ) {
      from.focus();
    } else {
      inputRef.current?.blur();
    }
    onClose?.();
  }

  useImperativeHandle(ref, () => ({
    open(timeStamp) {
      openPalette(timeStamp, document.activeElement);
      inputRef.current?.focus({ preventScroll: true });
    },
    close: () => close(),
  }));

  function clearForNext(timeStamp: number): void {
    setText('');
    setChoice(null);
    setMode({ kind: 'results' });
    search.setQuery('', timeStamp);
    openedAt.current = timeStamp;
    inputRef.current?.focus();
  }

  function capture(target: CaptureTarget, options: CaptureOptions | undefined, timeStamp: number) {
    const stay = latest.current.keepOpen;
    latest.current.actions.capture(target, options, {
      feedbackStart: timeStamp,
      captureStart: openedAt.current,
    });
    if (stay) clearForNext(timeStamp);
    else close();
  }

  function openGame(id: string): void {
    close();
    latest.current.actions.openGame(id);
  }

  /** Intro sobre un enlace aún sin buscar: espera al catálogo (500 ms como mucho). */
  async function resolveLink(option: LinkOption): Promise<LinkOption> {
    enterPending.current = true;
    const game = await within(
      search.game(option.appid).catch(() => null),
      ENTER_WAIT_MS,
    );
    enterPending.current = false;
    if (game === undefined) return { ...option, resolving: false };
    setLinkGame({ appid: option.appid, game });
    return game
      ? { ...option, resolving: false, provisional: false, title: displayName(game) }
      : { ...option, resolving: false };
  }

  function activate(option: PaletteOption, kind: EnterKind, timeStamp: number): void {
    setHint(null);
    if (option.kind === 'link' && option.resolving && kind !== 'sheet') {
      if (enterPending.current) return;
      void resolveLink(option).then((resolved) => {
        if (openRef.current) activate(resolved, kind, timeStamp);
      });
      return;
    }
    if (option.kind === 'catalog') {
      const current = text;
      close();
      latest.current.actions.openCatalog(current);
      return;
    }
    if (option.kind === 'manual') {
      if (kind !== 'sheet') setMode({ kind: 'manual', title: option.title });
      return;
    }
    const resolved = targetOf(option);
    if (!resolved) return;
    const { target, entry } = resolved;
    if (kind === 'sheet' || (entry && kind === 'enter') || (entry && kind === 'other')) {
      openGame(target.id);
      return;
    }
    if (entry) {
      setHint(es.palette.alreadyInList(entry.title, entry.status));
      return;
    }
    if (kind === 'other') {
      setMode({ kind: 'captureAs', target });
      return;
    }
    if (kind === 'continue') {
      latest.current.actions.capture(target, undefined, {
        feedbackStart: timeStamp,
        captureStart: openedAt.current,
      });
      clearForNext(timeStamp);
      return;
    }
    capture(target, undefined, timeStamp);
  }

  function hintFor(current: PaletteModel): string {
    return current.onlySuggestions ? es.palette.suggestionsHint : es.palette.chooseResult;
  }

  async function onEnter(kind: EnterKind, timeStamp: number): Promise<void> {
    if (enterPending.current || text.trim() === '') return;
    const searchable = canSearchCatalog(latest.current.status.state);
    // Un enlace pegado no depende de los resultados de la búsqueda.
    if (!searchable || query.fresh || activeOption?.kind === 'link') {
      if (activeOption) activate(activeOption, kind, timeStamp);
      else setHint(hintFor(model));
      return;
    }
    // Carrera de Intro: lo visible es de un `seq` anterior; se espera al actual (ver §8.7).
    enterPending.current = true;
    const fresh = await search.waitForFresh(ENTER_WAIT_MS);
    enterPending.current = false;
    if (!fresh || !openRef.current) {
      if (openRef.current) setHint(es.palette.chooseResult);
      return;
    }
    const freshModel = buildPaletteModel(
      fresh,
      latest.current.status,
      latest.current.entriesById,
      latest.current.pasted,
    );
    const option = freshModel.options[freshModel.defaultIndex];
    if (option) activate(option, kind, timeStamp);
    else setHint(hintFor(freshModel));
  }

  function moveActive(delta: 1 | -1): void {
    const count = model.options.length;
    if (count === 0) return;
    const from = activeIndex < 0 ? (delta === 1 ? -1 : 0) : activeIndex;
    const next = (from + delta + count) % count;
    const option = model.options[next];
    if (option) setChoice({ seq: query.seq, key: option.key });
    setHint(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.nativeEvent.isComposing) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        return;
      case 'Enter':
        event.preventDefault();
        void onEnter(enterKind(event), event.timeStamp);
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
    }
  }

  function onChange(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;
    openPalette(event.nativeEvent.timeStamp, null);
    setText(value);
    setHint(null);
    setMode({ kind: 'results' });
    search.setQuery(value, event.nativeEvent.timeStamp);
  }

  function onFocus(event: FocusEvent<HTMLInputElement>): void {
    openPalette(event.timeStamp, event.relatedTarget);
  }

  /** Cerrar al salir de la paleta, salvo que la ventana entera haya perdido el foco. */
  function onBlur(): void {
    setTimeout(() => {
      if (!openRef.current || !document.hasFocus()) return;
      if (!rootRef.current?.contains(document.activeElement)) close(false);
    }, 0);
  }

  // `search:keystroke-to-results`: del `input` al fotograma con los resultados de su `seq`.
  useLayoutEffect(() => {
    if (!open || query.text.trim() === '') return;
    const painted = canSearchCatalog(status.state) ? query.fresh : true;
    if (!painted || measuredSeq.current === query.seq || query.inputTimeStamp === null) return;
    measuredSeq.current = query.seq;
    measureToNextFrame('search:keystroke-to-results', query.inputTimeStamp);
  }, [open, query, status.state]);

  // La fila activa siempre a la vista, también con cada `seq` nuevo. `scrollIntoView` fuerza la
  // maquetación dentro del *commit*, así que se evita en el caso de cada pulsación: la primera
  // fila con la lista arriba del todo ya está a la vista (ver `onPopupScroll`).
  const activeKey = activeOption?.key ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `query.seq` también la vuelve a mostrar.
  useLayoutEffect(() => {
    if (activeKey === null || (activeIndex === 0 && !popupScrolled.current)) return;
    document.getElementById(optionId(baseId, activeKey))?.scrollIntoView({ block: 'nearest' });
  }, [activeKey, activeIndex, baseId, query.seq]);

  function onPopupScroll(event: UIEvent<HTMLDivElement>): void {
    popupScrolled.current = event.currentTarget.scrollTop > 0;
  }

  const trimmed = text.trim();
  const leading = model.options.filter(isGameRow);
  const suggestionOptions = model.options.filter((option) => option.kind === 'suggestion');
  const tail = model.options.filter((o) => o.kind === 'catalog' || o.kind === 'manual');
  const withInfo = [...leading, ...suggestionOptions];
  const showList = open && mode.kind === 'results' && model.options.length > 0;

  // Fila de la cuadrícula de cada `option`: en móvil, cada `(i)` va en la fila de su `option`
  // (está fuera de ella; ver §9.7, 4.1.2) con `subgrid`, sin medir nada (ver `palette.css`).
  const gridRow = new Map<string, number>();
  let rows = 0;
  for (const option of leading) gridRow.set(option.key, ++rows);
  if (suggestionOptions.length > 0) rows += 1; // título del grupo
  for (const option of suggestionOptions) gridRow.set(option.key, ++rows);
  rows += tail.length;
  const gridStyle = {
    '--palette-rows': Math.max(1, rows),
    '--palette-group-rows': 1 + suggestionOptions.length,
  } as CSSProperties;

  function renderOption(option: PaletteOption, index: number) {
    const selected = index === activeIndex;
    const common = {
      id: optionId(baseId, option.key),
      role: 'option',
      'aria-selected': selected,
      className: `palette__option${selected ? ' is-active' : ''}`,
      onClick: (event: { timeStamp: number }) => {
        setChoice({ seq: query.seq, key: option.key });
        // Con «Seguir apuntando», `capture()` deja la paleta abierta.
        activate(option, 'enter', event.timeStamp);
      },
    } as const;
    if (option.kind === 'manual') {
      return (
        <div key={option.key} {...common} data-kind="manual">
          <span className="palette__name">{es.palette.manual(option.title)}</span>
        </div>
      );
    }
    if (option.kind === 'catalog') {
      return (
        <div key={option.key} {...common} data-kind="catalog">
          <span className="palette__name">{es.palette.seeInCatalog}</span>
        </div>
      );
    }
    const entry = option.entry;
    const name =
      option.kind === 'entry'
        ? option.entry.title
        : option.kind === 'link'
          ? option.entry
            ? option.title
            : es.palette.linkCapture(option.title)
          : displayName(option.game);
    const year =
      option.kind === 'entry' ? null : option.kind === 'link' ? option.year : option.game.year;
    return (
      <div key={option.key} {...common} data-kind={option.kind}>
        <span className="palette__name">{name}</span>
        <span className="palette__meta">
          {option.kind === 'link' && option.provisional && !option.resolving && (
            <span className="badge">{es.game.provisional}</span>
          )}
          {year !== null && <span>{year}</span>}
          {entry ? (
            <span className={`status-text status-text--${entry.status}`}>
              <Icon name={entry.status} />
              {es.palette.inList(entry.status)}
            </span>
          ) : (
            selected && (
              <span className="palette__enter" aria-hidden="true">
                {es.palette.enterToCapture}
              </span>
            )
          )}
        </span>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: `focusout` del contenedor, para cerrar.
    <div
      ref={rootRef}
      className={`palette${open ? ' is-open' : ''}${showBar ? '' : ' is-barless'}`}
      onBlur={onBlur}
    >
      {open && (
        <button
          type="button"
          className="palette__backdrop"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => close(false)}
        />
      )}
      <div className="palette__panel">
        <div className="palette__field">
          {open && (
            <button
              type="button"
              className="icon-btn palette__close"
              aria-label={es.palette.close}
              onClick={() => close()}
            >
              <Icon name="back" />
            </button>
          )}
          <Icon name="search" className="icon palette__search-icon" />
          <input
            ref={inputRef}
            className="palette__input"
            type="text"
            role="combobox"
            aria-label={es.palette.label}
            aria-expanded={showList}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={
              showList && activeOption ? optionId(baseId, activeOption.key) : undefined
            }
            aria-describedby={`${baseId}-hint`}
            placeholder={es.palette.placeholder}
            value={text}
            onChange={onChange}
            onKeyDown={onKeyDown}
            onFocus={onFocus}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          {!open && <kbd className="palette__kbd">{es.palette.shortcut}</kbd>}
          {open && text !== '' && (
            <button
              type="button"
              className="icon-btn palette__clear"
              aria-label={es.palette.clear}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                clearForNext(event.timeStamp);
              }}
            >
              <Icon name="close" />
            </button>
          )}
          {open && <kbd className="palette__kbd palette__kbd--esc">{es.palette.escKey}</kbd>}
        </div>

        {/* biome-ignore lint/a11y/noStaticElementInteractions: solo evita que un clic quite el foco del campo (Safari no enfoca los botones al pulsarlos). */}
        <div
          ref={popupRef}
          className="palette__popup"
          hidden={!open}
          onScroll={onPopupScroll}
          onMouseDown={(event) => {
            if (!isEditableTarget(event.target)) event.preventDefault();
          }}
        >
          {open && !searchable && (
            <div className="palette__notice">
              <p>
                {status.error ? es.catalogState.failed : es.catalogState.preparing(status.progress)}
              </p>
              {status.error?.retryable && (
                <button type="button" className="btn" onClick={() => void search.retry()}>
                  {es.catalogState.retry}
                </button>
              )}
            </div>
          )}

          {open && mode.kind === 'captureAs' && (
            <CaptureAsPanel
              title={mode.target.title}
              onCapture={(options, timeStamp) => capture(mode.target, options, timeStamp)}
              onBack={() => {
                setMode({ kind: 'results' });
                inputRef.current?.focus();
              }}
            />
          )}

          {open && mode.kind === 'manual' && (
            <ManualForm
              initialTitle={mode.title}
              onSubmit={(title, timeStamp) =>
                capture({ id: manualEntryId(uuidv7()), title }, undefined, timeStamp)
              }
              onBack={() => {
                setMode({ kind: 'results' });
                inputRef.current?.focus();
              }}
            />
          )}

          {open && mode.kind === 'results' && model.noItems && (
            <p className="palette__empty">{es.palette.noResults(trimmed)}</p>
          )}
          {open && mode.kind === 'results' && trimmed === '' && (
            <p className="palette__empty">{es.palette.emptyHint}</p>
          )}

          <div className="palette__scroll" hidden={!showList} style={gridStyle}>
            <div
              id={listboxId}
              role="listbox"
              aria-label={es.palette.results}
              className="palette__listbox"
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
            >
              {leading.map((option) => renderOption(option, model.options.indexOf(option)))}
              {suggestionOptions.length > 0 && (
                // biome-ignore lint/a11y/useSemanticElements: grupo del listbox, no un <fieldset>.
                <div role="group" aria-label={es.palette.suggestions} className="palette__group">
                  <div className="palette__group-title" aria-hidden="true">
                    {es.palette.suggestions}
                  </div>
                  {suggestionOptions.map((option) =>
                    renderOption(option, model.options.indexOf(option)),
                  )}
                </div>
              )}
              {tail.map((option) => renderOption(option, model.options.indexOf(option)))}
            </div>
            <div className="palette__aside">
              {showList &&
                withInfo.map((option) => {
                  const resolved = targetOf(option);
                  if (!resolved) return null;
                  return (
                    <button
                      key={option.key}
                      type="button"
                      className="icon-btn palette__info"
                      style={{ gridRow: gridRow.get(option.key) }}
                      aria-label={es.palette.openSheet(resolved.target.title)}
                      onClick={() => openGame(resolved.target.id)}
                    >
                      <Icon name="info" />
                    </button>
                  );
                })}
            </div>
          </div>

          <p id={`${baseId}-hint`} className="palette__hint" aria-live="polite">
            {open ? (hint ?? '') : ''}
          </p>

          {open && (
            <label className="palette__keep">
              <input
                type="checkbox"
                checked={keepOpen}
                onChange={(event) => setKeepOpen(event.target.checked)}
              />
              {es.palette.keepCapturing}
            </label>
          )}
          {open && <p className="palette__keys muted">{es.palette.keysHint}</p>}
        </div>
      </div>
    </div>
  );
}
