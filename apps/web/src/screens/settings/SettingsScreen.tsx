// Ajustes (ver §9.1): Apariencia, Contenido (+18), Teclado (solo el atajo `/`), Datos (con la
// edad del catálogo y «Actualizar catálogo», M2), Privacidad («Cargar portadas» y «Datos de Steam
// que guardamos», M2) y Acerca de (con el aviso de marca, ver §11.1). En escritorio, menú y
// sección a la vez; en móvil, primero la lista de secciones y después cada una.
import { type JSX, useId, useRef, useState } from 'react';
import { useCatalogStatus, useServices, useSettings } from '../../app/services.tsx';
import { Icon } from '../../components/icons.tsx';
import { ScreenHeading } from '../../components/ScreenHeading.tsx';
import { useDetailsCatalog, useDetailsStore } from '../../details/details-context.tsx';
import { logError } from '../../errors/error-log.ts';
import { es } from '../../i18n/es.ts';
import { CaptureButton } from '../../palette/palette-context.tsx';
import { Link } from '../../router/router.tsx';
import { SETTINGS_SECTIONS, type SettingsSection, settingsPath } from '../../router/routes.ts';
import type { ThemePreference } from '../../settings/settings-store.ts';
import './settings.css';

const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];

function Appearance() {
  const { settings } = useServices();
  const { theme } = useSettings();
  return (
    <fieldset className="settings__fieldset">
      <legend>{es.settings.theme}</legend>
      {THEMES.map((value) => (
        <label key={value} className="settings__choice">
          <input
            type="radio"
            name="theme"
            value={value}
            checked={theme === value}
            onChange={() => settings.update({ theme: value })}
          />
          {es.settings.themeOption[value]}
        </label>
      ))}
    </fieldset>
  );
}

function Content() {
  const { settings, search } = useServices();
  const { showAdult } = useSettings();
  const id = useId();
  return (
    <div className="settings__choice-block">
      <label className="settings__choice">
        <input
          type="checkbox"
          checked={showAdult}
          aria-describedby={id}
          onChange={(event) => {
            settings.update({ showAdult: event.target.checked });
            void search.setOptions(event.target.checked);
          }}
        />
        {es.settings.adult}
      </label>
      <p id={id} className="muted">
        {es.settings.adultHint}
      </p>
    </div>
  );
}

function Keyboard() {
  const { settings } = useServices();
  const { slashOpensPalette } = useSettings();
  const id = useId();
  return (
    <div className="settings__choice-block">
      <label className="settings__choice">
        <input
          type="checkbox"
          checked={slashOpensPalette}
          aria-describedby={id}
          onChange={(event) => settings.update({ slashOpensPalette: event.target.checked })}
        />
        {es.settings.slash}
      </label>
      <p id={id} className="muted">
        {es.settings.slashHint}
      </p>
    </div>
  );
}

type ImportState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly message: string }
  | { readonly kind: 'invalid'; readonly message: string };

const loadDataActions = () => import('../../data/data-actions.ts');

