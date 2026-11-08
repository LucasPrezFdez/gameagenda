// El buzón del Atajo de iOS de punta a punta (M4; RF-08; CA4.5): el Atajo deja un enlace en D1, la
// siguiente ronda de una app de la agenda lo apunta como un enlace pegado (con su agenda de verdad
// y su IndexedDB), lo confirma en la petición siguiente y llega al resto de dispositivos.

import { afterEach, describe, expect, it } from 'vitest';
import { createNoticeCenter } from '../../src/notices/notice-center.ts';
import { createHarness, type Harness } from './harness.ts';
import { Replica, type ReplicaOptions } from './sync-client-support.ts';

const open: Replica[] = [];
const HADES = 'https://store.steampowered.com/app/1145360/Hades/';
const CATALOG = new Map([[1145360, 'Hades']]);

async function replica(h: Harness, options: ReplicaOptions = {}): Promise<Replica> {
  const r = await Replica.open(h, { catalog: CATALOG, ...options });
  open.push(r);
  return r;
}

afterEach(async () => {
  for (const r of open.splice(0)) {
    expect(r.errors).toEqual([]);
    await r.closeTab();
  }
});

/** El *token* del Atajo, creado desde Ajustes de `r`. */
async function inboxToken(r: Replica): Promise<string> {
  const { token } = await r.sync.createInboxToken('Atajo de iOS');
  return token;
}

/** Lo que hace el Atajo de iOS al compartir `url`. */
async function share(h: Harness, token: string, url: string): Promise<number> {
  const response = await h
    .client('198.51.100.40')
    .post(
      '/api/v1/inbox',
      { url },
      { origin: null, headers: { Authorization: `Bearer ${token}` } },
    );
  return response.status;
}

function inboxRows(h: Harness): unknown[] {
  return h.db.rows('SELECT url FROM inbox_item');
}

describe('el buzón del Atajo de iOS (CA4.5)', () => {
  it('lo apunta la siguiente sincronización, lo confirma y llega a los demás dispositivos', async () => {
    const h = createHarness();
    const notices = createNoticeCenter();
    const pc = await replica(h, { notices });
    const phone = await replica(h);
    await pc.activate();
    await pc.pair(phone);
    const token = await inboxToken(pc);
    expect(await share(h, token, `Mira: ${HADES}`)).toBe(201);
    expect(
      await share(h, token, 'https://store.steampowered.com/app/3999990/Mi_Juego_Indie/'),
    ).toBe(201);

    await pc.syncNow();
    // Del catálogo local, con su nombre; si no está, provisional con el del *slug*.
    expect(pc.agenda.get('steam:1145360')).toMatchObject({
      title: 'Hades',
      status: 'want_to_play',
    });
    expect(pc.agenda.get('steam:3999990')).toMatchObject({ title: 'Mi Juego Indie' });
    expect(notices.getSnapshot()?.message).toBe('Hemos apuntado 2 juegos desde el Atajo de iOS.');
    // Confirmado en la misma ronda: el buzón queda vacío y lo apuntado, subido.
    expect(inboxRows(h)).toEqual([]);
    expect(await pc.outboxSize()).toBe(0);

    await phone.syncNow();
    expect(phone.agenda.get('steam:1145360')).toMatchObject({ title: 'Hades' });
    expect(await phone.stored()).toEqual(await pc.stored());
  });

  it('un juego que ya está en la lista no cambia de estado, y se confirma igual', async () => {
    const h = createHarness();
    const pc = await replica(h);
    await pc.activate();
    pc.agenda.capture({ id: 'steam:1145360', title: 'Hades' }, { status: 'playing' });
    await pc.syncNow();
    const token = await inboxToken(pc);
    await share(h, token, HADES);
    await pc.syncNow();
    expect(pc.agenda.get('steam:1145360')?.status).toBe('playing');
    expect(inboxRows(h)).toEqual([]);
  });

  it('uno quitado de la lista vuelve a Quiero jugar', async () => {
    const h = createHarness();
    const pc = await replica(h);
    await pc.activate();
    pc.agenda.capture({ id: 'steam:1145360', title: 'Hades' }, { status: 'completed' });
    pc.agenda.remove('steam:1145360');
    await pc.syncNow();
    await share(h, await inboxToken(pc), HADES);
    await pc.syncNow();
    expect(pc.agenda.get('steam:1145360')).toMatchObject({
      status: 'want_to_play',
      deletedAt: null,
    });
  });

  it('sin quien lo apunte (o sin guardarlo), no se confirma: se queda para la ronda siguiente', async () => {
    const h = createHarness();
    const pc = await replica(h, { inbox: false });
    await pc.activate();
    const token = await inboxToken(pc);
    await share(h, token, HADES);
    await pc.syncNow();
    expect(pc.agenda.get('steam:1145360')).toBeUndefined();
    expect(inboxRows(h)).toHaveLength(1);
    // Otro dispositivo que sí lo apunta se lo lleva.
    const phone = await replica(h);
    await pc.pair(phone);
    await phone.syncNow();
    expect(phone.agenda.get('steam:1145360')).toMatchObject({ title: 'Hades' });
    expect(inboxRows(h)).toEqual([]);
    await pc.syncNow();
    expect(pc.agenda.get('steam:1145360')).toMatchObject({ title: 'Hades' });
  });

  it('un token revocado recibe 401 y no deja nada', async () => {
    const h = createHarness();
    const pc = await replica(h);
    await pc.activate();
    const { deviceId, token } = await pc.sync.createInboxToken('Atajo de iOS');
    expect((await pc.sync.listDevices()).map((d) => d.kind).sort()).toEqual(['app', 'inbox']);
    await pc.sync.revokeDevice(deviceId);
    expect(await share(h, token, HADES)).toBe(401);
    expect(inboxRows(h)).toEqual([]);
    // Revocar el del Atajo no desempareja la app.
    expect(pc.sync.getSnapshot().status).toBe('paired');
  });
});

describe('el buzón y lo que llega en la misma ronda (revisión del 08-11-2026)', () => {
  it('un dispositivo nuevo que recibe el juego (Completado) y su enlace a la vez no lo pisa', async () => {
    const h = createHarness();
    const pc = await replica(h);
    await pc.activate();
    pc.agenda.capture({ id: 'steam:1145360', title: 'Hades' }, { status: 'completed' });
    await pc.syncNow();
    await share(h, await inboxToken(pc), HADES);
    // El teléfono se empareja sin haberlo visto: su primera ronda baja el juego y el enlace juntos.
    const phone = await replica(h);
    await pc.pair(phone);
    expect(phone.agenda.get('steam:1145360')?.status).toBe('completed');
    expect(inboxRows(h)).toEqual([]);
    await pc.syncNow();
    expect(pc.agenda.get('steam:1145360')?.status).toBe('completed');
    expect(await phone.stored()).toEqual(await pc.stored());
  });
});
