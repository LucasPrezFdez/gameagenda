// `npm run catalog:publish` (§4.5, paso 6, y §13.3 de prototipe.md; DECISIONES §10.12): despliega
// `pipeline/dist/` (montada con `scripts/assemble-catalog.ts`) en `ga-catalog` con `wrangler`.
// Desde M2 solo lo ejecuta `catalog.yml`: fuera de GitHub Actions se niega, y también si el
// *manifest* montado no lleva una firma válida de una clave de producción. El *token* y la cuenta
// son los de `ga-catalog` (`CATALOG_CLOUDFLARE_*` en el flujo, que los pasa como
// `CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`). Escribe la URL de `workers.dev` en
// `$GITHUB_OUTPUT` (`url`).
//
// Uso (en catalog.yml): npm run catalog:publish -- --message "<texto>"
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { checkSignature, DEFAULT_OUT } from './assemble-catalog.ts';
import { writeGithubOutput } from './catalog-live.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

/** URL de `workers.dev` del despliegue en la salida de `WRANGLER_OUTPUT_FILE_PATH` (NDJSON). */
export function deployUrl(ndjson: string): string | null {
  for (const line of ndjson.split('\n')) {
    let entry: { type?: unknown; targets?: unknown };
    try {
      entry = JSON.parse(line) as typeof entry;
    } catch {
      continue;
    }
    if (entry.type !== 'deploy' || !Array.isArray(entry.targets)) continue;
    const url = entry.targets.find(
      (t): t is string => typeof t === 'string' && t.endsWith('.workers.dev'),
    );
    if (url) return url;
  }
  return null;
}

/** Por qué no se puede publicar desde aquí, o `null`. */
export function refusal(env: NodeJS.ProcessEnv): string | null {
  if (env.GITHUB_ACTIONS !== 'true') {
    return 'Desde M2 solo catalog.yml publica ga-catalog: el PC usa npm run catalog:stage (DECISIONES §10.12)';
  }
  if (!env.CLOUDFLARE_API_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    return 'Faltan CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID (los secretos CATALOG_CLOUDFLARE_*)';
  }
  return null;
}

function main(): void {
  const { values } = parseArgs({ options: { message: { type: 'string' } } });
  const refused = refusal(process.env);
  if (refused) throw new Error(refused);
  const manifest = join(DEFAULT_OUT, 'manifest.json');
  if (!existsSync(manifest)) {
    throw new Error(`Falta ${manifest}: monta antes con assemble-catalog.ts`);
  }
  console.log(`Manifest: ${checkSignature(JSON.parse(readFileSync(manifest, 'utf8')), 'prod')}`);

  const output = join(process.env.RUNNER_TEMP || tmpdir(), 'wrangler-catalog.ndjson');
  const args = ['wrangler', 'deploy', '-c', 'pipeline/wrangler.jsonc'];
  if (values.message) args.push('--message', values.message.slice(0, 100));
  const r = spawnSync('npx', args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: output, WRANGLER_SEND_METRICS: 'false' },
  });
  if (r.status !== 0) {
    throw new Error(`wrangler deploy ha fallado (${r.status ?? r.error?.message})`);
  }
  const url = existsSync(output) ? deployUrl(readFileSync(output, 'utf8')) : null;
  if (!url) throw new Error('wrangler no ha devuelto la URL de workers.dev');
  console.log(`✓ Publicado en ${url}`);
  writeGithubOutput({ url });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
