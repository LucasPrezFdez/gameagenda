// `GET /api/v1/steam/callback` (Fase 2, parte 2; §10.2 de prototipe.md; ADR-012): la vuelta de
// Steam y las cinco comprobaciones de OpenID 2.0. Cada una tiene aquí una aserción que el Steam
// falso confirma (está bien firmada) y que solo para esa comprobación: sin ella, la prueba falla.

import { STEAM_TICKET_TTL_MS } from '@gameagenda/core/api';
import { describe, expect, it } from 'vitest';
import { CALLBACK_PATH, checkAuthentication, OPENID_NS, STEAM_OPENID } from '../steam-openid.ts';
import { steamPageTitle } from '../steam-page.ts';
import { createHarness, type Harness, ORIGIN } from './harness.ts';
import {
  begin,
  callback,
  checkRequest,
  OTHER_STEAM_ID,
  STEAM_ID,
  steamIdOf,
} from './steam-support.ts';

const STEAM_SIGNED = [
  'signed',
  'op_endpoint',
  'claimed_id',
  'identity',
  'return_to',
  'response_nonce',
  'assoc_handle',
];
const FORGED_SIG = 'bm8gZXMgbGEgZmlybWEgZGUgU3RlYW0=';

function tickets(h: Harness): unknown[] {
  return h.db.rows('SELECT * FROM steam_ticket');
}

/** El Steam falso confirma la aserción: lo que la para es la comprobación de la micro-API. */
async function steamWouldConfirm(h: Harness, assertion: URLSearchParams): Promise<void> {
  const response = await h.steam.fetch(STEAM_OPENID, checkRequest(assertion));
  expect(await response.text()).toContain('is_valid:true');
  h.steam.calls.length = 0;
  h.steam.openid.checks.length = 0;
}

describe('una vuelta buena', () => {
  it('Steam la confirma y el ticket queda con el SteamID64; la página no lo enseña', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, returnTo } = await begin(pc);
    const response = await callback(pc, ticket, h.steam.openid.assertion(returnTo));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/^text\/html/);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(response.json).toContain(steamPageTitle('done'));
    expect(response.json).not.toContain(STEAM_ID);
    expect(response.json).not.toContain(ticket);
    expect(await steamIdOf(h, ticket)).toBe(STEAM_ID);
    // Comprobación 1: a la URL fija, con la aserción entera y el modo cambiado; nada más.
    expect(h.steam.calls).toEqual([STEAM_OPENID]);
    const [sent] = h.steam.openid.checks;
    expect(sent?.get('openid.mode')).toBe('check_authentication');
    expect(sent?.get('openid.claimed_id')).toBe(`https://steamcommunity.com/openid/id/${STEAM_ID}`);
    expect(sent?.get('openid.sig')).not.toBeNull();
    expect(sent?.has('t')).toBe(false);
  });

  it('con http y la barra final en claimed_id, también (OpenID lo admite)', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, returnTo } = await begin(pc);
    const claimed = `http://steamcommunity.com/openid/id/${STEAM_ID}/`;
    const assertion = h.steam.openid.assertion(returnTo, {
      fields: { 'openid.claimed_id': claimed, 'openid.identity': claimed },
    });
    expect((await callback(pc, ticket, assertion)).status).toBe(200);
    expect(await steamIdOf(h, ticket)).toBe(STEAM_ID);
  });

  it('desde el túnel de las pruebas a mano: la vuelta tiene que llegar al origen que empezó', async () => {
    const h = createHarness();
    const pc = h.client();
    const tunnel = 'https://prueba.trycloudflare.com';
    const viaTunnel = await begin(pc, tunnel);
    expect(viaTunnel.returnTo).toBe(`${tunnel}${CALLBACK_PATH}?t=${viaTunnel.ticket}`);
    const assertion = h.steam.openid.assertion(viaTunnel.returnTo);
    // Por otro origen, `return_to` no coincide con el de la petición.
    expect((await callback(pc, viaTunnel.ticket, assertion)).status).toBe(400);
    const again = await begin(pc, tunnel);
    const ok = await callback(pc, again.ticket, h.steam.openid.assertion(again.returnTo), tunnel);
    expect(ok.status).toBe(200);
    expect(await steamIdOf(h, again.ticket)).toBe(STEAM_ID);
  });
});

