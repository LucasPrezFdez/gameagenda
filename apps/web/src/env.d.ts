/** Versión de `package.json` y SHA corto del *commit* (los fija `vite.config.ts`). */
declare const __APP_VERSION__: string;
declare const __APP_SHA__: string;
/** «Importar desde Steam» está activada en este *build* (`vite.config.ts`; ADR-012). */
declare const __STEAM_IMPORT__: boolean;

interface ImportMetaEnv {
  /** Carpeta del catálogo publicado (por defecto, `/catalog-dev/`; ver §13.3). */
  readonly VITE_CATALOG_URL?: string;
  /** `'1'` enseña «Importar desde Steam» también en producción (`__STEAM_IMPORT__`; ADR-012). */
  readonly VITE_STEAM_IMPORT?: string;
}
