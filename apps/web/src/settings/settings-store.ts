// Ajustes de la interfaz, de momento solo en memoria; en la siguiente fase van a la tabla
// `settings` de Dexie (ver §7.2).

export type ThemePreference = 'system' | 'light' | 'dark';

export interface UiSettings {
  readonly theme: ThemePreference;
  /** `/` abre la paleta (WCAG 2.1.4: las teclas sueltas se pueden desactivar). */
  readonly slashOpensPalette: boolean;
  /** Contenido para adultos en el Catálogo y la búsqueda (RF-18). */
  readonly showAdult: boolean;
  /** Última vista, filtros y orden de Mi lista (la parte `?…` de su URL). */
  readonly listSearch: string;
}

export const DEFAULT_SETTINGS: UiSettings = {
  theme: 'system',
  slashOpensPalette: true,
  showAdult: false,
  listSearch: '',
};

export interface SettingsStore {
  getSnapshot(): UiSettings;
  subscribe(listener: () => void): () => void;
  update(patch: Partial<UiSettings>): void;
}

export function createSettingsStore(initial: UiSettings = DEFAULT_SETTINGS): SettingsStore {
  let settings = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => settings,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(patch) {
      const next = { ...settings, ...patch };
      const keys = Object.keys(patch) as (keyof UiSettings)[];
      if (keys.every((key) => next[key] === settings[key])) return;
      settings = next;
      for (const listener of listeners) listener();
    },
  };
}
