import { Component, type ErrorInfo, type ReactNode } from 'react';
import { es } from '../i18n/es.ts';
import { logError } from './error-log.ts';

interface State {
  readonly failed: boolean;
}

/** Si una pantalla falla, lo dice junto a ella y deja el resto de la app en pie. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    logError('render', Object.assign(error, { componentStack: info.componentStack }));
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="notice" role="alert">
        <p>{es.errors.screen}</p>
        <button type="button" className="btn" onClick={() => window.location.reload()}>
          {es.errors.reload}
        </button>
      </div>
    );
  }
}
