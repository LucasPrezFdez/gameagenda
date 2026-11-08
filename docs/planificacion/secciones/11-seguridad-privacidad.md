## 11. Seguridad, privacidad y cumplimiento

Referencia: OWASP ASVS nivel 1. Hasta M4 no hay servidor propio con datos de usuarios, y el navegador solo contacta con Valve por las portadas.

### 11.1 Condiciones de uso (ToU) de la Steam Web API

Versión de julio de 2010 (verificada el 28-10-2026):

| Obligación | Cómo se cumple |
|---|---|
| ≤100 000 llamadas/día en total, con clave o sin ella | Pipeline ≈220/día (≤230; ver §4); en Fase 2, importaciones a petición, incrementales y con tope por agenda |
| Clave confidencial | Solo en secretos, enviada en `x-webapi-key` (ver §11.3) |
| Política de privacidad; decir qué datos de Steam se guardan y en qué país | Política por capas (ver §11.2) y pantalla «Datos de Steam que guardamos»: qué; dónde (el dispositivo; la red global de Cloudflare, para el catálogo; D1 con jurisdicción UE, para la agenda desde M4; GitHub, en EE. UU., para el estado del pipeline); que la IP llega a Valve (EE. UU.) por las portadas, y botón de borrar |
| Datos de un usuario solo a petición suya | Nada por usuario antes de un login OpenID verificado; sin perfiles pegados (ver §10.2) |
| No insinuar respaldo de Valve; enlaces sin `nofollow` | Sin «Steam» en el nombre ni en el icono; aviso de marca en «Acerca de»; botón oficial de login en Fase 2; enlaces a la tienda sin `rel="nofollow"` |
| Borrar los datos de Steam al terminar | Botón de borrar; si Valve revoca el acceso, se retiran esas funciones |
| Uso comercial | Los ToU no dicen nada: consultar a Valve antes de monetizar |

Aviso de marca: «Steam y el logotipo de Steam son marcas comerciales o registradas de Valve Corporation en EE. UU. y otros países. GameAgenda no está afiliada a Valve ni cuenta con su respaldo». Las portadas se enlazan y nunca se copian a un servidor propio, porque republicar una copia es una nueva comunicación pública (TJUE, Renckhoff, C-161/17).

Fuentes: <https://steamcommunity.com/dev/apiterms> · <https://partner.steamgames.com/doc/marketing/branding>

### 11.2 Privacidad: RGPD, LOPDGDD y LSSI

Sin email, contraseña, analítica de terceros ni cookies no necesarias: **no hay banner** (art. 22.2 LSSI; la guía de cookies de la AEPD aplica lo mismo a `localStorage` e IndexedDB).

| Cuándo | Medidas |
|---|---|
| M1 (todo en el dispositivo) | Exportar (JSON/CSV) y «Borrar todos mis datos» |
| M2 (la IP llega a Valve por las portadas) | Aviso de primera capa, `referrerpolicy="no-referrer"`, interruptor «Cargar portadas» y «Datos de Steam que guardamos» |
| Antes del primer probador externo y de M4 | Política completa por capas, aviso legal y registro de actividades (Facilita RGPD, de la AEPD): redactados el 08-11-2026, con el responsable pendiente (ver abajo) |
| M4 (agenda en D1, UE) | Base del art. 6.1.b RGPD, declaración de edad, retención y borrado en el servidor |

Quienes hacen la prueba guiada de M3 (ver §2.4) en el móvil y el PC del desarrollador, sin datos propios, no cuentan como probadores externos.

