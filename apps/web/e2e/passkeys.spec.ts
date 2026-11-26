// Llaves de acceso (ADR-013) con la micro-API real de la vista previa y el autenticador virtual de
// Chromium (CDP): guardar una al activar (la oferta tras el código de recuperación), verla en la
// lista, entrar con ella en otro dispositivo (copiada a su autenticador, como un llavero
// sincronizado) con los juegos de la agenda, y quitarla. Cerrar el diálogo no dice nada.
//
// Por `localhost` y no por `127.0.0.1`: una IP no vale como `rp.id`. La vista previa sirve la
// `Permissions-Policy` de `public/_headers`, así que esto prueba también la de producción. WebKit
// no tiene autenticador virtual.
import type { CDPSession, Page } from '@playwright/test';
import { capture, expectAccessible, openNoEmail, setup } from './helpers.ts';
import { expect, test as syncTest } from './sync-server.ts';

const test = syncTest.extend({
  baseURL: async ({ baseURL }, use) => {
    await use(baseURL?.replace('//127.0.0.1:', '//localhost:'));
  },
});

test.skip(({ browserName }) => browserName !== 'chromium', 'autenticador virtual: solo Chromium');

interface Authenticator {
  readonly cdp: CDPSession;
  readonly id: string;
}

/** Un autenticador de plataforma virtual (como Windows Hello o Face ID), con UV. */
async function virtualAuthenticator(page: Page): Promise<Authenticator> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, id: authenticatorId };
}

function syncSection(page: Page) {
  return page.getByRole('region', { name: 'Sincronización' });
}

async function openSync(page: Page) {
  await page.goto('/ajustes/sincronizacion');
  await expect(page.getByRole('heading', { level: 2, name: 'Sincronización' })).toBeVisible();
}

test('guardar una llave al activar, entrar con ella en otro dispositivo y quitarla', async ({
  page,
  newDevice,
}) => {
  const checks = await setup(page);
  const pc = await virtualAuthenticator(page);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');

  await openSync(page);
  const section = syncSection(page);
  await section.getByRole('textbox', { name: 'Nombre de este dispositivo' }).fill('PC de prueba');
  await (await openNoEmail(section)).getByRole('checkbox', { name: /años o más/ }).check();
  await section.getByRole('button', { name: 'Activar sincronización' }).click();
  await expect(section.getByRole('heading', { name: 'Tu código de recuperación' })).toBeFocused();

  // La oferta, tras el código: guardada, el foco va a «Ya lo he guardado».
  await section.getByRole('button', { name: 'Crear una llave de acceso' }).click();
  await expect(section.getByText(/^Hemos guardado la llave\./)).toBeVisible();
  await expect(section.getByRole('button', { name: 'Ya lo he guardado' })).toBeFocused();
  await expectAccessible(page, 'Llave guardada tras el código de recuperación');
  await section.getByRole('button', { name: 'Ya lo he guardado' }).click();

  const keys = section.getByRole('list', { name: 'Llaves de acceso' });
  await expect(keys.getByRole('listitem')).toHaveCount(1);
  await expect(keys).toContainText('Creada en «PC de prueba»');
  await expect(keys).toContainText('Sin usar todavía');
  await expectAccessible(page, 'Llaves de acceso');
  const { credentials } = await pc.cdp.send('WebAuthn.getCredentials', {
    authenticatorId: pc.id,
  });
  expect(credentials).toHaveLength(1);

  // Otro dispositivo, sin código: la misma llave en su autenticador.
  const phone = await newDevice();
  const phoneChecks = await setup(phone);
  const phoneKeys = await virtualAuthenticator(phone);
  const [credential] = credentials;
  if (credential === undefined) throw new Error('sin llave');
  await phoneKeys.cdp.send('WebAuthn.addCredential', { authenticatorId: phoneKeys.id, credential });
  await openSync(phone);
  const phoneSection = syncSection(phone);
  await phoneSection
    .getByRole('textbox', { name: 'Nombre de este dispositivo' })
    .fill('Móvil de prueba');
  await expectAccessible(phone, 'Entrar con una llave de acceso');
  await phoneSection.getByRole('button', { name: 'Entrar con una llave de acceso' }).click();
  await expect(phoneSection.getByRole('heading', { name: 'Estado' })).toBeFocused();
  const devices = phoneSection.getByRole('list', { name: 'Dispositivos' });
  await expect(devices).toContainText('PC de prueba');
  await expect(devices).toContainText('Móvil de prueba');
  const listed = phoneSection.getByRole('list', { name: 'Llaves de acceso' });
  await expect(listed).toContainText('Usada por última vez: hoy');

  // Los juegos de la agenda llegan.
  await phone.goto('/');
  await expect(phone.getByRole('link', { name: 'Hades II' })).toBeVisible({ timeout: 15_000 });

  // Quitarla, desde el móvil: confirmación en el sitio y la lista vacía.
  await openSync(phone);
  const remove = phoneSection.getByRole('button', {
    name: 'Quitar la llave creada en «PC de prueba»',
  });
  await remove.click();
  await expect(remove).toBeFocused();
  await remove.click();
  await expect(phoneSection.getByText('Hemos quitado la llave.')).toBeVisible();
  await expect(phoneSection.getByText(/^Aún no tienes ninguna\./)).toBeVisible();
  await expect(phoneSection.getByRole('heading', { name: 'Llaves de acceso' })).toBeFocused();

  await checks.expectClean();
  await phoneChecks.expectClean();
});

