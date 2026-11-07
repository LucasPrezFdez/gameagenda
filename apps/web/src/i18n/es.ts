// Todas las cadenas de la interfaz (español de España; ver §9.9): tuteo, frases cortas,
// pretérito perfecto, sin exclamaciones y teclas con su nombre español.
import { formatCount } from '@gameagenda/core';
import type { DateField, Flag, Platform, Status } from '../agenda/types.ts';
import type { PanelMetric } from '../perf/samples.ts';
import type { SettingsSection } from '../router/routes.ts';
import type {
  ListOrder,
  ListView,
  PurchaseFilter,
  SectionId,
} from '../screens/my-list/list-model.ts';
import type { ShortcutText } from '../shortcuts/keymap.ts';

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
    shortcuts: 'Atajos de teclado',
    capture: 'Apuntar un juego',
    /** El botón que encoge y despliega la barra lateral (en el PC). */
    sidebar: 'Barra lateral',
    collapseSidebar: 'Encoger la barra lateral',
    expandSidebar: 'Desplegar la barra lateral',
  },

  nav: { list: 'Mi lista', catalog: 'Catálogo', settings: 'Ajustes' },

  /** Lo que llena la barra lateral del PC (DECISIONES §10.33). */
  sidebar: {
    views: 'Vistas',
    catalog: (count: string) => `Catálogo: ${count} juegos`,
    catalogLoading: 'Cargando el catálogo…',
    catalogError: 'Catálogo sin cargar',
  },

  /** Ayuda de atajos (`?`; §9.4). */
  shortcuts: {
    title: 'Atajos de teclado',
    close: 'Cerrar',
    intro: 'Las teclas sueltas no actúan mientras escribes en un campo ni con un menú abierto.',
    off: 'Los atajos de una tecla están desactivados: solo funcionan los que llevan Ctrl o Alt.',
    settings: 'Cambiarlo en Ajustes',
    sequence: 'luego',
    or: 'o',
    statusTo: (status: Status) => `Pasar a ${statusLabels[status]}`,
    flagToggle: (flag: Flag) => `Marcar o desmarcar ${flagLabels[flag]}`,
    text: {
      global: 'En toda la app',
      palette: 'Abrir la paleta',
      paletteGroup: 'En la paleta',
      undo: 'Deshacer el último cambio',
      close: 'Cerrar la paleta, un menú o la ficha',
      help: 'Ver estos atajos',
      goList: 'Ir a Mi lista',
      goCatalog: 'Ir al Catálogo',
      goSettings: 'Ir a Ajustes',
      filter: 'Filtrar Mi lista o el Catálogo',
      choose: 'Elegir un resultado',
      capture: 'Apuntar en Quiero jugar',
      captureAndStay: 'Apuntar y seguir buscando',
      captureAs: 'Apuntar con estado y marcas',
      openSheet: 'Abrir la ficha',
      rows: 'En las filas y en la ficha',
      move: 'Fila siguiente o anterior (en la ficha, el juego siguiente o el anterior)',
      captureRow: 'Apuntar la fila (Catálogo)',
      note: 'Escribir una nota',
      remove: 'Quitar de mi lista (con Deshacer)',
      priority: 'Subir o bajar la prioridad',
      steam: 'Ver en Steam',
      pasteLink: 'Apuntar el enlace de Steam copiado (fuera de los campos de texto)',
    } satisfies Record<ShortcutText, string>,
  },

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
    // Chip «Pegar enlace» (M3; RF-07).
    pasteLink: 'Pegar enlace',
    noLinkInClipboard: 'No hay ningún enlace de Steam en el portapapeles.',
    clipboardDenied:
      'No hemos podido leer el portapapeles. Mantén pulsado el campo, elige Pegar y pulsa Intro.',
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
    /** Estado `boot` (M3): la paleta busca en el núcleo de arranque (§8.8). */
    boot: `De momento buscamos en los ${formatCount(20_000)} juegos más populares; el catálogo completo está llegando.`,
    // `status.error` con o sin catálogo en uso (§8.7): si lo hay, se sigue buscando en él.
    /** `browser-too-old`: el navegador no tiene Ed25519 en WebCrypto (RNF-12). */
    browserTooOld:
      'Actualiza el navegador para recibir el catálogo de Steam al día: este no puede comprobar su firma.',
    /** `signature`: el *manifest* nuevo no lleva una firma válida (§11.3; CA2.3). */
    signatureRejected:
      'El catálogo de Steam nuevo no ha pasado la comprobación de seguridad. Lo volveremos a intentar más tarde.',
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

  // Gestos de M3 (§9.4): lo que se lee detrás de la fila al deslizarla.
  gestures: {
    advance: (from: Status) =>
      from === 'playing' ? 'Completar' : from === 'on_hold' ? 'Retomar' : 'Empezar',
    flags: 'Marcas',
    tray: (title: string) => `Marcas: ${title}`,
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
    // M4 (CA4.3): con IndexedDB borrada y el dispositivo aún emparejado, la agenda vuelve sola.
    restoring:
      'Estamos trayendo tu agenda sincronizada. Tus juegos aparecerán aquí en unos segundos.',
    restoringOffline:
      'Tu agenda sincronizada llegará en cuanto haya conexión. Mientras, puedes seguir apuntando.',
    restoringFailed:
      'No hemos podido traer tu agenda sincronizada. Lo seguiremos intentando; mientras, puedes seguir apuntando.',
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
    // Asa `::` (M3; ver §9.4): solo para el ratón y el dedo; el teclado tiene Alt+↑/↓.
    dragHandle: 'Arrastra para cambiar la prioridad',
    reorderHint: 'Arrastra :: o usa Alt+↑/↓',
    reorderHintTouch: 'Arrastra :: para ordenar',
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
      sync: 'Sincronización',
      performance: 'Rendimiento',
      about: 'Acerca de',
    } satisfies Record<SettingsSection, string>,
    theme: 'Tema',
    themeOption: { system: 'El del sistema', light: 'Claro', dark: 'Oscuro' },
    adult: 'Mostrar juegos para adultos (+18) en el Catálogo y en la búsqueda',
    adultHint: 'Están ocultos por defecto.',
    slash: 'Abrir la paleta con /',
    slashHint: 'Ctrl+K funciona siempre. Desactívalo si / te molesta al escribir.',
    singleKeys: 'Atajos de una tecla',
    singleKeysHint:
      '?, G luego L, C o A, J, K, 1–5, C, P, A, N, Supr, V, F y +. Desactívalos si los pulsas sin querer o usas el dictado o un programa de voz. Ctrl+K, Ctrl+Z, Esc y Alt+↑/↓ siguen funcionando.',
    showShortcuts: 'Ver los atajos de teclado',
    touchGestures: 'Gestos táctiles',
    touchGesturesHint:
      'En Mi lista, desliza un juego a la derecha para avanzar su estado y a la izquierda para ver sus marcas, o mantenlo pulsado para cambiar el estado. En la paleta, mantén pulsado un resultado para apuntarlo con otro estado, y desliza hacia abajo para cerrarla. Cada gesto tiene su botón; arrastrar :: funciona siempre.',
    dataStored: 'Guardado en este dispositivo',
    exportJson: 'Exportar JSON',
    exportCsv: 'Exportar CSV',
    import: 'Importar',
    exportErrors: 'Exportar registro de errores',
    deleteAll: 'Borrar todos mis datos',
    deleteAllHint: 'Borra tu lista y tus ajustes de este dispositivo. No se puede deshacer.',
    // M4: con la sincronización activada, también se borra la agenda del servidor (CA4.7).
    deleteAllHintSynced:
      'Borra tu lista y tus ajustes de este dispositivo, y tu agenda sincronizada del servidor. Tus otros dispositivos dejarán de sincronizar, pero conservarán su lista. No se puede deshacer.',
    deleteAllHintUnpaired:
      'Borra tu lista y tus ajustes de este dispositivo. Como ya no está emparejado, tu agenda sincronizada no se borra: recupérala antes con tu código en Ajustes › Sincronización, o bórrala desde otro dispositivo emparejado. No se puede deshacer.',
    deleteServerOffline:
      'No hay conexión y no podemos borrar tu agenda sincronizada, así que no hemos borrado nada. Vuelve a intentarlo cuando tengas conexión.',
    deleteServerDisabled:
      'La sincronización no está disponible ahora mismo y no podemos borrar tu agenda sincronizada, así que no hemos borrado nada. Vuelve a intentarlo más tarde.',
    deleteServerFailed:
      'No hemos podido borrar tu agenda sincronizada, así que no hemos borrado nada. Vuelve a intentarlo dentro de un rato.',
    deletedAllSynced:
      'Hemos borrado todos tus datos de este dispositivo y tu agenda sincronizada del servidor.',
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

  // Panel de rendimiento (Ajustes › Rendimiento, M3; §12.7).
  perfPanel: {
    intro:
      'Las medidas de este dispositivo: las 500 últimas de cada una, guardadas solo aquí. No se envía nada; para compartirlas, copia el informe.',
    since: (date: string) => `Desde el ${date}.`,
    empty: 'Aún no hay medidas. Busca y apunta algunos juegos y vuelve aquí.',
    table: 'Medidas de rendimiento',
    metric: 'Medida',
    samples: 'Muestras',
    target: 'Objetivo',
    result: 'Resultado',
    pass: 'Cumple',
    fail: 'No cumple',
    none: '—',
    targetText: (stat: string, limit: string) => `${stat} ≤ ${limit}`,
    metrics: {
      'search:keystroke-to-results': 'Tecla → resultados',
      'ui:feedback': 'Toque o tecla → respuesta',
      'capture:palette-to-confirm': 'Apuntar: abrir la paleta → confirmación',
      inp: 'INP (respuesta a cada interacción)',
      lcp: 'LCP (pintado principal al abrir)',
      'app:list-visible': 'Abrir → Mi lista visible',
      'search:ready': 'Abrir → se puede buscar',
      'search:boot': 'Búsqueda lista en la primera visita',
      'search:full': 'Abrir → índice completo',
      'search:index-restored': 'Restaurar el índice guardado',
    } satisfies Record<PanelMetric, string>,
    noEventTiming: 'Este navegador no mide el INP (no tiene Event Timing).',
    device: 'Este dispositivo',
    app: 'App',
    browser: 'Navegador',
    catalog: 'Catálogo',
    catalogNone: 'Aún no hay catálogo',
    search: 'Búsqueda',
    searchState: {
      none: 'Preparando el catálogo',
      boot: 'Buscando en los más populares',
      scan: 'Buscando mientras se construye el índice',
      full: 'Índice completo',
    },
    restored: (ms: string) => `restaurado del dispositivo en ${ms}`,
    built: 'construido en este arranque',
    persisted: 'Datos persistentes',
    persistedYes: 'Sí: el navegador no los borrará para hacer sitio',
    persistedNo: 'No: el navegador puede borrarlos si le falta espacio',
    unknown: 'No se sabe',
    storage: 'Espacio usado',
    storageUsed: (used: string, quota: string) => `${used} de ${quota}`,
    copy: 'Copiar informe',
    copied: 'Hemos copiado el informe.',
    copyFailed: 'No hemos podido copiarlo. Selecciona el texto de abajo y cópialo.',
    report: 'Informe',
    clear: 'Borrar las medidas',
    cleared: 'Hemos borrado las medidas.',
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

  /** Sincronización (M4): el aviso de la §9.6 y el nombre del dispositivo por defecto. */
  sync: {
    failed: (count: number) =>
      count === 0
        ? 'No hemos podido sincronizar. Lo seguiremos intentando.'
        : `No hemos podido sincronizar ${plural(count, 'cambio', 'cambios')}. Lo seguiremos intentando.`,
    retryNow: 'Reintentar ahora',
    /** «Chrome en Windows». */
    deviceLabel: (browser: string, system: string) => `${browser} en ${system}`,
    unknownBrowser: 'Navegador',
    unknownSystem: 'otro sistema',
  },

  /** Ajustes › Sincronización (M4; §9.1, §11.2 y §11.4). */
  syncPanel: {
    loading: 'Cargando el estado de la sincronización…',
    // Sin sincronizar. La cookie la crea el gesto de activar o emparejar, y se avisa aquí (§11.2).
    intro:
      'Ten la misma agenda en el móvil y en el PC, con una copia fuera de este dispositivo. Se sincroniza sola, también cuando vuelve la conexión.',
    stored:
      'Guardamos tu agenda (juegos, estados, marcas, fechas y notas) y el nombre de cada dispositivo en servidores de Cloudflare en la Unión Europea. No pedimos email, nombre ni contraseña.',
    cookie:
      'Al activar o emparejar, este dispositivo guarda una cookie que lo identifica ante el servidor. Solo sirve para sincronizar, y se borra al desemparejarlo.',
    /** Hueco de los textos legales (CA4.7): aquí irá el enlace cuando se publiquen. */
    legal:
      'Política de privacidad y condiciones: las publicaremos antes de abrir la sincronización.',
    deviceName: 'Nombre de este dispositivo',
    deviceNameHint: 'Así lo reconocerás en la lista de dispositivos.',
    deviceNameMissing: 'Escribe un nombre para este dispositivo.',
    /** Nombre por defecto en la app de escritorio (Tauri, ADR-010). */
    desktopLabel: 'App de escritorio',
    activateTitle: 'Empezar a sincronizar',
    age: (age: number) => `Tengo ${age} años o más`,
    ageMissing: (age: number) =>
      `Para sincronizar tienes que tener ${age} años o más. Si es tu caso, marca la casilla.`,
    activate: 'Activar sincronización',
    activating: 'Activando…',
    joinTitle: 'Ya sincronizo en otro dispositivo',
    joinIntro:
      'En el otro dispositivo, abre Ajustes › Sincronización y pulsa «Emparejar otro dispositivo». Escribe aquí el código que te dé, o tu código de recuperación.',
    code: 'Código',
    codeHint: '28 letras y números, con guiones o sin ellos.',
    codeInvalid:
      'Este código está incompleto o tiene caracteres que no valen. Revisa que tenga 28 letras y números.',
    pairThis: 'Emparejar este dispositivo',
    useRecovery: 'Usar código de recuperación',
    joining: 'Uniendo este dispositivo a tu agenda…',
    fromLink:
      'Has abierto un enlace para emparejar. Pulsa «Emparejar este dispositivo» para unirlo a tu agenda.',
    fromLinkPaired: 'Este dispositivo ya sincroniza: no necesita el código del enlace.',
    joined: 'Este dispositivo ya está emparejado. Estamos trayendo tu agenda.',

    // El código de recuperación se muestra una sola vez (§11.4).
    recoveryTitle: 'Tu código de recuperación',
    recoveryWhy:
      'Si borras los datos del navegador o pierdes este dispositivo, con este código recuperas tu agenda en cualquier otro.',
    recoveryOnce:
      'Solo lo verás ahora. Guárdalo en un sitio seguro, como un gestor de contraseñas, y no lo compartas.',
    recoveryCode: 'Código de recuperación',
    copy: 'Copiar',
    copied: 'Hemos copiado el código.',
    copyFailed: 'No hemos podido copiarlo. Selecciona el código y cópialo a mano.',
    saved: 'Ya lo he guardado',

    // Emparejada: el estado (§9.6) y lo que se puede hacer.
    statusTitle: 'Estado',
    restoring: 'Trayendo tu agenda sincronizada…',
    restoringOffline: 'Sin conexión. Traeremos tu agenda en cuanto vuelva.',
    syncing: 'Sincronizando…',
    synced: (ago: string) => `Sincronizado ${ago}.`,
    justNow: 'hace un momento',
    /** Para el lector de pantalla, sin cuenta que avance: «a las 18:42», «el 3 nov a las 18:42». */
    atTime: (time: string) => `a las ${time}`,
    onDay: (day: string, time: string) => `el ${day} a las ${time}`,
    never: 'Aún no se ha sincronizado.',
    offline: 'Sin conexión. Sincronizaremos en cuanto vuelva.',
    disabled: 'La sincronización no está disponible ahora mismo. Lo intentaremos más tarde.',
    failed:
      'No hemos podido sincronizar. Lo seguiremos intentando; si sigue así, pulsa «Sincronizar ahora» dentro de un rato.',
    failedLater: 'El servidor está muy ocupado. Lo intentaremos de nuevo dentro de un rato.',
    failedStorage:
      'No hemos podido leer o guardar en este dispositivo. Recarga la página para seguir sincronizando.',
    pending: (count: number) =>
      count === 1
        ? '1 juego con cambios sin sincronizar.'
        : `${formatCount(count)} juegos con cambios sin sincronizar.`,
    syncNow: 'Sincronizar ahora',

    pairTitle: 'Emparejar otro dispositivo',
    pairIntro:
      'Abre GameAgenda en el otro dispositivo y ve a Ajustes › Sincronización. Escanea el QR con su cámara, o escribe el código en «Ya sincronizo en otro dispositivo».',
    pairHome:
      'En un iPhone o un iPad con GameAgenda en la pantalla de inicio, ábrela desde ahí y escribe el código: la cámara abriría el enlace en Safari, que guarda sus datos aparte.',
    pairCreate: 'Emparejar otro dispositivo',
    pairCreating: 'Creando un código…',
    pairCode: 'Código de emparejamiento',
    pairQr: 'Código QR para emparejar otro dispositivo',
    pairExpiresIn: (time: string) => `Caduca en ${time}`,
    pairValidUntil: (clock: string) => `Sirve una sola vez, hasta las ${clock}.`,
    pairExpired: 'Este código ha caducado. Pide otro.',
    pairAnother: 'Otro código',
    pairHide: 'Ocultar el código',
    paired: (label: string) => `«${label}» ya está emparejado.`,

    devicesTitle: 'Dispositivos',
    devicesLoading: 'Cargando los dispositivos…',
    devicesRetry: 'Volver a cargar',
    thisDevice: 'Este dispositivo',
    inbox: 'Atajo de iOS',
    deviceSince: (date: string) => `Desde el ${date}`,
    deviceLastSeen: (when: string) => `Última vez: ${when}`,
    unpair: 'Desemparejar',
    unpairLabel: (label: string) => `Desemparejar: ${label}`,
    unpairConfirm: (label: string) =>
      `¿Desemparejar «${label}»? Dejará de sincronizar, pero conservará su lista.`,
    unpairInboxConfirm: (label: string) =>
      `¿Desemparejar «${label}»? El Atajo de iOS dejará de poder apuntar juegos.`,
    unpaired: (label: string) => `Hemos desemparejado «${label}».`,
    cancel: 'Cancelar',

    newRecoveryTitle: 'Código de recuperación',
    newRecoveryIntro:
      'Si has perdido el tuyo o alguien lo ha visto, crea uno nuevo. El anterior dejará de valer.',
    newRecovery: 'Código de recuperación nuevo',
    newRecoveryConfirm: 'El código anterior dejará de valer. ¿Crear uno nuevo?',
    newRecoveryDo: 'Crear código nuevo',

    leaveTitle: 'Desemparejar este dispositivo',
    leaveIntro: 'Dejará de sincronizar. Tu agenda se queda en este dispositivo y en los demás.',
    leave: 'Desemparejar este dispositivo',
    leaveConfirm: '¿Desemparejar este dispositivo? Podrás volver a emparejarlo con un código.',
    left: 'Este dispositivo ya no sincroniza. Tu agenda sigue aquí.',

    // Desemparejado (§11.4): por el servidor (401) o porque se borraron las cookies.
    unpairedTitle: 'Este dispositivo ya no sincroniza',
    unpairedServer:
      'Lo han desemparejado desde otro dispositivo, o se ha borrado la agenda sincronizada. Tu agenda sigue en este dispositivo.',
    unpairedCookies:
      'Se han borrado las cookies de GameAgenda en este navegador, y con ellas su emparejamiento. Tu agenda sigue en este dispositivo.',
    unpairedHow:
      'Para volver a sincronizar, escribe tu código de recuperación o un código de emparejamiento de otro dispositivo.',
    rejoinTitle: 'Volver a sincronizar',
    forgetIntro:
      'Si no vas a volver a sincronizar, quita la sincronización de este dispositivo. Tu agenda se queda.',
    forget: 'Dejar de sincronizar',
    forgetConfirm: '¿Dejar de sincronizar en este dispositivo? Tu agenda se queda aquí.',

    errors: {
      network:
        'No hemos podido conectar con el servidor. Comprueba tu conexión y vuelve a intentarlo.',
      rateLimited: 'Demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo.',
      disabled: 'La sincronización aún no está disponible. Vuelve a intentarlo más adelante.',
      ageChanged:
        'Ha cambiado la edad mínima para sincronizar. Recarga la página para ver la declaración nueva.',
      alreadyPaired:
        'Este dispositivo ya está emparejado con una agenda. Para unirlo a otra, desemparéjalo antes.',
      invalidPairing: (minutes: number) =>
        `Este código no vale: puede que esté mal escrito, que ya se haya usado o que haya caducado (dura ${minutes} minutos). Pide otro en el otro dispositivo.`,
      invalidRecovery:
        'Este código de recuperación no vale. Revisa que esté bien escrito; si creaste uno nuevo, el anterior ya no sirve.',
      unauthorized: 'Este dispositivo ya no está emparejado.',
      notFound: 'Ese dispositivo ya no estaba emparejado.',
      storage:
        'No hemos podido guardar en este dispositivo. Recarga la página y vuelve a intentarlo.',
      unavailable:
        'Este navegador no deja guardar datos (quizá es una ventana privada), así que no puede sincronizar.',
      server: 'Algo ha fallado en el servidor. Vuelve a intentarlo dentro de un rato.',
    },
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
