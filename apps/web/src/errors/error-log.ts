// Registro de errores (ver §12.7): búfer circular con los 100 últimos, sin búsquedas ni datos de
// la lista. De momento en memoria; en la siguiente fase, en `meta.errorLog` (ver §7.2).

export const ERROR_LOG_LIMIT = 100;

export interface ErrorRecord {
  readonly at: string;
  readonly source: 'window' | 'promise' | 'render' | 'worker';
  readonly message: string;
  readonly stack: string | null;
}

let records: ErrorRecord[] = [];

export function logError(source: ErrorRecord['source'], error: unknown): void {
  const record: ErrorRecord = {
    at: new Date().toISOString(),
    source,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? (error.stack ?? null) : null,
  };
  records = [...records, record].slice(-ERROR_LOG_LIMIT);
  console.error(`[${source}]`, error);
}

export function getErrorLog(): readonly ErrorRecord[] {
  return records;
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => logError('window', event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => logError('promise', event.reason));
}
