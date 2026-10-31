// Informe de una ejecución de `catalog.yml` (§12.7 de prototipe.md): el resumen del trabajo
// (`$GITHUB_STEP_SUMMARY`) y el cuerpo del *issue* `catalogo` cuando falla (CA2.2). Lee lo que
// deja el pipeline en `pipeline/state/reports/<versión>/build.json` y lo que dejan los pasos del
// flujo en `pipeline/state/reports/ci/` (`canary.json`, `build.log` y `smoke.json`). Todo es
// opcional: si la ejecución falla pronto, el informe dice lo que haya. Solo usa `node:`, porque el
// trabajo del *issue* no instala dependencias, y no publica nada que parezca la clave de Steam.
//
// Uso:
//   node scripts/catalog-report.ts summary [--reports=pipeline/state/reports]
//   node scripts/catalog-report.ts issue --reports=<carpeta> [--jobs=<gh run view --json jobs>]
//        [--run-url=<url>] [--event=<evento>] [--source=steam|staging] [--result=<resultado>]
//        [--previous=<versión>] [--version=<versión>] [--url=<url desplegada>]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { keyHashFromEnv, scanText } from './scan-secrets.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const RE_VERSION = /^(\d{8})\.([1-9]\d*)$/;
/** CA2.1: llamadas por ejecución, con el canario. */
export const MAX_CALLS = 230;
export const MAX_KEYED_CALLS = 10;
const LOG_LINES = 40;

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fmt = (n: number): string => n.toLocaleString('es-ES');

function readJson(path: string): Json | null {
  if (!existsSync(path)) return null;
  try {
    const v: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isObject(v) ? v : null;
  } catch {
    return null;
  }
}

/** `build.json` de la versión más alta de `reports` (o de `version`), o `null`. */
export function findBuildReport(reports: string, version?: string | null): Json | null {
  if (!existsSync(reports)) return null;
  const dirs = readdirSync(reports)
    .filter((d) => RE_VERSION.test(d) && existsSync(join(reports, d, 'build.json')))
    .sort((a, b) => {
      const [, da, na] = RE_VERSION.exec(a) as RegExpExecArray;
      const [, db, nb] = RE_VERSION.exec(b) as RegExpExecArray;
      return da === db ? Number(nb) - Number(na) : (db as string).localeCompare(da as string);
    });
  const dir = version && dirs.includes(version) ? version : dirs[0];
  return dir ? readJson(join(reports, dir, 'build.json')) : null;
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** Llamadas a la red por *endpoint* de un informe (`requests` de `build.json`). */
export function networkCalls(requests: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObject(requests)) return out;
  for (const [endpoint, r] of Object.entries(requests)) {
    const n = isObject(r) ? num(r.network) : null;
    if (n !== null) out[endpoint] = n;
  }
  return out;
}

/** Peticiones del canario (`requests` de `canary.json`) por *endpoint*. */
function canaryCalls(canary: Json | null): Record<string, number> {
  const out: Record<string, number> = {};
  const records = Array.isArray(canary?.requests) ? canary.requests : [];
  for (const r of records) {
    if (isObject(r) && typeof r.endpoint === 'string' && r.cached !== true) {
      out[r.endpoint] = (out[r.endpoint] ?? 0) + 1;
    }
  }
  return out;
}

