import { type ReactNode, useEffect, useRef } from 'react';
import { es } from '../i18n/es.ts';
import { useNavigationFocus } from '../router/router.tsx';

export interface ScreenHeadingProps {
  readonly children: ReactNode;
  /** Título del documento; por defecto, el texto del encabezado. */
  readonly documentTitle?: string;
  /** Solo la pantalla principal recibe el foco al navegar (la de fondo, no). */
  readonly primary?: boolean;
  readonly className?: string;
  readonly id?: string;
}

/** `<h1>` de cada pantalla: recibe el foco tras navegar y fija el título del documento. */
export function ScreenHeading({
  children,
  documentTitle,
  primary = true,
  className,
  id,
}: ScreenHeadingProps) {
  const ref = useRef<HTMLHeadingElement>(null);
  useNavigationFocus(ref, primary);
  const title = documentTitle ?? (typeof children === 'string' ? children : '');
  useEffect(() => {
    if (primary && title !== '') document.title = es.documentTitle(title);
  }, [primary, title]);
  return (
    <h1 ref={ref} id={id} tabIndex={-1} className={className}>
      {children}
    </h1>
  );
}
