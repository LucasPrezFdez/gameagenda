# ADR-013 · Llaves de acceso: otra forma de abrir la agenda sincronizada, sin email ni contraseña

- **Estado:** propuesta. Construida el 20-11-2026 en la rama `llaves-acceso` (abajo, «Construida»). Pendiente de la prueba del usuario en sus dispositivos.
- **Fecha:** 20-11-2026 (después de M4, a petición del usuario)
- **Deciden:** el usuario y el asistente

## Contexto y problema

Con la sincronización (ADR-011), la agenda está en D1 y se abre en otro dispositivo de dos formas:

- con un código de emparejamiento de 10 min, que hay que pedir desde un dispositivo ya emparejado;
- con el código de recuperación (28 símbolos), que se enseña una sola vez al activar.

Sin otro dispositivo a mano y sin el código, la agenda no se puede recuperar. Es lo que preocupa al usuario («el miedo a perder los datos», 20-11-2026).

El usuario preguntó por crear una cuenta. El asistente desaconsejó el email con contraseña:

- una contraseña bien guardada necesita un *hash* lento, de cientos de milisegundos, y el plan gratuito de Workers da 10 ms de CPU;
- hay que enviar correos para verificar la dirección y para recuperar la contraseña;
- el email es un dato personal, y §2 y RNF-10 dejan fuera las cuentas;
- abre ataques que hoy no existen, como probar contraseñas robadas en otros sitios.

Propuso en su lugar las llaves de acceso (*passkeys*), y el usuario respondió: «prepara lo de las llaves de acceso».

**Pregunta:** ¿cómo se abre la agenda en un dispositivo nuevo, o tras perderlos todos, con una llave guardada en iCloud, Google o Windows? Sin email, sin contraseña, sin datos personales nuevos y en el plan gratuito.

## Factores de la decisión

- **Privacidad (§11.2, RNF-10):**
  - sin email, nombre ni IP;
  - solo datos que no identifican a nadie;
  - los textos legales, al día antes de encenderlo.
- **0 €:** 10 ms de CPU por invocación y ningún servicio de pago.
- ***Local-first*:** la app nunca necesita una llave para funcionar. Solo sirve para unirse a la agenda.
- **Dónde se usa:**
  - el iPhone (Safari y la app en la pantalla de inicio) y Android;
  - Windows: Edge, Chrome y la app de escritorio (WebView2);
  - Firefox.
- **El código de recuperación sigue siendo la vía universal:** las llaves no pasan solas de iCloud a Windows.
- **Seguridad (§11.4):** las mismas reglas que el resto de la micro-API: `Origin` propio, Zod estricto, límites por IP y retos de un solo uso.
- **Lo que se mantiene:** cuanto menos código propio de criptografía, mejor, pero el arranque en frío de la micro-API lo pagan todas sus rutas.

## Opciones consideradas

1. **Llaves de acceso (WebAuthn) detectables**, verificadas en la micro-API con código propio y `crypto.subtle`.
2. **Llaves de acceso con una librería**, como `@simplewebauthn/server`.
3. **Cuenta con email:** con contraseña, o con un enlace por correo.
4. **La cuenta de Steam como llave**, con el inicio de sesión de OpenID de la Fase 2 (ADR-012).

## Paso 0: lo comprobado (20-11-2026)

- **La app de escritorio** (WebView2, Edge 157) está abierta oculta con `--remote-debugging-port` y se le pregunta solo por lectura:
  - `PublicKeyCredential` existe;
  - `isUserVerifyingPlatformAuthenticatorAvailable()` da `true` (Windows Hello);
  - `getClientCapabilities()` da `passkeyPlatformAuthenticator`, `hybridTransport` (el móvil por QR), `relatedOrigins`, `signalUnknownCredential` y `signalAllAcceptedCredentials`;
  - `getPublicKey()` y `parseCreationOptionsFromJSON` existen.
- **La cabecera de producción las bloquea:** `Permissions-Policy` lleva `publickey-credentials-get=()`. En la app de escritorio, `allowsFeature('publickey-credentials-get')` da `false`. La vista previa de los E2E no sirve `_headers`, así que ninguna prueba lo habría visto.
- **El autenticador virtual de Chromium (CDP), con Playwright**, en un origen de prueba:
  - crear una llave detectable con UV;
  - `getPublicKey()` da la SPKI;
  - el servidor comprueba el reto, el origen, el *hash* del `rp.id`, las marcas UP, UV y AT, y el id dentro de `authenticatorData`;
  - entrar sin decir qué llave;
  - la firma se verifica en Node con `crypto.subtle`, sin librerías, y una firma tocada se rechaza;
  - todo eso funciona con los tres algoritmos: Ed25519, ES256 (pasando la firma de DER a `r‖s`) y RS256;
  - cada verificación tarda entre 0,76 y 0,98 ms (en Node, con el reloj de pared);
  - la llave, copiada a otro contexto (`WebAuthn.getCredentials` y `addCredential`), abre lo mismo: así será el E2E.
