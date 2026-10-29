import { useCatalogStatus, useServices } from '../app/services.tsx';
import { es } from '../i18n/es.ts';
import { canSearchCatalog } from '../search-client/index.ts';

/** «Preparando el catálogo de Steam…» (ver §9.6): solo en `none`, junto a lo que afecta. */
export function CatalogNotice() {
  const { search } = useServices();
  const status = useCatalogStatus();
  if (canSearchCatalog(status.state)) return null;
  return (
    <div className="notice">
      <p>{status.error ? es.catalogState.failed : es.catalogState.preparing(status.progress)}</p>
      {status.error?.retryable && (
        <button type="button" className="btn" onClick={() => void search.retry()}>
          {es.catalogState.retry}
        </button>
      )}
    </div>
  );
}
