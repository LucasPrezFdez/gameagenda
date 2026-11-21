// Textos legales de GameAgenda (M4; CA4.7; §11.1 y §11.2 de prototipe.md): la política de privacidad
// completa (segunda capa, art. 13 RGPD), el aviso legal (art. 10 LSSI) y la primera capa que va
// junto a «Activar sincronización» (art. 11 LOPDGDD). Son datos, no HTML: la pantalla los pinta con
// React, sin `dangerouslySetInnerHTML` (§11.3). Los enlaces internos son rutas de la app; los
// externos se abren aparte.
//
// Al cambiar algo que importe (qué datos, para qué, con quién, cuánto tiempo), sube `LEGAL_VERSION`
// y la fecha, y cuéntalo en el CHANGELOG.
import {
  DEFAULT_MIN_AGE,
  PASSKEY_CHALLENGE_TTL_MS,
  STEAM_IMPORT_TOKEN_TTL_MS,
  STEAM_TICKET_TTL_MS,
} from '@gameagenda/core/api';
import {
  CONTROLLER,
  type Controller,
  controllerEmail,
  controllerName,
  type Inline,
  link,
  NOTICE_PATH,
  PRIVACY_PATH,
} from './controller.ts';

export type { Inline } from './controller.ts';

export const LEGAL_VERSION = '5';
/**
 * Día de esta versión de los textos (dd-mm-aaaa). La 2 añade «Importar desde Steam» (ADR-012); la
 * 3, los logros y el pase de la importación (parte 3); la 4, las llaves de acceso (ADR-013); la 5,
 * la pregunta a la tienda de Steam de qué es software al importar (DECISIONES §10.57).
 */
export const LEGAL_UPDATED = '21-11-2026';

/**
 * Lo más que guarda D1 el SteamID64 de un login con Steam: los 10 min del ticket
 * (`STEAM_TICKET_TTL_MS`) y los 5 del Cron Trigger que borra los caducados (ADR-012).
 */
export const STEAM_ID_RETENTION_MINUTES = STEAM_TICKET_TTL_MS / 60_000 + 5;

/** Id de la sección de la política sobre «Importar desde Steam» (la exige `legal-guard`). */
export const STEAM_IMPORT_SECTION = 'importar-steam';

/** Id de la sección de la política sobre las llaves de acceso (la exige `legal-guard`; ADR-013). */
export const PASSKEYS_SECTION = 'llaves-de-acceso';

/**
 * Lo más que guarda D1 un reto de una llave de acceso: los 5 min que vale y los 5 del Cron Trigger
 * que borra los caducados (ADR-013).
 */
export const PASSKEY_CHALLENGE_RETENTION_MINUTES = PASSKEY_CHALLENGE_TTL_MS / 60_000 + 5;

export type Block =
  | { readonly kind: 'p'; readonly parts: readonly Inline[] }
  | { readonly kind: 'list'; readonly items: readonly (readonly Inline[])[] }
  | {
      readonly kind: 'table';
      readonly caption: string;
      readonly head: readonly string[];
      readonly rows: readonly (readonly string[])[];
    };

export interface LegalSection {
  /** Para el índice y los enlaces con `#`. */
  readonly id: string;
  readonly title: string;
  readonly blocks: readonly Block[];
}

export interface LegalDocument {
  readonly title: string;
  readonly intro: readonly Inline[];
  readonly sections: readonly LegalSection[];
}

const p = (...parts: Inline[]): Block => ({ kind: 'p', parts });
const list = (...items: (Inline | Inline[])[]): Block => ({
  kind: 'list',
  items: items.map((item) => (Array.isArray(item) ? item : [item])),
});

const AEPD = 'https://www.aepd.es/';
const CLOUDFLARE_DPA = 'https://www.cloudflare.com/cloudflare-customer-dpa/';
const CLOUDFLARE_PRIVACY = 'https://www.cloudflare.com/privacypolicy/';
const VALVE_PRIVACY = 'https://store.steampowered.com/privacy_agreement/';
const DPF_LIST = 'https://www.dataprivacyframework.gov/list';

