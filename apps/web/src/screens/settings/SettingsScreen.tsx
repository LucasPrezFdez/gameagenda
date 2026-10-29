// Ajustes de M1 (ver §9.1): Apariencia, Contenido (+18), Teclado (solo el atajo `/`), Datos y
// Acerca de (con el aviso de marca, ver §11.1). En escritorio, menú y sección a la vez; en móvil,
// primero la lista de secciones y después cada una.
import { type JSX, useId, useState } from 'react';
import { useServices, useSettings } from '../../app/services.tsx';
import { Icon } from '../../components/icons.tsx';
import { ScreenHeading } from '../../components/ScreenHeading.tsx';
import { es } from '../../i18n/es.ts';
import { CaptureButton } from '../../palette/palette-context.tsx';
import { Link } from '../../router/router.tsx';
import { SETTINGS_SECTIONS, type SettingsSection, settingsPath } from '../../router/routes.ts';
import { DEFAULT_SETTINGS, type ThemePreference } from '../../settings/settings-store.ts';
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

function Data() {
  const { agenda, settings, notices } = useServices();
  const [confirming, setConfirming] = useState(false);
  const [word, setWord] = useState('');
  const id = useId();

  async function run(action: 'exportJson' | 'exportCsv' | 'exportErrorLog'): Promise<void> {
    const actions = await import('../../data/data-actions.ts');
    const result = await actions[action]();
    if (result === 'unavailable') notices.notify(es.settings.notYet);
  }

  async function onImport(file: File | undefined): Promise<void> {
    if (!file) return;
    const { importFile } = await import('../../data/data-actions.ts');
    if ((await importFile(file)) === 'unavailable') notices.notify(es.settings.notYet);
  }

  return (
    <div className="settings__data">
      <p className="muted">{es.settings.dataStored}</p>
      <div className="settings__buttons">
        <button type="button" className="btn" onClick={() => void run('exportJson')}>
          {es.settings.exportJson}
        </button>
        <button type="button" className="btn" onClick={() => void run('exportCsv')}>
          {es.settings.exportCsv}
        </button>
        <label className="btn settings__import">
          {es.settings.import}
          <input
            type="file"
            accept=".json,.csv,application/json,text/csv"
            className="visually-hidden"
            onChange={(event) => {
              void onImport(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        <button type="button" className="btn" onClick={() => void run('exportErrorLog')}>
          {es.settings.exportErrors}
        </button>
      </div>

      <div className="settings__danger">
        <p id={`${id}-hint`} className="muted">
          {es.settings.deleteAllHint}
        </p>
        {confirming ? (
          <form
            className="settings__confirm"
            onSubmit={(event) => {
              event.preventDefault();
              if (word.trim() !== es.settings.deleteConfirmWord) return;
              agenda.deleteAll();
              settings.update(DEFAULT_SETTINGS);
              setConfirming(false);
              setWord('');
              notices.notify(es.toast.deletedAll);
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
                disabled={word.trim() !== es.settings.deleteConfirmWord}
              >
                {es.settings.deleteConfirm}
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