- **Aviso de primera capa** (texto en la §9.9): sale la primera vez que se cargan portadas, solo informa, ofrece desactivarlas y su «Más información» abre la pantalla «Datos de Steam que guardamos» (M2), que desde el 08-11-2026 enlaza con la política completa. Base: interés legítimo (art. 6.1.f), con oposición en un toque, como dice la política. Precedente: condena del LG München I (3 O 17493/20, 2022) por enviar la IP a Google Fonts sin base jurídica. Cómo funciona desde M2:
  - «Cargar portadas» viene activado. Las portadas esperan a que el aviso se haya pintado (`coverNotice`: `unseen` → `shown`) y el aviso sigue a la vista hasta «Entendido» o «Desactivar portadas» (`done`);
  - la paleta nunca lo hace salir, porque taparía el campo de captura: sus portadas esperan a que el aviso haya salido en Mi lista o en la ficha;
  - no sale en Ajustes › Privacidad, se oculta con la paleta abierta y desmarcar «Cargar portadas» en Ajustes cuenta como leído;
  - va fijo abajo, bajo el aviso de Deshacer, y no empuja la lista (§9.5, regla 3).
- **Capas y derechos:** la primera capa (art. 11 LOPDGDD) da identidad y contacto del responsable, finalidad y derechos (arts. 15–22). Acceso y portabilidad = exportar; supresión = borrar en el dispositivo y, en M4, en el servidor; plazo de un mes (art. 12.3 RGPD).
- **Cookie de dispositivo:** es persistente, y el GT29 (WP194) solo exime las de autenticación persistentes si el usuario las pide: la crea un gesto explícito («Activar sincronización», «Emparejar este dispositivo» o «Usar código de recuperación»), que informa en ese momento. El aviso de las dos cookies va junto a esos botones (ver §9.1).
- **Menores:** al activar la sincronización se declara tener ≥14 años (art. 7 LOPDGDD); es un parámetro, porque el proyecto de ley 121/000052 la subiría a 16.
- **Registro de actividades:** obligatorio, porque la exención del art. 30.5 RGPD no cubre tratamientos habituales.
- **Encargados y transferencias:** Cloudflare (hosting y Workers): la jurisdicción UE de D1 fija dónde se guarda la base, no dónde se ejecuta la micro-API (en el centro de datos más cercano al usuario), y solo se elige al crearla (`--jurisdiction=eu`; plan gratuito, a verificar en M4). La IP llega a Valve en EE. UU. por las portadas. La política nombra a ambos y la base de cada transferencia a EE. UU.: Cloudflare y Valve declaran estar adheridos al Marco de Privacidad de Datos UE-EE. UU., y el DPA de Cloudflare incluye además las cláusulas tipo (comprobado en sus páginas el 08-11-2026). GitHub (EE. UU.) solo guarda el estado del pipeline, sin datos personales.
- **Textos legales tal como se han redactado (08-11-2026; DECISIONES §10.41; CA4.7):**
  - la política de privacidad completa (`/privacidad`, art. 13 RGPD) y el aviso legal y las condiciones de uso (`/aviso-legal`, art. 10 LSSI) son datos en `apps/web/src/legal/texts.ts`, que la pantalla pinta como texto (§11.3), en el *chunk* de Ajustes;
  - la primera capa (`legal/first-layer.ts`) va en Ajustes › Sincronización, junto a los botones que crean las cookies, con el enlace a la política (ver §9.1 y §9.9);
  - bases: sincronización, buzón y `resolve`, art. 6.1.b; portadas y seguridad (los contadores de peticiones), art. 6.1.f;
  - plazos: los de la tabla de abajo; una prueba ata los del texto a las constantes del código;
  - **el responsable, pendiente:** el nombre o alias y el correo los decide el usuario, y van en `legal/controller.ts`. Hasta entonces los textos dicen «pendiente», y `scripts/legal-guard.test.ts` no deja poner `SYNC_ENABLED` a `"1"` sin ellos (ver §12.5);
  - el registro de actividades (art. 30 RGPD) es interno: `docs/legal/registro-actividades.md`.

**Retención.** Time Travel de D1 está siempre activo: lo borrado se puede restaurar durante 7 días (plan gratuito), y así se declara.

