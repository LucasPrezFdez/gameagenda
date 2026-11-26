// CA4.7 (§11.2 de prototipe.md): la micro-API no se enciende sin los textos legales publicados. Si
// `apps/web/wrangler.jsonc` pone `SYNC_ENABLED` a "1", el responsable (`legal/controller.ts`) tiene
// que tener nombre y correo: si no, la política diría «pendiente» justo cuando empieza a valer.
// Y la importación de Steam (Fase 2; ADR-012) tampoco: con `STEAM_ENABLED` a "1", la política
// tiene que contar qué se trae de Steam, el SteamID64 y cuánto dura en D1. Y las llaves de acceso
// (ADR-013): con `PASSKEYS_ENABLED` a "1", qué se guarda de cada llave y cuánto duran sus retos. Y
// las cuentas (ADR-014): con `ACCOUNTS_ENABLED` a "1", que no se guarda ni el email ni la
// contraseña (sus huellas), cuánto duran los fallos, y qué se guarda de Steam vinculado.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTROLLER, controllerReady } from '../apps/web/src/legal/controller.ts';
import {
  ACCOUNT_SECTION,
  LOGIN_THROTTLE_RETENTION_MINUTES,
  PASSKEY_CHALLENGE_RETENTION_MINUTES,
  PASSKEYS_SECTION,
  privacyPolicy,
  STEAM_ID_RETENTION_MINUTES,
  STEAM_IMPORT_SECTION,
  STEAM_LINK_SECTION,
} from '../apps/web/src/legal/texts.ts';

/** JSONC → JSON: fuera los comentarios de línea y de bloque (sin tocar las cadenas). */
function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i++;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += char;
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

function wranglerVars(): Record<string, string> {
  const config = JSON.parse(stripJsonComments(readFileSync('apps/web/wrangler.jsonc', 'utf8'))) as {
    vars?: Record<string, string>;
  };
  return config.vars ?? {};
}

/** La política cuenta «Importar desde Steam»: su sección, el SteamID64 y cuánto dura en D1. */
function policyCoversSteamImport(): boolean {
  const policy = privacyPolicy(CONTROLLER);
  const section = policy.sections.find((s) => s.id === STEAM_IMPORT_SECTION);
  if (section === undefined) return false;
  const text = JSON.stringify(section);
  return text.includes('SteamID64') && text.includes(`${STEAM_ID_RETENTION_MINUTES} minutos`);
}

/** La política cuenta las llaves de acceso: su sección, la parte pública y cuánto duran los retos. */
function policyCoversPasskeys(): boolean {
  const policy = privacyPolicy(CONTROLLER);
  const section = policy.sections.find((s) => s.id === PASSKEYS_SECTION);
  if (section === undefined) return false;
  const text = JSON.stringify(section);
  return (
    text.includes('parte pública') &&
    text.includes(`${PASSKEY_CHALLENGE_RETENTION_MINUTES} minutos`)
  );
}

/**
 * La política cuenta las cuentas (ADR-014): la contraseña no sale del dispositivo, del email solo la
 * huella, cuánto duran los fallos, y Steam vinculado con el SteamID64 hasta desvincularlo.
 */
function policyCoversAccounts(): boolean {
  const policy = privacyPolicy(CONTROLLER);
  const account = policy.sections.find((s) => s.id === ACCOUNT_SECTION);
  const steam = policy.sections.find((s) => s.id === STEAM_LINK_SECTION);
  if (account === undefined || steam === undefined) return false;
  const a = JSON.stringify(account);
  const b = JSON.stringify(steam);
  return (
    a.includes('nunca sale de tu dispositivo') &&
    a.includes('Del email solo guardamos una huella') &&
    a.includes(`${LOGIN_THROTTLE_RETENTION_MINUTES} minutos`) &&
    b.includes('SteamID64') &&
    b.includes('desvincular')
  );
}

describe('textos legales antes de encender la micro-API (CA4.7)', () => {
  it('con SYNC_ENABLED a "1", el responsable tiene nombre y correo', () => {
    const config = { vars: wranglerVars() };
    const enabled = config.vars?.SYNC_ENABLED === '1';
    if (enabled) expect(controllerReady(CONTROLLER), 'apps/web/src/legal/controller.ts').toBe(true);
    else expect(config.vars?.SYNC_ENABLED).toBe('0');
  });

  it('con STEAM_ENABLED a "1", la política cuenta la importación de Steam (ADR-012)', () => {
    const steam = wranglerVars().STEAM_ENABLED;
    if (steam === '1') {
      expect(policyCoversSteamImport(), 'apps/web/src/legal/texts.ts').toBe(true);
      expect(controllerReady(CONTROLLER), 'apps/web/src/legal/controller.ts').toBe(true);
    } else {
      expect(steam).toBe('0');
    }
  });

  it('con PASSKEYS_ENABLED a "1", la política cuenta las llaves de acceso (ADR-013)', () => {
    const passkeys = wranglerVars().PASSKEYS_ENABLED;
    if (passkeys === '1') expect(policyCoversPasskeys(), 'apps/web/src/legal/texts.ts').toBe(true);
    else expect(passkeys).toBe('0');
  });

  it('con ACCOUNTS_ENABLED a "1", la política cuenta las cuentas y Steam vinculado (ADR-014)', () => {
    const accounts = wranglerVars().ACCOUNTS_ENABLED;
    if (accounts === '1') expect(policyCoversAccounts(), 'apps/web/src/legal/texts.ts').toBe(true);
    else expect(accounts).toBe('0');
  });

  it('la política de hoy ya cuenta la importación de Steam, las llaves y las cuentas', () => {
    expect(policyCoversSteamImport()).toBe(true);
    expect(policyCoversPasskeys()).toBe(true);
    expect(policyCoversAccounts()).toBe(true);
  });
});
