# ADR-014 · Cuentas: email y contraseña sobre la agenda sincronizada, y Steam vinculado que se actualiza solo

- **Estado:** propuesta. Construida el 26-11-2026 (abajo, «Construida»).
- **Fecha:** 26-11-2026 (Fase 2, a petición del usuario)
- **Deciden:** el usuario y el asistente

## Contexto y problema

El 26-11-2026 el usuario pidió «implementar las cuentas personales, sistema de registro, logueo y que cada usuario pueda tener su cuenta vinculada a su steam para guardar ahí sus juegos».

**Lo que ya hay:** casi todo, aunque no se llama «cuenta».

- La agenda sincronizada (ADR-011) guarda los juegos en D1 y se abre en otros dispositivos. Activar la sincronización es, en la práctica, registrarse.
- Hoy se entra de tres formas:
  - el código de emparejamiento;
  - el código de recuperación;
  - la llave de acceso (ADR-013).
- El inicio de sesión con Steam (ADR-012) solo sirve para importar. El SteamID64 se queda en D1 15 min como mucho, así que cada importación vuelve a pedir que se inicie sesión en Steam.

**Lo que falta:**

- que la app lo presente como una cuenta, con «Crear cuenta», «Iniciar sesión» y «Cerrar sesión»;
- una forma de entrar que todo el mundo conoce: el email y la contraseña;
- que la cuenta de Steam quede vinculada, para que la biblioteca se actualice sin volver a iniciar sesión en Steam.

**Lo que eligió el usuario el 26-11-2026**, entre las opciones que le dio el asistente:

- **Para entrar:** «Email y contraseña». Descartó entrar con Steam, el usuario con contraseña sin email y el email con un código.
- **Steam vinculado:** «Actualizar sola». Descartó actualizar con un toque y usar Steam solo para entrar.
- **La cuenta:** opcional, como recomendaba el asistente.
- **Correos:** «0 €, sin correos de momento». Descartó comprar un dominio con Resend (unos 10 $ al año) y un dominio con Workers Paid y Cloudflare Email Sending (unos 70 $ al año). Lo comprobado ese día:
  - Cloudflare Email Sending, en el plan gratuito, solo envía a direcciones verificadas de la propia cuenta. Para enviar a cualquiera hacen falta Workers Paid y un dominio propio.
  - Resend da 100 correos al día gratis, pero con un dominio propio.
  - La app está en `workers.dev`, sin dominio.

**Una corrección al ADR-013.** Ese ADR desaconsejaba la contraseña porque «el *hash* lento no cabe en 10 ms de CPU». En el servidor no cabe, pero el trabajo lento se puede hacer en el dispositivo, como hace Bitwarden. Así, el Worker solo calcula un HMAC.

**Pregunta:** ¿cómo se crea una cuenta con email y contraseña y se entra con ella? Y ¿cómo se vincula Steam para que la biblioteca se actualice sola? Todo en el plan gratuito, sin enviar correos y sin que la app necesite la cuenta para funcionar.

## Factores de la decisión

- **0 €:**
  - el plan gratuito de Workers, con 10 ms de CPU por invocación;
  - ningún servicio de pago;
  - ningún dominio.
- ***Local-first* y captura rápida:**
  - la cuenta es opcional, y sin ella la app es la de hoy;
  - el arranque no cambia (ADR-009);
  - la actualización de Steam corre después de la primera pintura.
- **Privacidad (§11.2):** solo lo necesario. Lo nuevo en D1:
  - el email, solo para buscar la cuenta;
  - lo que comprueba la contraseña, que no la descubre;
  - el SteamID64 vinculado;
  - los textos legales, al día antes de encenderlo.
- **Seguridad (§11.4 y OWASP ASVS):**
  - un error igual para un email desconocido y para una contraseña mala;
  - límites por IP y por email;
  - comparación en tiempo constante;
  - sin reglas de composición, con el pegado permitido y los gestores de contraseñas funcionando.
- **Funciona en todas partes:**
  - una pestaña;
  - la PWA de iOS;
  - la app de escritorio (WebView2);
  - Firefox.