- **Tamaño:** el código va en el *chunk* de Ajustes, junto a la sincronización, y no toca el JS inicial (143,3 KB de 150).

## Decisión

Opción elegida: **la 1, llaves de acceso detectables con verificación propia**, porque:

- abren la agenda sin otro dispositivo y sin teclear el código;
- no guardan nada que identifique a nadie;
- no se pueden suplantar con una página falsa (*phishing*);
- caben en el plan gratuito;
- la app de escritorio ya las admite.

La verificación propia son unas 150 líneas sobre `crypto.subtle`. Una librería traería CBOR, ASN.1 y formatos de atestación que no se usan, y alargaría el arranque en frío de todas las rutas de la micro-API.

### Qué hace una llave

- **Lo mismo que el código de recuperación:** da de alta un dispositivo nuevo en la agenda, con su cookie. No sustituye ni al código ni al emparejamiento.
- **El código se sigue enseñando una vez al activar.** Una llave de iCloud no se ve en Windows, salvo con el QR del propio sistema.
- **Crearla:**
  - desde un dispositivo sincronizado, en Ajustes › Sincronización › «Llaves de acceso» › «Crear una llave de acceso»;
  - también se ofrece justo después de enseñar el código de recuperación al activar, con «Ahora no». Es lo que más ayuda contra el miedo a perder los datos.
- **Entrar:** en la vista sin sincronizar, «Entrar con una llave de acceso», junto a «Tengo un código». El navegador enseña las llaves de este sitio, sin pedir usuario. Después, igual que con el código: baja la agenda.
- **La lista:**
  - cada llave lleva el nombre del dispositivo donde se creó (el mismo de la lista de dispositivos), cuándo se creó y cuándo se usó por última vez;
  - «Quitar» la borra de D1 y pide al navegador que la olvide (`signalUnknownCredential`, donde exista). Si no, la app explica cómo quitarla del llavero.
- **«Borrar todos mis datos»** se lleva las llaves en cascada y avisa al navegador (`signalAllAcceptedCredentials` con la lista vacía, donde exista).
- **Como mucho, 10 llaves por agenda.**

### Parámetros de WebAuthn

- **`rp.id`:** el *host* de la app (`ga-web.gameagenda.workers.dev`), sacado de la petición, el mismo origen que ya exige `requestRules`. En los E2E, `localhost`.
- **`user.id`:** 32 bytes aleatorios por agenda (`agenda.passkey_user_id`), no el id de la agenda.
- **`user.name` y `displayName`:** un texto fijo que reconozca el llavero, como «Mi agenda de GameAgenda».
- **El resto:**
  - `residentKey: 'required'`, `userVerification: 'required'` y `attestation: 'none'`;
  - algoritmos -8 (Ed25519), -7 (ES256) y -257 (RS256, el de Windows Hello con TPM);
  - `excludeCredentials` con las llaves de la agenda, para no duplicarlas en el mismo llavero.
- **Retos:** de un solo uso, 5 min, y en D1 solo su SHA-256.

### Rutas (`apps/web/worker/routes/passkeys.ts`)

| Ruta | Cookie | Qué hace |
|---|---|---|
| `POST /api/v1/passkeys/options` | sí | Las opciones para crear una llave y un reto `create` de la agenda. |
| `POST /api/v1/passkeys` | sí | Guarda la llave nueva tras comprobarla (abajo). 201. |
| `GET /api/v1/passkeys` | sí | La lista de la agenda. |
| `POST /api/v1/passkeys/:id/remove` | sí | Quita una llave. |
| `POST /api/v1/passkeys/challenge` | no | Un reto `get`, sin agenda. Con límite por IP. |
| `POST /api/v1/passkeys/redeem` | no | Comprueba la firma y da de alta el dispositivo, como `recovery/redeem`. Con `RL_REDEEM`, y `already_paired` si ya hay cookie. |

**Al crear,** la app manda:

- `id`, `clientDataJSON` y `authenticatorData` (de `getAuthenticatorData()`);
- la clave pública en SPKI (de `getPublicKey()`) y su algoritmo;
- `transports`.

El servidor comprueba:

- que el reto existe y no ha caducado, y lo gasta (`DELETE … RETURNING`);
- en `clientDataJSON`: `type` `webauthn.create` y el origen;
- en `authenticatorData`: el SHA-256 del `rp.id`, las marcas UP, UV y AT, y que el id de la credencial coincide con `id`;
- que el algoritmo está en la lista y la clave se importa con él.

La clave llega del cliente para no leer CBOR en el servidor. El que la manda ya es un dispositivo de la agenda, así que mentir solo estropearía su propia agenda.

