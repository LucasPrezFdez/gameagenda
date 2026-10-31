// Todas las cadenas de la interfaz (español de España; ver §9.9): tuteo, frases cortas,
// pretérito perfecto, sin exclamaciones y teclas con su nombre español.
import { formatCount } from '@gameagenda/core';
import type { DateField, Flag, Platform, Status } from '../agenda/types.ts';
import type { SettingsSection } from '../router/routes.ts';
import type {
  ListOrder,
  ListView,
  PurchaseFilter,
  SectionId,
} from '../screens/my-list/list-model.ts';

const percent = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 });

const statusLabels: Readonly<Record<Status, string>> = {
  want_to_play: 'Quiero jugar',
  playing: 'Jugando',
  on_hold: 'En pausa',
  completed: 'Completado',
  dropped: 'Abandonado',
};

const flagLabels: Readonly<Record<Flag, string>> = {
  owned: 'Comprado',
  platinum: 'Platinado',
  next: 'Próximo',
};

export const es = {
  appName: 'GameAgenda',
  documentTitle: (screen: string) => `${screen} · GameAgenda`,

  shell: {
    skipToContent: 'Saltar al contenido',
    mainNav: 'Principal',
    more: 'Más opciones',
    undoLast: 'Deshacer último cambio',
    capture: 'Apuntar un juego',
  },

  nav: { list: 'Mi lista', catalog: 'Catálogo', settings: 'Ajustes' },

  status: statusLabels,
  flag: flagLabels,
  /** Nombre accesible del selector de estado: empieza por el texto visible (WCAG 2.5.3). */
  changeStatus: (status: Status, title: string) =>
    `${statusLabels[status]}: cambiar estado de ${title}`,
  toggleFlag: (flag: Flag, title: string) => `${flagLabels[flag]}: ${title}`,

  platform: {
    pc: 'PC',
    steam_deck: 'Steam Deck',
    ps5: 'PS5',
    ps4: 'PS4',
    xbox_series: 'Xbox Series',
    xbox_one: 'Xbox One',
    switch_2: 'Switch 2',
    switch: 'Switch',
    mobile: 'Móvil',
    other: 'Otra',
  } satisfies Record<Platform, string>,

  palette: {
    label: 'Apunta un juego',
    placeholder: 'Apunta un juego…',
    shortcut: 'Ctrl+K',
    close: 'Cerrar la paleta',
    clear: 'Borrar el texto',
    escKey: 'Esc',
    results: 'Resultados',
    inList: (status: Status) => `En tu lista: ${statusLabels[status]}`,
    enterToCapture: 'Intro: Apuntar',
    enterToOpen: 'Intro: Ver ficha',
    suggestions: '¿Quizás buscabas…?',
    suggestionsHint: '¿Quizás buscabas…? Elige con ↓',
    chooseResult: 'Elige un resultado',
    manual: (text: string) => `Apuntar «${text}» a mano`,
    seeInCatalog: 'Ver más resultados en el Catálogo',
    keepCapturing: 'Seguir apuntando',
    openSheet: (title: string) => `Ficha de ${title}`,
    noResults: (text: string) => `No hemos encontrado «${text}» en Steam.`,
    emptyHint: 'Escribe el nombre de un juego y pulsa Intro.',
    keysHint:
      'Intro: apuntar · Ctrl+Intro: apuntar y seguir · Alt+Intro: otro estado o marcas · Mayús+Intro: ficha',
    alreadyInList: (title: string, status: Status) =>
      `${title} ya está en tu lista: ${statusLabels[status]}.`,
    captureAsTitle: (title: string) => `Apuntar «${title}» como…`,
    captureAsStatus: 'Estado',
    captureAsFlags: 'Marcas',
    captureAsHint: 'Intro: apuntar · Espacio: marcar · Esc: volver',
    manualTitle: 'Apuntar a mano',
    manualField: 'Título',
    manualSubmit: 'Apuntar en Quiero jugar',
    manualHint: 'Si luego llega al catálogo, podrás vincularlo con Steam.',
    manualEmpty: 'Escribe el título del juego.',
    back: 'Volver a los resultados',

    // Pegar un enlace de Steam (RF-04; ver §9.2, «Enlaces»).
    linkCapture: (title: string) => `Apuntar «${title}»`,
    steamGame: (appid: number) => `Juego de Steam ${appid}`,
  },

  catalogState: {
    preparing: (progress: number) =>
      `Preparando el catálogo de Steam… ${percent.format(progress)}. Mientras, buscamos en tu lista.`,
    failed: 'No hemos podido descargar el catálogo de Steam.',
    retry: 'Reintentar',
    meanwhile: 'Mientras, puedes apuntar a mano.',
  },

  toast: {
    region: 'Avisos',
    undo: 'Deshacer',
    undone: 'Hemos deshecho el último cambio.',
    nothingToUndo: 'No hay ningún cambio que deshacer.',
    captured: (status: Status, title: string) => `Apuntado en ${statusLabels[status]}: ${title}`,
    statusChanged: (title: string, status: Status) => `${title} pasa a ${statusLabels[status]}`,
    platinumAuto: 'Platinado. También lo hemos marcado como Completado.',
    flagOn: (flag: Flag, title: string) => `Marcado como ${flagLabels[flag]}: ${title}`,
    flagOff: (flag: Flag, title: string) => `Ya no está marcado como ${flagLabels[flag]}: ${title}`,
    moved: (title: string, position: number, total: number) =>
      `${title}: prioridad ${position} de ${total}`,
    removed: (title: string) => `Quitado de tu lista: ${title}`,
    linked: (title: string) => `Vinculado con Steam: ${title}`,
    updated: (field: 'note' | 'platform' | DateField, title: string) =>
      `Has cambiado ${fieldPhrases[field]} de ${title}`,
    deletedAll: 'Hemos borrado todos tus datos de este dispositivo.',

    // Agenda en Dexie: provisionales (§9.9) y Ajustes › Datos.
    provisional: (title: string) =>
      `Apuntado: «${title}» (provisional). Lo completaremos cuando llegue al catálogo.`,
    exported: (file: string) => `Hemos exportado ${file}.`,
  },

  list: {
    title: 'Mi lista',
    views: 'Vistas',
    view: {
      pending: 'Pendientes',
      upcoming: 'Próximos',
      want_to_play: 'Quiero jugar',
      playing: 'Jugando',
      on_hold: 'En pausa',
      completed: 'Completado',
      dropped: 'Abandonado',
      all: 'Todos',
    } satisfies Record<ListView, string>,
    purchase: 'Compra',
    purchaseOption: {
      any: 'Todos',
      owned: 'Comprados',
      not_owned: 'Por comprar',
    } satisfies Record<PurchaseFilter, string>,
    order: 'Orden',
    orderOption: {
      priority: 'Prioridad',
      added: 'Fecha de apuntado',
      name: 'Nombre',
      release: 'Lanzamiento',
    } satisfies Record<ListOrder, string>,
    filter: 'Filtrar lista',
    filterPlaceholder: 'Filtrar lista…',
    section: {
      playing: 'Jugando ahora',
      next: 'A continuación',
      want_to_play: 'Quiero jugar',
      on_hold: 'En pausa',
      completed: 'Completado',
      dropped: 'Abandonado',
    } satisfies Record<SectionId, string>,
    sectionCount: (label: string, count: number) => `${label} (${count})`,
    show: 'Mostrar',
    hide: 'Ocultar',
    allEntries: 'Juegos',
    empty:
      'Tu agenda está vacía. Apunta el primer juego que quieras jugar: escribe su nombre y pulsa Intro.',
    exploreCatalog: 'Explorar el catálogo',
    noMatches: 'Ningún juego de tu lista cumple estos filtros.',
    clearFilters: 'Quitar los filtros',
    priority: (position: number) => `Prioridad ${position}`,
    rowMenu: (title: string) => `Más acciones: ${title}`,
    start: 'Empezar',
    moveUp: 'Subir',
    moveDown: 'Bajar',
    moveTop: 'Al principio',
    moveBottom: 'Al final',
    openSheet: 'Ver ficha',
    remove: 'Quitar de mi lista',
    loading: 'Cargando tu lista…',

    // Próximos (M2; ver §9.2) y orden por lanzamiento.
    upcoming: {
      recent: 'Ya disponibles',
      week: 'Esta semana',
      later: 'Más adelante',
      tbd: 'Por confirmar',
      loading: 'Buscando las fechas de lanzamiento…',
      empty: 'Ningún juego de tu lista sale pronto ni ha salido en los últimos 14 días.',
    },
    releaseLoading: 'Ordenando por lanzamiento…',
  },

  // Lanzamientos de los *shards* (§7.6 y §9.9).
  release: {
    tbd: 'Por confirmar',
    today: 'Sale hoy',
    outToday: 'Ha salido hoy',
    upcoming: (date: string, when: string) => `Sale el ${date} · ${when}`,
    recent: (date: string, when: string) => `Salió el ${date} · ${when}`,
    quarter: (quarter: number, year: number) =>
      `${['Primer', 'Segundo', 'Tercer', 'Cuarto'][quarter - 1] ?? ''} trimestre de ${year}`,
  },

  catalog: {
    title: 'Catálogo de Steam',
    count: (count: number, formatted: string) => (count === 1 ? '1 juego' : `${formatted} juegos`),
    scope: 'Sin DLC · +18 oculto',
    scopeAdult: 'Sin DLC · +18 visible',
    filter: 'Filtrar el catálogo',
    filterPlaceholder: 'Filtrar el catálogo…',
    capture: (title: string) => `Apuntar ${title}`,
    noMatches: (text: string) => `No hemos encontrado «${text}» en Steam.`,
    loading: 'Cargando el catálogo…',
    // Lista virtual y filtros sobre el Worker de búsqueda (ver §9.1).
    list: 'Juegos del catálogo',
    chips: 'Mostrar',
    chip: {
      all: 'Populares',
      soon: 'Próximamente',
      free: 'Gratis',
      early: 'Acceso anticipado',
    },
    noFilterMatches: 'No hay juegos con este filtro.',
    loadingRow: 'Cargando…',
  },

  game: {
    sheet: 'Ficha',
    close: 'Cerrar',
    back: 'Volver',
    loading: 'Cargando la ficha…',
    notFound: 'No encontramos este juego en el catálogo.',
    backToList: 'Ir a Mi lista',
    free: 'Gratis',
    earlyAccess: 'Acceso anticipado',
    comingSoon: 'Próximamente',
    retired: 'Retirado',
    adult: '+18',
    manual: 'Juego manual',
    provisional: 'Provisional',
    status: 'Estado',
    flags: 'Marcas',
    platform: 'Juego en',
    choose: 'Elegir',
    priority: (position: number, total: number) => `Prioridad ${position} de ${total}`,
    note: 'Nota',
    dates: 'Fechas',
    date: {
      addedAt: 'Apuntado',
      startedAt: 'Empezado',
      completedAt: 'Completado',
      platinumAt: 'Platinado',
      ownedAt: 'Comprado',
    } satisfies Record<DateField, string>,
    datePlaceholder: 'AAAA-MM-DD',
    dateInvalid: 'Escribe una fecha como 2026, 2026-10 o 2026-10-28.',
    viewOnSteam: 'Ver en Steam',
    remove: 'Quitar de mi lista',
    capture: 'Apuntar en Quiero jugar',
    captureAs: 'Apuntar como…',
    linkQuestion: (title: string) => `¿Es «${title}» de Steam?`,
    link: 'Vincular',

    // Ficha completa (M2; CA2.8): datos de los *shards*.
    details: 'Datos de Steam',
    detailsLoading: 'Cargando los datos de Steam…',
    deck: (label: string) => `Steam Deck: ${label}`,
    /** `deck` del *shard*: 0 desconocido, 1 no compatible, 2 jugable, 3 verificado. */
    deckOption: ['Desconocido', 'No compatible', 'Jugable', 'Verificado'] as readonly string[],
    platformName: { windows: 'Windows', mac: 'macOS', linux: 'Linux' },
    reviews: (summary: string) => `Reseñas: ${summary}`,
    /** `review_score` de Steam (1–9), con los nombres de su tienda en español. */
    reviewScore: [
      '',
      'Extremadamente negativas',
      'Muy negativas',
      'Negativas',
      'Mayormente negativas',
      'Variadas',
      'Mayormente positivas',
      'Positivas',
      'Muy positivas',
      'Extremadamente positivas',
    ] as readonly string[],
    reviewsDetail: (summary: string, pct: number, count: number) =>
      `${summary} (${percent.format(pct / 100)} de ${plural(count, 'reseña', 'reseñas')})`,
    fewReviews: (count: number) =>
      count === 0 ? 'Sin reseñas' : plural(count, 'reseña', 'reseñas'),
  },

  settings: {
    title: 'Ajustes',
    sections: 'Secciones de Ajustes',
    section: {
      appearance: 'Apariencia',
      content: 'Contenido',
      keyboard: 'Teclado y gestos',
      data: 'Datos',
      privacy: 'Privacidad',
      about: 'Acerca de',
    } satisfies Record<SettingsSection, string>,
    theme: 'Tema',
    themeOption: { system: 'El del sistema', light: 'Claro', dark: 'Oscuro' },
    adult: 'Mostrar juegos para adultos (+18) en el Catálogo y en la búsqueda',
    adultHint: 'Están ocultos por defecto.',
    slash: 'Abrir la paleta con /',
    slashHint: 'Ctrl+K funciona siempre. Desactívalo si / te molesta al escribir.',
    dataStored: 'Guardado en este dispositivo',
    exportJson: 'Exportar JSON',
    exportCsv: 'Exportar CSV',
    import: 'Importar',
    exportErrors: 'Exportar registro de errores',
    deleteAll: 'Borrar todos mis datos',
    deleteAllHint: 'Borra tu lista y tus ajustes de este dispositivo. No se puede deshacer.',
    deleteConfirmLabel: 'Escribe BORRAR para confirmar',
    deleteConfirmWord: 'BORRAR',
    deleteConfirm: 'Borrar todo',
    cancel: 'Cancelar',

    // Exportar e importar (§7.5): resumen de la importación junto al botón, nunca en un modal.
    importHint: 'JSON de GameAgenda o CSV, hasta 10 MB. Importar une la copia con tu lista.',
    importing: 'Importando…',
    importTooBig: 'Este archivo pasa de 10 MB. No hemos cambiado nada.',
    importSummary: (added: number, changed: number, removed: number, rejected: number) =>
      `Hemos importado la copia: ${plural(added, 'alta', 'altas')}, ${plural(changed, 'cambio', 'cambios')}, ${plural(removed, 'baja', 'bajas')} y ${plural(rejected, 'rechazo', 'rechazos')}.`,
    importSkipped: (count: number) =>
      count === 1
        ? '1 juego ya estaba en tu lista.'
        : `${formatCount(count)} juegos ya estaban en tu lista.`,
    deleting: 'Borrando…',

    // Catálogo (M2): su edad y «Actualizar catálogo» (§9.1, §15.5).
    catalogTitle: 'Catálogo de Steam',
    catalogVersion: (version: string, date: string, ago: string) =>
      `Versión ${version}, del ${date} (${ago}).`,
    catalogNone: 'Aún no hay catálogo en este dispositivo.',
    catalogEnrichment: (days: number) =>
      days === 1
        ? 'Fechas, reseñas y portadas: de hace 1 día.'
        : `Fechas, reseñas y portadas: de hace ${formatCount(days)} días.`,
    catalogRefresh: 'Actualizar catálogo',
    catalogRefreshing: 'Buscando una versión nueva…',
    catalogUpToDate: 'Ya tienes la última versión del catálogo.',
    catalogUpdated: (version: string) => `Hemos descargado el catálogo ${version}.`,
    catalogRefreshFailed: 'No hemos podido comprobar el catálogo. Inténtalo más tarde.',
  },

  // Ajustes › Privacidad (M2; §11.1 y §11.2).
  privacy: {
    covers: 'Portadas',
    loadCovers: 'Cargar portadas',
    loadCoversHint:
      'Las portadas se cargan desde servidores de Valve en EE. UU., que reciben tu dirección IP. Sin ellas, cada juego lleva una portada con sus iniciales.',
    coversKilled: 'Ahora mismo las portadas están desactivadas para todos.',
    steamData: 'Datos de Steam que guardamos',
    what: 'Qué: el catálogo público de Steam (nombres, fechas de lanzamiento, reseñas, plataformas, compatibilidad con Steam Deck y las rutas de las portadas). No guardamos nada de tu cuenta de Steam.',
    where:
      'Dónde: en este dispositivo, en la caché del navegador. El catálogo se publica en la red global de Cloudflare, y GitHub, en EE. UU., guarda el estado del proceso que lo actualiza, sin datos personales.',
    ip: 'Portadas: tu navegador las pide a los servidores de Valve en EE. UU. (shared.akamai.steamstatic.com), que reciben tu dirección IP. Van sin cookies ni página de origen, y nunca las copiamos en un servidor propio.',
    agenda: 'Tu lista y tus ajustes se quedan en este dispositivo.',
    browserCache:
      'Las portadas que guarda la caché de tu navegador se borran desde los ajustes del navegador.',
    delete: 'Borrar los datos de Steam de este dispositivo',
    deleting: 'Borrando…',
    deleted:
      'Hemos borrado los datos de Steam de este dispositivo. El catálogo se volverá a descargar la próxima vez que abras GameAgenda.',
  },

  // Aviso de primera capa de las portadas (§9.9 y §11.2).
  coverNotice: {
    label: 'Aviso sobre las portadas',
    text: 'Las portadas se cargan desde servidores de Valve en EE. UU., que reciben tu dirección IP.',
    moreInfo: 'Más información',
    ok: 'Entendido',
    disable: 'Desactivar portadas',
  },

  about: {
    version: (version: string, sha: string) => `Versión ${version} (${sha})`,
    description:
      'Tu agenda de videojuegos: apunta en segundos los juegos que quieres jugar y lleva su estado.',
    trademark:
      'Steam y el logotipo de Steam son marcas comerciales o registradas de Valve Corporation en EE. UU. y otros países. GameAgenda no está afiliada a Valve ni cuenta con su respaldo.',
  },

  notices: {
    offline: 'Sin conexión. Puedes seguir apuntando: tus cambios se guardan en este dispositivo.',
    ios: 'Safari puede borrar tus datos si lo usas 7 días sin abrir GameAgenda. Añádela a la pantalla de inicio o exporta una copia.',
    iosHow: 'Cómo añadirla',
    iosSteps: 'En Safari, toca Compartir y después «Añadir a pantalla de inicio».',
    export: 'Exportar',
    dismiss: 'Ocultar este aviso',
    copyNever:
      'Aún no has guardado ninguna copia de tu lista. Exporta una por si este navegador borra los datos de GameAgenda.',
    copyOld: (days: number) =>
      `Tu última copia de la lista es de hace ${days} días. Exporta otra por si este navegador borra los datos de GameAgenda.`,
    later: 'Ahora no',
    storageFailed:
      'No hemos podido guardar en este dispositivo. Exporta tu lista para no perderla.',
    importInvalid: 'Este archivo no es una copia válida de GameAgenda. No hemos cambiado nada.',
    retry: 'Reintentar',
    chooseOther: 'Elegir otro',
  },

  errors: {
    screen: 'No hemos podido mostrar esta pantalla. Recarga la página para seguir.',
    reload: 'Recargar',
  },

  notFound: {
    title: 'No encontramos esta página',
    body: 'Puede que el enlace esté mal escrito o que la página ya no exista.',
  },
} as const;

/** «1 alta», «3 altas», «12 000 altas» (millares con espacio fino desde cinco cifras). */
function plural(count: number, one: string, many: string): string {
  return `${formatCount(count)} ${count === 1 ? one : many}`;
}

const fieldPhrases: Readonly<Record<'note' | 'platform' | DateField, string>> = {
  note: 'la nota',
  platform: '«Juego en»',
  addedAt: 'la fecha de apuntado',
  startedAt: 'la fecha de inicio',
  completedAt: 'la fecha de completado',
  platinumAt: 'la fecha de platinado',
  ownedAt: 'la fecha de compra',
};
