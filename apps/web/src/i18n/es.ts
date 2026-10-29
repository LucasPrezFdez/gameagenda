// Todas las cadenas de la interfaz (español de España; ver §9.9): tuteo, frases cortas,
// pretérito perfecto, sin exclamaciones y teclas con su nombre español.
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
  },

  list: {
    title: 'Mi lista',
    views: 'Vistas',
    view: {
      pending: 'Pendientes',
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
  },

  catalog: {
    title: 'Catálogo de Steam',
    count: (count: string) => `${count} juegos`,
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
  },

  settings: {
    title: 'Ajustes',
    sections: 'Secciones de Ajustes',
    section: {
      appearance: 'Apariencia',
      content: 'Contenido',
      keyboard: 'Teclado y gestos',
      data: 'Datos',
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
    notYet: 'Todavía no está disponible: llegará con el guardado en este dispositivo.',
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

const fieldPhrases: Readonly<Record<'note' | 'platform' | DateField, string>> = {
  note: 'la nota',
  platform: '«Juego en»',
  addedAt: 'la fecha de apuntado',
  startedAt: 'la fecha de inicio',
  completedAt: 'la fecha de completado',
  platinumAt: 'la fecha de platinado',
  ownedAt: 'la fecha de compra',
};