function Data() {
  const { agenda, settings, notices, search, copyReminder } = useServices();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [word, setWord] = useState('');
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const services = { agenda, settings, appVersion: __APP_VERSION__, copyReminder };

  function failed(error: unknown): void {
    logError('storage', error);
    notices.notify(es.notices.storageFailed);
  }

  async function exportAs(kind: 'json' | 'csv'): Promise<void> {
    try {
      const actions = await loadDataActions();
      const name = kind === 'json' ? actions.exportJson(services) : actions.exportCsv(services);
      notices.notify(es.toast.exported(name));
    } catch (error) {
      failed(error);
    }
  }

  async function exportErrors(): Promise<void> {
    try {
      const { exportErrorLog } = await loadDataActions();
      notices.notify(es.toast.exported(await exportErrorLog(__APP_VERSION__)));
    } catch (error) {
      failed(error);
    }
  }

  async function onImport(file: File | undefined): Promise<void> {
    if (!file) return;
    setImportState({ kind: 'busy' });
    try {
      const { importFile } = await loadDataActions();
      const outcome = await importFile(services, file);
      if (outcome.kind === 'done') {
        const { added, changed, removed, rejected } = outcome.counts;
        const summary = es.settings.importSummary(added, changed, removed, rejected);
        const skipped = outcome.skipped > 0 ? ` ${es.settings.importSkipped(outcome.skipped)}` : '';
        setImportState({ kind: 'done', message: summary + skipped });
      } else {
        const message =
          outcome.kind === 'tooBig' ? es.settings.importTooBig : es.notices.importInvalid;
        setImportState({ kind: 'invalid', message });
      }
    } catch (error) {
      setImportState({ kind: 'idle' });
      failed(error);
    }
  }

  async function deleteAll(): Promise<void> {
    setDeleting(true);
    const { showAdult } = settings.getSnapshot();
    try {
      const { deleteAllData } = await loadDataActions();
      await deleteAllData(services);
      if (showAdult) void search.setOptions(false);
      // Lo que se podía deshacer ya no existe.
      while (notices.undoStack.pop()) {
        // vacía la pila
      }
      setImportState({ kind: 'idle' });
      notices.notify(es.toast.deletedAll);
    } catch (error) {
      failed(error);
    } finally {
      setDeleting(false);
      setConfirming(false);
      setWord('');
    }
  }

  return (
    <div className="settings__data">
      <p className="muted">{es.settings.dataStored}</p>
      <div className="settings__buttons">
        <button type="button" className="btn" onClick={() => void exportAs('json')}>
          {es.settings.exportJson}
        </button>
        <button type="button" className="btn" onClick={() => void exportAs('csv')}>
          {es.settings.exportCsv}
        </button>
        <label className="btn settings__import">
          {es.settings.import}
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            className="visually-hidden"
            aria-describedby={`${id}-import`}
            disabled={importState.kind === 'busy'}
            onChange={(event) => {
              void onImport(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        <button type="button" className="btn" onClick={() => void exportErrors()}>
          {es.settings.exportErrors}
        </button>
      </div>
      <p id={`${id}-import`} className="muted">
        {es.settings.importHint}
      </p>
      <div className="settings__import-result" role="status">
        {importState.kind === 'busy' && <p>{es.settings.importing}</p>}
        {importState.kind === 'done' && <p>{importState.message}</p>}
        {importState.kind === 'invalid' && (
          <>
            <p>{importState.message}</p>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
              {es.notices.chooseOther}
            </button>
          </>
        )}
      </div>

      <CatalogAge />

      <div className="settings__danger">
        <p id={`${id}-hint`} className="muted">
          {es.settings.deleteAllHint}
        </p>
        {confirming ? (
          <form
            className="settings__confirm"
            onSubmit={(event) => {
              event.preventDefault();
              if (word.trim() !== es.settings.deleteConfirmWord || deleting) return;
              void deleteAll();
            }}
          >
            <label htmlFor={`${id}-word`}>{es.settings.deleteConfirmLabel}</label>
            <input
              id={`${id}-word`}
              className="field"
              value={word}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              onChange={(event) => setWord(event.target.value)}
            />
            <div className="settings__buttons">
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                {es.settings.cancel}
              </button>
              <button
                type="submit"
                className="btn btn--danger"
                disabled={word.trim() !== es.settings.deleteConfirmWord || deleting}
              >
                {deleting ? es.settings.deleting : es.settings.deleteConfirm}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="btn btn--danger"
            aria-describedby={`${id}-hint`}
            onClick={() => setConfirming(true)}
          >
            {es.settings.deleteAll}
          </button>
        )}
      </div>
    </div>
  );
}

const dayFormat = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const relativeDays = new Intl.RelativeTimeFormat('es-ES', { numeric: 'auto' });

type RefreshState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'busy' }
  | { readonly kind: 'done'; readonly message: string };

/** Edad del catálogo y «Actualizar catálogo» (§9.1 y §15.5). */
function CatalogAge() {
  const { search } = useServices();
  const { catalog } = useCatalogStatus();
  const [refresh, setRefresh] = useState<RefreshState>({ kind: 'idle' });
  const id = useId();

  async function onRefresh(): Promise<void> {
    setRefresh({ kind: 'busy' });
    const before = search.getStatus().catalog?.version ?? null;
    try {
      await search.refresh();
      // El índice nuevo puede tardar en construirse: se avisa con la versión ya descargada.
      const after = search.getStatus().catalog?.version ?? null;
      setRefresh({
        kind: 'done',
        message:
          after !== null && after !== before
            ? es.settings.catalogUpdated(after)
            : es.settings.catalogUpToDate,
      });
    } catch {
      setRefresh({ kind: 'done', message: es.settings.catalogRefreshFailed });
    }
  }

  let age: string = es.settings.catalogNone;
  if (catalog) {
    const generated = new Date(catalog.generatedAt);
    const days = Math.round((Date.now() - generated.getTime()) / 86_400_000);
    age = es.settings.catalogVersion(
      catalog.version,
      dayFormat.format(generated),
      relativeDays.format(-Math.max(0, days), 'day'),
    );
  }

  return (
    <section className="settings__catalog" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="settings__subtitle">
        {es.settings.catalogTitle}
      </h3>
      <p>{age}</p>
      {catalog && catalog.enrichmentAgeDays > 0 && (
        <p className="muted">{es.settings.catalogEnrichment(catalog.enrichmentAgeDays)}</p>
      )}
      <div className="settings__buttons">
        <button
          type="button"
          className="btn"
          disabled={refresh.kind === 'busy'}
          onClick={() => void onRefresh()}
        >
          {es.settings.catalogRefresh}
        </button>
      </div>
      <div className="settings__import-result" role="status">
        {refresh.kind === 'busy' && <p>{es.settings.catalogRefreshing}</p>}
        {refresh.kind === 'done' && <p>{refresh.message}</p>}
      </div>
    </section>
  );
}

/** Ajustes › Privacidad (§11): «Cargar portadas» y «Datos de Steam que guardamos». */
function Privacy() {
  const { settings } = useServices();
  const { loadCovers, coverNotice } = useSettings();
  const catalog = useDetailsCatalog();
  const store = useDetailsStore();
  const [deleting, setDeleting] = useState<'idle' | 'busy' | 'done'>('idle');
  const id = useId();

  async function deleteSteamData(): Promise<void> {
    setDeleting('busy');
    try {
      if (typeof caches !== 'undefined') {
        const names = await caches.keys();
        await Promise.all(
          names.filter((name) => name.startsWith('gacat-')).map((name) => caches.delete(name)),
        );
      }
      store.clear();
    } finally {
      setDeleting('done');
    }
  }

  return (
    <div className="settings__privacy">
      <section className="settings__choice-block" aria-labelledby={`${id}-covers`}>
        <h3 id={`${id}-covers`} className="settings__subtitle">
          {es.privacy.covers}
        </h3>
        <label className="settings__choice">
          <input
            type="checkbox"
            checked={loadCovers}
            aria-describedby={`${id}-covers-hint`}
            onChange={(event) =>
              settings.update({
                loadCovers: event.target.checked,
                // Quien las apaga aquí ya ha leído el aviso: no hace falta enseñarlo.
                ...(coverNotice === 'unseen' && !event.target.checked
                  ? { coverNotice: 'done' as const }
                  : {}),
              })
            }
          />
          {es.privacy.loadCovers}
        </label>
        <p id={`${id}-covers-hint`} className="muted">
          {es.privacy.loadCoversHint}
        </p>
        {(catalog?.killSwitches.covers === true || catalog?.killSwitches.details === true) && (
          <p className="muted">{es.privacy.coversKilled}</p>
        )}
      </section>

      <section className="settings__steam-data" aria-labelledby={`${id}-steam`}>
        <h3 id={`${id}-steam`} className="settings__subtitle">
          {es.privacy.steamData}
        </h3>
        <p>{es.privacy.what}</p>
        <p>{es.privacy.where}</p>
        <p>{es.privacy.ip}</p>
        <p>{es.privacy.agenda}</p>
        <p className="muted">{es.privacy.browserCache}</p>
        <div className="settings__buttons">
          <button
            type="button"
            className="btn btn--danger"
            disabled={deleting === 'busy'}
            onClick={() => void deleteSteamData()}
          >
            {deleting === 'busy' ? es.privacy.deleting : es.privacy.delete}
          </button>
        </div>
        <div className="settings__import-result" role="status">
          {deleting === 'done' && <p>{es.privacy.deleted}</p>}
        </div>
      </section>
    </div>
  );
}

function About() {
  return (
    <div className="settings__about">
      <p className="settings__app">
        <strong>{es.appName}</strong>
      </p>
      <p>{es.about.description}</p>
      <p className="muted">{es.about.version(__APP_VERSION__, __APP_SHA__)}</p>
      <p className="settings__trademark">{es.about.trademark}</p>
    </div>
  );
}

const SECTIONS: Readonly<Record<SettingsSection, () => JSX.Element>> = {
  appearance: Appearance,
  content: Content,
  keyboard: Keyboard,
  data: Data,
  privacy: Privacy,
  about: About,
};

export default function SettingsScreen({ section }: { section: SettingsSection | null }) {
  const shown = section ?? 'appearance';
  const Section = SECTIONS[shown];
  const headingId = useId();
  return (
    <div className={`screen settings${section === null ? ' is-index' : ' is-section'}`}>
      <header className="screen__header">
        <ScreenHeading
          documentTitle={section ? es.settings.section[section] : es.settings.title}
          className="settings__title"
        >
          {es.settings.title}
        </ScreenHeading>
        <CaptureButton className="settings__capture" />
      </header>
      <div className="settings__layout">
        <nav className="settings__nav" aria-label={es.settings.sections}>
          <ul>
            {SETTINGS_SECTIONS.map((value) => (
              <li key={value}>
                <Link
                  to={settingsPath(value)}
                  aria-current={value === shown ? 'page' : undefined}
                  className="settings__nav-link"
                >
                  {es.settings.section[value]}
                  <Icon name="chevronRight" className="icon settings__chevron" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <section className="settings__section" aria-labelledby={headingId}>
          <Link to={settingsPath(null)} className="btn btn--ghost settings__back">
            <Icon name="back" />
            {es.settings.title}
          </Link>
          <h2 id={headingId} className="settings__section-title">
            {es.settings.section[shown]}
          </h2>
          <Section />
        </section>
      </div>
    </div>
  );
}
