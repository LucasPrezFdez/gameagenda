# ADR-012 · Cuenta de Steam: OpenID 2.0 con canje tipo PKCE y la biblioteca en *streaming*

- **Estado:** propuesta. Pasa a «aceptada» con la prueba a mano con Steam de verdad (paso 5 del encargo) y la verificación final de la parte 2.
- **Fecha:** 19-11-2026 (Fase 2, parte 2 de la importación de Steam)
- **Deciden:** el usuario y el asistente

## Contexto y problema

La Fase 2 quiere que el usuario traiga su biblioteca de Steam (juegos, horas y última partida) y su lista de deseados sin teclearlos (§10 de `prototipe.md`). La parte 1, Mi lista con miles de juegos, está en producción desde el 17-11-2026 (DECISIONES §10.48). Esta parte, la 2, solo inicia sesión con Steam y trae los datos al dispositivo: revisar y aplicar es la parte 3, y los logros, la 4.

Steam solo ofrece OpenID 2.0 a terceros. La §10.2 fija las cinco comprobaciones y el canje tipo PKCE, y la §11 las obligaciones de los ToU (≤100 000 llamadas al día, clave confidencial, datos solo a petición del usuario). La micro-API (ADR-011) corre en el plan gratuito de Workers: 10 ms de CPU por invocación, 50 subpeticiones y `ratelimits` con periodos de 10 o 60 s.

¿Cómo se verifica el login de Steam en el Worker, cómo llega una biblioteca de miles de juegos al dispositivo sin pasarse de CPU, y cómo se acotan las llamadas a Steam sin guardar datos del usuario más de unos minutos?

## Factores de la decisión

- **Seguridad (§10.2):** las cinco comprobaciones, cada una con una prueba que falla sin ella; ninguna llamada a la Web API antes de un login verificado; nada de *login CSRF*.
- **Funciona en todas partes:** una pestaña, la PWA de iOS (el login acaba en Safari, con otras *cookies*) y la app de escritorio (el login va al navegador del sistema; ADR-010).
- **CPU (CA4.6):** p99 por debajo de 10 ms con una biblioteca de 5 000 juegos, también la primera petición de un *isolate*.
- **Privacidad (§11.2):** D1 guarda solo el ticket, unos minutos; las respuestas de Steam no se guardan ni se registran; sin `GetPlayerSummaries`.
- **ToU (§11.1):** tope de llamadas y clave solo en secretos.
- **Una persona en Windows:** pruebas en Node con `app.request()`, sin llamar a Steam en el CI.

## Opciones consideradas

Las cinco decisiones que el encargo dejaba abiertas, con lo medido el 19-11-2026 (sondas en `.cache/steam-probe/`, que no se versiona; con un juego abierto en el PC, así que los tiempos salen inflados, ≈1,4×, pero no las proporciones):

1. **Verificar el login:**
   - A. `steam-signin` 1.0.5 (la última, del 12-02-2025) con `nodejs_compat`;
   - B. portar su `verifyLogin` (MIT) a `fetch`.
2. **Devolver la biblioteca:**
   - A. leerla en el Worker, validarla con Zod y devolverla compacta;
   - B. pasar el cuerpo de Steam tal cual, en *streaming*, y validarlo en el dispositivo.
3. **Tope de llamadas:**
   - A. solo `ratelimits` por IP;
   - B. por SteamID64 y día;
   - C. `ratelimits` por IP y un contador diario global en D1.
4. **¿Exige la sincronización?** A. sí; B. no.
5. **Interruptor:** A. solo en el servidor; B. en el servidor y una constante de compilación en la app.

## Decisión

Opciones elegidas por el usuario el 19-11-2026 («sigue», sobre las recomendaciones): **1B, 2B, 3C, 4B y 5B**, porque son las que cumplen la CPU y la privacidad con menos piezas. El porqué de cada una está en «Pros y contras». Lo que sigue es el diseño.

### Rutas (`apps/web/worker/routes/steam.ts`)

Todas bajo `/api/v1/steam/`, con las reglas de la §11.4 (`Origin` propio y JSON en los POST, `Cache-Control: no-store` y las demás cabeceras de `apiHeaders`) y sin registrar nada: ni la URL (lleva el ticket y la aserción), ni los cuerpos, ni el SteamID64. Un error inesperado deja, como en el resto de la micro-API, solo su nombre y la ruta sin consulta; y si Steam rechaza la clave (401 o 403 en `GetOwnedGames`), una línea con ese código, sin nada de la cuenta, para saber que hay que cambiarla.

