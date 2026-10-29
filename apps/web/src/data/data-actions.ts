// Exportar e importar (*chunk* diferido, ver §6.2): se carga al pulsar un botón de Ajustes › Datos.
// JSON y CSV (§7.5) llegan con la agenda de Dexie; el registro de errores ya se puede exportar.
import { getErrorLog } from '../errors/error-log.ts';

export type DataActionResult = 'done' | 'unavailable';

function download(filename: string, type: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function exportJson(): Promise<DataActionResult> {
  return 'unavailable';
}

export async function exportCsv(): Promise<DataActionResult> {
  return 'unavailable';
}

export async function importFile(_file: File): Promise<DataActionResult> {
  return 'unavailable';
}

export async function exportErrorLog(): Promise<DataActionResult> {
  const body = JSON.stringify(
    { format: 'gameagenda-errors', version: 1, errors: getErrorLog() },
    null,
    2,
  );
  download(`gameagenda-errores-${stamp()}.json`, 'application/json', body);
  return 'done';
}