**Al entrar,** el servidor comprueba:

- el reto, `type` `webauthn.get`, el origen, el *hash* del `rp.id` y las marcas UP y UV;
- la firma sobre `authenticatorData ‖ SHA-256(clientDataJSON)`, con la clave guardada;
- el contador: solo se rechaza si el guardado y el nuevo son mayores que 0 y el nuevo no sube. Las llaves sincronizadas mandan 0.

Cualquier fallo responde lo mismo, `invalid_passkey`, como `invalid_code`.

### Verificación (`apps/web/worker/webauthn.ts`)

- **ES256:** ECDSA P-256 con SHA-256. La firma llega en DER y WebCrypto la quiere en `r‖s` de 64 bytes.
- **Ed25519:** la admiten Workers y Node 24.
- **RS256:** RSASSA-PKCS1-v1_5 con SHA-256.
- **CPU:** una verificación debería costar menos de 1 ms. Se medirá como en CA4.6.

### Esquema de D1 (`worker/migrations/0004_llaves.sql`)

Solo añade, así que vale con el código de antes:

- `agenda.passkey_user_id TEXT`, que se crea al pedir las primeras opciones;
- **`passkey`:**
  - `id` (el de la credencial, en base64url);
  - `agenda_id`, con `ON DELETE CASCADE`;
  - `public_key` (SPKI), `alg`, `sign_count` y `transports`;
  - `label`, `created_at` y `last_used_at`;
  - con un índice por agenda;
- **`webauthn_challenge`:** `challenge_hash`; `agenda_id`, nula en los de `get`; `kind` (`create` o `get`); y `expires_at`. El *cron* de cada 5 min, que ya purga los *tickets* de Steam, purga también estos.

### En la app

- `src/sync/passkeys.ts`, en el *chunk* de Ajustes:
  - base64url;
  - `navigator.credentials.create()` y `get()`;
  - si no hay `PublicKeyCredential`, el botón no sale.
- La fachada y el *runtime* de la sincronización: `createPasskey()`, `redeemPasskey(label)`, `listPasskeys()` y `removePasskey(id)`.
- `SyncPanel.tsx`:
  - «Entrar con una llave de acceso» en la vista sin sincronizar;
  - la sección «Llaves de acceso» en la sincronizada;
  - la oferta tras el código de recuperación.
- Cancelar el diálogo del navegador (`NotAllowedError`) no es un error: se vuelve sin mensaje.

### Cabeceras

- **`_headers`:** `publickey-credentials-get=(self)` y `publickey-credentials-create=(self)`.
- **Una prueba lee `_headers`** y comprueba las dos.

### Interruptor

- `PASSKEYS_ENABLED`, como `STEAM_ENABLED`. Apaga las seis rutas sin apagar la sincronización, por si aparece un fallo.
- La app esconde los botones si la micro-API responde `passkeys_disabled`.

### Textos legales (versión 4)

- **La política dice qué se guarda:**
  - la clave pública y el identificador de cada llave;
  - el nombre del dispositivo donde se creó y las fechas;
  - la huella o la cara nunca salen del dispositivo;
  - todo se borra al quitar la llave o con la agenda.
- **El registro de actividades,** al día.

### Consecuencias

- **Bien, porque:**
  - se abre la agenda sin otro dispositivo y sin el código: basta con la llave del llavero de iCloud, Google o Windows, que sobrevive a perder el móvil;
  - no hay ningún dato personal nuevo ni nada en el servidor que sirva para entrar en otro sitio;
  - una página falsa no puede usar la llave (la firma lleva el origen);
  - 0 €, y la app de escritorio ya las admite.
- **Mal, porque:**
  - **las llaves van atadas al dominio** (`ga-web.gameagenda.workers.dev`). Si la app cambia de dominio, hará falta declarar el nuevo en `/.well-known/webauthn` (*Related Origin Requests*; la app de escritorio lo admite y Safari está por comprobar). Si no, se pierden. El código de recuperación seguiría valiendo;
  - las llaves no pasan solas de un sistema a otro (iCloud ↔ Windows): entre los dos, el QR del sistema o el código;
  - quien tenga el llavero desbloqueado puede abrir la agenda, como con un código guardado en el gestor de contraseñas;
  - seis rutas más en la micro-API, y criptografía propia, aunque corta y con pruebas.
- **Pendiente:**
  - comprobar en el iPhone si la app de la pantalla de inicio admite llaves (en Safari, sí);
  - Android;
  - el QR entre el móvil y el PC.

### Confirmación

- **`webauthn.test.ts`:** un autenticador simulado con claves de Node (Ed25519, P-256 y RSA). Casos:
  - la llave buena;
  - un reto gastado, caducado o de otra agenda;
  - `type` cambiado, otro origen u otro `rp.id`;
  - sin UV;
  - la firma tocada;
  - el contador que baja;
  - una llave desconocida o de otra agenda.