/** El resumen de una construcción, en Markdown. */
export function renderBuild(build: Json | null, canary: Json | null = null): string {
  const lines: string[] = [];
  if (!build) {
    lines.push('### Catálogo', '', 'Sin informe de la construcción (`build.json`).');
  } else {
    const counts = isObject(build.counts) ? build.counts : {};
    lines.push(`### Catálogo ${String(build.version ?? '?')} (${String(build.mode ?? '?')})`, '');
    const core = num(counts.core);
    const aliases = num(counts.aliases);
    const facts = [
      core !== null ? `${fmt(core)} juegos` : null,
      aliases !== null ? `${fmt(aliases)} alias` : null,
      build.skipDeltaGates === true ? 'puertas de variación saltadas (--skip-delta-gates)' : null,
    ].filter(Boolean);
    if (facts.length > 0) lines.push(`- ${facts.join(' · ')}`);
  }

  const calls = networkCalls(build?.requests);
  const canaryByEndpoint = canaryCalls(canary);
  const endpoints = [...new Set([...Object.keys(calls), ...Object.keys(canaryByEndpoint)])].sort();
  if (endpoints.length > 0) {
    const total = endpoints.reduce((s, e) => s + (calls[e] ?? 0) + (canaryByEndpoint[e] ?? 0), 0);
    const keyed = (calls.getapplist ?? 0) + (canaryByEndpoint.getapplist ?? 0);
    const parts = endpoints.map((e) => {
      const c = canaryByEndpoint[e] ?? 0;
      return `${e} ${fmt(calls[e] ?? 0)}${c > 0 ? ` + ${c} del canario` : ''}`;
    });
    const over = total > MAX_CALLS || keyed > MAX_KEYED_CALLS;
    lines.push(
      `- ${over ? '⚠' : '✓'} Llamadas a Steam: ${parts.join(' · ')}; ${fmt(total)} en total (≤${MAX_CALLS}), ${keyed} con clave (≤${MAX_KEYED_CALLS}; CA2.1)`,
    );
  }
  if (isObject(build?.timingsMs)) {
    const t = Object.entries(build.timingsMs).flatMap(([k, v]) => {
      const n = num(v);
      return n === null ? [] : [`${k} ${duration(n)}`];
    });
    if (t.length > 0) lines.push(`- Duración: ${t.join(' · ')}`);
  }

  const gates = Array.isArray(build?.gates) ? build.gates.filter(isObject) : [];
  if (gates.length > 0) {
    lines.push('', '| Puerta | Estado | Detalle |', '|---|---|---|');
    for (const g of gates) {
      const icon = g.status === 'pass' ? '✓' : g.status === 'skip' ? '–' : '✗';
      const detail = String(g.detail ?? '').replaceAll('|', '\\|');
      lines.push(`| ${String(g.id ?? '?')} | ${icon} ${String(g.status ?? '?')} | ${detail} |`);
    }
  }
  return `${lines.join('\n')}\n`;
}

interface FailedStep {
  readonly job: string;
  readonly step: string;
  readonly conclusion: string;
}

/** Pasos fallidos o cancelados de `gh run view --json jobs`. */
export function failedSteps(jobs: unknown): FailedStep[] {
  const list = isObject(jobs) && Array.isArray(jobs.jobs) ? jobs.jobs.filter(isObject) : [];
  return list.flatMap((job) =>
    (Array.isArray(job.steps) ? job.steps.filter(isObject) : [])
      .filter((s) => s.conclusion === 'failure' || s.conclusion === 'cancelled')
      .map((s) => ({
        job: String(job.name ?? '?'),
        step: String(s.name ?? '?'),
        conclusion: String(s.conclusion),
      })),
  );
}