- **`POST /api/v1/steam/start`** `{ challenge }` → 201 `{ ticket, url, expiresAt }`.
  - `challenge` es `BASE64URL(SHA-256(verificador))`, como `S256` de PKCE (RFC 7636): 43 caracteres. El verificador son 256 bits aleatorios en base64url (43 caracteres) que solo conoce la app.
  - El ticket son otros 256 bits aleatorios. D1 guarda su SHA-256, el `challenge` y la caducidad (10 min, `STEAM_TICKET_TTL_MS`).
  - `url` es la de OpenID de Steam (`checkid_setup`, `identifier_select`), con `openid.realm` = el origen de la petición y `openid.return_to` = `<origen>/api/v1/steam/callback?t=<ticket>`. El origen sale de la petición, no de un valor fijo: el túnel de la prueba a mano tiene otro *host*.
  - No llama a Steam.
- **`GET /api/v1/steam/callback?t=<ticket>&openid.*`** → una página HTML corta, sin *scripts* ni estilos, con `color-scheme` para el modo oscuro: «Listo. Vuelve a GameAgenda para terminar». Es un GET que escribe en D1 (el SteamID64 en el ticket), la excepción que la §11.4 no prevé: lo exige OpenID 2.0, y solo escribe con una aserción verificada por Steam para un ticket vigente y sin usar.
  - Antes de llamar a nadie: el ticket existe, no ha caducado y no tiene SteamID64; `openid.mode` es `id_res` (con `cancel`, el ticket se borra y la página lo dice); `openid.ns` es el de OpenID 2.0; `openid.op_endpoint` es `https://steamcommunity.com/openid/login`; `claimed_id`, `return_to` y `response_nonce` están en `openid.signed` (**comprobación 2**); `openid.return_to` es **idéntico** al emitido, con el ticket (**comprobación 3**); y `openid.claimed_id` cumple `^https?://steamcommunity\.com/openid/id/(\d{17})/?$` (**comprobación 4**).
  - Después, `check_authentication` por POST a la URL **fija** `https://steamcommunity.com/openid/login`, nunca al `op_endpoint` recibido (**comprobación 1**), con todos los `openid.*` recibidos y `openid.mode=check_authentication`, 5 s de espera y la respuesta leída con tope (4 KiB). Vale solo con una línea `is_valid:true`.
  - Con `is_valid:true`, `UPDATE … SET steam_id = ?1 WHERE ticket_hash = ?2 AND steam_id IS NULL AND expires_at > ?3`: solo una vuelta gana. Si Steam dice que no, el ticket se borra (**comprobación 5**: una aserción sirve para un ticket y una vez). Si Steam no contesta, el ticket se queda y la página invita a recargar.
- **`POST /api/v1/steam/redeem`** `{ ticket, verifier }`:
  - **202** `{ status: "pending" }` si el ticket existe, no ha caducado, su `challenge` es el del verificador y aún no hay login. No lo gasta. Es un 2xx para que preguntar al volver a la app no deje errores en la consola.
  - **410** `steam_ticket_invalid` si no existe, ha caducado, ya se canjeó o el verificador no es el suyo: las cuatro dan la misma respuesta.
  - Si no, lo canjea con un `DELETE … RETURNING steam_id` (**comprobación 5**: un solo uso, y solo con el verificador). Suma 2 llamadas al contador del día y pide **a la vez** `IPlayerService/GetOwnedGames/v1` (`include_appinfo`, `include_played_free_games`, `skip_unvetted_apps=false`; la clave en `x-webapi-key`, nunca en la URL; 15 s de espera) e `IWishlistService/GetWishlist/v1` (sin clave; 5 s).
  - **200** `{"owned": <el cuerpo de GetOwnedGames tal cual>, "wishlist": <el de GetWishlist tal cual> | null}` en *streaming* (ver abajo). `wishlist` es `null` si Steam no la ha dado.
  - **502** `steam_unavailable` si `GetOwnedGames` no responde 200 con `application/json`. El ticket ya está gastado: se vuelve a empezar, y Steam suele recordar la sesión.

