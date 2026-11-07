// Carcasa de la app (ver §9.1): barra lateral y cabecera con la paleta en escritorio; en móvil,
// la barra «Apunta un juego…» fija abajo, encima de tres pestañas.
import {
  lazy,
  type RefObject,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useCommands } from './agenda/commands.ts';
import { useCanUndo, useServices, useSettings } from './app/services.tsx';
import { CoverNotice } from './components/CoverNotice.tsx';
import { Icon, type IconName } from './components/icons.tsx';
import { MenuButton } from './components/MenuButton.tsx';
import { ScreenHeading } from './components/ScreenHeading.tsx';
import { SidebarLibrary } from './components/SidebarLibrary.tsx';

import { DetailsProvider } from './details/details-context.tsx';
import { ErrorBoundary } from './errors/ErrorBoundary.tsx';
import { es } from './i18n/es.ts';
import { useMediaQuery, useOnline } from './lib/hooks.ts';
import { sharedText, useLinkCapture } from './links/link-capture.ts';
import type { NoticeCenter } from './notices/notice-center.ts';
import { Toaster } from './notices/Toaster.tsx';
import { Palette, type PaletteActions, type PaletteHandle } from './palette/Palette.tsx';
import { PaletteProvider } from './palette/palette-context.tsx';
import { linkInText } from './palette/palette-model.ts';
import { endFirstCommit } from './perf/measures.ts';
import { stashPairingCode } from './router/pairing-link.ts';
import { Link, navigate, useLocation } from './router/router.tsx';
import {
  gamePath,
  pairingCodeFromHash,
  type Route,
  settingsPath,
  withSearch,
} from './router/routes.ts';
import { GameScreen } from './screens/game/GameScreen.tsx';
import { parseListParams } from './screens/my-list/list-model.ts';
import { MyListScreen } from './screens/my-list/MyListScreen.tsx';
import type { ThemePreference } from './settings/settings-store.ts';
import { filterField, isShortcutTarget } from './shortcuts/dom.ts';
import { shortcutFor, trackGoSequence } from './shortcuts/keymap.ts';
import { ShortcutHelp, ShortcutHelpProvider } from './shortcuts/ShortcutHelp.tsx';

// Catálogo y Ajustes van en *chunks* diferidos (ver §6.2).
const loadCatalog = () => import('./screens/catalog/CatalogScreen.tsx');
const loadSettings = () => import('./screens/settings/SettingsScreen.tsx');
const CatalogScreen = lazy(loadCatalog);
const SettingsScreen = lazy(loadSettings);

function useTheme(theme: ThemePreference): void {
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') delete root.dataset.theme;
    else root.dataset.theme = theme;
  }, [theme]);
}

/**
 * Atajos globales (ver §9.4): `Ctrl+K` (el único del navegador que se intercepta) y `/` abren la
 * paleta; `Ctrl+Z` deshace fuera de los campos de texto; desde M3, `?` (ayuda), `G` y luego `L`,
 * `C` o `A` (ir a) y `F` (filtro). Letras por `event.key`, sin distinguir mayúsculas; `/` vale
 * también con Mayús (en el teclado español es Mayús+7). Lo de las filas y la ficha lo atienden
 * sus pantallas (`shortcuts/keymap.ts`), que reciben la tecla antes.
 */
function useGlobalShortcuts(
  palette: RefObject<PaletteHandle | null>,
  settings: { readonly slashOpensPalette: boolean; readonly singleKeyShortcuts: boolean },
  notices: NoticeCenter,
  openHelp: () => void,
  /** Mi lista con su última vista, filtros y orden (como el enlace de la barra lateral). */
  listHref: string,
): void {
  const { slashOpensPalette, singleKeyShortcuts } = settings;
  // De *layout*: los atajos funcionan desde el primer pintado, no después de `load`.
  useLayoutEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.isComposing) return;
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (!event.defaultPrevented && mod && !event.altKey && !event.shiftKey && key === 'k') {
        event.preventDefault();
        palette.current?.open(event.timeStamp);
        return;
      }
      if (!isShortcutTarget(event.target)) return;
      // Antes de mirar si otra pantalla la ha atendido: cualquier tecla cierra la secuencia «G».
      const action = shortcutFor(event, singleKeyShortcuts);
      trackGoSequence(event, event.defaultPrevented ? null : action);
      if (event.defaultPrevented) return;
      if (mod && !event.altKey && !event.shiftKey && key === 'z') {
        event.preventDefault();
        notices.undoLast({ feedbackStart: event.timeStamp });
        return;
      }
      if (slashOpensPalette && event.key === '/' && !mod && !event.altKey) {
        event.preventDefault();
        palette.current?.open(event.timeStamp);
        return;
      }
      switch (action?.kind) {
        case 'help':
          event.preventDefault();
          openHelp();
          break;
        case 'goStart':
          event.preventDefault();
          break;
        case 'go':
          event.preventDefault();
          navigate(
            action.to === 'list'
              ? listHref
              : action.to === 'catalog'
                ? '/catalogo'
                : settingsPath(null),
          );
          break;
        case 'filter': {
          const field = filterField();
          if (field) {
            event.preventDefault();
            field.focus();
            field.select();
          }
          break;
        }
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [palette, slashOpensPalette, singleKeyShortcuts, notices, openHelp, listHref]);
}