- **ToU de Steam (§11.1):**
  - ≤100 000 llamadas al día;
  - los datos, solo a petición del usuario: vincular con «Actualizar sola» es esa petición, y se puede apagar.
- **Preparado para los correos:** cuando haya dominio, verificar el email y «He olvidado mi contraseña» se añaden sin rehacer nada.

## Opciones consideradas

**A. Dónde se hace el *hash* lento de la contraseña**

1. PBKDF2 en el dispositivo con WebCrypto (600 000 vueltas, SHA-256) y un HMAC con un secreto en el Worker.
2. Argon2id en el dispositivo (WASM) y el mismo HMAC.
3. PBKDF2 en el Worker. Workers admite como mucho 100 000 vueltas, y aun así se pasa de 10 ms.
4. Workers Paid (30 s de CPU) con el *hash* en el servidor: 5 $ al mes.

**B. Cómo se guarda el email**

1. Solo su HMAC, con el mismo secreto: sirve para buscar la cuenta y para que no se repita, pero no se puede leer.
2. En claro.

**C. Dónde vive el vínculo con Steam**

1. El SteamID64 en D1, en una tabla de la agenda.
2. Un pase cifrado sin caducidad, que solo guarda el dispositivo, como el de `steam-token.ts`. Para que lo vean los demás dispositivos tendría que viajar también a D1.

## Decisión

Opciones elegidas: **A1, B1 y C1**:

- **A1:** cabe en el plan gratuito y no añade dependencias. Para quien robe D1, cada contraseña que pruebe cuesta 600 000 vueltas de PBKDF2.
- **B1:** la cuenta funciona sin poder leer el email, y una copia de D1 no lo enseña.
- **C1:** el vínculo tiene que verse desde todos los dispositivos de la cuenta, y el SteamID64 ya es público en el perfil de Steam.

### Qué es una cuenta

- **Una cuenta es la agenda sincronizada de ADR-011 con un email y una contraseña.** No es una entidad nueva: la agenda, sus dispositivos, el código de recuperación y las llaves de acceso siguen igual.
- **Lo que ya existe no cambia:**
  - una agenda sin email sigue valiendo;
  - la del usuario pasa a ser su cuenta al añadirle el email y la contraseña;
  - no se pierde nada.
- **Formas de entrar:**
  - el email y la contraseña;
  - la llave de acceso;
  - el código de recuperación;
  - el código de emparejamiento.
- **En la app,** Ajustes › «Sincronización» pasa a llamarse «Cuenta».

### La contraseña, en el dispositivo

- **El email se normaliza:**
  - se quitan los espacios de los extremos;
  - pasa a NFC y a minúsculas;
  - tiene que llevar una `@` y como mucho 254 caracteres. No se comprueba nada más, porque no se envía ningún correo.
- **La sal sale del email:** `SHA-256("gameagenda/cuenta/v1\0" ‖ email)`. Así no hace falta preguntar al servidor por ella, y no hay una ruta que diga si un email existe.
- **La clave:** `authKey = PBKDF2-HMAC-SHA256(contraseña en NFC, sal, 600 000 vueltas, 256 bits)`. Es la cifra de OWASP para PBKDF2-SHA256. Va con su versión (`kdf: "pbkdf2-sha256-600000"`) para poder subirla más adelante.
- **La contraseña nunca sale del dispositivo:** solo viaja `authKey`.
- **Reglas de la contraseña** (NIST SP 800-63B):
  - de 12 a 128 caracteres;
  - sin reglas de composición;
  - no puede ser el email.
- **Tiempo:**
  - se medirá en el Android de referencia, el iPhone y la app de escritorio;
  - el objetivo es menos de 1,5 s;
  - mientras tanto, el botón dice «Comprobando…».

### En el Worker

- **Secreto nuevo, `ACCOUNT_PEPPER`:**
  - 32 bytes aleatorios en los secretos del Worker;
  - una copia en el gestor de contraseñas del usuario;
  - si se pierde, nadie puede entrar con email, pero las llaves y los códigos siguen valiendo, y cada uno vuelve a poner su email y su contraseña desde un dispositivo con sesión;
  - no sale de `STEAM_WEB_API_KEY`: renovar la clave de Steam no puede echar a todo el mundo.
