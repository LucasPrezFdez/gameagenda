// Salida de una ejecución (§4.5, paso 5): si pasan las puertas, el catálogo va a `--out` (con los
// ficheros de la versión anterior, que cada despliegue reincluye) y el estado nuevo a su sitio; si
// falla una, `--out` no se toca (la versión anterior sigue servida, CA2.2) y el catálogo queda en
// la carpeta de rechazados para verlo. Informes y códigos de salida para `catalog.yml`.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeCatalog } from './catalog-files.ts';
import type { BuildResult } from './run.ts';
import { writeState } from './state.ts';

/**
 * Códigos de salida de `catalog:build`:
 * - 0: catálogo en `--out` y estado nuevo escrito;
 * - 1: falla una puerta; nada en `--out` ni en el estado, catálogo en la carpeta de rechazados;
 * - 2: falla una etapa (Steam, contrato, configuración); no se construye nada;
 * - 3: 403 con clave (revocada o cuenta limitada): avisar y relanzar con `--keyless` (§4.8).
 */
export const EXIT = { ok: 0, gates: 1, stage: 2, keyRejected: 3 } as const;

export interface OutputPaths {
  readonly outDir: string;
  readonly rejectedDir: string;
  /** `null`: no se escribe el estado (los *fixtures* versionados no se tocan). */
  readonly statePath: string | null;
}

/** Escribe el resultado según las puertas y devuelve el código de salida. */
export function writeResult(result: BuildResult, paths: OutputPaths): number {
  if (!result.ok) {
    writeCatalog(paths.rejectedDir, result.files);
    return EXIT.gates;
  }
  writeCatalog(paths.outDir, result.files, { keepPrevious: true });
  if (paths.statePath) writeState(paths.statePath, result.state, result.stateMeta);
  return EXIT.ok;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`, 'utf8');
}

/** Resumen de las puertas en Markdown: el cuerpo del *issue* que abre `catalog.yml` si fallan. */
export function gatesMarkdown(r: BuildResult): string {
  const mark = { pass: '✅', fail: '❌', skip: '➖' } as const;
  const n = (x: number): string => x.toLocaleString('es-ES');
  const lines = [
    `## Catálogo ${r.version}: ${r.ok ? 'puertas en verde' : 'no se publica'}`,
    '',
    `- Juegos: ${n(r.games.length)}; recientes: ${n(r.recent.length)}; con detalles: ${n(r.files.details.games)}`,
    `- enrichmentAgeDays: ${r.enrichmentAgeDays}${r.inputs.enrichmentFailed ? ` (Query: ${r.inputs.enrichmentFailed.kind}, ${r.inputs.enrichmentFailed.message})` : ''}`,
    ...r.inputs.degraded.map((d) => `- Etapa degradada: ${d.stage} (${d.kind}): ${d.message}`),
    '',
    '| Puerta | Estado | Detalle |',
    '|---|---|---|',
    ...r.gates.map((g) => `| ${g.id} | ${mark[g.status]} | ${g.detail.replaceAll('|', '\\|')} |`),
    '',
  ];
  return lines.join('\n');
}

/** Informes de la ejecución en `dir` (no se versionan ni se publican). */
export function writeReports(dir: string, r: BuildResult): void {
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, 'build.json'), { ...r.summary, gatesFull: r.gates });
  writeFileSync(join(dir, 'gates.md'), gatesMarkdown(r), 'utf8');
  writeFileSync(
    join(dir, 'excluded.tsv'),
    `appid\tname\treason\tdetail\n${r.excluded.map((e) => `${e.appid}\t${e.name}\t${e.reason}\t${e.detail}`).join('\n')}\n`,
  );
  if (r.coverage) {
    const { missing, ...rest } = r.coverage;
    writeJson(join(dir, 'coverage.json'), rest);
    writeFileSync(
      join(dir, 'coverage-missing.tsv'),
      `appid\tname\treason\tdetail\n${missing.map((m) => `${m.appid}\t${m.name}\t${m.reason}\t${m.detail}`).join('\n')}\n`,
    );
  }
  if (r.frozenDiff) writeJson(join(dir, 'frozen-diff.json'), r.frozenDiff);
}

/** La más reciente de dos versiones `AAAAMMDD.N` (o `null`). */
export function laterVersion(a: string | null, b: string | null): string | null {
  if (!a || !b) return a ?? b;
  const [da, na] = a.split('.');
  const [db, nb] = b.split('.');
  if (da !== db) return (da as string) > (db as string) ? a : b;
  return Number(na) >= Number(nb) ? a : b;
}