| Dato | Dónde | Retención |
|---|---|---|
| Agenda y ajustes | Dispositivo | Hasta que el usuario los borre |
| Agenda sincronizada | D1 (UE) | Mientras exista; se borra al pedirlo |
| *Hashes* de credenciales (dispositivo, buzón, recuperación) y de emparejamiento | D1 | Hasta revocarlas o borrar la agenda; los de emparejamiento, 10 min |
| Lápidas | Dispositivo | El dispositivo no las purga. Con la sincronización, la purga semanal de D1 fuerza un *reset* y lo deja igual que D1; al unirse, las de más de 90 días se reducen a `deletedAt` (ver §7.7) |
| Lápidas | D1 | 90 días tras el borrado (purga semanal, ver §7.7) |
| Agenda sin sincronizar en 13 meses | D1 | Se borra (el mantenimiento diario, ADR-011) |
| Enlaces del buzón | D1 | Hasta que una app de la agenda los apunta (200 pendientes como mucho) |
| Caché de `resolve` (nombres públicos, no datos del usuario) | D1 | 30 días un nombre; 1 día «Steam no lo conoce» |
| Contadores de peticiones (`ratelimits`, con el SHA-256 de la IP o del *token*) | Cloudflare | Unos segundos o minutos (periodos de 60 s) |
| Ticket de login con SteamID64 (Fase 2) | D1 | ≤10 min |

Fuentes: <https://www.aepd.es/guias/guia-cookies.pdf> · <https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673> · <https://developers.cloudflare.com/d1/reference/time-travel/> · <https://developers.cloudflare.com/d1/configuration/data-location/>

### 11.3 Seguridad de la app y del catálogo

- **Cabeceras por `_headers`** (fichero estático, ver §14), que no se aplica a lo que genera el Worker (en M4, la micro-API pone las suyas con Hono). CSP sin `unsafe-inline` y, de momento, sin *hashes*: el `index.html` de Vite no lleva *scripts* incrustados (el Service Worker se registra desde el código; verificado el 28-10-2026), así que basta `script-src 'self'`. Si hiciera falta uno (p. ej., para aplicar el tema antes de pintar), se permitiría por su *hash* y el *build* generaría `dist/_headers`. Máximo, 2 000 caracteres por cabecera:

  ```text
  default-src 'self'; script-src 'self'; style-src 'self';
  img-src 'self' https://shared.akamai.steamstatic.com;
  connect-src 'self' https://ga-catalog.<subdominio>.workers.dev;
  object-src 'none'; base-uri 'none'; form-action 'self';
  frame-ancestors 'none'; upgrade-insecure-requests
  ```

  Más `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cross-Origin-Opener-Policy: same-origin`, HSTS y una `Permissions-Policy` que desactiva lo que no se usa. El Service Worker aplica la CSP de su propio *script*, y sus descargas cuentan, en principio, como `connect-src`: esa CSP añade el CDN de portadas (a verificar en M2). En Fase 2, `img-src` añade `https://images.igdb.com` (ver §17). `ga-catalog` solo envía `Access-Control-Allow-Origin` para el origen de la app. Los e2e fallan ante cualquier violación de CSP (ver §12).
