// Textos legales de GameAgenda (M4; CA4.7; §11.1 y §11.2 de prototipe.md): la política de privacidad
// completa (segunda capa, art. 13 RGPD), el aviso legal (art. 10 LSSI) y la primera capa que va
// junto a «Activar sincronización» (art. 11 LOPDGDD). Son datos, no HTML: la pantalla los pinta con
// React, sin `dangerouslySetInnerHTML` (§11.3). Los enlaces internos son rutas de la app; los
// externos se abren aparte.
//
// Al cambiar algo que importe (qué datos, para qué, con quién, cuánto tiempo), sube `LEGAL_VERSION`
// y la fecha, y cuéntalo en el CHANGELOG.
import { DEFAULT_MIN_AGE } from '@gameagenda/core/api';
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

export const LEGAL_VERSION = '1';
/** Día de esta versión de los textos (dd-mm-aaaa). */
export const LEGAL_UPDATED = '08-11-2026';

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
            '4. Nombres de juegos que aún no están en el catálogo. Si apuntas un juego con un enlace de Steam y el catálogo de tu dispositivo no lo tiene, la app pregunta su nombre a nuestro servidor, que se lo pregunta a Steam. Solo viaja el número del juego, sin cookies ni nada que te identifique, y Steam no recibe tu IP. Guardamos el nombre en una caché de nombres públicos, sin saber quién lo pidió. Base: darte el servicio que pides al apuntar el juego (art. 6.1.b del RGPD).',
          ),
          p(
            '5. Sincronización, si la activas. Guardamos tu agenda (juegos, estados, marcas, fechas, notas y orden, también lo que borras durante un tiempo, para que se borre en todos tus dispositivos), el nombre que le das a cada dispositivo y cuándo sincronizó por última vez, además de un resumen (hash) de cada credencial. Para qué: tener la misma agenda en tus dispositivos y una copia fuera de ellos. Base: el servicio que pides al activarla (art. 6.1.b del RGPD). No guardamos email, nombre, contraseña ni dirección IP.',
          ),
          p(
            '6. Atajo de iOS, si lo creas. Guardamos los enlaces de Steam que mandas con el atajo hasta que una app tuya los apunta, y entonces los borramos. Base: el servicio que pides (art. 6.1.b del RGPD).',
          ),
          p(
            '7. Seguridad. Para que nadie abuse del servicio, contamos las peticiones de cada dirección IP durante unos segundos o minutos. Al contador le llega un resumen (hash) de la IP, nunca la IP, y no se guarda. Base: nuestro interés legítimo en proteger el servicio (art. 6.1.f del RGPD).',
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
              'Valve Corporation (EE. UU.) recibe tu IP cuando tu navegador pide las portadas, y el número de un juego cuando nuestro servidor le pregunta su nombre. Valve decide por su cuenta qué hace con ello: su ',
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
                'Enlaces del Atajo de iOS',
                'Cloudflare D1, en la UE',
                'Hasta que una app tuya los apunta',
              ],
              [
                'Caché de nombres de juegos (no son datos tuyos)',
                'Cloudflare D1, en la UE',
                '30 días',
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
            'Todo viaja cifrado (HTTPS). El servidor solo guarda resúmenes (hash) de las credenciales y de los códigos, nunca los originales. La credencial de cada dispositivo va en una cookie que ningún script puede leer. Los códigos de emparejamiento sirven una sola vez y caducan a los 10 minutos.',
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
