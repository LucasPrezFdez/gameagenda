// Ganchos de los E2E para los detalles (solo en el *build* del modo `e2e`, ver §12.3; el de
// producción no los lleva). Las pruebas dan el índice de *shards* y los *kill switches* sin tocar
// el *manifest*: el WebKit de Playwright no intercepta las peticiones del Worker de búsqueda, y el
// *manifest* firmado de M2 no se puede cambiar. Los *shards* sí se sirven con `page.route`.
import type { CatalogFileRef, CatalogInfo } from '../search-client/protocol.ts';

export interface DetailsTestOptions {
  readonly detailsIndex?: CatalogFileRef | null;
  readonly killSwitches?: CatalogInfo['killSwitches'];
}

declare global {
  var __GA_DETAILS_TEST__: DetailsTestOptions | undefined;
}

/** El catálogo en uso con lo que fije la prueba. */
export function withDetailsTestHooks(info: CatalogInfo | null): CatalogInfo | null {
  const options = globalThis.__GA_DETAILS_TEST__;
  if (!info || !options) return info;
  return {
    ...info,
    ...(options.detailsIndex !== undefined ? { detailsIndex: options.detailsIndex } : {}),
    ...(options.killSwitches ? { killSwitches: options.killSwitches } : {}),
  };
}
