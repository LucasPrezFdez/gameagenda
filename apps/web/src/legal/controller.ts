// El responsable del tratamiento (art. 13 RGPD y art. 11 LOPDGDD) y titular del sitio (art. 10
// LSSI), en un solo sitio: lo usan la política de privacidad, el aviso legal y la primera capa de
// Ajustes › Sincronización (CA4.7; §11.2).
//
// PENDIENTE (lo decide el usuario): el nombre o alias y el correo de contacto. Mientras falten, los
// textos dicen «pendiente» y `scripts/legal-guard.test.ts` no deja encender la micro-API
// (`SYNC_ENABLED` a "1" en `apps/web/wrangler.jsonc`).
//
// No importa nada: es lo único que comparten el *chunk* de Ajustes y el de los textos legales. Si
// importara algo del *chunk* inicial (el *router*, por ejemplo), Rolldown partiría el inicial en
// varios ficheros (medido el 08-11-2026: de 1 a 3, con 1,5 KB brotli más).

export interface Controller {
  /** Nombre o alias de quien responde de GameAgenda; `null` mientras no se haya decidido. */
  readonly name: string | null;
  /** Correo para ejercer los derechos y para cualquier consulta; `null` mientras tanto. */
  readonly email: string | null;
}

export const CONTROLLER: Controller = { name: null, email: null };

/** Las rutas de los textos (las mismas que `LEGAL_PATHS` de `router/routes.ts`; lo comprueba una prueba). */
export const PRIVACY_PATH = '/privacidad';
export const NOTICE_PATH = '/aviso-legal';

/** Un trozo de texto, o un enlace (una ruta de la app, `https:` o `mailto:`). */
export type Inline = string | { readonly text: string; readonly href: string };

export const link = (text: string, href: string): Inline => ({ text, href });

const PENDING_NAME = '[pendiente: nombre o alias del responsable]';
const PENDING_EMAIL = '[pendiente: correo de contacto]';

/** `true` si ya se puede publicar: con nombre y correo. */
export function controllerReady(controller: Controller = CONTROLLER): boolean {
  return (
    controller.name !== null &&
    controller.name.trim() !== '' &&
    controller.email !== null &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(controller.email)
  );
}

/** El nombre del responsable, o el aviso de que falta. */
export function controllerName(c: Controller = CONTROLLER): string {
  return c.name?.trim() || PENDING_NAME;
}

/** El correo del responsable como enlace `mailto:`, o el aviso de que falta. */
export function controllerEmail(c: Controller = CONTROLLER): Inline {
  return c.email === null ? PENDING_EMAIL : link(c.email, `mailto:${c.email}`);
}
