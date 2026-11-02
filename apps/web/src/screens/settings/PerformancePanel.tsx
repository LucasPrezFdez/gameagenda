// Ajustes › Rendimiento (M3; §12.7): las medidas de este dispositivo con su p50, p75 y p95 frente
// a los presupuestos de la §3, el catálogo y el índice, `persist()` y el espacio usado. Es para
// medir donde no hay `chrome://inspect`, como en un iPhone (CA3.1). No envía nada: el informe se
// copia a mano. Las medidas las recoge `perf/sampler.ts` desde el arranque.
import { useEffect, useId, useState } from 'react';
import { useCatalogStatus, usePerfSamples, useServices } from '../../app/services.tsx';
import { logError } from '../../errors/error-log.ts';
import { es } from '../../i18n/es.ts';
import { type MetricSummary, summarize } from '../../perf/samples.ts';

const ms = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const mb = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
const dateTime = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const day = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium' });

function formatMs(value: number | null): string {
  if (value === null) return es.perfPanel.none;
  return value >= 1000 ? `${ms.format(value / 1000)} s` : `${ms.format(value)} ms`;
}

function formatBytes(bytes: number): string {
  return bytes >= 1e9 ? `${mb.format(bytes / 1e9)} GB` : `${mb.format(bytes / 1e6)} MB`;
}

function targetOf(row: MetricSummary): string {
  return row.budget
    ? es.perfPanel.targetText(row.budget.stat, formatMs(row.budget.limit))
    : es.perfPanel.none;
}

function resultOf(row: MetricSummary): string {
  if (row.passes === null) return es.perfPanel.none;
  return row.passes ? es.perfPanel.pass : es.perfPanel.fail;
}

interface StorageInfo {
  readonly persisted: boolean | null;
  readonly usage: number | null;
  readonly quota: number | null;
}

/** `persist()` y el espacio usado; `null` donde el navegador no lo dice. */
function useStorageInfo(): StorageInfo {
  const [info, setInfo] = useState<StorageInfo>({ persisted: null, usage: null, quota: null });
  useEffect(() => {
    const storage = globalThis.navigator?.storage;
    let current = true;
    void Promise.all([
      storage?.persisted?.().catch(() => null) ?? null,
      storage?.estimate?.().catch(() => null) ?? null,
    ]).then(([persisted, estimate]) => {
      if (!current) return;
      setInfo({
        persisted: persisted ?? null,
        usage: estimate?.usage ?? null,
        quota: estimate?.quota ?? null,
      });
    });
    return () => {
      current = false;
    };
  }, []);
  return info;
}

