import { createContext, type ReactNode, type RefObject, use } from 'react';
import { Icon } from '../components/icons.tsx';
import { es } from '../i18n/es.ts';
import type { PaletteHandle } from './Palette.tsx';

const PaletteContext = createContext<RefObject<PaletteHandle | null> | null>(null);

export function PaletteProvider({
  handle,
  children,
}: {
  handle: RefObject<PaletteHandle | null>;
  children: ReactNode;
}) {
  return <PaletteContext value={handle}>{children}</PaletteContext>;
}

export function usePalette(): PaletteHandle {
  const handle = use(PaletteContext);
  return {
    open: (timeStamp) => handle?.current?.open(timeStamp),
    close: () => handle?.current?.close(),
  };
}

/** `(+)` de la ficha y de Ajustes en móvil: abre la paleta con el foco en el mismo toque. */
export function CaptureButton({ className = '' }: { className?: string }) {
  const palette = usePalette();
  return (
    <button
      type="button"
      className={`icon-btn capture-button ${className}`}
      aria-label={es.shell.capture}
      onClick={(event) => palette.open(event.timeStamp)}
    >
      <Icon name="plus" />
    </button>
  );
}
