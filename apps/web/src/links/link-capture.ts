// Apuntar un enlace de Steam sin pasar por la paleta (M3; RF-07, §9.2): «Compartir» en Android
// (`/share`), `Ctrl+V` en cualquier pantalla y el chip «Pegar enlace». Como Intro sobre un enlace
// en la paleta: espera al catálogo local como mucho 500 ms para el título y, si no llega o el
// juego no está, lo apunta como provisional con el título del *slug* (lo resuelve el catálogo
// después). Si ya está en la lista, el aviso lo dice y no se duplica.
import { useCallback } from 'react';
import { useCommands } from '../agenda/commands.ts';
import { type CaptureTarget, steamId } from '../agenda/types.ts';
import { useServices } from '../app/services.tsx';
import { displayName, linkInText, provisionalTitle } from '../palette/palette-model.ts';
import type { FeedbackTiming } from '../perf/measures.ts';

/** Lo que se espera al catálogo local por el título (el mismo plazo que Intro, §8.7). */
export const LINK_WAIT_MS = 500;

/** `true` si el texto traía un enlace de Steam y se ha apuntado (o ya estaba). */
export type CaptureLink = (text: string, timing: FeedbackTiming) => Promise<boolean>;

function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(resolve, ms))]);
}

export function useLinkCapture(): CaptureLink {
  const { search } = useServices();
  const commands = useCommands();
  return useCallback<CaptureLink>(
    async (text, timing) => {
      const found = linkInText(text);
      if (!found) return false;
      const { appid } = found.link;
      const game = await within(
        search.game(appid).catch(() => null),
        LINK_WAIT_MS,
      );
      const target: CaptureTarget = game
        ? { id: steamId(appid), title: displayName(game) }
        : { id: steamId(appid), title: provisionalTitle(found.link), provisional: true };
      commands.capture(target, undefined, timing);
      return true;
    },
    [search, commands],
  );
}

/** El texto que trae «Compartir» (`share_target`): enlace, texto y título, en ese orden. */
export function sharedText(params: URLSearchParams): string {
  return ['url', 'text', 'title']
    .map((name) => params.get(name)?.trim() ?? '')
    .filter((part) => part !== '')
    .join(' ');
}
