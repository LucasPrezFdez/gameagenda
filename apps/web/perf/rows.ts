// Filas del informe de `npm run perf`: cada prueba las adjunta (`perf-rows`) y
// `perf/reporter.ts` imprime la tabla al final. Una fila con presupuesto que no lo cumple hace
// fallar su prueba (`expect.soft`, para que se informe de todas).
import type { LatencyStats } from '@gameagenda/core/bench';
import { expect, type TestInfo } from '@playwright/test';

export const ROWS_ATTACHMENT = 'perf-rows';

export interface PerfRow {
  readonly group: string;
  readonly metric: string;
  /** Estadístico de `value`: «p95», «p75», «valor»… */
  readonly stat: string;
  readonly value: number | null;
  readonly p50?: number;
  readonly max?: number;
  readonly n?: number;
  readonly unit: string;
  /** Presupuesto legible («≤50 ms») o `null` si solo informa. */
  readonly budget: string | null;
  /** `null`: solo informa. */
  readonly pass: boolean | null;
  readonly note?: string;
}

interface RowInput {
  readonly metric: string;
  readonly stat?: string;
  readonly value: number | null;
  readonly p50?: number;
  readonly max?: number;
  readonly n?: number;
  readonly unit?: string;
  /** Límite superior; sin él, la fila solo informa. */
  readonly limit?: number;
  readonly note?: string;
}

const fmt = (value: number, unit: string): string =>
  `${value.toLocaleString('es-ES', { maximumFractionDigits: unit === 'ms' ? 1 : 2 })}${unit ? ` ${unit}` : ''}`;

export class PerfRows {
  readonly rows: PerfRow[] = [];
  private readonly group: string;
  constructor(group: string) {
    this.group = group;
  }

  add(input: RowInput): PerfRow {
    const unit = input.unit ?? 'ms';
    const row: PerfRow = {
      group: this.group,
      metric: input.metric,
      stat: input.stat ?? 'valor',
      value: input.value,
      ...(input.p50 !== undefined && { p50: input.p50 }),
      ...(input.max !== undefined && { max: input.max }),
      ...(input.n !== undefined && { n: input.n }),
      unit,
      budget: input.limit === undefined ? null : `≤${fmt(input.limit, unit)}`,
      pass:
        input.limit === undefined
          ? null
          : input.value !== null && Number.isFinite(input.value) && input.value <= input.limit,
      ...(input.note !== undefined && { note: input.note }),
    };
    this.rows.push(row);
    if (row.pass === false) {
      expect
        .soft(
          input.value,
          `${row.group} · ${row.metric} (${row.stat}): ${input.value === null ? '—' : fmt(input.value, unit)}, presupuesto ${row.budget}`,
        )
        .toBeLessThanOrEqual(input.limit as number);
    }
    return row;
  }

  /** Fila de una distribución: el valor es su p95 (o `stat`). */
  addStats(
    input: Omit<RowInput, 'value' | 'p50' | 'max' | 'n'> & { stats: LatencyStats },
  ): PerfRow {
    const { stats, ...rest } = input;
    const round = (x: number) => Math.round(x * 100) / 100;
    return this.add({
      stat: 'p95',
      ...rest,
      value: stats.n === 0 ? null : round(stats.p95),
      p50: round(stats.p50),
      max: round(stats.max),
      n: stats.n,
    });
  }

  async attach(testInfo: TestInfo): Promise<void> {
    await testInfo.attach(ROWS_ATTACHMENT, {
      body: JSON.stringify(this.rows),
      contentType: 'application/json',
    });
  }
}