- **El email:** `email_hash = HMAC-SHA256(ACCOUNT_PEPPER, "email\0" ‖ email)`, con índice único. El servidor vuelve a normalizar el email que recibe.
- **La contraseña:** `verifier = HMAC-SHA256(ACCOUNT_PEPPER, "pw\0" ‖ sal_servidor ‖ authKey)`, con 16 bytes aleatorios de `sal_servidor` por cuenta. Se compara en tiempo constante.
- **CPU:** dos HMAC, menos de 0,1 ms.

### Rutas (`apps/web/worker/routes/account.ts`)

Siguen las reglas de la §11.4: `Origin` propio, JSON, Zod estricto, el cuerpo con tope (1 KiB) y nada en el registro.

| Ruta | Cookie | Qué hace |
|---|---|---|
| `POST /api/v1/account` | no | Crea la agenda y su cuenta (email, `authKey`, `kdf`, edad y nombre del dispositivo) y da dispositivo, cookie y código de recuperación, como `POST /api/v1/agenda`. 409 `email_taken`. Con `RL_AGENDA`. |
| `POST /api/v1/account/login` | no | Email, `authKey` y nombre del dispositivo: da un dispositivo nuevo y la cookie, como `recovery/redeem`. 401 `invalid_login`, igual si el email no existe que si la contraseña no vale. Con `already_paired`, `RL_LOGIN` y el freno por email (abajo). |
| `GET /api/v1/account` | sí | `{ hasLogin, steam: { linkedAt, refreshedAt } \| null }`. |
| `POST /api/v1/account/login-details` | sí | Pone o cambia el email y la contraseña de la agenda del dispositivo. 409 `email_taken`. No echa a ningún dispositivo. |
| `POST /api/v1/account/login-details/remove` | sí | Quita el email y la contraseña. La agenda sigue. |

- **Con la cookie basta para cambiar la contraseña**, igual que hoy basta para borrar la agenda o echar dispositivos. «He olvidado mi contraseña» se resuelve así:
  1. se entra con la llave de acceso o el código de recuperación;
  2. se cambia en Ajustes › Cuenta.
- **El freno por email,** en la tabla `login_throttle`:
  - 10 fallos en una hora bloquean ese email una hora, con 429 `too_many_attempts`;
  - cuenta también los emails que no existen, para que el bloqueo no diga cuáles sí;
  - lo purga el *cron* de cada 5 minutos.
- **`RL_LOGIN`:** 10 por minuto y por el SHA-256 de la IP.
- **Al crear una cuenta, decir que el email ya existe es inevitable sin correos.** Lo frena `RL_AGENDA`, que da 5 por minuto y por IP.

### En la app (Ajustes › Cuenta)

- **Sin sesión:**
  - «Crear cuenta»: email, contraseña y la edad, como hoy al activar;
  - «Iniciar sesión»;
  - debajo, «Otras formas de entrar»: la llave de acceso, «Tengo un código» y «Crear una cuenta sin email», que es lo de hoy.
- **Al crear la cuenta,** como hoy al activar:
  - el código de recuperación, que ahora también sirve si se olvida la contraseña;
  - la oferta de crear una llave de acceso.
- **Si el dispositivo ya está sincronizado:** «Añadir email y contraseña».
- **Con sesión:**
  - el email, si este dispositivo lo conoce: se guarda en local al escribirlo, porque D1 no lo tiene en claro;
  - «Cambiar la contraseña» y «Cambiar el email». Al cambiar el email se pide la contraseña, porque la sal sale del email;
  - Steam (abajo), los dispositivos, las llaves y el código de recuperación;
  - «Cerrar sesión»;
  - «Borrar mi cuenta y todos mis datos», que es el borrado de hoy.
- **Iniciar sesión en un dispositivo con juegos** los junta con los de la cuenta, como hoy un código (LWW). La pantalla lo dice antes.
- **Cerrar sesión desempareja el dispositivo.** Sus juegos se quedan en él (*local-first*), salvo que se marque «Quitar también los juegos de este dispositivo».
- **Formularios de verdad**, para que los gestores de contraseñas los guarden y rellenen:
  - un `<form>`, con `autocomplete` `email`, `new-password` y `current-password`;
  - un botón para enseñar la contraseña;
  - el pegado permitido.