- **Las rutas, con el arnés de la micro-API:**
  - crear, listar y quitar;
  - entrar, que da dispositivo y cookie;
  - `already_paired`, los límites y la cascada al borrar la agenda.
- **E2E en Chromium con el autenticador virtual de CDP** (`WebAuthn.addVirtualAuthenticator`: `ctap2`, `internal`, con *resident key* y UV):
  - crear la llave en un contexto y copiarla a otro (`WebAuthn.getCredentials` y `addCredential`);
  - «Entrar con una llave de acceso» abre la misma agenda;
  - cancelar y quitar.
  WebKit no tiene autenticador virtual, así que se salta.
- **La prueba de `_headers`.**
- **A mano, el usuario:**
  - el iPhone, con Face ID e iCloud;
  - Windows Hello, en Edge y en la app de escritorio;
  - del móvil al PC con el QR.

## Construida (20-11-2026)

El usuario dio el visto bueno a la propuesta («si»). Se hizo como arriba, con estos detalles:

- **Servidor:** `worker/webauthn.ts` (la verificación), `worker/routes/passkeys.ts` (las seis rutas) y la migración `0004_llaves.sql`. El reto de crear se busca y se gasta con el que dice `clientDataJSON`, y solo si es de la agenda del dispositivo. Una llave que ya estaba no se pisa (`ON CONFLICT DO NOTHING`), y su nombre es el del dispositivo que la crea, leído de D1.
- **App:**
  - `src/sync/passkeys.ts`, en el *chunk* diferido del motor, con `navigator.credentials`;
  - los métodos nuevos de la fachada y del *runtime*;
  - la pantalla, en `SyncPanel.tsx`: `PasskeyJoin`, `PasskeyOffer` y `PasskeysSection`.
- **Errores del navegador:**
  - `NotAllowedError` (cerrar el diálogo) es `passkey_cancelled`, y la pantalla no dice nada;
  - `InvalidStateError` al crear es `passkey_exists`;
  - lo demás, `passkey_failed`.
- **Señales:** al quitar una llave y al borrar la agenda, sí se avisa al llavero. Al entrar con una llave que ya no vale, no: el servidor responde lo mismo que con un reto caducado, y se borraría del llavero una llave buena.
- **La vista previa de los E2E sirve la `Permissions-Policy` de `_headers`** (`vite.config.ts`). Con la cabecera antigua, el E2E falla al entrar con la llave (comprobado).
- **E2E por `localhost`:** la vista previa escucha en `127.0.0.1`, y una IP no vale como `rp.id`.
- **Comprobado:** `check` en verde (1 511 pruebas; JS inicial de 144,0 KB, antes 143,3, por los textos), y los dos E2E de Chromium, 6 de 6 al repetirlos. El detalle, en DECISIONES §10.52.

## Pros y contras de las opciones

### 1. Llaves detectables, verificación propia

- Bien: sin datos personales, sin *phishing*, 0 € y menos de 1 ms de CPU por verificación.
- Bien: sin dependencias. La clave llega en SPKI y no hace falta leer CBOR.
- Mal: criptografía propia, aunque corta (tres algoritmos) y con pruebas de cada rechazo.

### 2. Llaves con `@simplewebauthn/server`

- Bien: una librería probada que lee CBOR y todas las atestaciones.
- Mal: trae código que no se usa (atestación `none`) y alarga el arranque en frío de todas las rutas de `/api/*`.
- Mal: otra dependencia que auditar y fijar (§6).

### 3. Cuenta con email

- Bien: es lo que la gente conoce, y recupera aunque se pierda todo.
- Mal, con contraseña: el *hash* lento no cabe en 10 ms de CPU, y probar contraseñas robadas en otros sitios funcionaría.
- Mal, con enlace por correo: hace falta un servicio de envío.
- Mal: el email es un dato personal más; amplía la política y el registro; §2 lo excluye.

### 4. La cuenta de Steam como llave

- Bien: el inicio de sesión de Steam ya está hecho (ADR-012), y casi todos los usuarios tienen cuenta.
- Mal: ata la agenda al SteamID, que se guardaría en D1, y rompe lo que dice hoy la política: «15 min como mucho».
- Mal: depende de que el OpenID de Steam funcione, y no sirve a quien no tenga Steam.

## Más información

- [ADR-011](011-sincronizacion.md): la sincronización, las credenciales y el código de recuperación.
- [ADR-012](012-cuenta-de-steam.md): el inicio de sesión con Steam.
- `prototipe.md`:
  - §2 y RNF-10: sin cuentas;
  - §11.2 y §11.4: la privacidad y las reglas de la micro-API;
  - §15.7: los criterios de M4.
- WebAuthn Level 3 (W3C) y la API de señales (`signalUnknownCredential`).