/**
 * El logo (Grafito): el mismo dibujo que `public/icons/icon.svg`, el marcapáginas y el play de
 * Phosphor sobre un degradado de zinc, con los colores en tokens.css (`--brand-*`). Va una sola
 * vez en la página, así que sus `id` no chocan.
 */
function LogoMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="brand-mark-fill" x1="0" y1="0" x2="1" y2="1">
          <stop className="brand__from" offset="0" />
          <stop className="brand__to" offset="1" />
        </linearGradient>
        <mask id="brand-mark-hole">
          <rect width="256" height="256" fill="#fff" />
          <path
            fill="#000"
            transform="translate(103.5 82.4) scale(0.2)"
            d="M240,128a15.74,15.74,0,0,1-7.6,13.51L88.32,229.65a16,16,0,0,1-16.2.3A15.86,15.86,0,0,1,64,216.13V39.87a15.86,15.86,0,0,1,8.12-13.82,16,16,0,0,1,16.2.3L232.4,114.49A15.74,15.74,0,0,1,240,128Z"
          />
        </mask>
      </defs>
      <rect width="256" height="256" rx="56" fill="url(#brand-mark-fill)" />
      <rect className="brand__rim" x="3" y="3" width="250" height="250" rx="53" />
      <path
        className="brand__glyph"
        transform="translate(35.7 29) scale(.72)"
        mask="url(#brand-mark-hole)"
        d="M184,32H72A16,16,0,0,0,56,48V224a8,8,0,0,0,12.24,6.78L128,193.43l59.77,37.35A8,8,0,0,0,200,224V48A16,16,0,0,0,184,32Z"
      />
    </svg>
  );
}

function NavItem({
  to,
  icon,
  label,
  current,
  collapsed,
  onIntent,
}: {
  to: string;
  icon: IconName;
  label: string;
  current: boolean;
  /** Barra lateral encogida (PC): solo el icono, y el nombre en `title`. */
  collapsed: boolean;
  onIntent?: () => void;
}) {
  return (
    <li>
      <Link
        to={to}
        className="app-nav__link"
        aria-current={current ? 'page' : undefined}
        title={collapsed ? label : undefined}
        onPointerEnter={onIntent}
        onFocus={onIntent}
      >
        <Icon name={icon} />
        <span className="app-nav__label">{label}</span>
      </Link>
    </li>
  );
}

function NotFoundScreen() {
  return (
    <div className="screen">
      <header className="screen__header">
        <ScreenHeading>{es.notFound.title}</ScreenHeading>
      </header>
      <div className="empty-state">
        <p>{es.notFound.body}</p>
        <Link to="/" className="btn btn--primary">
          {es.game.backToList}
        </Link>
      </div>
    </div>
  );
}

/** Hueco de una pantalla diferida mientras llega su *chunk* (sin pantalla de carga, ver §9.5). */
function ScreenFallback() {
  return (
    <div className="screen" aria-busy="true">
      <span className="skeleton skeleton--title" />
      <span className="skeleton skeleton--block" />
    </div>
  );
}

