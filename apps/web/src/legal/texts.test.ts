// Textos legales (M4; CA4.7): que estén completos, que sus enlaces lleven a sitios que existen y que
// los plazos que declaran sean los del código.
import {
  DEFAULT_MIN_AGE,
  DEVICE_COOKIE,
  PAIRING_TTL_MS,
  RESOLVE_TTL_MS,
  STEAM_TICKET_TTL_MS,
  SYNC_HINT_COOKIE,
} from '@gameagenda/core/api';
import { PURGE_AFTER_DAYS } from '@gameagenda/core/sync';
import { describe, expect, it } from 'vitest';
import { LEGAL_PATHS, parseRoute } from '../router/routes.ts';
import { type Controller, controllerReady, NOTICE_PATH, PRIVACY_PATH } from './controller.ts';
import { syncFirstLayer } from './first-layer.ts';
import {
  type Inline,
  type LegalDocument,
  legalNotice,
  privacyPolicy,
  STEAM_ID_RETENTION_MINUTES,
  STEAM_IMPORT_SECTION,
} from './texts.ts';

const READY: Controller = { name: 'Responsable de prueba', email: 'privacidad@example.org' };
const PENDING: Controller = { name: null, email: null };

function inlines(doc: LegalDocument): Inline[] {
  const out: Inline[] = [...doc.intro];
  for (const section of doc.sections) {
    out.push(section.title);
    for (const block of section.blocks) {
      if (block.kind === 'p') out.push(...block.parts);
      else if (block.kind === 'list') for (const item of block.items) out.push(...item);
      else out.push(block.caption, ...block.head, ...block.rows.flat());
    }
  }
  return out;
}

function textOf(doc: LegalDocument): string {
  return inlines(doc)
    .map((part) => (typeof part === 'string' ? part : part.text))
    .join(' ');
}

describe('textos legales', () => {
  it('con el responsable, sin «pendiente»; sin él, lo dicen (y no se puede publicar)', () => {
    for (const make of [privacyPolicy, legalNotice]) {
      const ready = textOf(make(READY));
      expect(ready).toContain('Responsable de prueba');
      expect(ready).toContain('privacidad@example.org');
      expect(ready).not.toContain('pendiente');
      expect(textOf(make(PENDING))).toContain('[pendiente: nombre o alias del responsable]');
    }
    expect(controllerReady(READY)).toBe(true);
    expect(controllerReady(PENDING)).toBe(false);
    expect(controllerReady({ name: 'Alguien', email: 'sin-arroba' })).toBe(false);
    expect(controllerReady({ name: '  ', email: 'a@b.es' })).toBe(false);
  });

  it('las rutas de `controller.ts` son las del *router*', () => {
    expect(LEGAL_PATHS).toEqual({ privacy: PRIVACY_PATH, notice: NOTICE_PATH });
  });

  it('cada sección tiene un id único y los enlaces internos llevan a una pantalla que existe', () => {
    for (const doc of [privacyPolicy(READY), legalNotice(READY)]) {
      const ids = doc.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const part of inlines(doc)) {
        if (typeof part === 'string') continue;
        if (part.href.startsWith('/')) {
          expect(parseRoute(part.href).name, part.href).not.toBe('notFound');
        } else {
          expect(part.href, part.text).toMatch(/^(https:\/\/|mailto:)/);
        }
      }
    }
    const layer = syncFirstLayer(READY);
    expect(layer.some((part) => typeof part !== 'string' && part.href === '/privacidad')).toBe(
      true,
    );
  });

  it('la política cubre lo de la primera capa y del art. 13 RGPD', () => {
    const text = textOf(privacyPolicy(READY));
    for (const needed of [
      // Identidad y contacto, finalidades y bases, destinatarios, transferencias, plazos, derechos
      // y reclamación ante la AEPD.
      'responsable',
      'art. 6.1.b',
      'art. 6.1.f',
      'Cloudflare',
      'Valve',
      'Marco de Privacidad de Datos',
      'cláusulas contractuales tipo',
      'arts. 15 a 22',
      'Agencia Española de Protección de Datos',
      'un mes',
      // Las cookies, con su nombre real, y la edad.
      `__Host-${DEVICE_COOKIE}`,
      `__Host-${SYNC_HINT_COOKIE}`,
      `${DEFAULT_MIN_AGE} años`,
    ]) {
      expect(text, needed).toContain(needed);
    }
  });

  it('los plazos son los del código', () => {
    const text = textOf(privacyPolicy(READY));
    expect(text).toContain(`${PAIRING_TTL_MS / 60_000} minutos`);
    expect(text).toContain(`${RESOLVE_TTL_MS / 86_400_000} días`);
    expect(text).toContain(`${PURGE_AFTER_DAYS} días`);
    // `AGENDA_TTL_MONTHS` del mantenimiento de D1 y los 7 días de Time Travel del plan gratuito.
    expect(text).toContain('13 meses');
    expect(text).toContain('7 días');
    // La cookie dura lo que `DEVICE_COOKIE_MAX_AGE_S`.
    expect(text).toContain('400 días');
    // El ticket del login con Steam y lo más que dura el SteamID64 en D1 (ADR-012): los 10 min del
    // ticket y los 5 del Cron Trigger que borra los caducados.
    expect(STEAM_ID_RETENTION_MINUTES).toBe(STEAM_TICKET_TTL_MS / 60_000 + 5);
    expect(text).toContain(`caduca a los ${STEAM_TICKET_TTL_MS / 60_000} minutos`);
    expect(text).toContain(`${STEAM_ID_RETENTION_MINUTES} minutos como mucho`);
  });

  it('la política cuenta «Importar desde Steam», con los logros y el pase (Fase 2; ADR-012)', () => {
    const policy = privacyPolicy(READY);
    const section = policy.sections.find((s) => s.id === STEAM_IMPORT_SECTION);
    expect(section?.title).toBe('Importar desde Steam');
    const text = textOf(policy);
    for (const needed of [
      'SteamID64',
      'No pedimos tu nombre, tu avatar ni tu ubicación',
      'sin que el servidor los guarde ni los anote',
      'el número de tu cuenta cuando nuestro servidor le pide tu biblioteca y tus logros',
      'cuántas consultas hacemos a Steam cada día',
      // Parte 3: los logros y el pase.
      'si los tienes todos y el día del último, no cuáles son',
      'un pase cifrado con el número de tu cuenta, que caduca a los 15 minutos',
      'Pase de la importación',
    ]) {
      expect(text, needed).toContain(needed);
    }
  });
});
