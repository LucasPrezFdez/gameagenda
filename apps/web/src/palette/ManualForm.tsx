// Alta manual (RF-03): lo buscado rellena el título (WCAG 3.3.7); Intro apunta.
import { useEffect, useId, useRef, useState } from 'react';
import { es } from '../i18n/es.ts';

export interface ManualFormProps {
  readonly initialTitle: string;
  readonly onSubmit: (title: string, timeStamp: number) => void;
  readonly onBack: () => void;
}

export function ManualForm({ initialTitle, onSubmit, onBack }: ManualFormProps) {
  const id = useId();
  const [title, setTitle] = useState(initialTitle);
  const [error, setError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <form
      className="manual-form"
      aria-labelledby={`${id}-title`}
      onSubmit={(event) => {
        event.preventDefault();
        const value = title.trim();
        if (value === '') {
          setError(true);
          return;
        }
        onSubmit(value, event.timeStamp);
      }}
    >
      <p id={`${id}-title`} className="palette__subtitle">
        {es.palette.manualTitle}
      </p>
      <label htmlFor={`${id}-field`}>{es.palette.manualField}</label>
      <input
        ref={inputRef}
        id={`${id}-field`}
        className="field palette__manual-field"
        value={title}
        maxLength={300}
        aria-invalid={error || undefined}
        aria-describedby={`${id}-hint`}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="go"
        onChange={(event) => {
          setTitle(event.target.value);
          setError(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onBack();
          }
        }}
      />
      <p id={`${id}-hint`} className={error ? 'field-error' : 'muted'}>
        {error ? es.palette.manualEmpty : es.palette.manualHint}
      </p>
      <div className="manual-form__actions">
        <button type="button" className="btn" onClick={onBack}>
          {es.palette.back}
        </button>
        <button type="submit" className="btn btn--primary">
          {es.palette.manualSubmit}
        </button>
      </div>
    </form>
  );
}
