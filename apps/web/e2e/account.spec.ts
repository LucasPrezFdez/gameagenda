// Cuentas con email y contraseña (ADR-014) con la micro-API real de la vista previa: crear la cuenta
// en un dispositivo (con la edad, el código de recuperación y lo que se guarda), entrar desde otro
// y recibir la agenda, la contraseña mala, «He olvidado mi contraseña», cambiar la contraseña y
// cerrar sesión. La contraseña nunca viaja: lo comprueba cada petición a la micro-API.
import type { Page, Request } from '@playwright/test';
import { capture, expectAccessible, setup } from './helpers.ts';
import { expectStored } from './storage.ts';
import { expect, test } from './sync-server.ts';

const EMAIL = 'jugadora@example.com';
const PASSWORD = 'una frase larga para probar';

function syncSection(page: Page) {
  return page.getByRole('region', { name: 'Sincronización' });
}

async function openSync(page: Page) {
  await page.goto('/ajustes/sincronizacion');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Cuenta y sincronización' }),
  ).toBeVisible();
}

/** Las peticiones a la micro-API, para comprobar que la contraseña no sale del dispositivo. */
function watchApi(page: Page): Request[] {
  const seen: Request[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) seen.push(request);
  });
  return seen;
}

/**
 * Los errores de la consola, salvo los esperados: el 400 de una contraseña mala y el 409 de un
 * email que ya tiene cuenta, que el navegador anota como «Failed to load resource».
 */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
  const expected = /status of (400|409) .*\/api\/v1\/account(\/login)?\)$/;
  return {
    async expectClean() {
      expect(errors.filter((error) => !expected.test(error))).toEqual([]);
      expect(await page.evaluate(() => globalThis.__cspViolations)).toEqual([]);
    },
  };
}

function sentPassword(requests: readonly Request[], password: string): boolean {
  return requests.some(
    (r) => (r.postData() ?? '').includes(password) || r.url().includes(password),
  );
}