test('una llave quitada no abre la agenda, y lo dice; cerrar el diálogo no dice nada', async ({
  page,
  newDevice,
}) => {
  const pc = await virtualAuthenticator(page);
  await openSync(page);
  const section = syncSection(page);
  await (await openNoEmail(section)).getByRole('checkbox', { name: /años o más/ }).check();
  await section.getByRole('button', { name: 'Activar sincronización' }).click();
  await section.getByRole('button', { name: 'Crear una llave de acceso' }).click();
  await expect(section.getByText(/^Hemos guardado la llave\./)).toBeVisible();
  const { credentials } = await pc.cdp.send('WebAuthn.getCredentials', {
    authenticatorId: pc.id,
  });
  await section.getByRole('button', { name: 'Ya lo he guardado' }).click();
  const remove = section.getByRole('button', { name: /^Quitar la llave creada en/ });
  await remove.click();
  await remove.click();
  await expect(section.getByText('Hemos quitado la llave.')).toBeVisible();

  // Con la llave quitada (aún en el llavero del otro): no abre nada, y lo dice.
  const phone = await newDevice();
  const keys = await virtualAuthenticator(phone);
  const [credential] = credentials;
  if (credential === undefined) throw new Error('sin llave');
  await keys.cdp.send('WebAuthn.addCredential', { authenticatorId: keys.id, credential });
  await openSync(phone);
  const phoneSection = syncSection(phone);
  await phoneSection.getByRole('button', { name: 'Entrar con una llave de acceso' }).click();
  await expect(phoneSection.getByText(/^Esa llave no ha abierto ninguna agenda/)).toBeVisible();
  await expect(phoneSection.getByRole('heading', { name: 'Tu cuenta' })).toBeVisible();

  // Sin verificar al usuario (como cerrar el diálogo de Windows Hello): vuelve sin mensaje.
  await keys.cdp.send('WebAuthn.setUserVerified', {
    authenticatorId: keys.id,
    isUserVerified: false,
  });
  await phone.reload();
  await phoneSection.getByRole('button', { name: 'Entrar con una llave de acceso' }).click();
  await expect(
    phoneSection.getByRole('button', { name: 'Entrar con una llave de acceso' }),
  ).toHaveText('Entrar con una llave de acceso');
  await expect(phoneSection.locator('.sync__error')).toHaveCount(0);
});
