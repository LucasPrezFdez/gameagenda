// Ajustes › Sincronización pintada sin DOM (`renderToStaticMarkup`): lo que sale en el primer
// pintado de cada vista. Lo que cambia con los gestos, el foco, la red y el CSS (Vitest no carga
// las hojas de estilos) va en los E2E (`e2e/sync-settings.spec.ts`).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { es } from '../../i18n/es.ts';
import type { SyncService, SyncState } from '../../sync/types.ts';
import {
  JoinForm,
  type LabelProps,
  OffView,
  PairedView,
  type PanelIds,
  StatusSection,
  UnpairedView,
} from './SyncPanel.tsx';

const t = es.syncPanel;
const noop = () => undefined;
const never = () => new Promise<never>(noop);

function state(patch: Partial<SyncState> = {}): SyncState {
  return {
    ready: true,
    status: 'paired',
    activity: 'idle',
    error: null,
    unpairedReason: null,
    deviceId: 'd1',
    pending: 0,
    lastSyncAt: null,
    ...patch,
  };
}

const sync: SyncService = {
  getSnapshot: () => state(),
  subscribe: () => noop,
  activate: never,
  redeemPairingCode: never,
  redeemRecoveryCode: never,
  createPairingCode: never,
  createRecoveryCode: never,
  createInboxToken: never,
  listDevices: never,
  revokeDevice: never,
  deleteServerAgenda: never,
  syncNow: never,
  forget: never,
  notifyLocalWrite: noop,
  dispose: noop,
};

const ids: PanelIds = {
  off: 'off',
  join: 'join',
  status: 'status',
  pairing: 'pairing',
  devices: 'devices',
  inbox: 'inbox',
  recovery: 'recovery',
  leave: 'leave',
  unpaired: 'unpaired',
  forget: 'forget',
  reveal: 'reveal',
};

const labelProps: LabelProps = {
  labelId: 'label',
  label: 'Chrome en Windows',
  labelError: null,
  onLabel: noop,
  takeLabel: () => null,
};

describe('el aviso del gesto que crea las cookies (§11.2)', () => {
  const off = renderToStaticMarkup(
    createElement(OffView, {
      sync,
      ids,
      linkCode: null,
      iosTab: false,
      labelProps,
      onActivating: noop,
      onActivated: noop,
      onJoined: noop,
    }),
  );
  const unpaired = renderToStaticMarkup(
    createElement(UnpairedView, {
      sync,
      state: state({ status: 'unpaired', unpairedReason: 'cookies' }),
      ids,
      linkCode: null,
      iosTab: false,
      labelProps,
      onJoined: noop,
      onForgot: noop,
    }),
  );

  it('habla de las dos cookies y deja el hueco legal, sin sincronizar y desemparejado', () => {
    for (const html of [off, unpaired]) {
      expect(html).toContain('guarda dos cookies');
      expect(html).toContain('Cloudflare en la Unión Europea');
      expect(html).toContain('data-sync-legal=""');
    }
  });

  it('desemparejado, sale antes de poder volver a emparejar o recuperar', () => {
    const legal = unpaired.indexOf('data-sync-legal');
    expect(legal).toBeGreaterThan(unpaired.indexOf(t.unpairedTitle));
    expect(legal).toBeLessThan(unpaired.indexOf(t.rejoinTitle));
    expect(legal).toBeLessThan(unpaired.indexOf(t.useRecovery));
  });
});

describe('huecos reservados (§9.5, regla 3)', () => {
  const status = (pending: number) =>
    renderToStaticMarkup(
      createElement(StatusSection, { sync, state: state({ pending }), headingId: 's' }),
    );

  it('la línea de cambios pendientes está siempre, oculta si no hay ninguno', () => {
    expect(status(0)).toContain(
      '<p class="muted sync__pending">1 juego con cambios sin sincronizar.</p>',
    );
    expect(status(3)).toContain(
      '<p class="muted sync__pending" data-shown="">3 juegos con cambios sin sincronizar.</p>',
    );
  });

  it('mientras llega la lista, la fila de este dispositivo con sus dos líneas', () => {
    const html = renderToStaticMarkup(
      createElement(PairedView, {
        sync,
        state: state(),
        ids,
        fromLink: false,
        onNewRecovery: noop,
        onLeft: noop,
        notify: noop,
      }),
    );
    expect(html).toMatch(
      /<div class="sync__devices" aria-busy="true"><div class="sync__device"><div class="sync__device-main"><p class="sync__device-name">.+?<\/p><p class="muted" aria-hidden="true"><span class="skeleton sync__skeleton">/,
    );
    expect(html).toContain(t.devicesLoading);
    // Sin la lista aún, nada que se pueda confundir con ella.
    expect(html).not.toContain('<ul class="sync__devices"');
  });
});

describe('el enlace del QR en Safari de iPhone o iPad', () => {
  const join = (iosTab: boolean) =>
    renderToStaticMarkup(
      createElement(JoinForm, {
        sync,
        idPrefix: 'join',
        title: t.joinTitle,
        intro: t.joinIntro,
        primary: 'pair',
        initialCode: 'GXEN-Q32V-ABCD-EFGH-JKMN-PQRS-TVWX',
        fromLink: true,
        iosTab,
        takeLabel: () => null,
        onJoined: noop,
      }),
    );

  it('avisa, en la nota que describe el botón, de que la app de la pantalla de inicio es otra', () => {
    const safari = join(true);
    expect(safari).toContain(
      `<p id="join-link" class="sync__note">${t.fromLink} ${t.fromLinkSafari}</p>`,
    );
    expect(safari).toContain('aria-describedby="join-link"');
    const other = join(false);
    expect(other).toContain(`<p id="join-link" class="sync__note">${t.fromLink}</p>`);
    expect(other).not.toContain(t.fromLinkSafari);
  });
});
