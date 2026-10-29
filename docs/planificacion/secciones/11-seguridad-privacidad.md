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
| Antes del primer probador externo y de M4 | Política completa por capas, aviso legal y registro de actividades (Facilita RGPD, de la AEPD) |
| M4 (agenda en D1, UE) | Base del art. 6.1.b RGPD, declaración de edad, retención y borrado en el servidor |

Quienes hacen la prueba guiada de M3 (ver §2.4) en el móvil y el PC del desarrollador, sin datos propios, no cuentan como probadores externos.

- **Aviso de primera capa** (texto en la §9.9): sale la primera vez que se cargan portadas, solo informa, ofrece desactivarlas y su «Más información» abre la pantalla «Datos de Steam que guardamos» (M2), que enlazará con la política completa cuando exista. Base propuesta: interés legítimo (art. 6.1.f) con oposición en un toque, a validar al redactar la política. Precedente: condena del LG München I (3 O 17493/20, 2022) por enviar la IP a Google Fonts sin base jurídica.
- **Capas y derechos:** la primera capa (art. 11 LOPDGDD) da identidad y contacto del responsable, finalidad y derechos (arts. 15–22). Acceso y portabilidad = exportar; supresión = borrar en el dispositivo y, en M4, en el servidor; plazo de un mes (art. 12.3 RGPD).
- **Cookie de dispositivo:** es persistente, y el GT29 (WP194) solo exime las de autenticación persistentes si el usuario las pide: la crea un gesto explícito («Activar sincronización» o «Emparejar»), que informa en ese momento.
- **Menores:** al activar la sincronización se declara tener ≥14 años (art. 7 LOPDGDD); es un parámetro, porque el proyecto de ley 121/000052 la subiría a 16.
- **Registro de actividades:** obligatorio, porque la exención del art. 30.5 RGPD no cubre tratamientos habituales.
- **Encargados y transferencias:** Cloudflare (hosting y Workers): la jurisdicción UE de D1 fija dónde se guarda la base, no dónde se ejecuta la micro-API (en el centro de datos más cercano al usuario), y solo se elige al crearla (`--jurisdiction=eu`; plan gratuito, a verificar en M4). La IP llega a Valve en EE. UU. por las portadas. La política nombra a ambos y la base de cada transferencia a EE. UU. (Marco de Privacidad de Datos UE-EE. UU. o cláusulas tipo, a verificar). GitHub (EE. UU.) solo guarda el estado del pipeline, sin datos personales.

**Retención.** Time Travel de D1 está siempre activo: lo borrado se puede restaurar durante 7 días (plan gratuito), y así se declara.

| Dato | Dónde | Retención |
|---|---|---|
| Agenda y ajustes | Dispositivo | Hasta que el usuario los borre |
| Agenda sincronizada | D1 (UE) | Mientras exista; se borra al pedirlo |
| *Hashes* de credenciales (dispositivo, buzón, recuperación) y de emparejamiento | D1 | Hasta revocarlas o borrar la agenda; los de emparejamiento, 10 min |
| Lápidas | Dispositivo | No se purgan antes de M4; después, las ya sincronizadas, 90 días tras el borrado (ver §7.4 y §7.7) |
| Lápidas | D1 | 90 días tras el borrado (purga semanal, ver §7.7) |
| Agenda sin sincronizar en 13 meses | D1 | Se borra (propuesta) |
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
- **Cadena de suministro:** `save-exact=true`, *lockfile* y `npm ci`; *actions* fijadas por SHA con `permissions` mínimos; Dependabot semanal; secretos solo en los flujos que los usan (ver §12). El *token* de Cloudflare tiene el mínimo permiso, pero «Workers Scripts: Edit» abarca toda la cuenta: un pipeline comprometido (procesa datos no confiables) podría desplegar `ga-web`. Si en M0 se confirma que no se puede limitar a un *script*, `ga-catalog` pasa a otra cuenta gratuita con su propio *token*.
- **Integridad del catálogo:** *manifest* firmado con ed25519 (privada solo en un secreto de GitHub; pública en la app, con hueco para una segunda para rotarla). Desde M2, el PC nunca firma ni despliega `ga-catalog`: si el pipeline se lanza desde el PC (429 en los *runners* compartidos o falta de minutos), solo descarga y construye, y sube el resultado como *asset* de la *Release* de preparación `catalog-staging`; después, `catalog.yml` (`workflow_dispatch` con `source=staging`) pasa las puertas, firma y publica (ver §4.5). El cliente verifica la firma con WebCrypto (a verificar en M2 en los navegadores objetivo) y el `sha256` de cada fichero antes de sustituir el catálogo, y rechaza una `version` anterior a la suya (volver a un catálogo anterior es republicar sus ficheros con una `version` nueva): ni el CDN ni un *token* de Cloudflare robado cuelan un catálogo o un *kill switch* falsos.

### 11.4 Micro-API y emparejamiento (M4)

- **Credencial de dispositivo:** cookie `__Host-` `HttpOnly` `Secure` `SameSite=Lax` con 256 bits aleatorios; el servidor guarda solo su SHA-256. Ni el JavaScript ni un XSS la leen, y no le afecta la purga de 7 días de WebKit sobre lo que escriben los *scripts* (prueba en un iPhone real, ver §15). Chrome limita las cookies a 400 días: se renueva al sincronizar, como mucho una vez al día. En Ajustes se ven y se revocan los dispositivos.
- **Emparejar:** *token* de un solo uso, ≥128 bits y 10 min, en QR y como texto. Se canjea con un POST desde dentro de la app, nunca con un GET (una vista previa de enlaces lo gastaría); si va en una URL, en el fragmento (`#`), que no llega al servidor. Solo se guarda su *hash*, como el del código de recuperación (128 bits, se muestra una vez).
- **Buzón:** *token* de solo escritura y revocable en la cabecera `Authorization`, nunca en la URL; solo acepta enlaces de la tienda de Steam.
- **Peticiones:** nada cambia por GET; el resto exige `Content-Type: application/json` y `Origin` propio, salvo el buzón: el Atajo de iOS no envía `Origin` (a verificar en M4), así que esa ruta no lo comprueba ni acepta la cookie, solo su *token*. Zod rechaza campos desconocidos, cada ruta tiene tamaño máximo y no se aceptan HLC más de 5 min por delante del servidor: cada respuesta de `sync` trae la hora del servidor, con la que el cliente corrige su desfase y vuelve a sellar lo rechazado (ver §7.4). `Cache-Control: no-store` y registros sin cuerpos ni *tokens*. Solo se llama a `api.steampowered.com` (en Fase 2, también a `steamcommunity.com`): nunca es un *proxy* abierto.
- **Rate limiting** en las rutas sin autenticar (crear agenda, canjear emparejamiento o código, `resolve`; en Fase 2, las de Steam) y por *token* en el buzón, con el *binding* `ratelimits` (10 o 60 s; contadores aproximados por ubicación; plan gratuito a verificar en M4). Adivinar ≥128 bits es inviable: el límite protege la cuota gratuita de 100 000 peticiones/día, y si se agota, buscar y apuntar siguen funcionando (ver §5).

Fuentes: <https://developers.cloudflare.com/workers/static-assets/headers/> · <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>
