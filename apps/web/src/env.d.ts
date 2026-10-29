/** Versión de `package.json` y SHA corto del *commit* (los fija `vite.config.ts`). */
declare const __APP_VERSION__: string;
declare const __APP_SHA__: string;

interface ImportMetaEnv {
  /** Carpeta del catálogo publicado (por defecto, `/catalog-dev/`; ver §13.3). */
  readonly VITE_CATALOG_URL?: string;
}