describe('firma falsa', () => {
  it('Steam no la confirma: la página lo dice y el ticket se gasta', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, returnTo } = await begin(pc);
    const forged = h.steam.openid.assertion(returnTo);
    forged.set('openid.sig', FORGED_SIG);
    const response = await callback(pc, ticket, forged);
    expect(response.status).toBe(400);
    expect(response.json).toContain(steamPageTitle('invalid'));
    expect(tickets(h)).toEqual([]);
    expect(h.steam.calls).toEqual([STEAM_OPENID]);
    // Gastado: ni una aserción buena lo recupera.
    expect((await callback(pc, ticket, h.steam.openid.assertion(returnTo))).status).toBe(410);
  });

  it('otra cuenta con la firma de la buena: Steam no la confirma', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, returnTo } = await begin(pc);
    const tampered = h.steam.openid.assertion(returnTo);
    for (const field of ['claimed_id', 'identity']) {
      tampered.set(`openid.${field}`, `https://steamcommunity.com/openid/id/${OTHER_STEAM_ID}`);
    }
    expect((await callback(pc, ticket, tampered)).status).toBe(400);
    expect(tickets(h)).toEqual([]);
  });
});

describe('comprobación 1: check_authentication, a la URL fija y nunca al op_endpoint recibido', () => {
  it('un op_endpoint ajeno no llega a preguntar a nadie', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, returnTo } = await begin(pc);
    const evil = 'https://steamcommunity.com.evil.example/openid/login';
    const assertion = h.steam.openid.assertion(returnTo, {
      fields: { 'openid.op_endpoint': evil },
    });
    await steamWouldConfirm(h, assertion);
    expect((await callback(pc, ticket, assertion)).status).toBe(400);
    expect(h.steam.calls).toEqual([]);
    expect(tickets(h)).toEqual([]);
  });

  it('checkAuthentication pregunta a Steam aunque la aserción diga otro op_endpoint', async () => {
    const h = createHarness();
    const evil = 'https://evil.example/openid/login';
    // Lo firma un proveedor falso que dice que sí a todo: si se le preguntara a él, valdría.
    const assertion = h.steam.openid.assertion(`${ORIGIN}${CALLBACK_PATH}?t=x`, {
      fields: { 'openid.op_endpoint': evil },
    });
    assertion.set('openid.sig', FORGED_SIG);
    const asked: string[] = [];
    const verdict = await checkAuthentication(assertion, async (url, init) => {
      asked.push(url);
      if (url === evil) return new Response(`ns:${OPENID_NS}\nis_valid:true\n`);
      return h.steam.fetch(url, init);
    });
    expect(asked).toEqual([STEAM_OPENID]);
    expect(verdict).toBe('invalid');
  });

  it('vale solo con una línea is_valid:true exacta', async () => {
    const assertion = new URLSearchParams({ 'openid.mode': 'id_res' });
    for (const [body, verdict] of [
      [`ns:${OPENID_NS}\nis_valid:true\n`, 'valid'],
      [`ns:${OPENID_NS}\r\nis_valid:true\r\n`, 'valid'],
      [`ns:${OPENID_NS}\nis_valid:false\n`, 'invalid'],
      [`ns:${OPENID_NS}\nis_valid:true_no\n`, 'invalid'],
      [`ns:${OPENID_NS}\n is_valid:true\n`, 'invalid'],
      ['<html>is_valid:true</html>', 'invalid'],
      ['', 'invalid'],
    ] as const) {
      expect(await checkAuthentication(assertion, async () => new Response(body))).toBe(verdict);
    }
    expect(await checkAuthentication(assertion, async () => new Response('x'.repeat(5000)))).toBe(
      'failed',
    );
  });
});

describe('comprobación 2: claimed_id, return_to y response_nonce, firmados', () => {
  for (const field of ['claimed_id', 'return_to', 'response_nonce'] as const) {
    it(`sin ${field} en openid.signed no vale, aunque Steam confirme la firma`, async () => {
      const h = createHarness();
      const pc = h.client();
      const { ticket, returnTo } = await begin(pc);
      const assertion = h.steam.openid.assertion(returnTo, {
        signed: STEAM_SIGNED.filter((f) => f !== field),
      });
      // Lo que no está firmado se cambia sin que Steam lo note: p. ej., la cuenta.
      if (field === 'claimed_id') {
        assertion.set(
          'openid.claimed_id',
          `https://steamcommunity.com/openid/id/${OTHER_STEAM_ID}`,
        );
      }
      await steamWouldConfirm(h, assertion);
      expect((await callback(pc, ticket, assertion)).status).toBe(400);
      expect(h.steam.calls).toEqual([]);
      expect(tickets(h)).toEqual([]);
    });
  }

  it('un campo de openid.signed que no viene no vale', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, returnTo } = await begin(pc);
    const assertion = h.steam.openid.assertion(returnTo);
    assertion.delete('openid.identity');
    expect((await callback(pc, ticket, assertion)).status).toBe(400);
    expect(h.steam.calls).toEqual([]);
  });

  it('sin openid.sig o sin openid.assoc_handle no vale', async () => {
    const h = createHarness();
    const pc = h.client();
    for (const missing of ['openid.sig', 'openid.assoc_handle']) {
      const { ticket, returnTo } = await begin(pc);
      const assertion = h.steam.openid.assertion(returnTo, {
        signed: STEAM_SIGNED.filter((f) => f !== 'assoc_handle'),
      });
      assertion.delete(missing);
      expect((await callback(pc, ticket, assertion)).status).toBe(400);
    }
    expect(h.steam.calls).toEqual([]);
  });
});

