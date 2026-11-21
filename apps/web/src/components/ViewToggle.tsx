// Lista o cuadrícula de portadas: el Catálogo (DECISIONES §10.45) y Mi lista (§10.53). Dos botones
// conmutables con su icono; el nombre de cada uno, en `aria-label` y en la etiqueta del puntero.
import { es } from '../i18n/es.ts';
import type { LayoutMode } from '../settings/settings-store.ts';
import { Icon } from './icons.tsx';

const MODES: readonly LayoutMode[] = ['list', 'grid'];

export function ViewToggle({
  value,
  onChange,
}: {
  readonly value: LayoutMode;
  readonly onChange: (mode: LayoutMode) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: grupo de botones conmutables, no un formulario.
    <div className="view-toggle" role="group" aria-label={es.viewMode.label}>
      {MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          className="icon-btn view-toggle__button"
          aria-pressed={value === mode}
          aria-label={es.viewMode[mode]}
          title={es.viewMode[mode]}
          onClick={() => {
            if (mode !== value) onChange(mode);
          }}
        >
          <Icon name={mode === 'list' ? 'list' : 'catalog'} />
        </button>
      ))}
    </div>
  );
}