test('crear la cuenta en el PC, entrar desde el móvil con email y contraseña, y cerrar sesión', async ({
  page,
  newDevice,
}) => {
  test.setTimeout(120_000);
  await setup(page);
  const checks = watchErrors(page);
  const requests = watchApi(page);
  await page.goto('/');
  await capture(page, 'hades ii', 'Hades II');
  // Guardado antes de salir de la lista: si no, WebKit puede perderlo al navegar.
  await expectStored(page, 'steam:1145350', { title: 'Hades II' });

  await openSync(page);
  const section = syncSection(page);
  await expect(section.getByRole('heading', { name: 'Tu cuenta' })).toBeVisible();
  await expectAccessible(page, 'Cuenta sin sesión');
  await section.getByRole('textbox', { name: 'Nombre de este dispositivo' }).fill('PC de prueba');
  const signUp = section.getByRole('button', { name: 'Crear cuenta', exact: true });
  await expect(signUp.first()).toHaveAttribute('aria-pressed', 'true');

  // Sin nada, lo dice en el email; con una contraseña corta, en la contraseña; sin la edad, en ella.
  const form = section.locator('form').first();
  await form.getByRole('button', { name: 'Crear cuenta' }).click();
  const email = form.getByRole('textbox', { name: 'Email' });
  await expect(email).toBeFocused();
  await expect(email).toHaveAccessibleDescription('Escribe tu email.');
  await email.fill(EMAIL);
  const password = form.getByLabel('Contraseña', { exact: true });
  await password.fill('corta');
  await form.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(password).toBeFocused();
  await expect(password).toHaveAccessibleDescription(
    /La contraseña necesita al menos 12 caracteres/,
  );
  await password.fill(PASSWORD);
  await expect(password).toHaveAttribute('type', 'password');
  await form.getByRole('button', { name: 'Mostrar la contraseña' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await form.getByRole('button', { name: 'Crear cuenta' }).click();
  const age = form.getByRole('checkbox', { name: /años o más/ });
  await expect(age).toBeFocused();
  await age.check();
  await form.getByRole('button', { name: 'Crear cuenta' }).click();

  // Como al activar: el código de recuperación, una vez.
  await expect(section.getByRole('heading', { name: 'Tu código de recuperación' })).toBeFocused();
  await section.getByRole('button', { name: 'Ya lo he guardado' }).click();
  await expect(section.getByText(`Has iniciado sesión como ${EMAIL}.`)).toBeVisible();
  // Hasta que el PC no ha subido su agenda, el móvil no tendría nada que bajar.
  await expect(page.locator('[data-sync-status]')).toContainText('Sincronizado', {
    timeout: 15_000,
  });
  await expectAccessible(page, 'Cuenta con sesión');
  expect(sentPassword(requests, PASSWORD)).toBe(false);

  // Otro dispositivo: la contraseña mala no vale; la buena trae la agenda.
  const phone = await newDevice();
  await setup(phone);
  const phoneChecks = watchErrors(phone);
  const phoneRequests = watchApi(phone);
  await openSync(phone);
  const phoneSection = syncSection(phone);
  await phoneSection
    .getByRole('textbox', { name: 'Nombre de este dispositivo' })
    .fill('Móvil de prueba');
  await phoneSection.getByRole('button', { name: 'Iniciar sesión', exact: true }).first().click();
  const login = phoneSection.locator('form').first();
  await login.getByRole('textbox', { name: 'Email' }).fill(EMAIL);
  const phonePassword = login.getByLabel('Contraseña', { exact: true });
  await phonePassword.fill('otra frase que no es');
  await login.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(phonePassword).toBeFocused();
  await expect(phonePassword).toHaveAccessibleDescription(
    'El email o la contraseña no son correctos.',
  );
  await expect(phonePassword).toHaveValue('');

  // «He olvidado mi contraseña»: cómo entrar sin ella.
  await login.getByRole('button', { name: 'He olvidado mi contraseña' }).click();
  await expect(login.getByText(/no podemos recuperarla por email/)).toBeVisible();

  await phonePassword.fill(PASSWORD);
  await login.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(phoneSection.getByRole('heading', { name: 'Estado' })).toBeFocused();
  await expect(phoneSection.getByText(`Has iniciado sesión como ${EMAIL}.`)).toBeVisible();
  const devices = phoneSection.getByRole('list', { name: 'Dispositivos' });
  await expect(devices).toContainText('PC de prueba');
  await expect(devices).toContainText('Móvil de prueba');
  await expect(phone.locator('[data-sync-status]')).toContainText('Sincronizado', {
    timeout: 15_000,
  });
  await phone.goto('/');
  await expect(phone.getByRole('link', { name: 'Hades II' })).toBeVisible({ timeout: 15_000 });
  expect(sentPassword(phoneRequests, PASSWORD)).toBe(false);

  // Cambiar la contraseña desde el móvil: el PC sigue dentro.
  await openSync(phone);
  await phoneSection.getByRole('button', { name: 'Cambiar la contraseña' }).click();
  const newPassword = phoneSection.getByLabel('Contraseña nueva', { exact: true });
  await expect(newPassword).toBeFocused();
  const next = 'otra frase larga y nueva';
  await newPassword.fill(next);
  await phoneSection.getByRole('button', { name: 'Guardar' }).click();
  await expect(phoneSection.getByRole('heading', { name: 'Tu cuenta' })).toBeFocused();
  expect(sentPassword(phoneRequests, next)).toBe(false);

  // Cerrar sesión en el PC: su lista se queda, y al volver, el email ya no está.
  await openSync(page);
  await section.getByRole('button', { name: 'Cerrar sesión' }).click();
  await section
    .getByRole('group', { name: /¿Cerrar sesión en este dispositivo\?/ })
    .getByRole('button', { name: 'Cerrar sesión' })
    .click();
  await expect(section.getByText(/^Has cerrado la sesión en este dispositivo/)).toBeVisible();
  await expect(section.getByRole('heading', { name: 'Tu cuenta' })).toBeFocused();
  // Y vuelve a entrar con la contraseña nueva.
  await section.getByRole('button', { name: 'Iniciar sesión', exact: true }).first().click();
  const again = section.locator('form').first();
  await again.getByRole('textbox', { name: 'Email' }).fill(EMAIL);
  await again.getByLabel('Contraseña', { exact: true }).fill(next);
  await again.getByRole('button', { name: 'Iniciar sesión' }).click();
  await expect(section.getByRole('heading', { name: 'Estado' })).toBeFocused();

  await checks.expectClean();
  await phoneChecks.expectClean();
});

test('un email que ya tiene cuenta lo dice en el email', async ({ page, newDevice }) => {
  await setup(page);
  const checks = watchErrors(page);
  await openSync(page);
  const section = syncSection(page);
  const form = section.locator('form').first();
  await form.getByRole('textbox', { name: 'Email' }).fill(EMAIL);
  await form.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await form.getByRole('checkbox', { name: /años o más/ }).check();
  await form.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(section.getByRole('heading', { name: 'Tu código de recuperación' })).toBeFocused();

  const other = await newDevice();
  await setup(other);
  const otherChecks = watchErrors(other);
  await openSync(other);
  const otherForm = syncSection(other).locator('form').first();
  const email = otherForm.getByRole('textbox', { name: 'Email' });
  await email.fill(EMAIL.toUpperCase());
  await otherForm.getByLabel('Contraseña', { exact: true }).fill('otra frase larga distinta');
  await otherForm.getByRole('checkbox', { name: /años o más/ }).check();
  await otherForm.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(email).toBeFocused();
  await expect(email).toHaveAccessibleDescription(/^Ese email ya tiene una cuenta\./);
  await checks.expectClean();
  await otherChecks.expectClean();
});
