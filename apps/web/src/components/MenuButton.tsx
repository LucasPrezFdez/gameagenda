// Botón con menú (patrón «menu button» del APG): flechas, Inicio, Fin, Esc y Tab.
import {
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Icon, type IconName } from './icons.tsx';

export interface MenuItem {
  readonly key: string;
  readonly label: string;
  readonly onSelect: (event: SyntheticEvent) => void;
  readonly icon?: IconName;
  readonly disabled?: boolean;
  /** `radio` y `checkbox` llevan `aria-checked`. */
  readonly kind?: 'item' | 'radio' | 'checkbox';
  readonly checked?: boolean;
  /** Clase extra para colorear el icono (p. ej., el de un estado). */
  readonly tone?: string;
}

export interface MenuButtonProps {
  /** Nombre accesible del botón; empieza por el texto visible si lo hay (WCAG 2.5.3). */
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly children?: ReactNode;
  readonly className?: string;
  readonly buttonClassName?: string;
  readonly align?: 'start' | 'end';
  readonly tabIndex?: number;
  readonly id?: string;
  /** Nombre del menú; por defecto, el del botón. */
  readonly menuLabel?: string;
}

const ROLE = { item: 'menuitem', radio: 'menuitemradio', checkbox: 'menuitemcheckbox' } as const;
const OTHER_SIDE = { start: 'end', end: 'start' } as const;

/**
 * ¿Hay que abrir el menú hacia el otro lado? Sí si, alineado con `align`, se sale de la pantalla
 * y por el otro lado se sale menos: sin eso, un menú más ancho que su botón y pegado al borde
 * saca una barra de desplazamiento horizontal (§9.3: sin desplazamiento horizontal).
 */
export function shouldFlipMenu(
  align: 'start' | 'end',
  button: { readonly left: number; readonly right: number },
  menuWidth: number,
  viewportWidth: number,
): boolean {
  // Con `start` empieza en el borde izquierdo del botón; con `end`, acaba en el derecho.
  const overflowStart = Math.max(0, button.left + menuWidth - viewportWidth);
  const overflowEnd = Math.max(0, menuWidth - button.right);
  const [current, other] =
    align === 'start' ? [overflowStart, overflowEnd] : [overflowEnd, overflowStart];
  return current > 0 && other < current;
}

export function MenuButton({
  label,
  items,
  children,
  className = '',
  buttonClassName = 'icon-btn',
  align = 'end',
  tabIndex,
  id,
  menuLabel,
}: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndex = useRef(0);

  const enabled = items.flatMap((item, index) => (item.disabled ? [] : [index]));

  function focusItem(index: number): void {
    focusIndex.current = index;
    itemRefs.current[index]?.focus();
  }

  function openMenu(target: 'first' | 'last'): void {
    const checked = items.findIndex((item) => item.checked && !item.disabled);
    const first = checked >= 0 ? checked : (enabled[0] ?? 0);
    focusIndex.current = target === 'last' ? (enabled.at(-1) ?? 0) : first;
    setFlipped(false);
    setOpen(true);
  }

  function close(returnFocus: boolean): void {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  // Antes de pintarlo, como mucho una vuelta por apertura (no puede oscilar).
  useLayoutEffect(() => {
    if (!open || flipped || !popupRef.current || !buttonRef.current) return;
    const button = buttonRef.current.getBoundingClientRect();
    const viewport = document.documentElement.clientWidth;
    if (shouldFlipMenu(align, button, popupRef.current.offsetWidth, viewport)) setFlipped(true);
  }, [open, flipped, align]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[focusIndex.current]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      openMenu(event.key === 'ArrowUp' ? 'last' : 'first');
    }
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const position = enabled.indexOf(focusIndex.current);
    const move = (delta: number) => {
      const next = enabled[(position + delta + enabled.length) % enabled.length];
      if (next !== undefined) focusItem(next);
    };
    switch (event.key) {
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'Home':
        if (enabled[0] !== undefined) focusItem(enabled[0]);
        break;
      case 'End':
        if (enabled.at(-1) !== undefined) focusItem(enabled.at(-1) ?? 0);
        break;
      case 'Escape':
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        return;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  return (
    <div ref={rootRef} className={`menu ${className}`}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        className={buttonClassName}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        tabIndex={tabIndex}
        onClick={() => (open ? close(false) : openMenu('first'))}
        onKeyDown={onButtonKeyDown}
      >
        {children ?? <Icon name="more" />}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          ref={popupRef}
          aria-label={menuLabel ?? label}
          className={`menu__popup menu__popup--${flipped ? OTHER_SIDE[align] : align}`}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item, index) => {
            const kind = item.kind ?? 'item';
            return (
              // biome-ignore lint/a11y/useAriaPropsSupportedByRole: `role` es menuitemradio o menuitemcheckbox cuando lleva `aria-checked`.
              <button
                key={item.key}
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role={ROLE[kind]}
                aria-checked={kind === 'item' ? undefined : item.checked === true}
                aria-disabled={item.disabled || undefined}
                tabIndex={-1}
                className={`menu__item ${item.tone ?? ''}`}
                onClick={(event) => {
                  if (item.disabled) return;
                  close(true);
                  item.onSelect(event);
                }}
              >
                {item.icon && <Icon name={item.icon} />}
                <span>{item.label}</span>
                {kind !== 'item' && item.checked && (
                  <span className="menu__check" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
