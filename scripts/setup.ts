// Prepara un clon limpio (ver §13.3 de prototipe.md). Se puede repetir.
// Uso: npm run setup
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const REQUIRED = { major: 24, minor: 21 };

function checkNode(): void {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  if (major !== REQUIRED.major || minor < REQUIRED.minor) {
    console.error(
      `Hace falta Node ^${REQUIRED.major}.${REQUIRED.minor}.0 y está instalado ${process.versions.node}.`,
    );
    process.exit(1);
  }
  console.log(`✓ Node ${process.versions.node}`);
}

function run(title: string, command: string): void {
  console.log(`\n→ ${title}: ${command}`);
  // `shell: true`: en Windows, npm y npx son ficheros .cmd.
  const result = spawnSync(command, { cwd: root, stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    console.error(`✗ Falló «${command}» (código ${result.status ?? 'desconocido'}).`);
    process.exit(result.status ?? 1);
  }
}

function createEnvLocal(): void {
  const target = `${root}.env.local`;
  if (existsSync(target)) {
    console.log('\n✓ .env.local ya existe: no se toca.');
    return;
  }
  copyFileSync(`${root}.env.example`, target);
  console.log(
    '\n✓ .env.local creado a partir de .env.example (la clave de Steam va ahí, nunca en el repo).',
  );
}

checkNode();
run('Dependencias', 'npm ci');
run('Navegadores de Playwright', 'npx playwright install chromium webkit');
createEnvLocal();
console.log('\nListo. Siguiente: npm run dev (o npm run check).');
