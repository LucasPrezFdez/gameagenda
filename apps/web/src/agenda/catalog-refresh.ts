// Juegos provisionales (RF-04, §7.3): cuando el catálogo local cambia de `version` (también al
// cargarse en cada arranque), se buscan sus `appid` y se pone al día el título de las entradas de
// Steam con `refreshCatalogCopy`, sin cambiar de id. También recoge los cambios de nombre.
import { isSteamEntryId, parseEntryId, steamEntryId } from '@gameagenda/core/entries';
import { logError } from '../errors/error-log.ts';
import { displayName } from '../palette/palette-model.ts';
import { canSearchCatalog, type SearchClient } from '../search-client/index.ts';
import type { AgendaStore } from './types.ts';

export function startCatalogRefresh(search: SearchClient, agenda: AgendaStore): () => void {
  let done: string | null = null;

  async function check(): Promise<void> {
    const { state, version } = search.getStatus();
    if (!canSearchCatalog(state) || version === null || version === done) return;
    done = version;
    const appids: number[] = [];
    for (const entry of agenda.getSnapshot()) {
      const parsed = isSteamEntryId(entry.id) ? parseEntryId(entry.id) : null;
      if (parsed?.kind === 'steam') appids.push(parsed.appid);
    }
    if (appids.length === 0) return;
    const { found } = await search.lookup(appids);
    agenda.refreshFromCatalog(
      found.map((game) => ({ id: steamEntryId(game.appid), title: displayName(game) })),
    );
  }

  const run = () => {
    check().catch((error: unknown) => logError('worker', error));
  };
  run();
  return search.subscribeStatus(run);
}
