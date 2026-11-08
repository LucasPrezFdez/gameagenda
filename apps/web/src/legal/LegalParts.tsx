// Un texto legal con sus enlaces (`Inline` de `controller.ts`), como texto (§11.3): las rutas de
// la app con el `Link` del *router*; `https:` en otra pestaña y sin `Referer`; `mailto:` tal cual.
// Lo usan Ajustes y la pantalla de los textos legales, que va en el mismo *chunk* (ver `App.tsx`).
import { Link } from '../router/router.tsx';
import type { Inline } from './controller.ts';

export function LegalParts({ parts }: { parts: readonly Inline[] }) {
  return (
    <>
      {parts.map((part, i) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: los trozos de un texto fijo no cambian de sitio.
        if (typeof part === 'string') return <span key={i}>{part}</span>;
        if (part.href.startsWith('/')) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: ídem.
            <Link key={i} to={part.href}>
              {part.text}
            </Link>
          );
        }
        const external = part.href.startsWith('https:');
        return (
          <a
            // biome-ignore lint/suspicious/noArrayIndexKey: ídem.
            key={i}
            href={part.href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {part.text}
          </a>
        );
      })}
    </>
  );
}