Si Steam falla en el canje, la app no puede reintentar con el mismo ticket: es el precio del solo uso, y con él una respuesta interceptada no sirve para pedir otra biblioteca.

### La biblioteca, en *streaming* (2B)

Medido con una *fixture* de 5 000 juegos con `include_appinfo` (1,7 MB) en V8 (Node 24): solo decodificar y `JSON.parse`, 6–7 ms en frío; con Zod, 17–23 ms en frío y un p99 de 18 ms en caliente; normalizar y volver a serializar, 21–23 ms. Pasarla en *streaming*, contando bytes, 0,3 ms en caliente (p99 de 1,3 ms).

- El Worker comprueba el estado 200 y `Content-Type: application/json`, escribe `{"owned":`, pasa los trozos de Steam contando bytes (tope de 16 MiB, `STEAM_IMPORT_MAX_BYTES`: si se pasa, corta el *stream* y la app ve una respuesta rota) y, al acabar, `,"wishlist":` y la lista de deseados, y `}`.
- **La lista de deseados también va tal cual** (cambio sobre la propuesta, que la compactaba en el Worker): se lee entera, con tope de 1 MiB (≈19 000 deseados), y solo se comprueba que es JSON, para que un fallo suyo salga como `null` y no rompa la respuesta. Así el Worker no valida nada de Steam y su CPU no depende de lo que traiga. Todo lo que va en la respuesta es de Steam, así que una clave `wishlist` colada en el cuerpo de la biblioteca no cambia de quién son los datos (y `JSON.parse` se queda con la última, la de `GetWishlist`).
- **Excepción a la §11.3** («Zod valida cada respuesta de Steam»): la biblioteca y los deseados los valida Zod en el dispositivo (`steamImportResponseSchema` y, juego a juego, `steamOwnedGameSchema` y `steamWishlistItemSchema`, en `@gameagenda/core/api`): uno raro no tira el resto, y los nombres se limpian (sin caracteres de control, 200 caracteres como mucho).
- **En el móvil:** con 5 000 juegos, el bloque más largo de leerla es el `JSON.parse` (4–10 ms con CPU ×1, medido con un juego abierto en el PC): la app cede el turno después de leer el JSON y cada 500 juegos validados.

### Verificar el login sin `nodejs_compat` (1B)

Medido con `wrangler deploy --dry-run` y `wrangler check startup` (cinco arranques de cada uno, `workerd` local):

| Worker | Tamaño (gzip) | Arranque |
|---|---|---|
| El de `main` | 73,5 KiB | ≈24 ms |
| Con `steam-signin` 1.0.5 y `nodejs_compat` | 78,5 KiB | ≈38 ms |
| Con el `verifyLogin` portado a `fetch` | 74,0 KiB | ≈24 ms |

`worker/steam-openid.ts` porta `verifyLogin` de `steam-signin` 1.0.5 (MIT, © 2023 Alex Corn), con su aviso de licencia, y le añade lo que le falta: `claimed_id` con 17 cifras (acepta `\d+`), `return_to` idéntico (solo compara el *host*), el `op_endpoint`, un tiempo de espera (no tiene) y el `fetch` inyectable (`Deps.steamFetch`), con el que las pruebas usan aserciones grabadas. El `https.request` de Node no se puede sustituir así sin parchear módulos. El Worker sigue sin `nodejs_compat` y sin dependencias nuevas.

### Tope de llamadas (3C)

- **`RL_STEAM`** (`namespace_id` 1105): 10 por minuto y por el SHA-256 de la IP, en `start` y en `redeem`.
- **Contador diario global** en D1 (`steam_quota`: el día UTC y las llamadas; sin datos de usuarios): `callback` suma 1 (`check_authentication`) y `redeem`, 2. Con `STEAM_DAILY_CALLS` (50 000, la mitad de los ToU; el *pipeline* gasta ≈220) responde 503 `steam_busy`, «vuelve mañana». El mantenimiento diario borra los días de hace más de una semana.
- `callback` no lleva límite por IP: solo llama a Steam con un ticket vigente y sin usar, y si Steam dice que no, el ticket se borra. Así, cada `start` da como mucho una llamada de `callback`.
- **Sin tope por SteamID64 y día:** obligaría a guardar algo del usuario más de unos minutos.