function Screens({ route, wide }: { route: Route; wide: boolean }) {
  const withList =
    route.name === 'list' ||
    route.name === 'capture' ||
    route.name === 'share' ||
    route.name === 'game';
  return (
    <>
      {withList && (
        <div className="screen-slot screen-slot--list" inert={route.name === 'game' && !wide}>
          <MyListScreen primary={route.name !== 'game'} />
        </div>
      )}
      {route.name === 'game' && <GameScreen key={route.id} id={route.id} />}
      {route.name === 'catalog' && <CatalogScreen />}
      {route.name === 'settings' && <SettingsScreen section={route.section} />}
      {/* `/emparejar` (M4) pasa enseguida a Ajustes › Sincronización: la misma pantalla. */}
      {route.name === 'pair' && <SettingsScreen section="sync" />}
      {route.name === 'notFound' && <NotFoundScreen />}
    </>
  );
}

/** La app: los detalles del catálogo (portadas, ficha y Próximos) envuelven la carcasa. */
export function App() {
  return (
    <DetailsProvider>
      <AppShell />
    </DetailsProvider>
  );
}

function AppShell() {
  const { route, search } = useLocation();
  const { notices, settings: settingsStore } = useServices();
  const settings = useSettings();
  const collapsed = settings.sidebarCollapsed;
  const commands = useCommands();
  const canUndo = useCanUndo();
  const online = useOnline();
  const wide = useMediaQuery('(min-width: 1280px)');
  // La barra lateral (con sus vistas y portadas) solo existe en el PC; en el móvil no se monta.
  const desktop = useMediaQuery('(min-width: 768px)');
  const paletteRef = useRef<PaletteHandle>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const openHelp = useCallback(() => setHelpOpen(true), []);

  useTheme(settings.theme);
  const listHref = withSearch('/', new URLSearchParams(settings.listSearch));
  useGlobalShortcuts(paletteRef, settings, notices, openHelp, listHref);
  // Después de los efectos de los hijos: `app:list-visible` solo cuenta en el primer *commit*.
  useLayoutEffect(() => endFirstCommit(), []);

  // `/apuntar` abre la paleta sobre Mi lista (acceso directo del *manifest*).
  useEffect(() => {
    if (route.name === 'capture') paletteRef.current?.open(performance.now());
  }, [route.name]);

  // `/emparejar#<código>` (M4; §11.4). Al cargar la página ya lo resuelve `startRouter()`; esto
  // cubre una navegación dentro de la app. Antes de pintar: guarda el código para Ajustes ›
  // Sincronización y cambia la entrada del historial por la de esa sección, sin el fragmento.
  // Canjearlo es un POST tras pulsar «Emparejar este dispositivo», nunca automático.
  useLayoutEffect(() => {
    if (route.name !== 'pair') return;
    stashPairingCode(pairingCodeFromHash(window.location.hash));
    navigate(settingsPath('sync'), { replace: true });
  }, [route.name]);

  const captureLink = useLinkCapture();

  // «Compartir» en Android (`/share`, M3; RF-07): con un enlace de Steam, lo apunta (con su aviso
  // y Deshacer) y deja `/` en el historial; sin enlace, abre la paleta con el texto. Una sola vez
  // por navegación (en desarrollo, `StrictMode` repite los efectos).
  const sharedOnce = useRef<string | null>(null);
  useEffect(() => {
    if (route.name !== 'share') return;
    const key = window.location.href;
    if (sharedOnce.current === key) return;
    sharedOnce.current = key;
    const text = sharedText(new URLSearchParams(window.location.search));
    const startedAt = performance.now();
    navigate('/', { replace: true });
    void captureLink(text, { feedbackStart: startedAt }).then((captured) => {
      if (!captured && text !== '') paletteRef.current?.open(performance.now(), text);
    });
  }, [route.name, captureLink]);

  // `Ctrl+V` con un enlace de Steam en cualquier pantalla (M3; RF-07): fuera de los campos de
  // texto, los menús y los diálogos, lo apunta sin abrir la paleta. Otro texto no se toca.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!isShortcutTarget(event.target)) return;
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (!linkInText(text)) return;
      event.preventDefault();
      void captureLink(text, { feedbackStart: event.timeStamp });
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [captureLink]);

  // `Ctrl+Mayús+Espacio` en la app de escritorio (§17.3) ya no abre la paleta: desde el
  // 06-11-2026, por decisión del usuario, solo pone la ventana delante (DECISIONES §10.32). La
  // parte nativa sigue lanzando `gameagenda:capture` y la página no lo atiende; para apuntar,
  // `Ctrl+K` o `/`. `onDesktopCapture` se conserva en desktop/desktop-capture.ts.

  const paletteActions = useMemo<PaletteActions>(
    () => ({
      capture: (target, options, timing) => {
        commands.capture(target, options, timing);
      },
      openGame: (id) => navigate(gamePath(id)),
      openCatalog: (text) => {
        const params = new URLSearchParams();
        if (text !== '') params.set('q', text);
        navigate(withSearch('/catalogo', params));
      },
      captureLink,
    }),
    [commands, captureLink],
  );

  const onList =
    route.name === 'list' ||
    route.name === 'capture' ||
    route.name === 'share' ||
    route.name === 'game';
  const inSettings = route.name === 'settings' || route.name === 'pair';
  const group = onList ? 'agenda' : inSettings ? 'settings' : route.name;

  return (
    <PaletteProvider handle={paletteRef}>
      <ShortcutHelpProvider value={openHelp}>
        <div
          className="app"
          data-route={route.name}
          data-sidebar={collapsed ? 'collapsed' : 'expanded'}
        >
          <a className="skip-link" href="#main">
            {es.shell.skipToContent}
          </a>
          <div className="app-sidebar">
            <header className="app-header">
              <Link to={listHref} className="brand">
                <LogoMark />
                <span className="brand__name">{es.appName}</span>
              </Link>
              <button
                type="button"
                className="icon-btn app-sidebar-toggle"
                aria-label={es.shell.sidebar}
                aria-expanded={!collapsed}
                aria-controls="app-nav"
                title={collapsed ? es.shell.expandSidebar : es.shell.collapseSidebar}
                onClick={() => settingsStore.update({ sidebarCollapsed: !collapsed })}
              >
                <Icon name="sidebar" />
              </button>
              <MenuButton
                label={es.shell.more}
                className="app-header__menu"
                items={[
                  {
                    key: 'undo',
                    label: es.shell.undoLast,
                    icon: 'undo',
                    disabled: !canUndo,
                    onSelect: (event) => notices.undoLast({ feedbackStart: event.timeStamp }),
                  },
                  {
                    key: 'shortcuts',
                    label: es.shell.shortcuts,
                    icon: 'keyboard',
                    onSelect: openHelp,
                  },
                  {
                    key: 'settings',
                    label: es.nav.settings,
                    icon: 'settings',
                    onSelect: () => navigate(settingsPath(null)),
                  },
                  {
                    key: 'about',
                    label: es.settings.section.about,
                    icon: 'info',
                    onSelect: () => navigate(settingsPath('about')),
                  },
                ]}
              />
              <Palette
                ref={paletteRef}
                actions={paletteActions}
                showBar={
                  route.name === 'list' || route.name === 'capture' || route.name === 'share'
                }
                onClose={() => {
                  if (window.location.pathname === '/apuntar') navigate('/', { replace: true });
                }}
              />
            </header>

            <nav id="app-nav" className="app-nav" aria-label={es.shell.mainNav}>
              <ul>
                <NavItem
                  to={listHref}
                  icon="list"
                  label={es.nav.list}
                  current={onList}
                  collapsed={collapsed}
                />
                <NavItem
                  to="/catalogo"
                  icon="catalog"
                  label={es.nav.catalog}
                  current={route.name === 'catalog'}
                  collapsed={collapsed}
                  onIntent={() => void loadCatalog()}
                />
                <NavItem
                  to={settingsPath(null)}
                  icon="settings"
                  label={es.nav.settings}
                  current={inSettings}
                  collapsed={collapsed}
                  onIntent={() => void loadSettings()}
                />
              </ul>
            </nav>
            {desktop && (
              <SidebarLibrary
                listParams={parseListParams(onList ? search : settings.listSearch)}
                onList={onList}
                collapsed={collapsed}
              />
            )}
          </div>

          {!online && (
            <div className="app-banner notice" role="status">
              <Icon name="offline" />
              <p>{es.notices.offline}</p>
            </div>
          )}

          <main id="main" tabIndex={-1} className="app-main">
            <ErrorBoundary key={group}>
              <Suspense fallback={<ScreenFallback />}>
                <Screens route={route} wide={wide} />
              </Suspense>
            </ErrorBoundary>
          </main>

          <Toaster />
          <CoverNotice hidden={route.name === 'settings' && route.section === 'privacy'} />
          <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
        </div>
      </ShortcutHelpProvider>
    </PaletteProvider>
  );
}
