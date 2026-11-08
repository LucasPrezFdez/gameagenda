// La primera capa de los textos legales (art. 11 LOPDGDD; M4; CA4.7), junto a «Activar
// sincronización», «Emparejar» y el código de recuperación: quién, para qué, dónde y qué derechos,
// con el enlace a la política completa. Solo la usa Ajustes, sin descargar la política entera
// (`texts.ts`, en el *chunk* de su pantalla).
import {
  CONTROLLER,
  type Controller,
  controllerName,
  type Inline,
  link,
  PRIVACY_PATH,
} from './controller.ts';

export function syncFirstLayer(c: Controller = CONTROLLER): readonly Inline[] {
  return [
    `Responsable: ${controllerName(c)}. Para qué: tener tu agenda en tus dispositivos y una copia fuera de ellos, porque tú lo pides al activarla. Se guarda en servidores de Cloudflare en la Unión Europea. Puedes acceder a tus datos, corregirlos, llevártelos y borrarlos desde la app. Más información en la `,
    link('política de privacidad', PRIVACY_PATH),
    '.',
  ];
}