### Sin exigir la sincronización (4B)

Importar es un gesto explícito del usuario, y sin sincronizar D1 solo ve el ticket unos minutos: nada queda ligado a una agenda. Cambia respecto a la §11.1, que hablaba de un «tope por agenda»: el tope es el contador diario. A diferencia de `resolve`, que sale solo y por eso exige la sincronización (decisión del usuario del 08-11-2026), aquí la petición la lanza el usuario con el botón.

### Interruptor (5B)

- **`STEAM_ENABLED`** en `wrangler.jsonc`, a `"0"` en producción hasta la parte 3. Con otro valor que `"1"`, o sin el secreto `STEAM_WEB_API_KEY`, `/api/v1/steam/*` responde 503 `steam_disabled` sin tocar D1 (la vuelta de `callback`, con una página que lo dice). Va aparte de `SYNC_ENABLED`: apagar Steam no apaga la sincronización, y `SYNC_ENABLED` a `"0"` lo apaga todo.
- **En la app,** una constante de compilación esconde la entrada en producción y la enseña en desarrollo y en los E2E: la app no puede saber el valor del servidor sin preguntar, y no pregunta nada a `/api` antes del clic.
- `scripts/legal-guard.test.ts` no deja `STEAM_ENABLED` a `"1"` sin la política de privacidad al día con los datos de Steam.

### Esquema de D1 (`worker/migrations/0003_steam.sql`)

Solo aditiva (§10.47): la versión anterior del código funciona con la base nueva.

- `steam_ticket (ticket_hash PK, challenge, expires_at, steam_id NULL)` e índice por `expires_at`.
- `steam_quota (day PK, calls)`.

**Retención.** El ticket caduca a los 10 min y se borra al canjearlo, al fallar la aserción, y en cada `start` los caducados. Un ticket abandonado lo borra un segundo Cron Trigger, `*/5 * * * *`, que solo hace eso. Así un SteamID64 está en D1 **como mucho 15 min**, no los 10 que decía la §11.2: los 10 min son los del ticket, y los 5 más, el margen del *cron*. Time Travel lo conserva 7 días más, como todo lo de D1.

### En la app (`src/steam/` y `screens/settings/SteamImport.tsx`)

- **Dos pasos.** «Importar desde Steam» genera el verificador (`crypto.getRandomValues`) y el `challenge` (`crypto.subtle.digest`) y pide `start`: es la primera petición a `/api`, y antes del clic no hay ninguna. Después, el **botón oficial de Steam** (la imagen «Sign in through Steam», que dice «This site not associated with Valve Corp.», con el nombre accesible «Iniciar sesión con Steam») es un enlace de verdad a la URL de OpenID, en otra ventana. Abrirla con `window.open` tras el `await` de `start` la bloquearía Safari; un enlace que pulsa el usuario, no. En la app de escritorio, `on_new_window` lo abre en el navegador del sistema (ADR-010), y en la PWA de iOS, en Safari.
- **Al volver:** la app pide `redeem` cuando recupera el foco o vuelve a la vista, y con «Ya he iniciado sesión». Funciona igual en la pestaña, en la PWA de iOS y en la app de escritorio, porque el canje lo hace la app con su verificador, venga de donde venga la vuelta de Steam. Foco y vista llegan juntos: un solo canje a la vez.
- **El flujo** (`steam/steam-flow.ts`) es un almacén pequeño que sobrevive a salir de Ajustes. Las peticiones van sin *cookies* (`credentials: 'omit'`), sin `Referer` y sin caché. El verificador solo está en memoria: si el sistema cierra la app, se vuelve a empezar. La caducidad la decide el servidor (410): con el reloj del dispositivo desfasado, comprobarla aquí daría por caducado un ticket vigente.
- **Estados**, en `role="status"`: esperando (y «aún no has terminado» tras «Ya he iniciado sesión» sin login), trayendo la biblioteca, el resumen («Hemos encontrado 287 juegos en tu biblioteca y 25 deseados», con «De momento no hemos cambiado nada de tu lista»), perfil privado (la guía de la §10.1 y el enlace a la privacidad de Steam), biblioteca vacía, caducado, sin red (reintenta con el mismo ticket), Steam caído, tope del día, demasiados intentos y apagada. Los textos, en `steam/texts.ts`: en `i18n/es.ts` subían el JS inicial 0,6 KB.
- Lo traído se queda **en memoria** hasta la parte 3. No cambia la agenda.
- **`__STEAM_IMPORT__`**, una constante de compilación de `vite.config.ts` (como `__APP_VERSION__`): `true` en desarrollo y en los E2E, `false` en producción hasta la parte 3, salvo con `VITE_STEAM_IMPORT=1` al construir (la prueba a mano). Con `false` no queda nada en el *build*: el mismo JS inicial que `main` (141,4 KB), sin *chunks* de Steam y con el botón (`public/steam/`) fuera de la precaché del Service Worker. Dos intentos que no valieron: importar la imagen y un `import()` dentro de un módulo que se descarta los publicaba igual; y `SteamImport` como *chunk* propio, anidado en el de Ajustes, hacía que Rolldown partiera el JS inicial en tres ficheros (142,7 KB con la importación activada). Va dentro del *chunk* de Ajustes.
- **Service Worker:** servía el `index.html` para cualquier navegación del origen, también a `/api/`. La vuelta de Steam es una navegación: en el mismo navegador que la app, el usuario habría visto la app en vez de «Listo». Ahora las navegaciones a `/api/` van a la red (lo encontró el E2E).

