// Los textos de «Importar desde Steam» (Fase 2, partes 2 y 3; §10 y §9.9; ADR-012), en Ajustes ›
// Datos. Van aquí y no en `i18n/es.ts`, que está en el JS inicial: como los textos legales, solo los
// descarga quien abre la importación.

import { formatCount } from '@gameagenda/core';
import type { SteamImportCounts } from '@gameagenda/core/entries';

/** «1 juego», «287 juegos», «12 000 juegos» (millares con espacio fino desde cinco cifras). */
function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

export const steamTexts = {
  title: 'Importar desde Steam',
  /** Lo que no está en el catálogo ni trae nombre de Steam (como `es.palette.steamGame`). */
  steamGame: (appid: number) => `Juego de Steam ${appid}`,
  intro:
    'Trae los juegos de tu biblioteca de Steam y los apunta como Comprados, con Platinado si tienen todos los logros. Antes de cambiar nada, te enseña un resumen. Inicias sesión en Steam, no aquí: GameAgenda no ve tu contraseña.',
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
  // Parte 3: los logros, el resumen, aplicar y deshacer.
  checking: (done: number, total: number) =>
    total === 0
      ? 'Preparando el resumen…'
      : `Comprobando los logros: ${formatCount(done)} de ${formatCount(total)} juegos…`,
  reviewAdded: (count: number) =>
    `Se añadirán ${plural(count, 'juego', 'juegos')} de tu biblioteca, como Comprados:`,
  reviewStatus: {
    playing: (count: number) => `${formatCount(count)} a Jugando`,
    on_hold: (count: number) => `${formatCount(count)} a En pausa`,
    want_to_play: (count: number) => `${formatCount(count)} a Quiero jugar`,
    completed: (count: number) =>
      `${formatCount(count)} a Completado, con Platinado (tienen todos los logros)`,
  },
  reviewMarked: (count: number) =>
    count === 1
      ? 'Uno que ya tenías se marcará como Comprado.'
      : `${formatCount(count)} que ya tenías se marcarán como Comprados.`,
  reviewPlatinum: (count: number) =>
    count === 1
      ? 'Uno que ya tenías tiene todos los logros: se marcará como Platinado (y Completado).'
      : `${formatCount(count)} que ya tenías tienen todos los logros: se marcarán como Platinados (y Completados).`,
  reviewWishes: (count: number) =>
    `Y ${plural(count, 'deseado', 'deseados')} de tu lista de deseados, a Quiero jugar.`,
  reviewUnchanged: (count: number) =>
    count === 1 ? 'Uno ya estaba al día.' : `${formatCount(count)} ya estaban al día.`,
  reviewNothing: 'No hay nada que cambiar: tu lista ya está al día.',
  wishlistLabel: (count: number) =>
    `Añadir también tu lista de deseados a Quiero jugar (${plural(count, 'juego', 'juegos')})`,
  unknownAchievements: (count: number) =>
    `De ${plural(count, 'juego', 'juegos')} no hemos podido ver los logros: si alguno está platinado, márcalo a mano.`,
  apply: 'Aplicar',
  applying: (done: number, total: number) =>
    `Añadiendo a tu lista: ${formatCount(done)} de ${formatCount(total)}…`,
  applied: (counts: SteamImportCounts) => {
    const added = Object.values(counts.added).reduce((a, b) => a + b, 0) + counts.wishes;
    const parts = [];
    if (added > 0) parts.push(`${plural(added, 'juego añadido', 'juegos añadidos')} a tu lista`);
    if (counts.markedOwned > 0) {
      parts.push(plural(counts.markedOwned, 'marcado como Comprado', 'marcados como Comprados'));
    }
    return parts.length === 0
      ? 'Hecho: tu lista ya estaba al día.'
      : `Hecho: ${parts.join(' y ')}.`;
  },
  undo: 'Deshacer',
  undone: 'Importación deshecha: tu lista está como antes.',
  finish: 'Listo',
  unsaved: 'No se ha podido guardar en este dispositivo. Vuelve a intentarlo.',
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