- **El código va en el *chunk* de Ajustes.** El JS inicial no cambia (≤150 KB).
- **Visibilidad:** una entrada «Cuenta» o «Iniciar sesión» al pie de la barra lateral. Se decide con capturas.

### Steam vinculado

- **Vincular:**
  - en el flujo de «Importar desde Steam», si el dispositivo está sincronizado, una casilla marcada: «Vincular a mi cuenta y actualizar sola»;
  - también desde Ajustes › Cuenta › «Vincular Steam»;
  - se reutiliza el inicio de sesión de OpenID (`start` y `callback`).
- **`POST /api/v1/steam/link` `{ ticket, verifier }`**, con cookie: canjea el ticket como `redeem`, guarda el vínculo y responde lo mismo que `redeem`, con la biblioteca y el pase de los logros. La primera importación sale con su resumen, como hoy.
- **`POST /api/v1/steam/refresh`**, con cookie:
  - responde como `redeem`, si la agenda tiene vínculo;
  - como mucho una vez cada 20 h por agenda (`refreshed_at`). Si es antes, 429 `steam_refresh_too_soon`;
  - así, con varios dispositivos, solo uno actualiza cada día, y a los demás les llega por la sincronización.
- **`POST /api/v1/steam/unlink`**, con cookie: borra el vínculo.
- **Cuándo se actualiza** (`steam/auto-refresh.ts`), al abrir la app o al volver a ella, si se cumple todo esto:
  - el dispositivo está sincronizado;
  - la agenda tiene vínculo (se guarda en local tras `GET /api/v1/account`);
  - «Actualizar sola» está encendido, que viene así por defecto, se recuerda en el dispositivo y se apaga en Ajustes › Cuenta;
  - han pasado 24 h desde la última actualización.

  Corre tras la primera pintura y en un momento libre (`requestIdleCallback`). Si falla, se calla y lo intenta la siguiente vez.
- **Qué hace:**
  - el mismo `planSteamImport` y `applySteamImport` de la importación a mano, sin el resumen;
  - después, un aviso con «Deshacer» y «Ver»: «Steam: 3 juegos nuevos y 1 platinado»;
  - si no cambia nada, no avisa.
- **Los logros, al actualizar sola:** solo de los juegos jugados desde la última actualización (`rtime_last_played`) que no sean ya Platinado. Así son pocas llamadas al día, y cuentan en el contador diario global de siempre.
- **Lo quitado no vuelve.** Hoy la importación solo se salta lo que sigue en la agenda, así que, con la actualización diaria, un juego quitado volvería al día siguiente (el caso de Wallpaper Engine). Para evitarlo:
  - `planSteamImport` se salta también las lápidas;
  - las lápidas de las entradas `steam:` no se purgan a los 90 días (`isPurgeable` y la purga de `maintenance.ts`);
  - volver a apuntar el juego a mano lo revive, como hoy.

### Esquema de D1 (`worker/migrations/0005_cuentas.sql`)

Solo añade, así que vale con el código de antes:

- **`account_login`:**
  - `agenda_id` como PK, con `ON DELETE CASCADE`;
  - `email_hash`, único;
  - `pw_salt`, `pw_verifier` y `kdf`;
  - `created_at` y `updated_at`;
- **`login_throttle`:** `email_hash` como PK, `failures` y `window_start`;
- **`steam_link`:**
  - `agenda_id` como PK, con `ON DELETE CASCADE`;
  - `steam_id`;
  - `linked_at` y `refreshed_at`.

**Retención:**

- el email (su HMAC) y la contraseña (su comprobación), hasta quitarlos o borrar la cuenta;
- el SteamID64, hasta desvincular o borrar la cuenta;
- las agendas sin sincronizar en 13 meses se borran como hoy, y se llevan todo en cascada.

### Interruptor

- **`ACCOUNTS_ENABLED`:**
  - apaga las rutas de `/account` y las de `steam/link`, `refresh` y `unlink`, sin apagar la sincronización ni la importación;
  - responden 503 `accounts_disabled`, y la app esconde los botones.