### Consecuencias

- Bien, porque ninguna llamada a la Web API sale antes de un login verificado por Steam, y una aserción o un ticket robados no sirven sin el verificador.
- Bien, porque el Worker no lee la biblioteca: la CPU de `redeem` no crece con ella.
- Bien, porque no hay dependencias nuevas ni `nodejs_compat`.
- Mal, porque lo de Steam no lo valida el servidor (excepción a la §11.3), y la app tiene que leer hasta 1,7 MB.
- Mal, porque la vuelta de Steam escribe en D1 con un GET (lo exige OpenID 2.0; solo con una aserción verificada).
- Mal, porque un SteamID64 puede estar en D1 hasta 15 min, no 10.
- Mal, porque si Steam falla durante el canje, hay que volver a empezar.
- Pendiente: qué campos devuelve Steam de verdad (familia, juegos privados, lista de deseados privada o vacía), en la prueba a mano.
- Pendiente: la parte 3 decide dónde se guarda lo traído y cómo se aplica sin 15 operaciones por juego en la `outbox`.

### CPU por petición (19-11-2026)

`node scripts/api-cpu.ts`, con un juego abierto en el PC (los tiempos salen inflados: `sync` que sube 200 operaciones dio un p99 de 6,52 ms, cuando el 08-11-2026 dio 2,38):

| Petición | p50 (ms) | p99 (ms) | Primera (ms) |
|---|---|---|---|
| `start` | 0,19 | 0,48 | 8,25 |
| `callback` (con `check_authentication` falso, sin esperar) | 0,38 | 0,84 | 2,39 |
| `redeem` con 5 000 juegos (1,7 MB), leída entera sin parsear | 3,47 | 6,95 | 6,02 |

En `redeem`, ≈2,9 ms (p50) son de los *streams* de Node que lo rodean en la prueba (el Steam falso que reparte los trozos y el lector), que en `workerd` son nativos: lo que añade el Worker son ≈0,25 ms (`.cache/steam-probe/stream-cost.mts`). `redeem` tiene su propio presupuesto en el script, 10 ms (el límite gratuito); el resto, el de CA4.6. La primera petición de un *isolate* es como la de las demás rutas (de 2 a 10 ms). Lo que cierra la medida es el panel de Workers.

### Confirmación

- **Micro-API**, con `app.request()`, D1 sobre `node:sqlite` y aserciones de OpenID con la forma de las de Steam (`fixtures/steam/openid/`), firmadas por un Steam falso que contesta `check_authentication` recalculando la firma (`worker/test/steam-support.ts`):
  - cada comprobación con su prueba: firma falsa, campo sin firmar, `op_endpoint` ajeno, `return_to` con otra ruta, otro ticket u otro origen, `claimed_id` con otro formato, parámetros repetidos, ticket repetido, caducado y verificador equivocado; y que `start` y un `callback` no válido no llaman a la Web API;
  - **mutaciones:** se quitó cada comprobación de `callback` (15) y cada condición de `redeem` (9) una a una, y en las 24 alguna prueba falla (`.cache/steam-probe/mutate*.mjs`);
  - el interruptor, `RL_STEAM`, el tope diario, la purga y los fallos de Steam.
