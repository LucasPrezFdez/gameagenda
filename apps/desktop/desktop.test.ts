// Guardas de la app de escritorio que corren en el CI sin Rust (§12.5; ADR-010): la página de
// `ga-web` no puede invocar ninguna orden de Tauri (CA3.8), el atajo y la web usan el mismo evento
// y las versiones van fijadas (§6.1 y §6.5). Lee los ficheros como texto: `apps/desktop` no
// importa nada del repositorio (§14.3, regla 8).
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, root), 'utf8');

const GA_WEB = 'https://ga-web.gameagenda.workers.dev/';

interface TauriConfig {
  readonly version: string;
  readonly identifier: string;
  readonly build: { readonly frontendDist?: unknown; readonly devUrl?: string };
  readonly app: {
    readonly withGlobalTauri?: boolean;
    readonly windows: readonly {
      readonly label: string;
      readonly create?: boolean;
      readonly url?: string;
    }[];
    readonly security?: { readonly capabilities?: readonly unknown[] };
  };
  readonly bundle: {
    readonly targets: readonly string[];
    readonly windows: { readonly nsis: { readonly installMode: string } };
  };
}

const config = JSON.parse(read('apps/desktop/src-tauri/tauri.conf.json')) as TauriConfig;
const mainRs = read('apps/desktop/src-tauri/src/main.rs');
const cargoToml = read('apps/desktop/src-tauri/Cargo.toml');
const cargoLock = read('apps/desktop/src-tauri/Cargo.lock');

/** Las versiones de `name` en `Cargo.lock` (de `windows` puede haber más de una). */
function lockedVersions(name: string): string[] {
  const pattern = new RegExp(`\\[\\[package\\]\\]\\nname = "${name}"\\nversion = "([^"]+)"`, 'g');
  return [...cargoLock.replaceAll('\r\n', '\n').matchAll(pattern)].map((match) => match[1] ?? '');
}

describe('app de escritorio: la página no recibe órdenes de Tauri (CA3.8)', () => {
  it('no hay capabilities: ni la carpeta ni en tauri.conf.json', () => {
    expect(existsSync(new URL('apps/desktop/src-tauri/capabilities', root))).toBe(false);
    expect(config.app.security?.capabilities ?? []).toEqual([]);
  });

  it('no declara órdenes propias', () => {
    expect(mainRs).not.toMatch(/invoke_handler|generate_handler!|#\[tauri::command\]/);
  });

  it('carga ga-web como origen remoto, no como frontendDist, y sin window.__TAURI__', () => {
    // Con `frontendDist` como URL, Tauri trataría `ga-web` como origen local (ADR-010).
    expect(config.build.frontendDist).toBeUndefined();
    const main = config.app.windows.find((window) => window.label === 'main');
    expect(main).toMatchObject({ create: false, url: GA_WEB });
    expect(config.build.devUrl).toBe('http://127.0.0.1:5173');
    expect(config.app.withGlobalTauri).toBe(false);
  });

  it('la web no depende de @tauri-apps/api', () => {
    expect(read('apps/web/package.json')).not.toContain('@tauri-apps/');
  });
});

describe('app de escritorio: atajo, instalador y versiones', () => {
  it('el script del atajo lanza el evento que atiende la web', () => {
    const web = read('apps/web/src/desktop/desktop-capture.ts');
    const event = /DESKTOP_CAPTURE_EVENT = '([^']+)'/.exec(web)?.[1];
    expect(event).toBe('gameagenda:capture');
    expect(mainRs).toContain(`window.dispatchEvent(new Event('${event}'));`);
  });

  it('instalador NSIS por usuario, sin derechos de administrador', () => {
    expect(config.bundle.targets).toEqual(['nsis']);
    expect(config.bundle.windows.nsis.installMode).toBe('currentUser');
  });

  it('la versión es la de la app', () => {
    const rootVersion = (JSON.parse(read('package.json')) as { version: string }).version;
    const desktop = JSON.parse(read('apps/desktop/package.json')) as { version: string };
    expect(config.version).toBe('../package.json');
    expect(desktop.version).toBe(rootVersion);
    expect(/^version = "([^"]+)"/m.exec(cargoToml)?.[1]).toBe(rootVersion);
  });

  it('los crates de Tauri van fijados con = y Cargo.lock los resuelve igual', () => {
    const crates = [
      'tauri',
      'tauri-build',
      'tauri-plugin-autostart',
      'tauri-plugin-global-shortcut',
      'tauri-plugin-single-instance',
      'windows',
    ];
    for (const name of crates) {
      const pinned = new RegExp(`^${name} = (?:"=([^"]+)"|\\{ version = "=([^"]+)")`, 'm').exec(
        cargoToml,
      );
      const version = pinned?.[1] ?? pinned?.[2];
      expect(version, name).toBeDefined();
      expect(lockedVersions(name), name).toContain(version);
    }
  });
});