- **`scripts/legal-guard.test.ts`** no deja `ACCOUNTS_ENABLED` a `"1"` sin los textos legales de la versión 6.

### Textos legales (versión 6) y el plan

- **La política dice:**
  - que se guarda el HMAC del email, no el email;
  - que la contraseña nunca sale del dispositivo;
  - que se guarda el SteamID64 vinculado y las fechas de actualización;
  - cuánto se guarda cada cosa y cómo se borra;
  - que las respuestas de Steam no se guardan, como hoy.
- **El registro de actividades,** al día.
- **`prototipe.md`:** §2 y RNF-10 pasan de «sin cuentas» a «cuenta opcional, sin datos de contacto».

### Más adelante, con dominio

- verificar el email;
- «He olvidado mi contraseña» por correo;
- entonces, guardar el email en claro, con permiso.

El HMAC del email sigue siendo la clave de búsqueda, así que no hay que migrar nada.

### Por partes

Al acabar cada parte, el usuario la ve y decide si se sigue:

1. **Servidor:** la migración, el *core* (normalizar, la sal y los esquemas), las rutas de `/account` y sus pruebas.
2. **App:** Ajustes › Cuenta (crear, entrar, cambiar y cerrar sesión), con capturas antes de seguir.
3. **Steam vinculado:**
   - `link`, `refresh` y `unlink`;
   - la actualización automática y su aviso;
   - lo quitado que no vuelve.
4. **Cierre:**
   - los textos legales (versión 6), el plan, DECISIONES y el CHANGELOG;
   - el usuario pone `ACCOUNT_PEPPER`;
   - el despliegue, con su visto bueno.

### Consecuencias

- **Bien, porque:**
  - se entra en cualquier dispositivo con algo que todo el mundo conoce, y los gestores de contraseñas lo guardan;
  - la biblioteca de Steam se pone al día sola, sin volver a iniciar sesión en Steam;
  - un juego quitado ya no vuelve con la importación;
  - 0 € y sin dependencias;
  - el servidor nunca ve la contraseña, y una copia de D1 no enseña los emails.
- **Mal, porque:**
  - **sin correos, el email no se verifica.** Alguien podría crear una cuenta con un email ajeno; su dueño vería «ese email ya tiene cuenta» y tendría que usar otro hasta que haya verificación;
  - **al registrarse se sabe si un email tiene cuenta.** Lo frenan los límites, pero no se evita;
  - **una contraseña olvidada, sin llave y sin código, es una cuenta perdida.** Los juegos de cada dispositivo se quedan en él;
  - el freno por email deja que otro bloquee una hora las entradas con contraseña de una cuenta. Las llaves, los códigos y los dispositivos con sesión siguen funcionando;
  - PBKDF2 resiste peor que Argon2id a quien tenga tarjetas gráficas, si roba D1 y el secreto;
  - `ACCOUNT_PEPPER` es un secreto más que no se puede perder;
  - el SteamID64 se guarda mientras haya vínculo, cuando hoy dura 15 min.
- **Pendiente:**
  - medir PBKDF2 en el Android de referencia, el iPhone y la app de escritorio;
  - comprobar que los gestores de contraseñas (iCloud, Google, Edge y Bitwarden) guardan y rellenan;
  - la verificación y la recuperación por correo, cuando haya dominio.

### Confirmación

- **En `core`, pruebas de:**
  - normalizar el email;
  - la sal;
  - un vector fijo de PBKDF2;
  - los esquemas estrictos de las rutas.
- **Las rutas, con el arnés de la micro-API:**
  - crear, que da cookie y código;
  - `email_taken`;
  - entrar;
  - el mismo `invalid_login` para un email desconocido y para una contraseña mala;
  - el freno por email, también con emails que no existen;
  - `already_paired`;
  - cambiar y quitar el email y la contraseña;
  - la cascada al borrar la agenda;
  - `ACCOUNTS_ENABLED`.
- **Steam:**
  - `link`, `refresh` (y su 429 antes de 20 h) y `unlink`;
  - el plan que se salta las lápidas;
  - la purga que conserva las de `steam:`.