/** Las últimas líneas de un registro, sin códigos ANSI ni líneas larguísimas. */
export function logTail(text: string, lines = LOG_LINES): string {
  return (
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: códigos ANSI del registro.
      .replace(/\u001b\[[0-9;]*m/g, '')
      .trimEnd()
      .split('\n')
      .slice(-lines)
      .map((l) => (l.length > 300 ? `${l.slice(0, 300)}…` : l))
      .join('\n')
      .replaceAll('```', "'''")
  );
}

export interface IssueInput {
  readonly build: Json | null;
  readonly canary: Json | null;
  readonly smoke: Json | null;
  readonly jobs: unknown;
  readonly log: string | null;
  readonly runUrl: string | null;
  readonly event: string | null;
  readonly source: string | null;
  readonly result: string | null;
  readonly previous: string | null;
  readonly version: string | null;
  readonly deployedUrl: string | null;
  readonly now: Date;
}

/** Cuerpo del *issue* (o del comentario) de una ejecución fallida. */
export function renderIssue(input: IssueInput): string {
  const when = `${input.now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const run = input.runUrl ? `[${input.runUrl.split('/').pop()}](${input.runUrl})` : '—';
  const lines = [
    `## Falla \`catalog.yml\` (${when})`,
    '',
    `- **Ejecución:** ${run} · \`${input.event ?? '?'}\` · origen \`${input.source ?? 'steam'}\` · resultado \`${input.result ?? '?'}\``,
  ];
  const failed = failedSteps(input.jobs);
  if (failed.length > 0) {
    lines.push(
      `- **Falla:** ${failed.map((f) => `«${f.step}» (${f.job}${f.conclusion === 'cancelled' ? ', cancelado o fuera de tiempo' : ''})`).join('; ')}`,
    );
  }
  lines.push(
    input.deployedUrl
      ? `- **Publicación:** se desplegó ${input.version ?? 'la versión nueva'} en ${input.deployedUrl} y falló después: revisa la prueba de humo y el estado.`
      : `- **Publicación:** no se ha desplegado nada; sigue servida ${input.previous ? `la versión ${input.previous}` : 'la versión anterior'} (CA2.2).`,
  );
  lines.push('', renderBuild(input.build, input.canary).trimEnd());

  const problems = Array.isArray(input.smoke?.problems) ? input.smoke.problems : [];
  if (problems.length > 0) {
    lines.push('', '### Prueba de humo', '', ...problems.map((p) => `- ✗ ${String(p)}`));
  }
  if (input.log) {
    lines.push(
      '',
      '### Final del registro de la construcción',
      '',
      '```text',
      logTail(input.log),
      '```',
    );
  }
  const repo = input.runUrl?.split('/actions/')[0];
  const runbook = 'docs/adr/007-pipeline-del-catalogo.md';
  lines.push(
    '',
    `Qué hacer: el *runbook* del ADR-007 (${repo ? `[${runbook}](${repo}/blob/main/${runbook})` : `\`${runbook}\``}). Este *issue* recoge las ejecuciones fallidas hasta que se cierre a mano.`,
  );
  return `${lines.join('\n')}\n`;
}

/** El texto, o un aviso si contiene la clave de Steam o su nombre (no debe salir del *runner*). */
export function redactIfSecret(text: string, keySha256: string | null): string {
  if (scanText(text, keySha256).length === 0) return text;
  return 'El informe contenía algo con la forma de la clave de Steam y no se publica: mira el registro de la ejecución.\n';
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      reports: { type: 'string', default: join(root, 'pipeline/state/reports') },
      jobs: { type: 'string' },
      'run-url': { type: 'string' },
      event: { type: 'string' },
      source: { type: 'string' },
      result: { type: 'string' },
      previous: { type: 'string' },
      version: { type: 'string' },
      url: { type: 'string' },
    },
  });
  const reports = values.reports;
  const build = findBuildReport(reports, values.version || null);
  const canary = readJson(join(reports, 'ci/canary.json'));
  let text: string;
  if (positionals[0] === 'summary') {
    text = renderBuild(build, canary);
  } else if (positionals[0] === 'issue') {
    const logPath = join(reports, 'ci/build.log');
    text = renderIssue({
      build,
      canary,
      smoke: readJson(join(reports, 'ci/smoke.json')),
      jobs: values.jobs ? readJson(values.jobs) : null,
      log: existsSync(logPath) ? readFileSync(logPath, 'utf8') : null,
      runUrl: values['run-url'] || null,
      event: values.event || null,
      source: values.source || null,
      result: values.result || null,
      previous: values.previous || null,
      version: values.version || null,
      deployedUrl: values.url || null,
      now: new Date(),
    });
  } else {
    throw new Error('Uso: catalog-report.ts summary | issue …');
  }
  process.stdout.write(redactIfSecret(text, keyHashFromEnv(process.env.STEAM_KEY_SHA256)));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
