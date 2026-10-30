// Carpeta del catálogo (§13.3): `VITE_CATALOG_URL` en producción (`ga-catalog`) o, por defecto, el
// de desarrollo (`/catalog-dev/`). La usan el Worker de búsqueda, para el núcleo, y la interfaz,
// para los *shards* de detalles: así resuelven las rutas del *manifest* igual.

/** URL absoluta de la carpeta del catálogo, con barra final, desde `origin`. */
export function catalogBaseUrl(origin: string): string {
  const configured = import.meta.env.VITE_CATALOG_URL || '/catalog-dev/';
  const base = configured.endsWith('/') ? configured : `${configured}/`;
  return new URL(base, `${origin}/`).href;
}
