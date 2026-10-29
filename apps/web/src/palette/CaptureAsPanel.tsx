// `Alt+Intro`: apuntar con otro estado o con marcas (RF-06). Un número del 1 al 5 apunta con
// ese estado; Espacio marca; Intro apunta (ver §9.2: «Alt+Intro + opción»).
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import { type CaptureOptions, FLAGS, type Flag, STATUSES, type Status } from '../agenda/types.ts';
import { Icon } from '../components/icons.tsx';
import { es } from '../i18n/es.ts';

export interface CaptureAsPanelProps {
  readonly title: string;
  readonly onCapture: (options: CaptureOptions, timeStamp: number) => void;
  readonly onBack: () => void;
}

type Item =
  | { readonly kind: 'status'; readonly status: Status }
  | { readonly kind: 'flag'; readonly flag: Flag };

const ITEMS: readonly Item[] = [
  ...STATUSES.map((status): Item => ({ kind: 'status', status })),
  ...FLAGS.map((flag): Item => ({ kind: 'flag', flag })),
];

const DIGITS: Readonly<Record<string, Status>> = {
  Digit1: 'want_to_play',
  Digit2: 'playing',
  Digit3: 'on_hold',
  Digit4: 'completed',
  Digit5: 'dropped',
  Numpad1: 'want_to_play',
  Numpad2: 'playing',
  Numpad3: 'on_hold',
  Numpad4: 'completed',
  Numpad5: 'dropped',
};

export function CaptureAsPanel({ title, onCapture, onBack }: CaptureAsPanelProps) {
  const titleId = useId();
  // Elegir un estado ya apunta: el marcado es siempre el de por defecto.
  const status: Status = 'want_to_play';
  const [flags, setFlags] = useState<Record<Flag, boolean>>({
    owned: false,
    platinum: false,
    next: false,
  });
  const [focus, setFocus] = useState(0);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    refs.current[focus]?.focus();
  }, [focus]);

  function capture(chosen: Status, timeStamp: number): void {
    onCapture({ status: chosen, flags }, timeStamp);
  }

  function toggle(flag: Flag): void {
    setFlags((current) => ({ ...current, [flag]: !current[flag] }));
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const item = ITEMS[focus];
    // Los dígitos van por `event.code` (ver §9.4).
    const digit = DIGITS[event.code];
    if (digit && !event.ctrlKey && !event.altKey && !event.metaKey) {
      event.preventDefault();
      capture(digit, event.timeStamp);
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        setFocus((focus + 1) % ITEMS.length);
        break;
      case 'ArrowUp':
        setFocus((focus - 1 + ITEMS.length) % ITEMS.length);
        break;
      case 'Home':
        setFocus(0);
        break;
      case 'End':
        setFocus(ITEMS.length - 1);
        break;
      case 'Enter':
        capture(item?.kind === 'status' ? item.status : status, event.timeStamp);
        break;
      // Espacio: la activación nativa del botón (marca, o apunta con ese estado).
      case 'Escape':
        event.stopPropagation();
        onBack();
        break;
      case 'Tab':
        return;
      default:
        return;
    }
    event.preventDefault();
  }

  return (
    <div className="capture-as">
      <p id={titleId} className="palette__subtitle">
        {es.palette.captureAsTitle(title)}
      </p>
      <div role="menu" aria-labelledby={titleId} className="capture-as__menu" onKeyDown={onKeyDown}>
        {/* biome-ignore lint/a11y/useSemanticElements: grupo de un menú ARIA, no un <fieldset>. */}
        <div role="group" aria-label={es.palette.captureAsStatus} className="capture-as__group">
          {STATUSES.map((value, index) => (
            <button
              key={value}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={status === value}
              tabIndex={focus === index ? 0 : -1}
              className={`capture-as__item status-text status-text--${value}`}
              onFocus={() => setFocus(index)}
              onClick={(event) => capture(value, event.timeStamp)}
            >
              <span className="capture-as__key" aria-hidden="true">
                {index + 1}
              </span>
              <Icon name={value} />
              {es.status[value]}
            </button>
          ))}
        </div>
        {/* biome-ignore lint/a11y/useSemanticElements: grupo de un menú ARIA, no un <fieldset>. */}
        <div role="group" aria-label={es.palette.captureAsFlags} className="capture-as__group">
          {FLAGS.map((flag, offset) => {
            const index = STATUSES.length + offset;
            return (
              <button
                key={flag}
                ref={(element) => {
                  refs.current[index] = element;
                }}
                type="button"
                role="menuitemcheckbox"
                aria-checked={flags[flag]}
                tabIndex={focus === index ? 0 : -1}
                className={`capture-as__item status-text status-text--${flag}`}
                onFocus={() => setFocus(index)}
                onClick={() => toggle(flag)}
              >
                <span className="capture-as__check" aria-hidden="true">
                  {flags[flag] ? '✓' : ''}
                </span>
                <Icon name={flag} />
                {es.flag[flag]}
              </button>
            );
          })}
        </div>
      </div>
      <p className="palette__keys muted">{es.palette.captureAsHint}</p>
    </div>
  );
}
