// Los textos de «Importar desde Steam» (Fase 2, parte 2; §10 y §9.9; ADR-012), en Ajustes › Datos.
// Van aquí y no en `i18n/es.ts`, que está en el JS inicial: como los textos legales, solo los
// descarga quien abre la importación. En esta parte solo se trae y se resume: revisar y aplicar es
// la parte 3.

import { formatCount } from '@gameagenda/core';

/** «1 juego», «287 juegos», «12 000 juegos» (millares con espacio fino desde cinco cifras). */
function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

export const steamTexts = {
  title: 'Importar desde Steam',
  intro:
    'Trae los juegos de tu biblioteca de Steam, con sus horas, y tu lista de deseados. Inicias sesión en Steam, no aquí: GameAgenda no ve tu contraseña.',
  start: 'Importar desde Steam',
  starting: 'Preparando el inicio de sesión…',
  // El nombre accesible del botón oficial de Steam (la imagen dice «Sign in through Steam»).
  signIn: 'Iniciar sesión con Steam',
  signInHint: 'Steam se abre en otra ventana. Cuando hayas iniciado sesión, vuelve aquí.',
  waiting: 'Inicia sesión en Steam en la otra ventana. Cuando termines, vuelve aquí.',
  continue: 'Ya he iniciado sesión',
  stillPending: 'Aún no has terminado de iniciar sesión en Steam.',
  loading: 'Trayendo tu biblioteca de Steam…',
  summary: (owned: number, wishlist: number | null) =>
    wishlist === null
      ? `Hemos encontrado ${plural(owned, 'juego', 'juegos')} en tu biblioteca. No hemos podido traer tu lista de deseados.`
      : `Hemos encontrado ${plural(owned, 'juego', 'juegos')} en tu biblioteca y ${wishlist === 0 ? 'ningún deseado' : plural(wishlist, 'deseado', 'deseados')}.`,
  empty: (wishlist: number | null) =>
    wishlist === null || wishlist === 0
      ? 'Tu biblioteca de Steam no tiene juegos.'
      : `Tu biblioteca de Steam no tiene juegos, y en tu lista de deseados hay ${formatCount(wishlist)}.`,
  noChanges: 'De momento no hemos cambiado nada de tu lista.',
  hiddenGames: 'Los juegos que hayas marcado como privados en Steam no aparecen.',
  private: 'Tu biblioteca de Steam es privada, así que Steam no nos deja verla.',
  privateGuide:
    'En Steam, abre tu perfil › Editar perfil › Configuración de privacidad y pon «Detalles de juegos» en Público. Después, vuelve a empezar.',
  privacySettings: 'Abrir la privacidad de Steam',
  expired: 'El inicio de sesión ha caducado o se ha cancelado.',
  offline: 'No hay conexión. Conéctate y vuelve a intentarlo.',
  unavailable: 'Steam no ha respondido. Vuelve a intentarlo dentro de un rato.',
  busy: 'Hoy ya no se puede importar más. Vuelve a intentarlo mañana.',
  disabled: 'La importación de Steam no está disponible ahora mismo.',
  rateLimited: 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.',
  retry: 'Reintentar',
  restart: 'Volver a empezar',
  cancel: 'Cancelar',
} as const;
