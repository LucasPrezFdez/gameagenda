import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  failedSteps,
  findBuildReport,
  logTail,
  redactIfSecret,
  renderBuild,
  renderIssue,
} from './catalog-report.ts';
import { cleanup, tempDir } from './test-helpers.ts';

const dirs: string[] = [];
afterEach(() => cleanup(dirs));

const build = {
  version: '20261031.1',
  mode: 'con clave',
  skipDeltaGates: false,
  counts: { core: 196_900, aliases: 3_563 },
  requests: {
    getapplist: { network: 4, statuses: { 200: 4 } },
    query: { network: 208, statuses: { 200: 208 } },
    getitems: { network: 6, statuses: { 200: 6 } },
  },
  timingsMs: { list: 12_000, query: 630_500 },
  gates: [
    { id: 'count', status: 'pass', detail: '196 900 juegos (+0,1 %)' },
    { id: 'sentinels', status: 'fail', detail: 'falta 730 | y más' },
  ],
};
const canary = {
  requests: [
    { endpoint: 'getapplist', cached: false },
    { endpoint: 'query', cached: false },
  ],
};

describe('catalog-report: resumen e issue de catalog.yml', () => {
  it('resume la construcción: juegos, llamadas (con el canario), duración y puertas', () => {
    const md = renderBuild(build, canary);
    expect(md).toContain('### Catálogo 20261031.1 (con clave)');
    expect(md).toContain('196.900 juegos');
    expect(md).toContain('getapplist 4 + 1 del canario');
    expect(md).toContain('✓ Llamadas a Steam');
    expect(md).toContain('220 en total (≤230), 5 con clave (≤10; CA2.1)');
    expect(md).toContain('query 10 min 31 s');
    expect(md).toContain('| sentinels | ✗ fail | falta 730 \\| y más |');
  });

  it('avisa si se pasa del presupuesto de llamadas', () => {
    const over = { ...build, requests: { query: { network: 240 } } };
    expect(renderBuild(over)).toContain('⚠ Llamadas a Steam');
  });

  it('sin build.json, lo dice', () => {
    expect(renderBuild(null)).toContain('Sin informe de la construcción');
  });

  it('elige el build.json de la versión más alta', () => {
    const reports = tempDir('reports-', dirs);
    for (const v of ['20261031.2', '20261031.10', '20261030.5']) {
      mkdirSync(join(reports, v));
      writeFileSync(join(reports, v, 'build.json'), JSON.stringify({ version: v }));
    }
    mkdirSync(join(reports, 'ci'));
    expect(findBuildReport(reports)?.version).toBe('20261031.10');
    expect(findBuildReport(reports, '20261030.5')?.version).toBe('20261030.5');
    expect(findBuildReport(join(reports, 'no-existe'))).toBeNull();
  });

  it('saca los pasos que fallan de gh run view --json jobs', () => {
    const jobs = {
      jobs: [
        {
          name: 'Construye, firma y publica',
          steps: [
            { name: 'Canario', conclusion: 'success' },
            { name: 'Construye', conclusion: 'failure' },
            { name: 'Despliega', conclusion: 'skipped' },
          ],
        },
      ],
    };
    expect(failedSteps(jobs)).toEqual([
      { job: 'Construye, firma y publica', step: 'Construye', conclusion: 'failure' },
    ]);
    expect(failedSteps(null)).toEqual([]);
  });

  it('el issue dice qué falló y que sigue servida la versión anterior (CA2.2)', () => {
    const md = renderIssue({
      build,
      canary,
      smoke: null,
      jobs: { jobs: [{ name: 'publish', steps: [{ name: 'Construye', conclusion: 'failure' }] }] },
      log: `\u001b[31m✗ falla\u001b[0m\n${'x'.repeat(400)}`,
      runUrl: 'https://github.com/o/r/actions/runs/42',
      event: 'schedule',
      source: 'steam',
      result: 'failure',
      previous: '20261030.1',
      version: '20261031.1',
      deployedUrl: null,
      now: new Date('2026-10-31T04:40:00Z'),
    });
    expect(md).toContain('## Falla `catalog.yml` (2026-10-31 04:40 UTC)');
    expect(md).toContain('[42](https://github.com/o/r/actions/runs/42)');
    expect(md).toContain('«Construye» (publish)');
    expect(md).toContain('sigue servida la versión 20261030.1 (CA2.2)');
    expect(md).toContain('✗ falla');
    expect(md).not.toContain('\u001b[');
    expect(md).toContain(`${'x'.repeat(300)}…`);
    expect(md).toContain('https://github.com/o/r/blob/main/docs/adr/007-pipeline-del-catalogo.md');
  });

  it('el issue dice si ya se había desplegado', () => {
    const md = renderIssue({
      build: null,
      canary: null,
      smoke: { problems: ['core.x.tsv sin CORS'] },
      jobs: null,
      log: null,
      runUrl: null,
      event: 'workflow_dispatch',
      source: 'staging',
      result: 'failure',
      previous: '20261030.1',
      version: '20261031.1',
      deployedUrl: 'https://ga-catalog.x.workers.dev',
      now: new Date(),
    });
    expect(md).toContain('se desplegó 20261031.1 en https://ga-catalog.x.workers.dev');
    expect(md).toContain('- ✗ core.x.tsv sin CORS');
  });

  it('logTail se queda con las últimas líneas', () => {
    const log = Array.from({ length: 100 }, (_, i) => `línea ${i}`).join('\n');
    const tail = logTail(log, 3);
    expect(tail).toBe('línea 97\nlínea 98\nlínea 99');
  });

  it('no publica nada con la forma de la clave', () => {
    const key = '0123456789ABCDEF0123456789ABCDEF';
    const hash = createHash('sha256').update(key).digest('hex');
    expect(redactIfSecret(`clave ${key}`, hash)).toContain('no se publica');
    expect(redactIfSecret('x-webapi-key: …', null)).toContain('no se publica');
    expect(redactIfSecret('todo bien', hash)).toBe('todo bien');
  });
});