- **El flujo de la app** contra la micro-API real (`worker/test/steam-client.test.ts`, 14) y el lector (`steam-library.test.ts`, 8).
- **E2E** (`steam-import.spec.ts`, 7 pruebas en Chromium y en WebKit, con axe en cada estado): nada a `/api` antes del clic y después solo `start`, sin cookies ni `Referer`; la pestaña con Steam en otra ventana; la PWA de iOS con el login en otro contexto; perfil privado; caducado; sin red; apagada. La página de Steam la hace una ruta de Playwright que vuelve a `return_to` con una aserción firmada (con una página que redirige sola: el WebKit de Playwright no deja responder con un 302). En la vista previa, la app pide `/api/v1/steam/*` sin cookies y la vuelta de Steam sí las lleva, así que todo lo de Steam va a un mundo por proyecto (`steam-http` y `steam-https`), para que las dos lleguen a la misma D1 y un proyecto no apague la importación del otro.
- **La clave:** `scan-secrets.ts --key-only` sobre `wrangler deploy --dry-run --outdir`, en el CI (el *bundle* del Worker lleva los nombres, nunca el valor), y el de siempre sobre el de la app.
- **`legal-guard`:** `STEAM_ENABLED` a "1" solo con la política al día.
- La prueba a mano con Steam de verdad, con un túnel `cloudflared`.

## Pros y contras de las opciones

### 1. Verificar el login

- **A, `steam-signin` con `nodejs_compat`:** la librería que citaba la §10.2. Pero añade 5,1 KiB y ≈14 ms al arranque, arrastra `steamid` solo para devolver el SteamID64, no tiene tiempo de espera, y deja a la micro-API la ruta del `return_to` y las 17 cifras igualmente. En las pruebas, su `https.request` no se puede cambiar por el `fetch` falso.
- **B, portarla (elegida):** unas 40 líneas con todas las comprobaciones juntas, el `fetch` inyectable y nada que añadir al Worker. Hay que mantenerlas, pero OpenID 2.0 no cambia.

### 2. Devolver la biblioteca

- **A, leerla en el Worker:** valida en el servidor, como pide la §11.3, y la app recibe algo compacto. Pero se come el presupuesto de CPU con 5 000 juegos (17–23 ms en frío).
- **B, en *streaming* (elegida):** 0,3 ms y no crece con la biblioteca. Valida el dispositivo, que lee hasta 1,7 MB.

### 3. Tope de llamadas

- **A, solo por IP:** con periodos de 60 s no acota el día.
- **B, por SteamID64 y día:** el «tope por agenda» más cercano, pero guarda un dato del usuario un día entero.
- **C, por IP y un contador diario global (elegida):** acota el total de los ToU sin datos personales. Un abuso puede gastar el cupo del día de todos; el límite por IP lo hace lento, y buscar y apuntar no dependen de él.

### 4. ¿Exige la sincronización?

- **A, sí:** el tope podría ser por agenda, y la micro-API solo la usaría quien sincroniza, como `resolve`. Pero obliga a subir la agenda a D1 para importar una vez.
- **B, no (elegida):** cualquiera importa, y D1 solo ve el ticket unos minutos.

### 5. Interruptor

- **A, solo en el servidor:** con él apagado, la app enseñaría un botón que no funciona.
- **B, también en la app (elegida):** la entrada no se ve en producción hasta la parte 3, y el servidor puede apagarla sin desplegar la app.

## Más información

- `prototipe.md`: §10 (cuenta de Steam), §11.1 (ToU), §11.2 (retención), §11.3 y §11.4 (micro-API).
- `docs/planificacion/DECISIONES.md` §10.49 (esta parte), §10.40 (`resolve`) y §10.47 (migraciones solo aditivas).
- ADR-010 (app de escritorio: `on_new_window`) y ADR-011 (micro-API).
- Encargo: `docs/planificacion/prompts/importacion-steam-parte-2.md`.
- OpenID 2.0: <https://openid.net/specs/openid-authentication-2_0.html> · PKCE: <https://www.rfc-editor.org/rfc/rfc7636> · `steam-signin`: <https://github.com/DoctorMcKay/node-steam-signin>
