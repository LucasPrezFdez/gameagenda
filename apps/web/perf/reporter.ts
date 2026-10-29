// *Reporter* de `npm run perf`: al terminar imprime una tabla con cada medida, su presupuesto y
// si pasa, y la guarda en `test-results/perf-report.json` (ver §12.4).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { FullConfig, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { type PerfRow, ROWS_ATTACHMENT } from './rows.ts';

const num = (value: number | null | undefined, unit = ''): string =>
  value === null || value === undefined
    ? '—'
    : `${value.toLocaleString('es-ES', { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ''}`;

function table(rows: readonly PerfRow[]): string {
  const header = ['Medida', 'Valor', 'p50', 'máx.', 'n', 'Presupuesto', 'Pasa'];
  const body = rows.map((r) => [
    r.metric,
    `${num(r.value, r.unit)}${r.stat === 'valor' ? '' : ` (${r.stat})`}`,
    num(r.p50),
    num(r.max),
    r.n === undefined ? '' : String(r.n),
    r.budget ?? 'informa',
    r.pass === null ? '·' : r.pass ? 'sí' : 'NO',
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i]?.length ?? 0)),
  );
  const line = (cells: readonly string[]) =>
    `| ${cells.map((c, i) => c.padEnd(widths[i] as number)).join(' | ')} |`;
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
}

export default class PerfReporter implements Reporter {
  private readonly rows: PerfRow[] = [];
  private outputFile = 'test-results/perf-report.json';

  onBegin(config: FullConfig): void {
    const outputDir = config.projects[0]?.outputDir;
    if (outputDir) this.outputFile = `${outputDir}/perf-report.json`;
  }

  onTestEnd(_test: TestCase, result: TestResult): void {
    for (const attachment of result.attachments) {
      if (attachment.name !== ROWS_ATTACHMENT || !attachment.body) continue;
      this.rows.push(...(JSON.parse(attachment.body.toString('utf8')) as PerfRow[]));
    }
  }

  onEnd(): void {
    if (this.rows.length === 0) return;
    const groups = [...new Set(this.rows.map((r) => r.group))];
    const out: string[] = ['', 'Informe de rendimiento (npm run perf, §12.4)'];
    for (const group of groups) {
      out.push('', `## ${group}`, '', table(this.rows.filter((r) => r.group === group)));
      for (const r of this.rows.filter((row) => row.group === group && row.note)) {
        out.push(`  · ${r.metric}: ${r.note}`);
      }
    }
    const failed = this.rows.filter((r) => r.pass === false);
    out.push(
      '',
      failed.length === 0
        ? `Todas las medidas con presupuesto pasan (${this.rows.filter((r) => r.pass).length}).`
        : `No pasan ${failed.length}: ${failed.map((r) => r.metric).join('; ')}.`,
      '',
    );
    console.log(out.join('\n'));
    mkdirSync(dirname(this.outputFile), { recursive: true });
    writeFileSync(
      this.outputFile,
      JSON.stringify({ at: new Date().toISOString(), rows: this.rows }, null, 1),
    );
    console.log(`Informe guardado en ${this.outputFile}`);
  }
}