export function privacyPolicy(c: Controller = CONTROLLER): LegalDocument {
  const name = controllerName(c);
  const email = controllerEmail(c);
  return {
    title: 'Política de privacidad',
    intro: [
      `Versión ${LEGAL_VERSION}, del ${LEGAL_UPDATED}. GameAgenda es una agenda de videojuegos que funciona en tu dispositivo: no tiene cuentas, no pide email ni contraseña, no lleva publicidad ni analítica y no vende ni cede datos. Aquí explicamos qué datos salen de tu dispositivo, cuándo, para qué y qué puedes hacer con ellos.`,
    ],
    sections: [
      {
        id: 'resumen',
        title: 'En pocas palabras',
        blocks: [
          list(
            'Sin sincronizar, tu lista, tus ajustes y lo demás se quedan en tu dispositivo. No los recibimos.',
            'Las portadas de los juegos se piden a los servidores de Valve (Steam), que reciben tu dirección IP. Puedes desactivarlas.',
            'Si activas la sincronización, guardamos tu agenda en servidores de Cloudflare en la Unión Europea, para que la tengas en tus dispositivos. No sabemos quién eres: no hay nombre, email ni IP guardados.',
            `Si importas tu biblioteca de Steam, inicias sesión en Steam, no aquí. Tus juegos, tu lista de deseados y si tienes todos los logros de cada juego pasan por nuestro servidor hasta tu dispositivo sin quedarse en él, y en el servidor solo queda el número de tu cuenta de Steam, ${STEAM_ID_RETENTION_MINUTES} minutos como mucho.`,
            'Si creas una llave de acceso para entrar en tu agenda desde otro dispositivo, solo guardamos su parte pública: tu cara, tu huella o tu PIN nunca salen de tu dispositivo.',
            'Puedes exportar tus datos, corregirlos y borrarlos desde la app, también los del servidor.',
          ),
        ],
      },
      {
        id: 'responsable',
        title: 'Quién es el responsable',
        blocks: [
          p(
            `El responsable del tratamiento es ${name}. Para cualquier consulta sobre tus datos, o para ejercer tus derechos, escribe a `,
            email,
            '. GameAgenda es un proyecto personal, gratuito y sin publicidad.',
          ),
        ],
      },
      {
        id: 'datos',
        title: 'Qué datos tratamos, para qué y con qué base',
        blocks: [
          p(
            '1. En tu dispositivo. Tu lista de juegos (estados, marcas, fechas, notas y orden), tus ajustes, el registro de errores y las medidas de rendimiento se guardan en el almacenamiento del navegador (IndexedDB y la caché). No salen de él salvo que actives la sincronización, o que tú los exportes o los copies. El catálogo de Steam también se guarda ahí: son datos públicos de juegos, no tuyos.',
          ),
          p(
            '2. Descargar la app y el catálogo. Como cualquier web, al abrir GameAgenda tu navegador pide sus ficheros y el catálogo a Cloudflare, que recibe tu dirección IP para servirlos y protegerlos de abusos. Nosotros no guardamos registros de acceso.',
          ),
          p(
            '3. Portadas. Si «Cargar portadas» está activado, tu navegador pide cada imagen a los servidores de Valve en EE. UU. (shared.akamai.steamstatic.com), que reciben tu dirección IP. Van sin cookies y sin decir desde qué página. Base: nuestro interés legítimo en enseñarte la portada de cada juego (art. 6.1.f del RGPD). Puedes oponerte desactivándolas en ',
            link('Ajustes › Privacidad', '/ajustes/privacidad'),
            '.',
          ),
          p(
            '4. Nombres de juegos que aún no están en el catálogo, solo con la sincronización activada. Si apuntas un juego con un enlace de Steam y el catálogo de tu dispositivo no lo tiene, la app pregunta su nombre a nuestro servidor, que se lo pregunta a Steam. Sin sincronizar, no se pregunta: el juego espera a que llegue al catálogo. Solo viaja el número del juego, sin cookies ni nada que te identifique, y Steam no recibe tu IP. Guardamos el nombre en una caché de nombres públicos, sin saber quién lo pidió. Base: darte el servicio que pides al apuntar el juego (art. 6.1.b del RGPD).',
          ),
          p(
            '5. Sincronización, si la activas. Guardamos tu agenda (juegos, estados, marcas, fechas, notas y orden, también lo que borras durante un tiempo, para que se borre en todos tus dispositivos), el nombre que le das a cada dispositivo y cuándo sincronizó por última vez, además de un resumen (hash) de cada credencial. Para qué: tener la misma agenda en tus dispositivos y una copia fuera de ellos. Base: el servicio que pides al activarla (art. 6.1.b del RGPD). No guardamos email, nombre, contraseña ni dirección IP. Si creas una llave de acceso, guardamos también su parte pública, su identificador, el nombre del dispositivo donde la creaste y sus fechas: lo explicamos más abajo, en «Llaves de acceso».',
          ),
          p(
            '6. Atajo de iOS, si lo creas. Guardamos los enlaces de Steam que mandas con el atajo hasta que una app tuya los apunta, y entonces los borramos. Base: el servicio que pides (art. 6.1.b del RGPD).',
          ),
          p(
            '7. Importar desde Steam, si lo usas: tu biblioteca y tu lista de deseados de Steam, si tienes todos los logros de los juegos que has jugado, y el número de tu cuenta de Steam mientras importas. Lo explicamos más abajo, en «Importar desde Steam». Base: el servicio que pides al importar (art. 6.1.b del RGPD).',
          ),
          p(
            '8. Seguridad. Para que nadie abuse del servicio, contamos las peticiones de cada dirección IP durante unos segundos o minutos. Al contador le llega un resumen (hash) de la IP, nunca la IP, y no se guarda. También contamos cuántas consultas hacemos a Steam cada día, sin saber de quién son, para no pasar del límite que pone Valve. Base: nuestro interés legítimo en proteger el servicio (art. 6.1.f del RGPD).',
          ),
          p('No tomamos decisiones automatizadas sobre ti ni hacemos perfiles.'),
        ],
      },
      {
        id: 'cookies',
        title: 'Cookies y almacenamiento en tu dispositivo',
        blocks: [
          p(
            'GameAgenda no usa cookies de analítica, de publicidad ni de terceros, así que no hay banner de cookies (art. 22.2 de la LSSI). Lo que guarda en tu dispositivo es lo necesario para funcionar:',
          ),
          {
            kind: 'table',
            caption: 'Lo que GameAgenda guarda en tu dispositivo',
            head: ['Qué', 'Para qué', 'Cuánto dura'],
            rows: [
              [
                'IndexedDB y la caché del navegador',
                'Tu lista, tus ajustes y el catálogo, para que la app funcione sin conexión',
                'Hasta que los borres',
              ],
              [
                'Cookie __Host-ga_device (solo con la sincronización)',
                'Identifica este dispositivo ante el servidor. No la puede leer ningún script',
                '400 días desde la última sincronización, o hasta desemparejar o borrar la agenda',
              ],
              [
                'Cookie __Host-ga_sync (solo con la sincronización)',
                'Sin datos: le dice a la app que este dispositivo está emparejado',
                'Lo mismo que la anterior',
              ],
            ],
          },
          p(
            'Las dos cookies solo se crean cuando tú activas la sincronización, emparejas este dispositivo o usas tu código de recuperación, y en ese momento se avisa.',
          ),
        ],
      },
      {
        id: PASSKEYS_SECTION,
        title: 'Llaves de acceso',
        blocks: [
          p(
            'Con la sincronización activada, puedes crear una llave de acceso para entrar en tu agenda desde otro dispositivo sin escribir ningún código. La crea y la guarda tu dispositivo o tu llavero (por ejemplo, el de iCloud, Google o Windows), protegida con tu cara, tu huella o tu PIN. Solo pasa si tú lo pides.',
          ),
          list(
            'Tu cara, tu huella y tu PIN nunca salen de tu dispositivo: solo los usa él para dejarte usar la llave. No los vemos ni los guardamos.',
            'Guardamos la parte pública de la llave, que sirve para comprobar que una firma es suya pero no para firmar; su identificador; el nombre del dispositivo donde la creaste, y cuándo se creó y cuándo se usó por última vez.',
            `Cada vez que creas una llave o entras con ella, guardamos un reto de un solo uso (solo su resumen, hash), ${PASSKEY_CHALLENGE_RETENTION_MINUTES} minutos como mucho.`,
            'Tu llavero guarda la llave según las condiciones de quien lo ofrece (Apple, Google, Microsoft u otro). Nosotros no recibimos nada de él aparte de lo dicho aquí.',
            'Puedes quitar una llave en Ajustes › Sincronización, y se borran todas al borrar la agenda sincronizada. La app pide también a tu llavero que la olvide, si sabe hacerlo; si no, bórrala tú allí.',
          ),
          p('Base: el servicio que pides al crear la llave (art. 6.1.b del RGPD).'),
        ],
      },
      {
        id: STEAM_IMPORT_SECTION,
        title: 'Importar desde Steam',
        blocks: [
          p(
            'Desde Ajustes › Datos puedes traer los juegos de tu biblioteca de Steam (y, si quieres, tu lista de deseados) a tu lista, como Comprados y, si tienes todos sus logros, como Platinados, para no tener que apuntarlos uno a uno. Solo pasa si tú lo pides, antes de cambiar nada te enseñamos un resumen, y no hace falta tener la sincronización activada.',
          ),
          list(
            'Inicias sesión en la web de Steam, con su botón oficial. Nunca vemos tu contraseña ni nada de tu cuenta, salvo lo que se dice aquí.',
            'Steam le dice a nuestro servidor el número de tu cuenta (SteamID64), y con él le pedimos tu biblioteca (qué juegos tienes, las horas jugadas y cuándo jugaste por última vez) y tu lista de deseados. No pedimos tu nombre, tu avatar ni tu ubicación.',
            `Para saber cuáles tienes platinados, le preguntamos a Steam, juego a juego, por los logros de los que has jugado. A tu dispositivo solo le decimos si los tienes todos y el día del último, no cuáles son. Para esas preguntas, al traer tu biblioteca el servidor le da a tu dispositivo un pase cifrado con el número de tu cuenta, que caduca a los ${STEAM_IMPORT_TOKEN_TTL_MS / 60_000} minutos y solo se guarda en la memoria de la app: el servidor no lo guarda. Y para saber cuáles son programas y no juegos (como Wallpaper Engine), le preguntamos a la tienda de Steam qué es cada uno de los que no están en nuestro catálogo, solo con su número, sin el de tu cuenta.`,
            'Tu biblioteca, tu lista de deseados y lo de los logros pasan por nuestro servidor hasta tu dispositivo, sin que el servidor los guarde ni los anote en ningún registro. En tu dispositivo, lo que decidas aplicar pasa a ser parte de tu lista, como cualquier juego que apuntes, y se puede deshacer.',
            `Mientras inicias sesión, el servidor guarda el número de tu cuenta junto a un código de un solo uso que solo tu dispositivo puede canjear. El código caduca a los ${STEAM_TICKET_TTL_MS / 60_000} minutos, y en ${STEAM_ID_RETENTION_MINUTES} minutos como mucho ya no queda nada.`,
            'Si tu perfil de Steam no deja ver los detalles de juegos, Steam no nos da la biblioteca, y la app te dice cómo cambiarlo. Los juegos que hayas marcado como privados en Steam no aparecen.',
          ),
          p(
            'Al iniciar sesión hablas directamente con Steam: lo que recoja su web lo trata Valve según su ',
            link('política de privacidad', VALVE_PRIVACY),
            '. Base: el servicio que pides al importar (art. 6.1.b del RGPD).',
          ),
        ],
      },
      {
        id: 'edad',
        title: 'Edad',
        blocks: [
          p(
            `Para activar la sincronización tienes que declarar que tienes ${DEFAULT_MIN_AGE} años o más (art. 7 de la LOPDGDD). Si tienes menos, no la actives: la app funciona igual sin ella. Si la ley cambia la edad, te pediremos la declaración nueva.`,
          ),
        ],
      },
      {
        id: 'destinatarios',
        title: 'Quién más trata tus datos',
        blocks: [
          list(
            [
              'Cloudflare, Inc. aloja la app, el catálogo y el servidor de la sincronización, y guarda la agenda sincronizada en su base de datos D1 en la Unión Europea. Lo hace por encargo nuestro, con su ',
              link('contrato de encargo', CLOUDFLARE_DPA),
              '. El servidor se ejecuta en el centro de datos de Cloudflare más cercano a ti, que puede estar fuera de la Unión Europea, aunque la base de datos esté en ella. Su ',
              link('política de privacidad', CLOUDFLARE_PRIVACY),
              '.',
            ],
            [
              'Valve Corporation (EE. UU.) recibe tu IP cuando tu navegador pide las portadas, el número de un juego cuando nuestro servidor le pregunta su nombre o si es un programa y, si importas desde Steam, el número de tu cuenta cuando nuestro servidor le pide tu biblioteca y tus logros. Valve decide por su cuenta qué hace con ello: su ',
              link('política de privacidad', VALVE_PRIVACY),
              '.',
            ],
            'GitHub (EE. UU.) guarda el estado del proceso que actualiza el catálogo, sin ningún dato tuyo.',
          ),
          p('No vendemos ni cedemos tus datos a nadie.'),
        ],
      },
      {
        id: 'transferencias',
        title: 'Transferencias fuera de la Unión Europea',
        blocks: [
          p(
            'Cloudflare, Inc. y Valve Corporation son empresas de EE. UU. Las dos declaran estar adheridas al Marco de Privacidad de Datos UE-EE. UU., que la Comisión Europea considera adecuado (se puede comprobar en la ',
            link('lista oficial', DPF_LIST),
            '). El contrato de encargo de Cloudflare incluye además las cláusulas contractuales tipo de la Comisión, por si ese marco dejara de valer.',
          ),
        ],
      },
      {
        id: 'plazos',
        title: 'Cuánto tiempo los guardamos',
        blocks: [
          {
            kind: 'table',
            caption: 'Plazos de conservación',
            head: ['Dato', 'Dónde', 'Cuánto'],
            rows: [
              [
                'Tu lista, ajustes, registro de errores y medidas',
                'Tu dispositivo',
                'Hasta que los borres',
              ],
              [
                'Agenda sincronizada y nombres de los dispositivos',
                'Cloudflare D1, en la UE',
                'Hasta que la borres; si ningún dispositivo sincroniza en 13 meses, se borra sola',
              ],
              [
                'Lo que borras de la agenda sincronizada',
                'Cloudflare D1, en la UE',
                'Unos 90 días, para que se borre también en tus otros dispositivos',
              ],
              [
                'Copias de seguridad de la base de datos',
                'Cloudflare D1, en la UE',
                '7 días: lo borrado se puede recuperar durante ese tiempo',
              ],
              [
                'Resúmenes (hash) de las credenciales de los dispositivos, del Atajo de iOS y del código de recuperación',
                'Cloudflare D1, en la UE',
                'Hasta que las revoques, cambies el código o borres la agenda',
              ],
              [
                'Códigos de emparejamiento',
                'Cloudflare D1, en la UE',
                '10 minutos, o hasta usarlos',
              ],
              [
                'Llaves de acceso: su parte pública, su identificador, el nombre del dispositivo donde se creó y sus fechas',
                'Cloudflare D1, en la UE',
                'Hasta que la quites o borres la agenda',
              ],
              [
                'Retos de las llaves de acceso (solo su resumen, hash)',
                'Cloudflare D1, en la UE',
                `${PASSKEY_CHALLENGE_RETENTION_MINUTES} minutos como mucho, o hasta usarlos`,
              ],
              [
                'Enlaces del Atajo de iOS',
                'Cloudflare D1, en la UE',
                'Hasta que una app tuya los apunta',
              ],
              [
                'Caché de nombres de juegos (no son datos tuyos)',
                'Cloudflare D1, en la UE',
                '30 días',
              ],
              [
                'Número de tu cuenta de Steam, al importar, con su código de un solo uso',
                'Cloudflare D1, en la UE',
                `${STEAM_ID_RETENTION_MINUTES} minutos como mucho (el código caduca a los ${STEAM_TICKET_TTL_MS / 60_000})`,
              ],
              [
                'Tu biblioteca y tu lista de deseados de Steam, y si tienes todos los logros',
                'Tu dispositivo',
                'Solo mientras importas; lo que apliques, como el resto de tu lista',
              ],
              [
                'Pase de la importación (el número de tu cuenta de Steam, cifrado)',
                'Tu dispositivo, solo en la memoria de la app',
                `${STEAM_IMPORT_TOKEN_TTL_MS / 60_000} minutos como mucho`,
              ],
              ['Contadores de peticiones', 'Cloudflare', 'Unos segundos o minutos'],
            ],
          },
        ],
      },
      {
        id: 'derechos',
        title: 'Tus derechos',
        blocks: [
          p(
            'Puedes acceder a tus datos, corregirlos, borrarlos, llevártelos, limitar su tratamiento u oponerte a él (arts. 15 a 22 del RGPD). Casi todo se hace desde la app, al momento:',
          ),
          list(
            [
              'Acceso y portabilidad: exporta tu lista en JSON o CSV en ',
              link('Ajustes › Datos', '/ajustes/datos'),
              '.',
            ],
            'Corregir: cambia cualquier juego, estado, fecha o nota en la propia app; con la sincronización, el cambio llega al servidor.',
            [
              'Borrar: «Borrar todos mis datos» en ',
              link('Ajustes › Datos', '/ajustes/datos'),
              ' borra lo de este dispositivo y, con la sincronización activada, también la agenda del servidor, con sus dispositivos y su buzón.',
            ],
            [
              'Oponerte a las portadas: desactívalas en ',
              link('Ajustes › Privacidad', '/ajustes/privacidad'),
              '.',
            ],
            [
              'Dejar de sincronizar un dispositivo o el Atajo de iOS: desemparéjalos en ',
              link('Ajustes › Sincronización', '/ajustes/sincronizacion'),
              '.',
            ],
          ),
          p(
            'Como no sabemos quién eres, la forma de ejercerlos sobre la agenda sincronizada es desde un dispositivo emparejado. Si nos escribes a ',
            email,
            ', te ayudaremos y contestaremos en un mes como mucho (art. 12.3 del RGPD). Nunca te pediremos tu código de recuperación: no se lo des a nadie.',
          ),
          p(
            'Si crees que no tratamos bien tus datos, puedes reclamar ante la Agencia Española de Protección de Datos (',
            link('aepd.es', AEPD),
            ').',
          ),
        ],
      },
      {
        id: 'seguridad',
        title: 'Seguridad',
        blocks: [
          p(
            'Todo viaja cifrado (HTTPS). El servidor solo guarda resúmenes (hash) de las credenciales y de los códigos, nunca los originales. La credencial de cada dispositivo va en una cookie que ningún script puede leer. Los códigos de emparejamiento sirven una sola vez y caducan a los 10 minutos. El inicio de sesión con Steam lo comprueba Steam, y solo lo puede canjear el dispositivo que lo empezó. La clave con la que pedimos datos a Steam nunca sale del servidor.',
          ),
        ],
      },
      {
        id: 'cambios',
        title: 'Cambios en esta política',
        blocks: [
          p(
            'Si cambia algo importante (qué datos, para qué, con quién o cuánto tiempo), cambiarán la versión y la fecha de arriba. Ver también el ',
            link('aviso legal', NOTICE_PATH),
            '.',
          ),
        ],
      },
    ],
  };
}

