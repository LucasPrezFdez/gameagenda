// Lo que una recarga perdería o que se notaría (ver `update-policy.ts`): texto escrito en el campo
// con el foco (una nota sin guardar, la paleta), un diálogo, un menú o la lista de la paleta
// abiertos, un aviso a la vista (con su Deshacer) o el catálogo aún cargando.
import type { CatalogState } from '../search-client/protocol.ts';

/** Lo que se mira de un elemento; en las pruebas, un objeto cualquiera. */
interface FieldLike {
  readonly tagName?: string;
  readonly type?: string;
  readonly readOnly?: boolean;
  readonly value?: unknown;
  readonly isContentEditable?: boolean;
  readonly textContent?: string | null;
}

export interface DocumentLike {
  readonly activeElement: unknown;
  querySelector(selectors: string): unknown;
}

/** Tipos de `<input>` que no son texto. */
const NOT_TEXT = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

/** Diálogos, menús y la lista de resultados de la paleta, abiertos. */
export const OPEN_UI = 'dialog[open], [role="menu"], [role="combobox"][aria-expanded="true"]';

/** ¿Es un campo de texto editable y con algo escrito? */
export function hasTextInProgress(element: unknown): boolean {
  if (typeof element !== 'object' || element === null) return false;
  const field = element as FieldLike;
  if (field.isContentEditable === true) return (field.textContent ?? '') !== '';
  const tag = field.tagName?.toLowerCase();
  const isText =
    tag === 'textarea' || (tag === 'input' && !NOT_TEXT.has((field.type ?? 'text').toLowerCase()));
  return isText && field.readOnly !== true && typeof field.value === 'string' && field.value !== '';
}

export function hasWorkInProgress(doc: DocumentLike): boolean {
  return hasTextInProgress(doc.activeElement) || doc.querySelector(OPEN_UI) !== null;
}

/** Mientras el catálogo se descarga o se indexa, una recarga tiraría ese trabajo. */
export function catalogIsLoading(status: {
  readonly state: CatalogState;
  readonly error: unknown;
}): boolean {
  return status.state !== 'full' && status.error === null;
}