export function PerformancePanel() {
  const { perf, search } = useServices();
  const samples = usePerfSamples();
  const status = useCatalogStatus();
  const storage = useStorageInfo();
  const [message, setMessage] = useState<string | null>(null);
  const [manualCopy, setManualCopy] = useState<string | null>(null);
  const id = useId();
  const rows = summarize(samples);
  const restoredMs = search.getRestoredMs?.() ?? null;
  const eventTiming =
    typeof PerformanceObserver !== 'undefined' &&
    (PerformanceObserver.supportedEntryTypes ?? []).includes('event');

  const info: [string, string][] = [
    [es.perfPanel.app, es.about.version(__APP_VERSION__, __APP_SHA__)],
    [es.perfPanel.browser, navigator.userAgent],
    [
      es.perfPanel.catalog,
      status.catalog
        ? `${status.catalog.version} (${day.format(new Date(status.catalog.generatedAt))})`
        : es.perfPanel.catalogNone,
    ],
    [
      es.perfPanel.search,
      `${es.perfPanel.searchState[status.state]}${
        status.state === 'full'
          ? `, ${restoredMs !== null ? es.perfPanel.restored(formatMs(restoredMs)) : es.perfPanel.built}`
          : ''
      }`,
    ],
    [
      es.perfPanel.persisted,
      storage.persisted === null
        ? es.perfPanel.unknown
        : storage.persisted
          ? es.perfPanel.persistedYes
          : es.perfPanel.persistedNo,
    ],
    [
      es.perfPanel.storage,
      storage.usage !== null && storage.quota !== null
        ? es.perfPanel.storageUsed(formatBytes(storage.usage), formatBytes(storage.quota))
        : es.perfPanel.unknown,
    ],
  ];

  function report(): string {
    const lines = [
      `GameAgenda · ${es.settings.section.performance}`,
      samples.since !== null ? es.perfPanel.since(dateTime.format(new Date(samples.since))) : '',
      '',
      `${es.perfPanel.metric} | n | p50 | p75 | p95 | ${es.perfPanel.target} | ${es.perfPanel.result}`,
      ...rows.map((row) =>
        [
          es.perfPanel.metrics[row.metric],
          row.n,
          formatMs(row.p50),
          formatMs(row.p75),
          formatMs(row.p95),
          targetOf(row),
          resultOf(row),
        ].join(' | '),
      ),
      '',
      ...info.map(([label, value]) => `${label}: ${value}`),
    ];
    return `${lines.filter((line, i) => line !== '' || i > 1).join('\n')}\n`;
  }

  async function copy(): Promise<void> {
    const text = report();
    try {
      await navigator.clipboard.writeText(text);
      setManualCopy(null);
      setMessage(es.perfPanel.copied);
    } catch {
      setManualCopy(text);
      setMessage(es.perfPanel.copyFailed);
    }
  }

  async function exportErrors(): Promise<void> {
    try {
      const { exportErrorLog } = await import('../../data/data-actions.ts');
      setMessage(es.toast.exported(await exportErrorLog(__APP_VERSION__)));
    } catch (error) {
      logError('storage', error);
      setMessage(es.notices.storageFailed);
    }
  }

  async function clear(): Promise<void> {
    await perf?.clear().catch((error: unknown) => logError('storage', error));
    setMessage(es.perfPanel.cleared);
  }

  const empty = rows.every((row) => row.n === 0);

  return (
    <div className="settings__perf">
      <p>{es.perfPanel.intro}</p>
      <p className="muted">
        {samples.since !== null
          ? es.perfPanel.since(dateTime.format(new Date(samples.since)))
          : es.perfPanel.empty}
      </p>
      <section
        className="settings__perf-scroll"
        aria-labelledby={`${id}-caption`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: en una pantalla estrecha la tabla se desplaza, y con el teclado hay que poder llegar a ella (WCAG 2.1.1).
        tabIndex={0}
      >
        <table className="settings__perf-table" aria-labelledby={`${id}-caption`}>
          <caption id={`${id}-caption`} className="visually-hidden">
            {es.perfPanel.table}
          </caption>
          <thead>
            <tr>
              <th scope="col">{es.perfPanel.metric}</th>
              <th scope="col">{es.perfPanel.samples}</th>
              <th scope="col">p50</th>
              <th scope="col">p75</th>
              <th scope="col">p95</th>
              <th scope="col">{es.perfPanel.target}</th>
              <th scope="col">{es.perfPanel.result}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.metric} data-metric={row.metric}>
                <th scope="row">{es.perfPanel.metrics[row.metric]}</th>
                <td>{row.n}</td>
                <td>{formatMs(row.p50)}</td>
                <td>{formatMs(row.p75)}</td>
                <td>{formatMs(row.p95)}</td>
                <td>{targetOf(row)}</td>
                <td data-passes={row.passes === null ? undefined : String(row.passes)}>
                  {resultOf(row)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {!eventTiming && <p className="muted">{es.perfPanel.noEventTiming}</p>}

      <section aria-labelledby={`${id}-device`}>
        <h3 id={`${id}-device`} className="settings__subtitle">
          {es.perfPanel.device}
        </h3>
        <dl className="settings__perf-info">
          {info.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="settings__buttons">
        <button type="button" className="btn btn--primary" onClick={() => void copy()}>
          {es.perfPanel.copy}
        </button>
        <button type="button" className="btn" onClick={() => void exportErrors()}>
          {es.settings.exportErrors}
        </button>
        <button type="button" className="btn" disabled={empty} onClick={() => void clear()}>
          {es.perfPanel.clear}
        </button>
      </div>
      <div className="settings__import-result" role="status">
        {message !== null && <p>{message}</p>}
      </div>
      {manualCopy !== null && (
        <label className="settings__perf-report">
          <span className="sheet__label">{es.perfPanel.report}</span>
          <textarea className="field" readOnly rows={12} value={manualCopy} />
        </label>
      )}
    </div>
  );
}
