// Selector de una opción con un menú de radio (sin `<select>` nativo: en WebKit su árbol de
// agente de usuario viola `style-src 'self'`, ver §11.3).
import type { SyntheticEvent } from 'react';
import { Icon } from './icons.tsx';
import { MenuButton } from './MenuButton.tsx';

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface ChoiceMenuProps<T extends string> {
  readonly label: string;
  readonly value: T;
  readonly options: readonly Choice<T>[];
  readonly onChange: (value: T, event: SyntheticEvent) => void;
  readonly className?: string;
}

export function ChoiceMenu<T extends string>({
  label,
  value,
  options,
  onChange,
  className = '',
}: ChoiceMenuProps<T>) {
  const current = options.find((option) => option.value === value);
  return (
    <div className={`choice ${className}`}>
      <span className="choice__label" aria-hidden="true">
        {label}
      </span>
      <MenuButton
        label={`${label}: ${current?.label ?? ''}`}
        menuLabel={label}
        align="start"
        buttonClassName="btn choice__button"
        items={options.map((option) => ({
          key: option.value,
          label: option.label,
          kind: 'radio',
          checked: option.value === value,
          onSelect: (event) => onChange(option.value, event),
        }))}
      >
        {current?.label}
        <Icon name="chevronDown" />
      </MenuButton>
    </div>
  );
}