export function legalNotice(c: Controller = CONTROLLER): LegalDocument {
  const name = controllerName(c);
  const email = controllerEmail(c);
  return {
    title: 'Aviso legal y condiciones de uso',
    intro: [`Versión ${LEGAL_VERSION}, del ${LEGAL_UPDATED}.`],
    sections: [
      {
        id: 'titular',
        title: 'Quién está detrás',
        blocks: [
          p(
            `GameAgenda es un proyecto personal de ${name}, gratuito y sin publicidad. Contacto: `,
            email,
            '.',
          ),
        ],
      },
      {
        id: 'uso',
        title: 'Uso de GameAgenda',
        blocks: [
          list(
            'GameAgenda es gratuita y se ofrece tal cual, sin garantías: puede tener fallos, cambiar o dejar de estar disponible.',
            'Tu lista vive en tu dispositivo. Si no sincronizas, el navegador puede borrarla (por ejemplo, Safari tras 7 días sin abrir la web): exporta una copia de vez en cuando en Ajustes › Datos.',
            'Úsala para tu agenda personal. No intentes saltarte los límites del servicio ni acceder a agendas que no son tuyas.',
            'La sincronización y el Atajo de iOS se pueden pausar o cerrar si hace falta para proteger el servicio. Tu agenda local no se toca.',
          ),
        ],
      },
      {
        id: 'steam',
        title: 'Datos de Steam',
        blocks: [
          p(
            'El catálogo de juegos sale de la Steam Web API, con datos públicos de la tienda de Steam. Las portadas se enlazan a los servidores de Valve y nunca se copian en servidores propios. Los nombres e imágenes de los juegos son de sus titulares.',
          ),
          p(
            'Steam y el logotipo de Steam son marcas comerciales o registradas de Valve Corporation en EE. UU. y otros países. GameAgenda no está afiliada a Valve ni cuenta con su respaldo.',
          ),
        ],
      },
      {
        id: 'privacidad',
        title: 'Privacidad',
        blocks: [
          p(
            'Qué datos tratamos y cómo lo explica la ',
            link('política de privacidad', PRIVACY_PATH),
            '.',
          ),
        ],
      },
      {
        id: 'ley',
        title: 'Ley aplicable',
        blocks: [p('Estas condiciones se rigen por la ley española.')],
      },
    ],
  };
}