- **E2E en Chromium y WebKit:**
  - crear una cuenta en un contexto, iniciar sesión en otro y ver la misma agenda;
  - cambiar la contraseña y entrar con la nueva;
  - cerrar sesión;
  - vincular Steam (con el Steam simulado de `e2e-api-server`) y la actualización al abrir con el reloj adelantado 24 h.
- **`legal-guard` y la puerta de tamaño.**
- **A mano, el usuario:**
  - crear la cuenta en su PC;
  - iniciar sesión en el iPhone;
  - que el gestor de contraseñas la guarde;
  - vincular su Steam.

## Construida (26-11-2026)

El usuario dio el visto bueno a la propuesta y pidió hacerlo todo de una vez («dale hazlo todo tú»). Se hizo en la rama `cuentas`, en tres partes y una de cierre: `611f873` (la micro-API), `f407dbc` (la pantalla de la cuenta) y `8b836f0` (Steam vinculado), y después los textos legales y la documentación. El detalle está en DECISIONES §10.58. Lo que cambió respecto a la propuesta:

- **La sección se llama «Cuenta y sincronización»,** no «Cuenta». Dice qué hay dentro, y los nombres de siempre («Sincronización») siguen encontrándose.
- **La pantalla sin sesión:**
  - arriba, «Tu cuenta», con el conmutador «Iniciar sesión / Crear cuenta». Sale «Crear cuenta» si el dispositivo no conoce ningún email, e «Iniciar sesión» si lo conoce;
  - el nombre del dispositivo;
  - «Otras formas de entrar»: un código, una llave y «Sincronizar sin email». Esta última va en un desplegable cerrado, cuyo contenido solo existe abierto; así la casilla de la edad y el aviso no salen dos veces.
- **Desemparejado,** solo «Volver a iniciar sesión»: no se crea otra cuenta desde ahí.
- **El aviso de las cookies y la primera capa de los textos legales** salen junto a «Iniciar sesión» y junto a «Crear cuenta», porque los dos gestos crean las cookies (§11.2).
- **«Cerrar sesión» no lleva la casilla «Quitar también los juegos de este dispositivo».** Su texto remite a «Borrar todo», en Ajustes › Datos: una casilla así, en una confirmación, haría fácil perder la agenda por error, y el usuario tiene miedo a perder los datos (ADR-013).
- **Los textos de la cuenta** van en `screens/settings/account-texts.ts`, en el *chunk* de Ajustes: en `i18n/es.ts` subían el JS inicial 1,4 KB. Las ayudas que comparten con la sincronización (`attempt`, `focusWhenReady` y `ConfirmAction`) pasan a `sync-ui.tsx`.
- **`steam/refresh`:**
  - «sin vínculo» y «ya se trajo hace menos de 20 h» responden **202** con `status` (`unlinked` o `too_soon`), no 409 y 429. Así la comprobación de cada dispositivo no deja errores en la consola, como el «aún no» de `redeem`;
  - `steam_not_linked` y `steam_refresh_too_soon` ya no son códigos de error.
- **Al vincular, `start` también va con la cookie:** todo el canje es de esa agenda. Lo demás de Steam (logros y software) sigue sin cookies, con el pase. El servidor de los E2E manda al mundo de la prueba lo de Steam que lleva la cookie del dispositivo.
- **Cuándo se actualiza** (`steam/auto-refresh-trigger.ts`, en el JS inicial y sin nada de Steam):
  - tras una **ronda buena de la sincronización en esta sesión**. Así lo quitado en otro dispositivo ya ha llegado: si no, la importación lo volvería a añadir con una HLC más nueva, y ganaría;
  - cada 24 h si el dispositivo sabe que hay vínculo, y cada 7 días si no lo sabe (por si se vinculó desde otro dispositivo);
  - la hora se apunta antes de pedir nada.
