// Registro de errores (ver §12.7): búfer circular con los 100 últimos en `meta.errorLog` (§7.2),
// sin búsquedas ni datos de la lista. Hasta que la base está abierta se guardan en memoria y
// después se añaden a `meta.errorLog`, que comparten todas las pestañas.

export const ERROR_LOG_LIMIT = 100;

export interface ErrorRecord {
  readonly at: string;
  readonly source: 'window' | 'promise' | 'render' | 'worker' | 'storage';
  readonly message: string;
  readonly stack: string | null;
}

/** Dónde se guarda el registro (`meta.errorLog`). */
export interface ErrorLogStorage {
  append(records: readonly ErrorRecord[]): Promise<void>;
  load(): Promise<readonly ErrorRecord[]>;
}

let records: ErrorRecord[] = [];
let unsaved: ErrorRecord[] = [];
let storage: ErrorLogStorage | null = null;
let saving: Promise<void> = Promise.resolve();

function save(): void {
  if (storage === null || unsaved.length === 0) return;
  const target = storage;
  const batch = unsaved;
  unsaved = [];
  // Si falla, solo a la consola: registrarlo aquí volvería a fallar.
  saving = saving.then(() => target.append(batch)).catch((error: unknown) => console.error(error));
}

export function logError(source: ErrorRecord['source'], error: unknown): void {
  const record: ErrorRecord = {
    at: new Date().toISOString(),
    source,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? (error.stack ?? null) : null,
  };
  records = [...records, record].slice(-ERROR_LOG_LIMIT);
  unsaved = [...unsaved, record].slice(-ERROR_LOG_LIMIT);
  console.error(`[${source}]`, error);
  save();
}

/** Los de esta sesión. */
export function getErrorLog(): readonly ErrorRecord[] {
  return records;
}

/** Empieza a guardar en `meta.errorLog` (también lo registrado antes de abrir la base). */
export function connectErrorLog(target: ErrorLogStorage): void {
  storage = target;
  save();
}

/** Los guardados (de todas las pestañas y sesiones); sin base, los de esta sesión. */
export async function readErrorLog(): Promise<readonly ErrorRecord[]> {
  if (storage === null) return records;
  await saving;
  try {
    return await storage.load();
  } catch {
    return records;
  }
}

/** «Borrar todos mis datos»: también el registro (la base ya está vacía). */
export function clearErrorLog(): void {
  records = [];
  unsaved = [];
}

export function installGlobalErrorHandlers(): void {
  window.addEventListener('error', (event) => logError('window', event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => logError('promise', event.reason));
}
