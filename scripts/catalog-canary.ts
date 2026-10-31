// Canario de `catalog.yml` (§4.5 y §12.5 de prototipe.md): antes de la pasada completa (≈12 min),
// dos peticiones pequeñas con el cliente y los contratos Zod del pipeline:
// - `GetAppList` (10 juegos, con clave): la columna vertebral. Si falla (403: clave revocada o
//   cuenta limitada; contrato roto; 429 seguidos), no se sigue: falla el paso;
// - Query (10 juegos, sin clave): el enriquecimiento. Sin clave también es la columna vertebral y
//   su fallo para la ejecución; con clave solo avisa, porque si falla solo el enriquecimiento se
//   publican los nombres con el último enriquecimiento conocido (§4.6).
// Son dos llamadas más al día (≈220 + 2, ≤230; CA2.1), al ritmo del cliente. Ante un 429, el
// cliente espera ≥60 s: el paso del flujo tiene su propio tiempo máximo.
//
// Uso: node scripts/catalog-canary.ts [--keyless] [--report=<fichero.json>]
// La clave sale de `STEAM_WEB_API_KEY` y nunca se imprime.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { realRuntime } from '../pipeline/src/clock.ts';
import { SteamClient, SteamError } from '../pipeline/steam/client.ts';
import { appListUrl, queryUrl } from '../pipeline/steam/endpoints.ts';
import { appListResponseSchema, queryResponseSchema } from '../pipeline/steam/schemas.ts';
import { httpsTransport } from '../pipeline/steam/transports.ts';

/** Juegos que Query tiene que contar como mínimo (≈197 000 el 28-10-2026; §4.3). */
const MIN_QUERY_TOTAL = 150_000;

interface Check {
  readonly endpoint: 'getapplist' | 'query';
  readonly ok: boolean;
  /** Si su fallo para la ejecución. */
  readonly blocking: boolean;
  readonly detail: string;
}

function explain(e: unknown): string {
  if (e instanceof SteamError) {
    if (e.kind === 'key-rejected') {
      return `${e.message}. Revisa la clave y, mientras, relanza con keyless (plan B, §4.8)`;
    }
    return `${e.kind}: ${e.message}`;
  }
  return (e as Error).message;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { keyless: { type: 'boolean', default: false }, report: { type: 'string' } },
  });
  const key = values.keyless ? null : process.env.STEAM_WEB_API_KEY?.trim() || null;
  const client = new SteamClient({
    transport: httpsTransport(),
    ...realRuntime,
    key,
    timeoutMs: 30_000,
    log: (line) => console.log(line),
  });
  const checks: Check[] = [];

  if (key) {
    try {
      const r = await client.get(appListUrl(0, 10), appListResponseSchema, 'canary-getapplist');
      const apps = r.response.apps;
      const ok =
        apps.length > 0 &&
        r.response.have_more_results === true &&
        (r.response.last_appid ?? 0) > 0;
      checks.push({
        endpoint: 'getapplist',
        ok,
        blocking: true,
        detail: ok
          ? `${apps.length} juegos desde el ${apps[0]?.appid} («${apps[0]?.name}»), have_more_results`
          : `respuesta vacía o sin paginación (${apps.length} juegos, have_more_results ${r.response.have_more_results})`,
      });
    } catch (e) {
      checks.push({ endpoint: 'getapplist', ok: false, blocking: true, detail: explain(e) });
    }
  } else {
    console.log('GetAppList: sin clave, se salta (plan B, §4.8)');
  }

  try {
    const r = await client.get(queryUrl(0, 10), queryResponseSchema, 'canary-query');
    const total = r.response.metadata.total_matching_records;
    const items = r.response.store_items.length;
    const ok = total >= MIN_QUERY_TOTAL && items > 0;
    checks.push({
      endpoint: 'query',
      ok,
      blocking: key === null,
      detail: `${items} juegos de ${total.toLocaleString('es-ES')} (mínimo ${MIN_QUERY_TOTAL.toLocaleString('es-ES')})`,
    });
  } catch (e) {
    checks.push({ endpoint: 'query', ok: false, blocking: key === null, detail: explain(e) });
  }

  const lines = checks.map(
    (c) => `- ${c.ok ? '✓' : c.blocking ? '✗' : '⚠'} **${c.endpoint}**: ${c.detail}`,
  );
  const md = `### Canario de Steam (${key ? 'con clave' : 'sin clave'})\n\n${lines.join('\n')}\n`;
  console.log(md);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  if (values.report) {
    mkdirSync(dirname(values.report), { recursive: true });
    const report = { keyed: key !== null, checks, requests: client.records };
    writeFileSync(values.report, `${JSON.stringify(report, null, 1)}\n`);
  }
  for (const c of checks.filter((x) => !x.ok)) {
    console.log(`::${c.blocking ? 'error' : 'warning'}::Canario ${c.endpoint}: ${c.detail}`);
  }
  if (checks.some((c) => !c.ok && c.blocking)) process.exitCode = 1;
}

// El agente HTTPS con `keepAlive` podría retener el proceso: se sale en cuanto termina.
main()
  .catch((e: unknown) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
