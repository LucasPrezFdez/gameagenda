// Router propio sobre la History API (ver §6.4): sin librería de enrutado.
import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  type Ref,
  useLayoutEffect,
  useSyncExternalStore,
} from 'react';
import { parseRoute, type Route } from './routes.ts';

export type NavigationKind = 'initial' | 'push' | 'replace' | 'pop';

export interface LocationSnapshot {
  readonly href: string;
  readonly pathname: string;
  readonly search: string;
  readonly route: Route;
  readonly kind: NavigationKind;
  /** Posición en el historial de esta sesión de la app. */
  readonly index: number;
}

interface HistoryState {
  readonly idx?: unknown;
}

const listeners = new Set<() => void>();
/** Id del elemento enfocado al salir de cada entrada del historial (WCAG 2.4.3). */
const focusMemory = new Map<number, string>();
let pendingFocus: { readonly kind: 'push' | 'pop'; readonly index: number } | null = null;

function currentIndex(): number {
  const state = history.state as HistoryState | null;
  return typeof state?.idx === 'number' ? state.idx : 0;
}

function read(kind: NavigationKind): LocationSnapshot {
  const { pathname, search } = window.location;
  return {
    href: pathname + search,
    pathname,
    search,
    route: parseRoute(pathname),
    kind,
    index: currentIndex(),
  };
}

let snapshot: LocationSnapshot = read('initial');

function emit(): void {
  for (const listener of listeners) listener();
}

function onPopState(): void {
  snapshot = read('pop');
  pendingFocus = { kind: 'pop', index: snapshot.index };
  emit();
}

/** Prepara el historial y escucha `popstate`; devuelve la función que lo para. */
export function startRouter(): () => void {
  if (typeof (history.state as HistoryState | null)?.idx !== 'number') {
    history.replaceState({ idx: 0 }, '');
  }
  snapshot = read('initial');
  window.addEventListener('popstate', onPopState);
  return () => window.removeEventListener('popstate', onPopState);
}

export interface NavigateOptions {
  /** Sustituye la entrada actual (filtros, cerrar `/apuntar`…): no mueve el foco. */
  readonly replace?: boolean;
}

export function navigate(to: string, options: NavigateOptions = {}): void {
  const url = new URL(to, window.location.href);
  const href = url.pathname + url.search;
  if (href === snapshot.href) return;
  const index = currentIndex();
  if (options.replace) {
    history.replaceState({ idx: index }, '', href);
    snapshot = read('replace');
  } else {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.id !== '') focusMemory.set(index, active.id);
    else focusMemory.delete(index);
    history.pushState({ idx: index + 1 }, '', href);
    snapshot = read('push');
    pendingFocus = { kind: 'push', index: index + 1 };
    window.scrollTo(0, 0);
  }
  emit();
}

export function canGoBack(): boolean {
  return currentIndex() > 0;
}

/** Vuelve atrás si la entrada anterior es de la app; si no, va a `fallback`. */
export function goBack(fallback: string): void {
  if (canGoBack()) history.back();
  else navigate(fallback, { replace: true });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLocation(): LocationSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot);
}

/**
 * Tras una navegación, el título de la pantalla principal recibe el foco; al volver atrás,
 * lo recupera el elemento que lo tenía (ver §9.7, 2.4.7).
 */
export function useNavigationFocus(
  target: { readonly current: HTMLElement | null },
  enabled = true,
) {
  const { href } = useLocation();
  // biome-ignore lint/correctness/useExhaustiveDependencies: se repite en cada navegación.
  useLayoutEffect(() => {
    const pending = pendingFocus;
    if (!enabled || pending === null) return;
    pendingFocus = null;
    const rememberedId = pending.kind === 'pop' ? focusMemory.get(pending.index) : undefined;
    const remembered = rememberedId ? document.getElementById(rememberedId) : null;
    (remembered ?? target.current)?.focus();
  }, [href, enabled, target]);
}

function isPlainClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  readonly to: string;
  readonly replace?: boolean;
  readonly ref?: Ref<HTMLAnchorElement>;
}

/** Enlace de la app: un `<a>` de verdad (abre en otra pestaña con Ctrl o el botón central). */
export function Link({ to, replace, onClick, ...rest }: LinkProps) {
  return (
    <a
      {...rest}
      href={to}
      onClick={(event) => {
        onClick?.(event);
        if (!isPlainClick(event)) return;
        event.preventDefault();
        navigate(to, { replace });
      }}
    />
  );
}
