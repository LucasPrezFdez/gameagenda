// Importar desde Steam (Fase 2, parte 2; §10.2 de prototipe.md; ADR-012): el login con OpenID 2.0,
// el canje tipo PKCE y la biblioteca. Steam es falso: el CI nunca lo llama.

import { STEAM_TICKET_TTL_MS } from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import { sha256Base64url, sha256Hex } from '../crypto.ts';
import { CALLBACK_PATH, OPENID_NS, STEAM_OPENID } from '../steam-openid.ts';
import { createHarness, dumpAllText, ORIGIN, T0 } from './harness.ts';
import { pkce } from './steam-support.ts';

describe('POST /api/v1/steam/start', () => {
  it('crea el ticket ligado al challenge y devuelve la URL de OpenID de Steam', async () => {
    const h = createHarness();
    const { challenge } = await pkce();
    const response = await h.client().post('/api/v1/steam/start', { challenge });
    expect(response.status).toBe(201);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const { ticket, url, expiresAt } = response.json;
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(new Date(T0 + STEAM_TICKET_TTL_MS).toISOString());

    const login = new URL(url);
    expect(`${login.origin}${login.pathname}`).toBe(STEAM_OPENID);
    expect(Object.fromEntries(login.searchParams)).toEqual({
      'openid.ns': OPENID_NS,
      'openid.mode': 'checkid_setup',
      'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
      'openid.realm': ORIGIN,
      'openid.return_to': `${ORIGIN}${CALLBACK_PATH}?t=${ticket}`,
    });

    // D1 guarda el *hash* del ticket, el challenge y la caducidad; el SteamID64, aún no.
    expect(h.db.rows('SELECT * FROM steam_ticket')).toEqual([
      { ticket_hash: await sha256Hex(ticket), challenge, expires_at: expiresAt, steam_id: null },
    ]);
    expect(dumpAllText(h.db)).not.toContain(ticket);
    // Empezar no llama a Steam.
    expect(h.steam.calls).toEqual([]);
  });

  it('realm y return_to salen del origen de la petición, no de un valor fijo', async () => {
    const h = createHarness();
    const { challenge } = await pkce();
    const tunnel = 'https://prueba.trycloudflare.com';
    const response = await h.client().post('/api/v1/steam/start', { challenge }, { base: tunnel });
    expect(response.status).toBe(201);
    const login = new URL(response.json.url);
    expect(login.searchParams.get('openid.realm')).toBe(tunnel);
    expect(login.searchParams.get('openid.return_to')).toBe(
      `${tunnel}${CALLBACK_PATH}?t=${response.json.ticket}`,
    );
  });

  it('cada vez un ticket distinto, y de paso borra los caducados', async () => {
    const h = createHarness();
    const pc = h.client();
    const first = await pc.post('/api/v1/steam/start', { challenge: (await pkce()).challenge });
    h.clock.ms += STEAM_TICKET_TTL_MS;
    const second = await pc.post('/api/v1/steam/start', { challenge: (await pkce()).challenge });
    expect(second.json.ticket).not.toBe(first.json.ticket);
    expect(h.db.rows('SELECT ticket_hash FROM steam_ticket')).toEqual([
      { ticket_hash: await sha256Hex(second.json.ticket) },
    ]);
  });

  it('el challenge tiene que ser de 43 caracteres de base64url, y nada más en el cuerpo', async () => {
    const h = createHarness();
    const pc = h.client();
    const { challenge } = await pkce();
    for (const body of [
      {},
      { challenge: challenge.slice(1) },
      { challenge: `${challenge}A` },
      { challenge: `${challenge.slice(1)}=` },
      { challenge: `${challenge.slice(1)}+` },
      { challenge, verifier: challenge },
    ]) {
      expect((await pc.post('/api/v1/steam/start', body)).status).toBe(400);
    }
    expect(h.db.rows('SELECT * FROM steam_ticket')).toEqual([]);
  });

  it('con las reglas de la micro-API: Origin propio y JSON', async () => {
    const h = createHarness();
    const pc = h.client();
    const { challenge } = await pkce();
    expect(
      (await pc.post('/api/v1/steam/start', { challenge }, { origin: 'https://otro.example' }))
        .status,
    ).toBe(403);
    expect(
      (
        await pc.post('/api/v1/steam/start', JSON.stringify({ challenge }), {
          headers: { 'Content-Type': 'text/plain' },
        })
      ).status,
    ).toBe(415);
    expect(h.db.rows('SELECT * FROM steam_ticket')).toEqual([]);
  });
});

describe('canje tipo PKCE', () => {
  it('el challenge es BASE64URL(SHA-256(verificador)), con el vector del RFC 7636 (apéndice B)', async () => {
    expect(await sha256Base64url('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});