- **Texto de Steam como texto:** Biome prohíbe `dangerouslySetInnerHTML`; las URL se construyen desde el `appid` y rutas validadas. Zod valida cada respuesta de Steam, cada entrada de la micro-API y cada importación (con tamaño máximo).
- **Clave de Steam:** solo en un secreto de GitHub y en `.env.local`; el CI falla si el *build* contiene su valor o la cadena `x-webapi-key` (ver §12). Si se filtra, se revoca, se crea otra y se actualiza el secreto.
- **Cadena de suministro:** `save-exact=true`, *lockfile* y `npm ci`; *actions* fijadas por SHA con `permissions` mínimos; Dependabot semanal; secretos solo en los flujos que los usan (ver §12). El *token* de Cloudflare tiene el mínimo permiso, pero «Workers Scripts: Edit» abarca toda la cuenta: un pipeline comprometido (procesa datos no confiables) podría desplegar `ga-web`. Por eso, desde el 31-10-2026 `ga-catalog` va en otra cuenta gratuita (https://ga-catalog.gameagenda-cat.workers.dev). Su *token* solo tiene «Workers Scripts: Edit» en esa cuenta, y el de `ga-web` no está en ningún flujo del catálogo (ADR-003 y ADR-007).
- **Integridad del catálogo:** *manifest* firmado con ed25519 (privada solo en un secreto de GitHub; pública en la app, con hueco para una segunda para rotarla). Desde M2, el PC nunca firma ni despliega `ga-catalog`. Si el pipeline se lanza desde el PC (429 en los *runners* compartidos o falta de minutos), el PC construye y sube las páginas crudas de Steam a la *Release* de preparación `catalog-staging`. Después, `catalog.yml` (`workflow_dispatch` con `source=staging`) vuelve a derivar el catálogo sin red, pasa las puertas, firma y publica (ver §4.5). `catalog:publish` se niega fuera de GitHub Actions.

  El cliente verifica la firma con WebCrypto y el `sha256` de cada fichero antes de sustituir el catálogo, y rechaza una `version` anterior a la suya. Volver a un catálogo anterior es republicar sus ficheros con una `version` nueva. Así, ni el CDN ni un *token* de Cloudflare robado cuelan un catálogo o un *kill switch* falsos. En producción solo valen las claves `prod`; la de desarrollo (`dev-1`), cuya privada está en el repositorio, solo la aceptan los modos `development` y `e2e`.

  El 30-10-2026, Ed25519 funcionó en Node 24 y en Chromium, en la página y en un Worker. El WebKit de Playwright para Windows no lo trae, y por eso el *build* `e2e` tiene un gancho que acepta el mini-catálogo firmado con `dev-1` sin verificarlo:
  - las pruebas del *manifest* manipulado y de la regla de los 7 días corren solo en Chromium (además, en WebKit `context.route` no ve las peticiones del Worker);
  - `webkit-movil` prueba con el gancho apagado el camino real sin Ed25519: con caché, sigue buscando y avisa (`browser-too-old`); sin caché, no hay catálogo ni «Reintentar» (RNF-12).

  Safari está a verificar en el dispositivo.

### 11.4 Micro-API y emparejamiento (M4)

- **Credencial de dispositivo:** cookie `__Host-` `HttpOnly` `Secure` `SameSite=Lax` con 256 bits aleatorios; el servidor guarda solo su SHA-256. Ni el JavaScript ni un XSS la leen, y no le afecta la purga de 7 días de WebKit sobre lo que escriben los *scripts* (prueba en un iPhone real, ver §15). Chrome limita las cookies a 400 días: se renueva al sincronizar, como mucho una vez al día. En Ajustes se ven y se revocan los dispositivos; revocar borra la fila, y revocarse a uno mismo es desemparejar. Va con un indicio sin secreto, `__Host-ga_sync=1`, que la app sí lee: si se borra solo IndexedDB, sabe que sigue emparejada y restaura la agenda sin preguntar al servidor en cada arranque (CA4.3). Las dos se crean y se borran juntas (ADR-011).
- **Emparejar:** *token* de un solo uso, ≥128 bits y 10 min, en QR y como texto. Se canjea con un POST desde dentro de la app, nunca con un GET (una vista previa de enlaces lo gastaría); si va en una URL, en el fragmento (`#`), que no llega al servidor: el QR lleva `<origen>/emparejar#código`, y la app lo quita de la URL antes de pintar y no lo canjea sin pulsar «Emparejar este dispositivo» (ver §9.1). Solo se guarda su *hash*, como el del código de recuperación (se muestra una vez). Los dos son 28 símbolos de la base32 de Crockford (140 bits) en grupos de 4, sin I, L, O ni U. El canje es un `DELETE … RETURNING`, así que solo lo usa uno, y usado, caducado o inventado dan la misma respuesta. El código de recuperación sigue valiendo tras canjearlo; `POST /api/v1/recovery` crea otro y anula el anterior. Un dispositivo ya emparejado no crea agenda ni canjea códigos.
- **Buzón:** *token* de solo escritura y revocable en la cabecera `Authorization`, nunca en la URL; solo acepta enlaces de la tienda de Steam. Tal como se ha construido (08-11-2026; DECISIONES §10.39 y §10.43):
  - el *token* es un `device` de tipo `inbox`: 256 bits en base64url, como la credencial de la app, y D1 guarda su SHA-256. Se crea con la cookie desde Ajustes, se ve una vez, sale en la lista de dispositivos y se revoca como los demás; revocarlo no desempareja la app que lo creó. Puede haber varios, y no vale como cookie de la app (`readDevice()` solo busca `kind = 'app'`);
  - va en `Authorization: Bearer …`. Uno sin forma de *token* da 401 sin tocar D1 ni el límite; uno con forma pasa antes por `RL_INBOX`, y si es inventado o está revocado, 401;
  - acepta `{ "url": "…" }` con un texto de hasta 2 KiB que lleve un enlace de Steam (`findSteamLink`: el que comparte la app de Steam lleva el título delante) y guarda solo el enlace canónico de la tienda (`canonicalStoreUrl`). Si pasara de 512 caracteres (`INBOX_URL_MAX`), lo guarda sin *slug*: un enlace demasiado largo rompería el esquema de la respuesta de `sync` para toda la agenda. Sin enlace, 400 `invalid_link`;
  - un juego que ya espera no se repite (200; si no, 201), y con 200 pendientes en la agenda responde 409 `inbox_full`;
  - todas sus respuestas llevan un `message` en español, que es lo que enseña el Atajo, también las de error que salen antes de la ruta (interruptor, tipo de contenido, tamaño y cuerpo).
- **`resolve`** (DECISIONES §10.40 y §10.43): valida el `appid` (1 a 10 cifras, sin ceros delante y de 32 bits; si no, 404 sin llamar a nadie) y pregunta a `IStoreBrowseService/GetItems/v1` sin clave, en español y para España (y para EE. UU. si allí está bloqueado), con 2 s de espera. La respuesta se lee con tope (64 KiB, `readCapped`), pasa por Zod y el nombre se limpia: sin caracteres de control y 200 caracteres como mucho. Es un GET que escribe en la caché, pero son datos públicos y nada de un usuario cambia. La app lo pide sin cookies (`credentials: 'omit'`), sin `Referer` y sin caché, y solo si sincroniza (ver §7.3): viaja el `appid`, y la IP llega a Cloudflare como con cualquier fichero de la app.
- **Peticiones:** nada cambia por GET; el resto exige `Content-Type: application/json` y `Origin` propio, salvo el buzón: el Atajo de iOS no envía `Origin` (a verificar en el iPhone; si lo enviara, da igual), así que esa ruta no lo comprueba ni acepta la cookie, solo su *token*, aunque sí exige JSON. La app manda todas sus peticiones a la micro-API con `referrerPolicy: 'no-referrer'`: con la `Referrer-Policy` global, `Referer` llevaba la ruta y la consulta de la página (búsquedas, filtros, fichas). Zod rechaza campos desconocidos, cada ruta tiene tamaño máximo y no se aceptan HLC más de 5 min por delante del servidor: cada respuesta de `sync` trae la hora del servidor, con la que el cliente corrige su desfase y vuelve a sellar lo rechazado (ver §7.4). `Cache-Control: no-store` y registros sin cuerpos ni *tokens*. Solo se llama a `api.steampowered.com` (en Fase 2, también a `steamcommunity.com`): nunca es un *proxy* abierto.
- **Rate limiting** en las rutas sin autenticar (crear agenda, canjear emparejamiento o código, `resolve`; en Fase 2, las de Steam) y por *token* en el buzón, con el *binding* `ratelimits` (10 o 60 s; contadores aproximados por ubicación; plan gratuito a verificar al desplegar: la documentación no lo dice). Crear agenda (`RL_AGENDA`), 5 por minuto, y canjear un código (`RL_REDEEM`), 10 por minuto; al *binding* le llega el SHA-256 de la IP, no la IP (ADR-011). Desde el 08-11-2026, también `resolve` (`RL_RESOLVE`), 30 por minuto y por IP, y el buzón (`RL_INBOX`), 30 por minuto y por el SHA-256 del *token*. Adivinar ≥128 bits es inviable: el límite protege la cuota gratuita de 100 000 peticiones/día, y si se agota, buscar y apuntar siguen funcionando (ver §5).

Fuentes: <https://developers.cloudflare.com/workers/static-assets/headers/> · <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>