describe('comprobación 3: return_to idéntico al emitido, ticket incluido', () => {
  it('una aserción para otra ruta del mismo origen no vale', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket } = await begin(pc);
    const elsewhere = h.steam.openid.assertion(`${ORIGIN}/api/v1/steam/otra?t=${ticket}`);
    await steamWouldConfirm(h, elsewhere);
    expect((await callback(pc, ticket, elsewhere)).status).toBe(400);
    expect(h.steam.calls).toEqual([]);
    expect(tickets(h)).toEqual([]);
  });

  it('una aserción para otro ticket no vale para este (login CSRF)', async () => {
    const h = createHarness();
    const attacker = h.client();
    const victim = h.client();
    const mine = await begin(attacker);
    const theirs = await begin(victim);
    // El atacante inicia sesión con su cuenta y lleva su aserción al ticket de la víctima.
    const assertion = h.steam.openid.assertion(mine.returnTo, { steamId: OTHER_STEAM_ID });
    await steamWouldConfirm(h, assertion);
    expect((await callback(victim, theirs.ticket, assertion)).status).toBe(400);
    expect(h.steam.calls).toEqual([]);
    expect(await steamIdOf(h, mine.ticket)).toBeNull();
    expect(await steamIdOf(h, theirs.ticket)).toBeUndefined();
  });

  it('una aserción para otro origen no vale', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket } = await begin(pc);
    const other = h.steam.openid.assertion(`https://otro.example${CALLBACK_PATH}?t=${ticket}`);
    await steamWouldConfirm(h, other);
    expect((await callback(pc, ticket, other)).status).toBe(400);
    expect(h.steam.calls).toEqual([]);
  });

  it('con algo más en return_to, tampoco', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, returnTo } = await begin(pc);
    const longer = h.steam.openid.assertion(`${returnTo}&x=1`);
    await steamWouldConfirm(h, longer);
    expect((await callback(pc, ticket, longer)).status).toBe(400);
  });
});

describe('comprobación 4: claimed_id de Steam, con 17 cifras', () => {
  for (const claimed of [
    `https://steamcommunity.com.evil.example/openid/id/${STEAM_ID}`,
    `https://evil.example/openid/id/${STEAM_ID}`,
    `https://steamcommunity.com/openid/id/${STEAM_ID.slice(1)}`,
    `https://steamcommunity.com/openid/id/${STEAM_ID}0`,
    `https://steamcommunity.com/openid/id/${STEAM_ID}/x`,
    `https://steamcommunity.com/profiles/${STEAM_ID}`,
  ]) {
    it(`${claimed} no vale, aunque Steam lo firme`, async () => {
      const h = createHarness();
      const pc = h.client();
      const { ticket, returnTo } = await begin(pc);
      const assertion = h.steam.openid.assertion(returnTo, {
        fields: { 'openid.claimed_id': claimed, 'openid.identity': claimed },
      });
      await steamWouldConfirm(h, assertion);
      expect((await callback(pc, ticket, assertion)).status).toBe(400);
      expect(h.steam.calls).toEqual([]);
      expect(tickets(h)).toEqual([]);
    });
  }
});

