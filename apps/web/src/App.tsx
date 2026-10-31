// Carcasa de la app (ver §9.1): barra lateral y cabecera con la paleta en escritorio; en móvil,
// la barra «Apunta un juego…» fija abajo, encima de tres pestañas.
import { lazy, type RefObject, Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useCommands } from './agenda/commands.ts';
import { useCanUndo, useServices, useSettings } from './app/services.tsx';
import { CoverNotice } from './components/CoverNotice.tsx';
import { Icon, type IconName } from './components/icons.tsx';
import { MenuButton } from './components/MenuButton.tsx';
import { ScreenHeading } from './components/ScreenHeading.tsx';
import { DetailsProvider } from './details/details-context.tsx';
import { ErrorBoundary } from './errors/ErrorBoundary.tsx';
import { es } from './i18n/es.ts';
import { isEditableTarget, useMediaQuery, useOnline } from './lib/hooks.ts';
import type { NoticeCenter } from './notices/notice-center.ts';
import { Toaster } from './notices/Toaster.tsx';
import { Palette, type PaletteActions, type PaletteHandle } from './palette/Palette.tsx';
import { PaletteProvider } from './palette/palette-context.tsx';
import { endFirstCommit } from './perf/measures.ts';
import { Link, navigate, useLocation } from './router/router.tsx';
import { gamePath, type Route, settingsPath, withSearch } from './router/routes.ts';
import { GameScreen } from './screens/game/GameScreen.tsx';
import { MyListScreen } from './screens/my-list/MyListScreen.tsx';
import type { ThemePreference } from './settings/settings-store.ts';

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
 * Atajos globales de M1 (ver §9.4): `Ctrl+K` (el único del navegador que se intercepta) y `/`
 * abren la paleta; `Ctrl+Z` deshace fuera de los campos de texto. Letras por `event.key`, sin
 * distinguir mayúsculas; `/` vale también con Mayús (en el teclado español es Mayús+7).
 */
function useGlobalShortcuts(
  palette: RefObject<PaletteHandle | null>,
  slashOpensPalette: boolean,
  notices: NoticeCenter,
): void {
  // De *layout*: los atajos funcionan desde el primer pintado, no después de `load`.
  useLayoutEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented || event.isComposing) return;
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey && !event.shiftKey && key === 'k') {
        event.preventDefault();
        palette.current?.open(event.timeStamp);
        return;
      }
      if (isEditableTarget(event.target)) return;
      if (mod && !event.altKey && !event.shiftKey && key === 'z') {
        event.preventDefault();
        notices.undoLast({ feedbackStart: event.timeStamp });
        return;
      }
      if (slashOpensPalette && event.key === '/' && !mod && !event.altKey) {
        event.preventDefault();
        palette.current?.open(event.timeStamp);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [palette, slashOpensPalette, notices]);
}

function LogoMark() {
  return (
    <svg className="brand__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="8" />
      <path d="M10 7h12a1 1 0 0 1 1 1v17l-7-4-7 4V8a1 1 0 0 1 1-1z" />
      <path d="M16 11v7M12.5 14.5h7" />
    </svg>
  );
}

function NavItem({
  to,
  icon,
  label,
  current,
  onIntent,
}: {
  to: string;
  icon: IconName;
  label: string;
  current: boolean;
  onIntent?: () => void;
}) {
  return (
    <li>
      <Link
        to={to}
        className="app-nav__link"
        aria-current={current ? 'page' : undefined}
        onPointerEnter={onIntent}
        onFocus={onIntent}
      >
        <Icon name={icon} />
        <span>{label}</span>
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
  const withList = route.name === 'list' || route.name === 'capture' || route.name === 'game';
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
  const { route } = useLocation();
  const { notices } = useServices();
  const settings = useSettings();
  const commands = useCommands();
  const canUndo = useCanUndo();
  const online = useOnline();
  const wide = useMediaQuery('(min-width: 1280px)');
  const paletteRef = useRef<PaletteHandle>(null);

  useTheme(settings.theme);
  useGlobalShortcuts(paletteRef, settings.slashOpensPalette, notices);
  // Después de los efectos de los hijos: `app:list-visible` solo cuenta en el primer *commit*.
  useLayoutEffect(() => endFirstCommit(), []);

  // `/apuntar` abre la paleta sobre Mi lista (acceso directo del *manifest*).
  useEffect(() => {
    if (route.name === 'capture') paletteRef.current?.open(performance.now());
  }, [route.name]);

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
    }),
    [commands],
  );

  const listHref = withSearch('/', new URLSearchParams(settings.listSearch));
  const onList = route.name === 'list' || route.name === 'capture' || route.name === 'game';
  const group = onList ? 'agenda' : route.name;

  return (
    <PaletteProvider handle={paletteRef}>
      <div className="app" data-route={route.name}>
        <a className="skip-link" href="#main">
          {es.shell.skipToContent}
        </a>
        <header className="app-header">
          <Link to={listHref} className="brand">
            <LogoMark />
            <span>{es.appName}</span>
          </Link>
          <Palette
            ref={paletteRef}
            actions={paletteActions}
            showBar={route.name === 'list' || route.name === 'capture'}
            onClose={() => {
              if (window.location.pathname === '/apuntar') navigate('/', { replace: true });
            }}
          />
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
        </header>

        <nav className="app-nav" aria-label={es.shell.mainNav}>
          <ul>
            <NavItem to={listHref} icon="list" label={es.nav.list} current={onList} />
            <NavItem
              to="/catalogo"
              icon="catalog"
              label={es.nav.catalog}
              current={route.name === 'catalog'}
              onIntent={() => void loadCatalog()}
            />
            <NavItem
              to={settingsPath(null)}
              icon="settings"
              label={es.nav.settings}
              current={route.name === 'settings'}
              onIntent={() => void loadSettings()}
            />
          </ul>
        </nav>

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
      </div>
    </PaletteProvider>
  );
}
