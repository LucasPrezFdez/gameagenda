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
    not_started: (count: number) => `${formatCount(count)} a Sin empezar (no los has jugado)`,
    completed: (count: number) =>
      `${formatCount(count)} a Completado, con Platinado (tienen todos los logros)`,
    software: (count: number) => `${formatCount(count)} a Software (son programas, no juegos)`,
  },
  reviewMarked: (count: number) =>
    count === 1
      ? 'Uno que ya tenías se marcará como Comprado.'
      : `${formatCount(count)} que ya tenías se marcarán como Comprados.`,
  reviewToSoftware: (count: number) =>
    count === 1
      ? 'Uno que ya tenías es un programa, no un juego: pasará a Software.'
      : `${formatCount(count)} que ya tenías son programas, no juegos: pasarán a Software.`,
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
  reviewRemoved: (count: number) =>
    count === 1
      ? 'Uno que quitaste de tu lista no se vuelve a añadir.'
      : `${formatCount(count)} que quitaste de tu lista no se vuelven a añadir.`,

  // Steam vinculado (ADR-014): la biblioteca se pone al día sola, sin volver a iniciar sesión.
  linkLabel: 'Vincular a mi cuenta y actualizar sola cada día',
  linkHint:
    'Guardamos el identificador de tu cuenta de Steam con tu agenda sincronizada. Cada día, al abrir la app, traemos los juegos nuevos y los platinados. Puedes desvincularla cuando quieras.',
  linked: 'Tu cuenta de Steam ha quedado vinculada: tu lista se pondrá al día sola cada día.',
  /** El aviso de la actualización diaria, con «Deshacer». */
  autoApplied: (counts: SteamImportCounts) => {
    const added = Object.values(counts.added).reduce((a, b) => a + b, 0) + counts.wishes;
    const platinum = counts.platinum - counts.added.completed;
    const parts = [];
    if (added > 0) parts.push(plural(added, 'juego nuevo', 'juegos nuevos'));
    if (platinum > 0) parts.push(plural(platinum, 'platinado', 'platinados'));
    if (counts.toSoftware > 0) parts.push(`${formatCount(counts.toSoftware)} a Software`);
    if (counts.markedOwned > 0) {
      parts.push(plural(counts.markedOwned, 'comprado', 'comprados'));
    }
    return `Actualizado desde Steam: ${parts.join(', ')}.`;
  },

  // Ajustes › Cuenta y sincronización › Tu cuenta: el vínculo con Steam.
  linkTitle: 'Steam',
  linkedSince: (date: string) => `Tu cuenta de Steam está vinculada desde el ${date}.`,
  lastRefresh: (when: string) => `Última actualización: ${when}.`,
  neverRefreshed: 'Aún no se ha actualizado.',
  notLinked:
    'Vincula tu cuenta de Steam para que tu lista se ponga al día sola: «Importar desde Steam», en Ajustes › Datos.',
  goImport: 'Ir a Importar desde Steam',
  autoLabel: 'Actualizar sola cada día, al abrir la app en este dispositivo',
  refreshNow: 'Actualizar ahora',
  refreshing: 'Trayendo tu biblioteca de Steam…',
  refreshTooSoon: 'Ya se ha actualizado hace poco. Vuelve a intentarlo mañana.',
  refreshNothing: 'Tu lista ya estaba al día con Steam.',
  refreshPrivate: 'Tu biblioteca de Steam es privada, así que Steam no nos deja verla.',
  refreshFailed: 'Steam no ha respondido. Vuelve a intentarlo dentro de un rato.',
  unlinkTitle: 'Desvincular Steam',
  unlinkIntro:
    'Dejaremos de guardar tu cuenta de Steam y tu lista ya no se pondrá al día sola. Lo que ya está en tu lista se queda.',
  unlinkConfirm: '¿Desvincular tu cuenta de Steam?',
  unlinkDo: 'Desvincular',
  unlinking: 'Desvinculando…',
  unlinked: 'Hemos desvinculado tu cuenta de Steam.',
} as const;
