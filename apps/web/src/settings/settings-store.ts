// Ajustes de la interfaz, en la tabla `settings` de Dexie (ver §7.2): se leen antes de pintar
// (sin parpadeo del tema) y se guardan en segundo plano, una fila por clave.

export type ThemePreference = 'system' | 'light' | 'dark';

export interface UiSettings {
  readonly theme: ThemePreference;
  /** `/` abre la paleta (WCAG 2.1.4: las teclas sueltas se pueden desactivar). */
  readonly slashOpensPalette: boolean;
  /** Contenido para adultos en el Catálogo y la búsqueda (RF-18). */
  readonly showAdult: boolean;
  /** Última vista, filtros y orden de Mi lista (la parte `?…` de su URL). */
  readonly listSearch: string;
  /**
   * «Cargar portadas» (§11.2): encendido por defecto (interés legítimo, con oposición en un
   * toque). Apagado, ninguna petición a `*.steamstatic.com` (CA2.7).
   */
  readonly loadCovers: boolean;
  /** Aviso de primera capa de las portadas (§11.2): sin ver, visto o ya cerrado. */
  readonly coverNotice: CoverNoticeState;
}

/**
 * `unseen`: aún no ha salido y ninguna portada se carga; `shown`: ha salido y las portadas ya se
 * cargan, pero sigue a la vista hasta que se cierra; `done`: cerrado.
 */
export type CoverNoticeState = 'unseen' | 'shown' | 'done';

export const DEFAULT_SETTINGS: UiSettings = {
  theme: 'system',
  slashOpensPalette: true,
  showAdult: false,
  listSearch: '',
  loadCovers: true,
  coverNotice: 'unseen',
};

export type SettingKey = keyof UiSettings;
const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];
const THEMES: readonly ThemePreference[] = ['system', 'light', 'dark'];
const COVER_NOTICE: readonly CoverNoticeState[] = ['unseen', 'shown', 'done'];
const MAX_LIST_SEARCH = 2000;

/** Valor válido de un ajuste, o `undefined` si no lo es (se queda el de por defecto). */
function validValue(key: SettingKey, value: unknown): UiSettings[SettingKey] | undefined {
  switch (key) {
    case 'theme':
      return THEMES.find((theme) => theme === value);
    case 'slashOpensPalette':
    case 'showAdult':
    case 'loadCovers':
      return typeof value === 'boolean' ? value : undefined;
    case 'listSearch':
      return typeof value === 'string' && value.length <= MAX_LIST_SEARCH ? value : undefined;
    case 'coverNotice':
      return COVER_NOTICE.find((state) => state === value);
  }
}

/** Ajustes desde filas guardadas o un fichero importado: lo desconocido o no válido se ignora. */
export function parseSettings(record: Readonly<Record<string, unknown>>): UiSettings {
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of SETTING_KEYS) {
    const value = validValue(key, record[key]);
    if (value !== undefined) settings[key] = value;
  }
  return settings as unknown as UiSettings;
}

/** Solo las claves válidas presentes en `record` (para importar sin tocar el resto). */
export function settingsPatch(record: Readonly<Record<string, unknown>>): Partial<UiSettings> {
  const patch: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const value = validValue(key, record[key]);
    if (value !== undefined) patch[key] = value;
  }
  return patch as Partial<UiSettings>;
}

/** Ajustes como clave → valor, para exportar. */
export function settingsRecord(settings: UiSettings): Record<string, string | boolean> {
  return { ...settings };
}

export interface SettingsStorage {
  /** Guarda lo cambiado: `undefined` borra la fila (vuelve al valor por defecto). */
  save(changes: Readonly<Partial<Record<SettingKey, UiSettings[SettingKey] | undefined>>>): void;
}

export interface SettingsStore {
  getSnapshot(): UiSettings;
  subscribe(listener: () => void): () => void;
  update(patch: Partial<UiSettings>): void;
  /** Sustituye los ajustes sin guardarlos (llegan de otra pestaña o se han borrado). */
  replace(next: UiSettings): void;
}

export function createSettingsStore(
  initial: UiSettings = DEFAULT_SETTINGS,
  storage?: SettingsStorage,
): SettingsStore {
  let settings = initial;
  const listeners = new Set<() => void>();

  function set(next: UiSettings): void {
    settings = next;
    for (const listener of listeners) listener();
  }

  return {
    getSnapshot: () => settings,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(patch) {
      const next = { ...settings, ...patch };
      const keys = (Object.keys(patch) as SettingKey[]).filter(
        (key) => next[key] !== settings[key],
      );
      if (keys.length === 0) return;
      set(next);
      const changes: Partial<Record<SettingKey, UiSettings[SettingKey] | undefined>> = {};
      for (const key of keys) {
        changes[key] = next[key] === DEFAULT_SETTINGS[key] ? undefined : next[key];
      }
      storage?.save(changes);
    },
    replace(next) {
      if (SETTING_KEYS.every((key) => next[key] === settings[key])) return;
      set(next);
    },
  };
}