- **Los logros, al actualizar sola,** son de lo jugado en los últimos 14 días (`RECENT_PLAY_MS`) y no «desde la última actualización». Si un día se pierde (la app se cierra a medias), no se queda ningún juego sin mirar.
- **Lo quitado no vuelve,** pero las lápidas de `steam:` no se quedan enteras para siempre:
  - a los 90 días, D1 les quita el contenido y deja `deletedAt` y `mergedInto`, que es lo mismo que sube `uploadOf` de una lápida purgable. Solo queda el id (el `appid`) y la fecha;
  - fuerza el `reset` de siempre, y una lápida ya reducida no se vuelve a tocar;
  - la política lo cuenta (versión 6).
- **El resumen de la importación** dice cuántos juegos quitados no se vuelven a añadir (`counts.removed`). La lista de deseados tampoco cuenta los quitados.
- **Visibilidad:** no hay entrada nueva en la barra lateral. Queda por decidir con el usuario, con capturas.
- **Comprobado:** `lint`, `typecheck` y 1 643 pruebas. Entre ellas:
  - 24 de las rutas de la cuenta, con dos mutaciones cazadas;
  - 15 de las de Steam vinculado;
  - 3 de las lápidas de Steam en la purga;
  - el vector de PBKDF2, comparado con el `pbkdf2Sync` de Node;
  - el cliente de punta a punta;
  - el disparador.

  JS inicial de 146,8 KB (antes, 145,9). E2E en Chromium y WebKit: `account.spec.ts` (crear, entrar desde otro dispositivo, contraseña mala, «He olvidado mi contraseña», cambiar la contraseña, cerrar sesión y el email ya usado), el de vincular Steam en `steam-import.spec.ts` y los de la sincronización, la importación, los datos, las llaves y el buzón, puestos al día.

## Pros y contras de las opciones

### A1. PBKDF2 en el dispositivo, HMAC en el Worker

- Bien: cabe en 10 ms, viene con WebCrypto en todos los navegadores y la app de escritorio, y no añade dependencias.
- Mal: PBKDF2 no gasta memoria, así que es más barato de atacar con GPU que Argon2id.
- Mal: un móvil viejo puede tardar más de 1 s.

### A2. Argon2id en el dispositivo

- Bien: el estándar recomendado, que resiste mejor a las GPU.
- Mal: un WASM de decenas de KB y otra dependencia que fijar (§6). En la PWA de iOS, la memoria que pide puede fallar.

### A3. PBKDF2 en el Worker

- Mal: Workers admite como mucho 100 000 vueltas (OWASP pide 600 000) y aun así se pasa de 10 ms de CPU.

### A4. Workers Paid

- Bien: el *hash* en el servidor, con margen de CPU.
- Mal: 5 $ al mes, y el usuario eligió 0 €.

### B1. Solo el HMAC del email

- Bien: una copia de D1 no enseña ningún email, y basta para buscar la cuenta y evitar duplicados.
- Mal: un dispositivo que entró con llave o código no puede enseñar el email.
- Mal: los correos, cuando lleguen, pedirán confirmar la dirección. Eso ya se haría para verificarla.

### B2. El email en claro

- Bien: se enseña en todas partes y ya está listo para los correos.
- Mal: es un dato personal guardado sin usarlo para nada que el HMAC no haga.

### C1. El SteamID64 en D1

- Bien: lo ven todos los dispositivos de la cuenta, y el servidor frena las actualizaciones por agenda.
- Mal: un dato más, aunque público en Steam, que se guarda mientras dure el vínculo.

### C2. Un pase cifrado en el dispositivo

- Bien: D1 no guardaría nada de Steam.
- Mal: cada dispositivo tendría que vincularse aparte, o el pase acabaría en D1 de todos modos. Además, el servidor no podría frenar por agenda sin guardar algo.

## Más información

- [ADR-011](011-sincronizacion.md): la agenda, los dispositivos, el código de recuperación y la purga.
- [ADR-012](012-cuenta-de-steam.md): el inicio de sesión con Steam, el pase y el contador diario.
- [ADR-013](013-llaves-de-acceso.md): las llaves de acceso y por qué entonces no se eligió la contraseña.
- `prototipe.md`:
  - §2 y RNF-10;
  - §11.1, §11.2 y §11.4.
- OWASP Password Storage Cheat Sheet (PBKDF2-HMAC-SHA256, 600 000 vueltas) y NIST SP 800-63B (longitud y reglas).
