// Los enlaces del buzón del Atajo de iOS (M4; RF-08; CA4.5): la sincronización los trae y esta
// pestaña los apunta como un enlace pegado (`link-capture.ts`), en Quiero jugar. El título sale del
// catálogo local si llega en 500 ms; si no, el juego queda provisional con el título del *slug* (lo
// resuelven el catálogo o `resolve` después). Lo que ya está en la lista no se toca. Al acabar, un
// aviso dice qué ha llegado, si no tapa otro.

import type { AgendaStore } from '../agenda/types.ts';
import { steamId } from '../agenda/types.ts';
import { es } from '../i18n/es.ts';
import type { NoticeCenter } from '../notices/notice-center.ts';
import { displayName } from '../palette/palette-model.ts';
import type { SearchClient } from '../search-client/index.ts';
import type { InboxLink, InboxSink } from '../sync/types.ts';
import { LINK_WAIT_MS } from './link-wait.ts';

export interface InboxCaptureDeps {
  readonly agenda: AgendaStore;
  readonly search: Pick<SearchClient, 'lookup'>;
  readonly notices: Pick<NoticeCenter, 'notify' | 'getSnapshot'> | null;
  /** Lo que se espera al catálogo local por los títulos (por defecto, el de Intro: 500 ms). */
  readonly waitMs?: number;
}

function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(undefined), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** El título del juego provisional: el del *slug* o «Juego de Steam <appid>». */
function provisional(link: InboxLink): string {
  return link.title ?? es.palette.steamGame(link.appid);
}

export function createInboxSink(deps: InboxCaptureDeps): InboxSink {
  const { agenda, search, notices } = deps;
  return {
    async capture(links) {
      if (links.length === 0) return;
      const lookup = await within(
        search.lookup(links.map((l) => l.appid)).catch(() => undefined),
        deps.waitMs ?? LINK_WAIT_MS,
      );
      const titles = new Map((lookup?.found ?? []).map((g) => [g.appid, displayName(g)]));
      const captured: string[] = [];
      for (const link of links) {
        const title = titles.get(link.appid);
        const result = agenda.capture(
          title === undefined
            ? { id: steamId(link.appid), title: provisional(link), provisional: true }
            : { id: steamId(link.appid), title },
        );
        if (result.effect.kind === 'captured') captured.push(result.effect.title);
      }
      await agenda.whenIdle();
      if (captured.length > 0 && notices !== null && notices.getSnapshot() === null) {
        notices.notify(es.inbox.captured(captured));
      }
    },
  };
}
