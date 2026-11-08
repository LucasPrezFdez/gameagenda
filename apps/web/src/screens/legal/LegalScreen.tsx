// Política de privacidad (`/privacidad`) y aviso legal (`/aviso-legal`) (M4; CA4.7; §11.2). Va en
// el *chunk* de Ajustes (ver `App.tsx`), desde donde se abre. Pinta los datos de `legal/texts.ts`
// como texto (§11.3): párrafos, listas y tablas, con un índice de secciones.
import { ScreenHeading } from '../../components/ScreenHeading.tsx';
import { es } from '../../i18n/es.ts';
import { LegalParts } from '../../legal/LegalParts.tsx';
import { type Block, legalNotice, privacyPolicy } from '../../legal/texts.ts';
import { CaptureButton } from '../../palette/palette-context.tsx';
import type { LegalDoc } from '../../router/routes.ts';
import './legal.css';

function LegalBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'p':
      return (
        <p>
          <LegalParts parts={block.parts} />
        </p>
      );
    case 'list':
      return (
        <ul>
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: ídem.
            <li key={i}>
              <LegalParts parts={item} />
            </li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <div className="legal__table-wrap">
          <table className="legal__table">
            <caption>{block.caption}</caption>
            <thead>
              <tr>
                {block.head.map((cell) => (
                  <th key={cell} scope="col">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) =>
                    i === 0 ? (
                      <th key={cell} scope="row">
                        {cell}
                      </th>
                    ) : (
                      // biome-ignore lint/suspicious/noArrayIndexKey: columnas fijas.
                      <td key={i}>{cell}</td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export default function LegalScreen({ doc }: { doc: LegalDoc }) {
  const text = doc === 'privacy' ? privacyPolicy() : legalNotice();
  return (
    <div className="screen legal" data-legal={doc}>
      <header className="screen__header">
        <ScreenHeading className="legal__title">{text.title}</ScreenHeading>
        <CaptureButton className="legal__capture" />
      </header>
      <article className="legal__body">
        <p className="muted">
          <LegalParts parts={text.intro} />
        </p>
        <nav className="legal__toc" aria-label={es.about.sections}>
          <ol>
            {text.sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  onClick={(event) => {
                    // Sin cambiar la URL (el *router* no usa el fragmento): baja y deja el foco ahí.
                    const target = document.getElementById(section.id);
                    if (target === null) return;
                    event.preventDefault();
                    target.scrollIntoView({ block: 'start' });
                    target.focus({ preventScroll: true });
                  }}
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {text.sections.map((section) => (
          <section key={section.id} aria-labelledby={section.id} className="legal__section">
            <h2 id={section.id} tabIndex={-1}>
              {section.title}
            </h2>
            {section.blocks.map((block, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: bloques de un texto fijo.
              <LegalBlock key={i} block={block} />
            ))}
          </section>
        ))}
      </article>
    </div>
  );
}