describe('comprobación 5: ticket de un solo uso que caduca a los 10 min', () => {
  it('la misma aserción otra vez no vale, ni pregunta a Steam', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, returnTo } = await begin(pc);
    const assertion = h.steam.openid.assertion(returnTo);
    expect((await callback(pc, ticket, assertion)).status).toBe(200);
    const again = await callback(pc, ticket, assertion);
    expect(again.status).toBe(410);
    expect(again.json).toContain(steamPageTitle('expired'));
    expect(h.steam.calls).toEqual([STEAM_OPENID]);
    expect(await steamIdOf(h, ticket)).toBe(STEAM_ID);
  });

  it('otra cuenta sobre un ticket que ya tiene su login, tampoco', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, returnTo } = await begin(pc);
    await callback(pc, ticket, h.steam.openid.assertion(returnTo));
    const other = h.steam.openid.assertion(returnTo, { steamId: OTHER_STEAM_ID });
    expect((await callback(pc, ticket, other)).status).toBe(410);
    expect(await steamIdOf(h, ticket)).toBe(STEAM_ID);
  });

  it('caducado, no vale ni pregunta a Steam', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, returnTo } = await begin(pc);
    h.clock.ms += STEAM_TICKET_TTL_MS;
    expect((await callback(pc, ticket, h.steam.openid.assertion(returnTo))).status).toBe(410);
    expect(h.steam.calls).toEqual([]);
  });

  it('inventado o mal formado, tampoco', async () => {
    const h = createHarness();
    const pc = h.client();
    const { returnTo } = await begin(pc);
    const assertion = h.steam.openid.assertion(returnTo);
    for (const ticket of ['A'.repeat(43), 'corto', '']) {
      expect((await callback(pc, ticket, assertion)).status).toBe(410);
    }
    expect(h.steam.calls).toEqual([]);
  });
});

describe('lo demás', () => {
  it('un parámetro repetido no vale (p. ej., dos claimed_id)', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, returnTo } = await begin(pc);
    const assertion = h.steam.openid.assertion(returnTo);
    assertion.append('openid.claimed_id', `https://steamcommunity.com/openid/id/${OTHER_STEAM_ID}`);
    expect((await callback(pc, ticket, assertion)).status).toBe(400);
    expect(h.steam.calls).toEqual([]);
  });

  it('una consulta enorme no vale', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket, returnTo } = await begin(pc);
    const assertion = h.steam.openid.assertion(returnTo, {
      fields: { 'openid.x': 'x'.repeat(9000) },
    });
    expect((await callback(pc, ticket, assertion)).status).toBe(400);
    expect(h.steam.calls).toEqual([]);
  });

  it('con openid.mode=cancel, la página lo dice y el ticket se gasta', async () => {
    const h = createHarness();
    const pc = h.client();
    const { ticket } = await begin(pc);
    const response = await callback(
      pc,
      ticket,
      new URLSearchParams({ 'openid.ns': OPENID_NS, 'openid.mode': 'cancel' }),
    );
    expect(response.status).toBe(200);
    expect(response.json).toContain(steamPageTitle('cancelled'));
    expect(tickets(h)).toEqual([]);
    expect(h.steam.calls).toEqual([]);
  });

  for (const [field, value] of [
    ['openid.mode', 'check_authentication'],
    ['openid.mode', 'setup_needed'],
    ['openid.ns', 'http://openid.net/signon/1.1'],
  ] as const) {
    it(`con ${field}=${value} no vale`, async () => {
      const h = createHarness();
      const pc = h.client();
      const { ticket, returnTo } = await begin(pc);
      const assertion = h.steam.openid.assertion(returnTo, { fields: { [field]: value } });
      expect((await callback(pc, ticket, assertion)).status).toBe(400);
      expect(h.steam.calls).toEqual([]);
    });
  }

  for (const fail of ['network', 'status'] as const) {
    it(`si Steam no contesta (${fail}), el ticket se queda y recargar lo reintenta`, async () => {
      const h = createHarness();
      const pc = h.client();
      const { ticket, returnTo } = await begin(pc);
      const assertion = h.steam.openid.assertion(returnTo);
      h.steam.openid.fail = fail;
      const response = await callback(pc, ticket, assertion);
      expect(response.status).toBe(502);
      expect(response.json).toContain(steamPageTitle('unavailable'));
      expect(await steamIdOf(h, ticket)).toBeNull();
      h.steam.openid.fail = null;
      expect((await callback(pc, ticket, assertion)).status).toBe(200);
      expect(await steamIdOf(h, ticket)).toBe(STEAM_ID);
    });
  }

  it('ninguna vuelta llama a la Web API de Steam: solo a check_authentication', async () => {
    const h = createHarness();
    const pc = h.client();
    for (let i = 0; i < 3; i++) {
      const { ticket, returnTo } = await begin(pc);
      const assertion = h.steam.openid.assertion(returnTo);
      if (i === 1) assertion.set('openid.sig', FORGED_SIG);
      await callback(pc, ticket, assertion);
    }
    expect(h.steam.calls.length).toBeGreaterThan(0);
    expect(h.steam.calls.every((url) => url === STEAM_OPENID)).toBe(true);
  });
});
