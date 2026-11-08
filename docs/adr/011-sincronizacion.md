# ADR-011 · Sincronización: micro-API, D1 en la UE y emparejamiento

- **Estado:** propuesta. Pasa a «aceptada» con CA4.1–CA4.7 cumplidos en producción.
- **Fecha:** 06-11-2026 (al empezar M4); el cliente y Ajustes › Sincronización, el 07-11-2026; el buzón, `resolve` y los textos legales, el 08-11-2026
- **Deciden:** el usuario y el asistente

## Contexto y problema

Hasta M4 la agenda vive en un solo navegador. La app de escritorio tiene además la suya, aparte, en su WebView2 (R-18). Si se borran los datos del sitio, o Safari los purga tras 7 días sin abrir una web sin instalar, la agenda se pierde salvo que se haya exportado. M4 quiere **una sola agenda en el móvil y en el PC, con copia fuera del dispositivo** (§15.7), sin cuentas con email, a 0 €/mes y sin que buscar o apuntar esperen nunca a la red (ADR-001).

Desde M1 el cliente ya está preparado: ids naturales, HLC por campo, `outbox` y una sola `merge()` en `core` (ADR-004). Falta el transporte.

¿Dónde y cómo se guarda la agenda fuera del dispositivo, cómo se autentica un dispositivo sin email ni contraseña, y cómo se protege una API pública con el plan gratuito de Cloudflare?

## Factores de la decisión

- **CA4.1–CA4.7** (§15.7): convergencia con propiedades, dos navegadores sin red, restaurar tras borrar IndexedDB o los datos del sitio, *tokens* de emparejamiento de un uso que caducan, buzón del Atajo de iOS, CPU ≤5 ms por petición en el p99 y textos legales antes de activar nada.
- **Local-first:** la sincronización va en segundo plano y nunca pregunta (RF-26). Sin red, la app sigue igual.
- **Privacidad (§11.2):** sin email, nombre ni IP; D1 en la jurisdicción UE; solo *hashes* de los secretos; borrar en cascada.
- **Seguridad (§11.4):** cookie `__Host-` `HttpOnly`, nada cambia por GET, `Origin` propio, Zod estricto y límites por IP.
- **0 €:** 100 000 peticiones al día, 10 ms de CPU y 50 consultas a D1 por invocación (plan gratuito).
- **Una persona en Windows:** sin Docker, con pruebas rápidas en Node.

## Opciones consideradas

1. **Micro-API Hono en `/api/*` del propio `ga-web`, con D1 en la UE** y emparejamiento por código (D-13 y §5).
2. **Un Worker aparte para la API**, en otro origen.
3. **Un Durable Object con SQLite por agenda.**

## Decisión

Opción elegida: **1**, porque es la del plan (D-13), mantiene la cookie de primera parte y la CSP con `connect-src 'self'`, y D1 se prueba en Node con el mismo SQL. Lo que sigue es lo construido del 06 al 08-11-2026 en la rama `m4-sincronizacion`:

- la base (DECISIONES §10.34);
- `POST /api/v1/sync` con la purga (§10.35);
- el cliente, con los arreglos de la revisión (§10.36);
- Ajustes › Sincronización (§10.37);
- los E2E contra la micro-API real (§10.38);
- el buzón del Atajo de iOS (§10.39) y `resolve` (§10.40);
- los textos legales (§10.41) y la estimación de CA4.6 (§10.42).

### Encaminamiento

- `apps/web/wrangler.jsonc` lleva `main: ./worker/index.ts` y `assets.run_worker_first: ["/api/*"]`. El *script* solo corre en `/api/*`, y el resto lo sirven los *assets*, gratis. Si llega otra petición al *script* (con `run_worker_first`, Cloudflare no garantiza dejar fuera las navegaciones), se devuelve con `env.ASSETS.fetch()`, que aplica el *fallback* de la SPA.
- Comprobado con `wrangler dev` (`workerd` y D1 locales) el 06-11-2026: `/juego/steam:730` da el 307 de siempre y luego `index.html`, y un fichero que no existe, el `index.html` del *fallback*.
- **Interruptor:** la variable `SYNC_ENABLED` vale `"0"` en `wrangler.jsonc`, y con ella toda `/api/*` responde 503 `sync_disabled` sin tocar D1. Se pone a `"1"` cuando estén publicados los textos legales (CA4.7).

### Código y tipos

- `apps/web/worker/`: `app.ts` (Hono), `http.ts` (reglas), `device.ts` (credencial), `crypto.ts` y `routes/`. Importa `core` y Hono, nunca `apps/web/src/` ni `node:*`. Lo vigila Biome, y la SPA tampoco puede importar `worker/` (§14.3, regla 3).
- **Hono 4.13.16:** un parche sobre la 4.13.14 de la §6, comprobado en npm el 06-11-2026 y sin dependencias.
- **Sin `@cloudflare/workers-types`:** `env.ts` declara a mano lo que se usa: seis métodos de D1, `ratelimits` y `ASSETS`. Así la D1 de las pruebas, en Node, implementa la misma interfaz sin mezclar sus tipos con los de `@types/node`. Sin `nodejs_compat`.
- **El contrato, en `core`:** `@gameagenda/core/api` tiene los esquemas Zod de cada petición (objetos estrictos: un campo de más da 400) y de cada respuesta (abiertos: un cliente antiguo acepta campos nuevos), los códigos de error y el formato de los códigos. El Worker valida con ellos, y la app también.
- **Constantes sin Zod** (07-11-2026): `api/constants.ts` lleva los códigos de error, los nombres de las cookies, `PAIRING_TTL_MS`, `DEFAULT_MIN_AGE`, `EPOCH_MAX` y los topes de `sync`, y `schemas.ts` las importa. La API pública de `@gameagenda/core/api` no cambia. Así Ajustes usa `DEFAULT_MIN_AGE` sin cargar Zod.
- El *bundle* pesa 271 KiB (59 KiB con gzip), casi todo Zod. El límite gratuito es de 3 MiB.

### Reglas de petición (§11.4)

- Toda respuesta de `/api/*`, también la de un error: `Cache-Control: no-store`, `nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `CORP: same-origin` y HSTS.
- Lo que no es GET exige `Origin` igual al de la petición (403 `bad_origin`) y `Content-Type: application/json` (415). El buzón (`/api/v1/inbox`) no mira `Origin`, porque el Atajo de iOS no lo envía (a verificar en el iPhone), y no acepta la cookie.
- Los cuerpos se leen con un tope (1 KiB en estas rutas; 413 con `Content-Length` o sin él), en UTF-8 estricto, y pasan por Zod (400 `invalid_body`).
- Errores internos: 500 `internal`, y el registro solo lleva el nombre del error y la ruta, nunca cuerpos ni *tokens*.

### Credenciales

- **Dispositivo:** 256 bits en base64url, en `__Host-ga_device` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, 400 días). D1 guarda su SHA-256. Sin una válida, 401, y si venían cookies, se borran.
- **Indicio `__Host-ga_sync=1`** (nuevo): va con la credencial, sin secreto y legible desde JavaScript. Si se borra solo IndexedDB, la app ve el indicio y restaura la agenda (CA4.3). Sin él, tendría que preguntar al servidor en cada arranque, también quien no sincroniza. Las dos cookies se crean y se borran juntas.
- **Códigos de emparejamiento y de recuperación:** 28 símbolos de la base32 de Crockford (140 bits), en 7 grupos de 4 (`GXEN-Q32V-…`). Se leen sin confundir letras: no hay I, L, O ni U, y al teclear O cuenta como 0 e I y L como 1. D1 guarda su SHA-256: con ≥128 bits aleatorios no hace falta un *hash* lento.
- **Emparejar:** `POST /api/v1/pairing` (con cookie) da un código de 10 min. `POST /api/v1/pairing/redeem` lo canjea con un `DELETE … RETURNING`, así que el que lo encuentra es el único que lo usa. Usado, caducado e inventado dan la misma respuesta, 400 `invalid_code`. Pedir otro no anula el anterior: cada uno es de un uso y caduca solo.
- **Recuperar:** `POST /api/v1/recovery/redeem` da un dispositivo nuevo y el código sigue valiendo. **Ruta nueva**, que no estaba en la §5.2: `POST /api/v1/recovery` (con cookie) crea otro código y anula el anterior, por si se pierde o alguien lo ve.
- **Un dispositivo ya emparejado** no crea agenda ni canjea códigos: 409 `already_paired`. Para cambiar de agenda, antes se desempareja.
- **Revocar** borra la fila, porque el *hash* de una credencial solo se guarda hasta revocarla (§11.2). Revocarse a uno mismo es desemparejar, y quita las cookies. La agenda se queda en D1 aunque sea el último dispositivo: el código de recuperación la sigue abriendo, y la supresión se pide con «Borrar todos mis datos».
- **Edad (CA4.7; R-10):** `POST /api/v1/agenda` exige `ageConfirmed: true` y la `minAge` que se le pidió declarar. Si no coincide con la variable `MIN_AGE` del servidor (14), responde 409 `age_policy_changed`. Así, subirla a 16 no deja pasar a un cliente que preguntó por 14. El 06-11-2026 la ley que la sube seguía en el Congreso (enmiendas de ponencia del 24-06-2026).

### Límites (§11.4)

- Con el *binding* `ratelimits`: `RL_AGENDA`, 5 por minuto, para crear agendas, y `RL_REDEEM`, 10 por minuto, para canjear códigos. Los dos van por IP, y al *binding* le llega el SHA-256 de la IP, no la IP.
- Desde el 08-11-2026, también `RL_RESOLVE`, 30 por minuto y por IP, para `resolve`, y `RL_INBOX`, 30 por minuto y por *token* (su SHA-256), para el buzón.
- Son aproximados y por ubicación de Cloudflare. Protegen la cuota: adivinar 140 bits es inviable igual.
- En `workerd` local, la quinta alta del mismo minuto dio 429.

### Sincronización (`POST /api/v1/sync`)

Una ida y vuelta, como dice la §7.7: sube la `outbox` y baja los cambios desde el cursor. Lo que cambia respecto a la §7.7:

- **El LWW lo decide la `merge()` de `core`, no el SQL.** El servidor lee en una transacción la `seq` de la agenda y las filas de las entradas tocadas, reconstruye cada entrada, le aplica el lote con `applyOps()` (LWW, Platinado ⇒ Completado y reenvío de los manuales vinculados) y escribe las filas que cambian (`worker/sync-plan.ts`). Si una derivada toca otra entrada, lee sus filas y repite, hasta 8 saltos.
  - El motivo: el servidor tiene que leer las filas de todos modos, para las derivadas. Además, el `WHERE excluded.hlc > op.hlc` de la §7.7 necesitaba un desempate por valor, y SQLite compara UTF-8 donde JavaScript compara UTF-16. Así hay una sola implementación de LWW (§5.4, principio 6).
- **Concurrencia optimista:** el `batch()` de escritura hace `UPDATE agenda SET seq = seq + n, write_id = <uuid> WHERE seq = <la leída>`, y el `INSERT … SELECT … FROM json_each()` solo escribe si `write_id` sigue siendo el suyo. Si otro dispositivo escribió entre medias, se repite, hasta 3 veces (después, 503 `busy`). En el mismo `batch()` se lee la página de cambios, así que nadie ve la `seq` N+1 sin la N.
- **Rechazos por acción:** cada operación pasa por `strictOpSchema` y por el reloj. Si una no vale, se rechazan con ella todas las de su HLC, porque una acción no se parte. `invalid` se descarta; `clock` (más de 5 min por delante) se vuelve a sellar. Las demás van en `accepted`, ganen o no.
- **Cursor y purga:** la petición lleva `cursor` y el `purgedSeq` de la última respuesta. Hay `reset` (bajar desde 0 y, al acabar, borrar lo que el servidor ya no tiene) si `0 < cursor ≤ seq`, `cursor < purged_seq` y la app no ha visto esa purga (`purgedSeq < purged_seq`). Sin el `purgedSeq`, las páginas de un *reset* volverían a pedirlo.
- **D1 vuelto atrás** (07-11-2026; antes se escribía el lote y luego se comparaba): si el cursor de la petición va por delante de la `seq` leída antes de escribir, el servidor no escribe el lote (`accepted: []`, con los `rejected` de siempre) y baja desde 0. El cursor de la respuesta es menor que el enviado, así que la app lo vuelve a subir todo, también cuando la petición llevaba operaciones. Si se escribiera antes, la `seq` podría alcanzar al cursor y nadie lo notaría. Con varios dispositivos eso no basta: por eso está la época.
- **Época** (`agenda.epoch`, migración `0002_epoca.sql`): 16 cifras hexadecimales aleatorias. `POST /api/v1/agenda` la crea en el propio `INSERT` con `lower(hex(randomblob(8)))`, y la migración se la da a las agendas que ya había. Va en cada respuesta de `sync`, y el *runbook* del restore la cambia (ver «Cliente»).
  - En `syncResponseSchema` es obligatoria (`z.string().max(64)`, que también admite `''`): aún no hay ningún cliente desplegado, la D1 de producción ni siquiera existe y la SPA y la micro-API salen en el mismo Worker. Un campo opcional dejaría una rama sin época que nunca correría en producción.
  - Un cliente viejo en caché la ignora, porque las respuestas son objetos abiertos. El único riesgo es volver el Worker a una versión sin época con la SPA nueva en la caché del Service Worker: daría `bad_response`, con reintentos y sin perder la `outbox`.
- **Respuesta:** `cursor`, `purgedSeq`, `epoch`, `reset`, `more`, `serverTime`, `changes` (1 000 por página, también las propias: aplicarlas otra vez no cambia nada), `accepted` y `rejected` (`index`, `opId`, `reason`).
- **Cookie:** se renueva al sincronizar, como mucho una vez al día, con `device.last_seen_at` y `agenda.last_sync_at`.
- **Lotes de 200, no de 500:** en Node, filtrar y planificar 500 operaciones cuesta p50 3,1 ms y p99 4,9 ms, y 8,5 ms en frío, cerca de los 10 ms del plan gratuito. Con 200, p50 ≈1,4 ms y p99 ≈2,3 ms. `SYNC_BATCH_SIZE` pasa a 200. El servidor admite hasta 1 000, por si una sola acción tuviera más. CA4.6 se mide en producción.
- **Consultas:** 3 por petición con escritura (cookie, lectura y `batch()`), y una más por cada salto de reenvío. El límite gratuito es de 50.

### Mantenimiento (Cron Trigger `17 3 * * *`, `worker/maintenance.ts`)

Un solo `batch()` al día:

- borra los *tokens* de emparejamiento caducados;
- borra en cascada las agendas sin sincronizar en 13 meses (§11.2);
- los lunes, la purga semanal: las entradas con `deletedAt` de hace más de 90 días y los esqueletos (sin `status` o sin `title`) sin cambios en 90 días, con el corte de `purgeCutoff()` de `core` (`PURGE_AFTER_DAYS`), el mismo de `isPurgeable()`.

**La purga fuerza un `reset`** (07-11-2026; antes, `purged_seq` subía a la mayor `seq` de lo purgado):

- en cada agenda con algo purgado, la `seq` sube 1 y `purged_seq` pasa a ser esa `seq` nueva (`SET purged_seq = seq + 1, seq = seq + 1`);
- así toda app que sincronizó antes de la purga, cuyo cursor no llega a la `seq` nueva, recibe `reset` en su siguiente `sync` y queda igual que D1, lápidas incluidas;
- tras el *reset* no se repite: la respuesta da `cursor = seq` y el `purgedSeq` nuevo;
- una agenda sin nada que purgar no cambia.

**La app no purga por su cuenta.** La primera versión del cliente purgaba sus lápidas una vez al día, con su propio calendario. La revisión encontró que una escritura vieja subida después de una purga dejaba réplicas distintas a la vista, para siempre. Ahora la purga solo llega de D1, con el *reset*.

**Coste:** un *reset* por dispositivo cada semana en que su agenda purga algo, es decir, bajar la agenda entera. Con 1 000 juegos son unas 15 000 filas leídas en D1 por dispositivo y semana; la cuota gratuita es de 5 M filas leídas al día.

Comprobado en `workerd` local con la API de `wrangler dev` (`POST /cdn-cgi/local/explorer/api/local/scheduled?worker=ga-web` con `cron` y `scheduled_time`; `/__scheduled` ya no existe en la 4.155.0). El 07-11-2026, con `scheduled_time` en un lunes a 91 días: `seq` de 112 a 113, `purged_seq` de 0 a 113, y cada dispositivo recibió un solo *reset*.

### Esquema de D1 (`worker/migrations/`)

`0001_inicial.sql` es el de la §7.7, con seis cambios:

- `created_at` en `agenda` y en `inbox_item`, y `label`, `created_at` y `last_seen_at` en `device`, para la lista de dispositivos de Ajustes;
- sin `revoked_at` ni `used_at`, porque revocar y canjear borran la fila;
- `recovery_hash` único, para buscarlo por índice;
- índices por `agenda_id` en las tablas hijas, para las cascadas;
- `write_id` en `agenda`, para la concurrencia optimista de `sync`.

`0002_epoca.sql` (07-11-2026) añade `agenda.epoch TEXT NOT NULL DEFAULT ''` y un `UPDATE` que la rellena: `ADD COLUMN` no admite un valor por defecto calculado. **Hay que aplicarla antes de desplegar el Worker con esta versión** (`npx wrangler d1 migrations apply DB --remote -c apps/web/wrangler.jsonc`); si no, el `SELECT` de `epoch` falla con 500.

D1 aplica las claves foráneas, así que borrar una agenda se lleva sus dispositivos, *tokens*, operaciones y buzón (CA4.7). `STRICT`, `WITHOUT ROWID`, `RETURNING`, `json_each`, `->>`, el *upsert* y la purga con CTE funcionan en el `workerd` de `wrangler` 4.155.0.

### Cliente (07-11-2026)

Va en `apps/web/src/sync/`, con lo que necesita de `core` en `@gameagenda/core/sync` (`HlcClock.setOffset()`, `offsetFromRoundTrip()`, `sync/client.ts` y `sync/outbox.ts`). Una revisión independiente, con verificación de cada hallazgo, encontró fallos en la primera versión (`0d8b9ba`). Lo que sigue es lo construido con sus arreglos (DECISIONES §10.36).

**Fachada y carga diferida:**

- La fachada (`facade.ts`, `state.ts` y `types.ts`) va en el *chunk* inicial, sin Zod ni red. Lee el indicio y `meta.syncState`, da el estado a la interfaz (`AppServices.sync` y `useSyncState()`, con `useSyncExternalStore`) y carga el motor con `import()`.
- El motor (`runtime.ts`, `engine.ts`, `scheduler.ts` y `api-client.ts`) solo se descarga si el navegador está emparejado, tras el primer pintado y en un rato ocioso (§9.5, regla 6), o al activar, emparejar o recuperar. Quien no sincroniza no hace ninguna petición a `/api`, no crea cookies y no descarga Zod. La excepción, desde el 08-11-2026, es `resolve`, sin cookies, solo para un juego que no está en el catálogo (ver «`resolve`»).
- `"sideEffects": ["./src/zod-config.ts"]` en `packages/core/package.json`. Sin él, Rolldown partía el *chunk* inicial en cinco al compartir con el motor módulos de `core`, y subía de 132,0 a 137,3 KB brotli. De paso, el Worker de búsqueda baja de 39,0 a 37,3 KB.
- Estados para la interfaz: `off`, `paired`, `restoring` (indicio sin `meta.syncState`: CA4.3) y `unpaired` (estado sin indicio, por cookies; o un 401, por el servidor). La actividad: `idle`, `syncing`, `offline`, `error` y `disabled`.

**La ronda** (`engine.ts`):

- Sube la `outbox` en lotes de 200 sin partir acciones y baja los cambios por páginas. Cada respuesta se aplica en **una** transacción `rw` de Dexie (`entries`, `outbox` y `meta`), con el mismo reloj que la agenda de la pestaña. La agenda se entera por `storagemutated`.
- **La `outbox` se lee y se compacta una vez por ronda**, en una cola ordenada por HLC (`sortForUpload`), y cada lote sale de la cabeza con `takeSortedBatch()`, que no reordena. Solo se vuelve a leer si se ha vuelto a sellar algo, si se ha subido todo otra vez o si `outbox.count()` no cuadra con lo que queda en la cola (una escritura de la agenda a mitad de ronda). Antes, cada lote leía, compactaba y ordenaba la `outbox` entera: con 1 000 juegos, 1 246 ms en el hilo principal y lotes de hasta 49,1 ms; ahora, 32,7 ms (medidas en la §12.4).
- Las derivadas de los cambios remotos (Platinado ⇒ Completado, reenvíos) no van a la `outbox`: el servidor ya las deriva con la misma `applyOps()`. Las entradas se comparan con `canon()`, no solo por sus HLC.
- **Tope de 100 peticiones por ronda;** si se llega, otra ronda 1 s después. Las páginas de un *reset* que avanzan (el cursor sube) no cuentan: con más páginas que el tope, el *reset* volvía a empezar desde 0 cada segundo, sin acabar nunca. Los reinicios del *reset* sí cuentan, así que no hay bucle.
- **Sin `meta.syncState` no escribe nada.** Lo mira antes de cada petición y dentro de la transacción de cada respuesta. Si falta (otra pestaña, o esta, ha desemparejado, olvidado o borrado los datos), la ronda acaba con `aborted` sin escribir entradas, `outbox`, cursor ni reloj.

**Disparadores** (`scheduler.ts`; amplían los de RF-26): al arrancar, al ganar el foco, al volver la red, al volver a la vista, al ocultarse (solo si hay `outbox`, para subir antes de que el sistema congele la página) y 2 s después de la última escritura local (envolviendo el almacén de la agenda: `storagemutated` también salta con las escrituras del motor). El foco y la vuelta a la vista no repiten una ronda correcta de hace menos de 3 s. Con la página oculta no hay temporizadores.

**Errores y reintentos:**

- Con 429, 503 `busy`, 5xx, red con conexión, `bad_response` y `storage`, espera exponencial de 5 s ×2 hasta 5 min (±20 %), solo con la página visible; `online` reinicia la cuenta.
- Con `sync_disabled` y los demás 4xx no hay bucle: solo el siguiente disparador. Sin red no se intenta, y la actividad pasa a `offline`.
- Un 401 deja `meta.syncState.unpairedBy = 'server'` y para el planificador, sin tocar entradas ni `outbox`.
- **Si no se puede cargar el *chunk* del motor** estando emparejado (una pestaña vieja tras un despliegue), la actividad pasa a `error` con el código `network`, sin reintentos solos. «Sincronizar ahora», o cualquier operación que lo cargue, lo vuelve a intentar y reanuda el planificador.
- **Aviso «Sincronización fallida»** (§9.6): tras 3 fallos seguidos que no sean falta de red, `sync_disabled` ni 401, como mucho una vez hasta el siguiente éxito y sin tapar un aviso a la vista. N son los juegos con cambios pendientes, no las operaciones.
- Una ronda correcta reinicia el aviso de copia (RNF-08), como mucho una vez por hora.

**Web Lock `gameagenda-sync`:** una ronda a la vez entre pestañas, con `ifAvailable`. Si está cogido y la página está visible, un reintento a los 1,5 s, y solo si el motor sigue reanudado; si sigue ocupado, se salta la ronda. «Borrar todos mis datos» lo pide **esperando turno**, para que antes acabe la ronda de otra pestaña. Sin `navigator.locks` (Safari anterior a la 15.4) no hay candado: protegen la ronda abortada y la guarda de `meta.syncState`.

**`meta.syncState`, sin estados resucitados:**

- Solo cambia con `updateRecord()`, que lee, modifica y escribe en una transacción `rw` a partir de lo guardado, no de la copia de la fachada. Si ya no está, no lo vuelve a crear, salvo tras una ronda buena con el indicio puesto.
- Así una ronda que acaba tras desemparejar o borrar los datos, en esta pestaña o en otra, no deja un estado nuevo, tampoco «desemparejado por el servidor».
- Una ronda abortada no cuenta como buena: ni registro, ni aviso de copia, ni contador.
- `lastPurgeAt` ya no existe: un registro viejo que lo lleve se sigue leyendo y lo pierde con la siguiente escritura.

**IndexedDB borrada con la app abierta** (cookies intactas): la siguiente ronda se encuentra sin `meta.syncState` y se aborta. Con el indicio, restaura como al arrancar: `join(null, true)`, cursor a 0 y bajada completa. La fachada lanza esa ronda en cuanto ve que el estado ha desaparecido con el indicio puesto, y la pestaña pasa de `restoring` a `paired` sin recargar.

**Reloj** (§7.4):

- El desfase es `serverTime − (envío + recepción) / 2`, y solo se cambia si la diferencia supera max(500 ms, media ida y vuelta). `HlcClock.setOffset()` baja la parte física si iba más de 5 min por delante.
- Se vuelven a sellar las acciones rechazadas por `clock` y todas las de la `outbox` que van más de 5 min por delante, en orden de la HLC vieja, con HLC nuevas por delante de la mayor vista del servidor (`meta.syncCursor.maxSeen`) y de lo legítimo de sus entradas. Se conserva el `opId`.
- Si `setOffset()` baja la parte física, el reloj recibe la mayor `lastHlc` legítima de la agenda (≤ ahora + desfase + 5 min, con el índice `lastHlc`). `refreshFromCatalog()` recibe la de la entrada antes de sellar, e `importContext()` la mayor de todas: antes lanzaban `RangeError` con una entrada por delante del reloj.
- `meta.hlcClock` se guarda con la instantánea tomada al escribir, dentro de la transacción (`WriteBatch.clock` es una función), no la de la acción. No hace falta compartir el desfase entre pestañas: cada una lo corrige en su primera ronda.

***Reset*** (§7.7):

- Mientras dura, las peticiones van con `ops: []` y los cambios de todas las páginas se acumulan en memoria. Todo se aplica en la transacción de la última página: cada entrada vista se reconstruye desde lo pendiente en su `outbox` más lo del servidor, y las no vistas se borran o se quedan solo con lo pendiente.
- Las páginas intermedias solo escriben `meta.syncCursor` (`{cursor: 0, reset: true}` con el `purgedSeq` nuevo) y `meta.hlcClock`, y quitan de la `outbox` lo aceptado en la primera petición. Un *reset* cortado deja lo local como estaba, y la ronda siguiente empieza desde 0. Otro `reset` a mitad de camino vuelve a empezar la acumulación.
- Sustituye a «cada entrada se reconstruye la primera vez que llega» de la primera versión, que dejaba entradas a medias (invisibles) entre páginas y tras un corte.
- Tras el *reset*, la ronda sigue subiendo la `outbox`.

**D1 vuelto atrás y época:**

- Si el cursor de la respuesta es menor que el enviado y no hay *reset*, se vuelve a subir todo en la misma transacción. A mitad de un *reset*, lo cancela, porque las páginas anteriores eran del D1 de antes.
- La app guarda la época en `meta.syncCursor.epoch`. Si no la tenía, adopta la que llega. Si llega otra, en la misma transacción: fusiona la página, vuelve a subirlo todo y pone el cursor a 0 sin *reset* (cancela uno en marcha). La ronda sigue bajando desde 0 aunque no quede `outbox`. Sin *reset* no se borra lo que el restore perdió: vuelve con lo que se sube.

**Runbook del restore con Time Travel:** tras restaurar D1, cambiar la época de todas las agendas:

```text
npx wrangler d1 execute ga-agenda --remote -c apps/web/wrangler.jsonc
  --command "UPDATE agenda SET epoch = lower(hex(randomblob(8)))"
```

(una sola orden; aquí partida en dos líneas). Cada dispositivo lo vuelve a subir todo en su siguiente `sync` y nada de lo que el restore perdió se queda fuera.

**Unirse y volver a subirlo todo:** `join()` (activar, emparejar o recuperar) y la resubida por D1 vuelto atrás o por época nueva usan `uploadOf()` de `core`, con el corte `purgeCutoff(ahora + desfase)`, el mismo de D1:

- lo no purgable sube entero;
- una lápida de más de 90 días sube solo `deletedAt` y, si lo tiene, `mergedInto` (así el reenvío de un manual vinculado sigue funcionando);
- un esqueleto de más de 90 días no sube nada;
- lo que esas entradas ya tenían en la `outbox` (desde M1, la agenda lo apunta todo) no sube;
- en local quedan como quedarán en el servidor: reducidas o borradas.

Antes, activar subía a D1 lápidas viejas con todo su contenido, nota incluida (§11.2).

**Borrar la agenda del servidor** (`deleteServerAgenda()`, antes de `agenda.deleteAll()`): espera a que acabe la ronda en marcha (`await joining`, planificador parado y el Web Lock en espera) y, dentro del candado, llama a la API y borra el estado. Un 401 **no** cuenta como borrada: el servidor no distingue «revocado» de «agenda borrada», así que queda «desemparejado por el servidor», no se borra nada y rechaza con `SyncError('unauthorized')`. Con otros errores tampoco se borra nada, y la sincronización sigue.

**Desemparejar este dispositivo** (`revokeDevice(self)`) para el planificador antes de la llamada y lo vuelve a arrancar si falla (salvo un 401). No espera a la ronda en vuelo: la guarda de `meta.syncState` basta para que acabe en `off`.

**Peticiones:** `api-client.ts` valida cada respuesta con Zod y manda todas con `referrerPolicy: 'no-referrer'`. Con la `Referrer-Policy` global (`strict-origin-when-cross-origin`), cada petición mandaba en `Referer` la ruta y la consulta de la página (búsquedas, filtros, fichas); la micro-API valida `Origin`, no `Referer`.

**Ganchos E2E** (solo con `import.meta.env.MODE === 'e2e'`): `globalThis.__gaSync` (`state`, `successes`, `syncNow()` e `idle()`) y `globalThis.__GA_SYNC_TEST__ = {timings}` para cambiar las esperas (por defecto: 2 000, 5 000, 300 000, 1 000, 3 000 y 1 500 ms).

**Limitaciones conocidas:**

- La compactación borra las operaciones dominadas antes de saber si la dominante vale. Si el servidor la rechazara como `invalid`, la dominada se perdería. Con las operaciones de la app no pasa (todas pasan `strictOpSchema`), así que no se cambia.
- La lectura inicial de la `outbox` sigue siendo una tarea larga tras `join()` o una resubida: unos 32 ms con 1 000 juegos en Node, unos 130 ms con CPU ×4. Para trocearla haría falta un índice `hlc` en la `outbox`, que cambia la §7.2.
- `countPendingEntries()` (en la fachada) lee todas las claves de la `outbox` en cada escritura local mientras dura la subida.
- Un *reset* guarda en memoria todas las filas de la agenda, y su última página es una tarea larga. Pasa como mucho una vez por semana y dispositivo, pero una agenda de unas 100 000 filas son decenas de MB.
- Si entre la lectura y el `batch()` otro dispositivo escribe hasta que la `seq` alcanza el cursor, este no nota el D1 vuelto atrás por el cursor. Solo lo cubre la época, siempre que se siga el *runbook*.
- Tras restaurar (CA4.3), `deviceId` es `null` hasta que Ajustes llama a `listDevices()`. Si se desempareja justo entonces, `revokeDevice()` no sabe que es el propio y no para el planificador antes; el resultado sigue siendo `off`.
- Con un 401 en `restoring` sin `meta.syncState`, el estado queda en `off`, no en `unpaired`: el 401 quita el indicio y no hay registro que marcar.

### Ajustes › Sincronización (07-11-2026)

Sección `sync` (`/ajustes/sincronizacion`), entre Privacidad y Rendimiento, en `screens/settings/SyncPanel.tsx`, con la lógica pura en `sync-model.ts` (DECISIONES §10.37). Va dentro del *chunk* de Ajustes: como *chunk* propio, Rolldown partía el inicial en cuatro (139,1 KB brotli). Ajustes no carga Zod.

**Cuatro vistas** (`[data-sync-view]`):

- **Sin sincronizar (`off`):** qué se guarda y dónde, el aviso de las dos cookies en el propio gesto, la primera capa de los textos legales (`[data-sync-legal]`, desde el 08-11-2026), el nombre del dispositivo prellenado (`defaultDeviceLabel()`, «Chrome en Windows»; «App de escritorio» si `window.isTauri === true`), la casilla de edad con `DEFAULT_MIN_AGE` y «Activar sincronización». Aparte, «Emparejar este dispositivo» y «Usar código de recuperación».
- **Código de recuperación (`reveal`):** se muestra una sola vez, en grupos de 4 y monoespaciado, con «Copiar» y «Ya lo he guardado».
- **Emparejada (`paired`):** estado (`role="status"`) con «Sincronizar ahora» y los juegos pendientes; «Emparejar otro dispositivo»; la lista de dispositivos con «Desemparejar» y confirmación en el sitio; «Código de recuperación nuevo» y «Desemparejar este dispositivo».
- **Desemparejada (`unpaired`):** dice por qué (servidor o cookies) y ofrece el código de recuperación o «Dejar de sincronizar». Lleva el mismo aviso de las cookies y la primera capa de los textos legales que la vista sin sincronizar, porque canjear un código vuelve a crearlas.

**Emparejar otro dispositivo:**

- Código de 10 min en texto y en QR (`<origen>/emparejar#código`, versión 5, corrección M, `#18181b` sobre blanco en los dos temas, 216 px), con cuenta atrás, «Otro código» y «Ocultar el código». El texto alternativo del QR no lleva el código.
- El QR lo codifica `uqr` 0.1.3 (MIT, sin dependencias), en su propio *chunk* (3,5 KB brotli), que se descarga al pedir un código. Un codificador propio eran unas 400 líneas difíciles de verificar sin un decodificador.
- La cuenta atrás y la hora límite van con el plazo local (envío + 10 min), no con el `expiresAt` del servidor: con el reloj del dispositivo adelantado, el código salía caducado.
- Mientras se ve un código vigente y la página está visible, mira la lista de dispositivos cada 5 s y avisa ««X» ya está emparejado.» en el aviso de la app.
- En un iPhone con la app en la pantalla de inicio hay que escribir el código: la cámara abre Safari, que tiene otras cookies y otro almacenamiento.

**Ruta `/emparejar#código`:** `startRouter()` guarda el código del fragmento y cambia la URL por `/ajustes/sincronizacion` antes de pintar (`router/pairing-link.ts`). Nunca se canjea solo: el campo llega relleno y el foco va a «Emparejar este dispositivo». El enlace solo vale en la vista en que se abrió y se olvida al cambiar de vista o al usarlo. En Safari de iOS fuera de la pantalla de inicio (`navigator.standalone === false`), la nota avisa de que la app de inicio guarda sus datos aparte.

**«Borrar todos mis datos» con la sincronización activada:**

- Emparejado (o restaurando): primero `sync.deleteServerAgenda()` y después `agenda.deleteAll()`. Borrar solo lo local con la cookie `HttpOnly` viva haría que el siguiente arranque viera indicio sin estado y restaurara la agenda entera.
- Si lo del servidor falla (sin red, `sync_disabled`, 5xx…), no se borra nada y se dice en un `role="alert"`, con un texto según la causa.
- Con un 401 tampoco se borra nada, y lo dice: el estado pasa a `unpaired` y un segundo «Borrar todo» borra solo lo de este dispositivo.
- Desemparejado: solo lo local, y la ayuda explica cómo borrar la agenda del servidor (recuperarla antes o borrarla desde otro dispositivo).
- Mientras espera (también el Web Lock de otra pestaña), «Borrar todo» dice «Borrando…», con `aria-disabled` y el foco.

**Último dispositivo:** si la lista ya cargada no tiene otro dispositivo `app` (el buzón del Atajo de iOS no cuenta), la confirmación de «Desemparejar este dispositivo» avisa de que la copia sincronizada se queda en el servidor y de cómo borrarla. La retención de 13 meses queda para la política (CA4.7).

**Mi lista vacía mientras se restaura (CA4.3):** «Estamos trayendo tu agenda sincronizada…», con sus variantes sin conexión y con fallo. Los cuatro textos ocupan la misma celda, así que el botón no se mueve.

**Foco, anuncios y huecos** (§9.5 y §9.7):

- El foco sigue a cada cambio de vista (`focusWhenReady()` y encabezados con `tabIndex=-1`). Si la vista cambia sin un gesto (un 401) y el foco se ha perdido, va al encabezado de la vista nueva; «Volver a cargar» lo lleva a «Dispositivos».
- La línea de estado es `role="status"`: se ve «Sincronizado hace 5 minutos.» (`aria-hidden`) y el lector oye «Sincronizado a las 18:42.», que no cambia hasta otra ronda. La cuenta atrás tampoco se anuncia; el lector oye «Sirve una sola vez, hasta las 18:52.».
- `role="alert"` solo para «Borrar todos mis datos» sin poder borrar el servidor.
- Los botones ocupados llevan `aria-disabled` (con estilo propio y texto en curso), no `disabled`, que manda el foco al `body`.
- La línea de pendientes tiene siempre su hueco y la lista de dispositivos empieza con un esqueleto de una fila.
- Arriba de la sección (`.sync__message`) solo van los avisos de un cambio de vista provocado por un gesto («Este dispositivo ya está emparejado…» y «Este dispositivo ya no sincroniza…»), y se borran al cambiar de vista. Lo que llega sin un gesto, y «Hemos desemparejado «X».», va al aviso de la app.
- Los nombres largos se parten (`overflow-wrap: anywhere`) en la sección y en el aviso de la app.

### Buzón del Atajo de iOS (08-11-2026; CA4.5)

El Atajo de iOS deja enlaces de Steam en D1, y la siguiente sincronización de cualquier app de la agenda los apunta (DECISIONES §10.39).

- **El *token*:**
  - es un `device` de tipo `inbox`. `POST /api/v1/inbox/token` lo crea con la cookie y un nombre (`Atajo de iOS` por defecto) y devuelve el *token* una sola vez;
  - son 256 bits en base64url, como la credencial de la app, y D1 guarda su SHA-256;
  - sale en la lista de dispositivos y se revoca como los demás. Revocarlo no desempareja la app que lo creó. Puede haber varios;
  - no vale como cookie de la app: `readDevice()` solo busca `kind = 'app'`.
- **`POST /api/v1/inbox`** (`worker/routes/inbox.ts`):
  - el *token* va en `Authorization: Bearer …`. No mira `Origin` ni acepta la cookie (§11.4), pero sigue exigiendo JSON;
  - un *token* sin forma de *token* da 401 sin tocar D1 ni el límite. Uno con forma pasa por `RL_INBOX` (por su SHA-256) y después se busca. Inventado o revocado, 401;
  - acepta `{ "url": "…" }` con un texto de hasta 2 KiB que lleve un enlace de Steam (`findSteamLink` de core: el que comparte la app de Steam lleva el título delante). Guarda solo el enlace canónico de la tienda (`canonicalStoreUrl`, `https://store.steampowered.com/app/<appid>/<slug>`);
  - sin enlace, 400 `invalid_link`;
  - un juego que ya espera en el buzón (con cualquier *slug*) no se repite: 200. Si no, 201. Con 200 pendientes en la agenda, 409 `inbox_full`;
  - las respuestas llevan, además del código, un `message` en español, porque es lo que enseña el Atajo, que no tiene la app para traducir.
- **En `sync`:**
  - la respuesta trae `inbox` (`{ id, url }`, 50 como mucho, por orden de llegada), solo en la última página (`more: false`). Con más páginas por bajar, la app aún no sabe si el juego ya está en la agenda, y apuntarlo pisaría su estado;
  - la petición lleva `inboxAck` (opcional, 200 ids como mucho), y el mismo `batch()` los borra, solo los de esa agenda.
- **En la app** (`engine.ts` y `links/inbox-capture.ts`):
  - con todo bajado (sin `more`, sin otra época y sin un *reset* en marcha), la ronda pasa los enlaces nuevos a `options.inbox`. Fuera de la transacción, la agenda de la pestaña los apunta como un enlace pegado. El título sale del catálogo local si llega en 500 ms; si no, el juego queda provisional con el del *slug*. Van en Quiero jugar, y lo que ya está en la lista no se toca (una lápida vuelve). Espera a `whenIdle()`;
  - después, la ronda confirma (en la petición siguiente) lo que está vivo en IndexedDB y lo que no es un enlace de Steam. Lo que no se haya guardado no se confirma y vuelve en la ronda siguiente;
  - en la misma ronda no se repite;
  - sin `inbox` (una pestaña sin agenda), no se confirma nada de Steam y se queda para otro dispositivo;
  - el aviso de la app dice qué ha llegado («Hemos apuntado «Hades» desde el Atajo de iOS.»), si no tapa otro.
- **Ajustes › Sincronización, «Atajo de iOS»** (`InboxSection`, entre «Dispositivos» y el código de recuperación):
  - el nombre y «Crear un token para el atajo»;
  - después, una sola vez, la dirección (`<origen>/api/v1/inbox`) y el valor del encabezado (`Bearer …`), cada uno con «Copiar», y los 7 pasos para crear el atajo en la app Atajos: hoja de compartir con URL y texto, «Obtener contenido de URL» con POST, el encabezado, el JSON con `url` y la notificación con `message`;
  - «Ya he creado el atajo» lo oculta.
- **A verificar en el iPhone:** los pasos, que el Atajo no envía `Origin` (si lo enviara, da igual: no se mira) y lo que comparte la app de Steam.

### `resolve` (08-11-2026; CA4.5)

`GET /api/v1/resolve/<appid>` (`worker/routes/resolve.ts`) da el nombre de un juego que no está en el catálogo local (DECISIONES §10.40).

- **El servidor:**
  - valida el `appid`: de 1 a 10 cifras, sin ceros delante y de 32 bits; si no, 404 sin llamar a nadie. Después pasa por `RL_RESOLVE`;
  - mira `resolve_cache`: un nombre vale 30 días (`RESOLVE_TTL_MS`), y «Steam no lo conoce» (`name = ''`), 1 día (`RESOLVE_MISS_TTL_MS`);
  - si no, pregunta a `IStoreBrowseService/GetItems/v1` sin clave y sin `data_request` (el nombre llega igual; comprobado el 08-11-2026: ≈0,3 s), en español y para España. Si está bloqueado en España, pregunta para EE. UU.;
  - Zod valida la respuesta de Steam (`steamItemsResponseSchema` de core), y el nombre se limpia: sin caracteres de control y 200 caracteres como mucho;
  - el tiempo de espera es de 2 s. Si Steam falla, vale lo que haya en la caché, aunque sea viejo; sin nada, 502 `steam_unavailable`;
  - es un GET que escribe en la caché. Son datos públicos, y nada de un usuario cambia (§11.4).
- **La respuesta es `{ appid, name }`, con `name: null` si Steam no lo conoce.** No es un 404: el navegador anotaría un error en la consola por cada juego que aún no existe.
- **Sin Cache API:** la caché es la tabla de D1, como decía la §5.2, porque `workers.dev` no la garantiza.
- **La app** (`agenda/resolve-client.ts` y `agenda/catalog-refresh.ts`, en el *chunk* inicial, sin Zod):
  - `catalog-refresh` busca también los juegos que se apuntan después (enlace pegado, buzón u otro dispositivo), 50 ms después de llegar, no solo al cambiar el catálogo;
  - lo que no está en el catálogo entero (en `scan` o `full`: en `boot` puede estar en el núcleo) pregunta a `resolve`, de uno en uno y una vez por sesión y juego;
  - con un nombre, `refreshFromCatalog` lo pone (se sincroniza como cualquier cambio de título). Con `null`, se queda provisional;
  - la petición va sin cookies (`credentials: 'omit'`), sin `Referer` y sin caché, con 5 s de espera;
  - sin red, se espera a `online`. Con 429, 5xx o una respuesta rara, se para 1 minuto; con 503 `sync_disabled`, 1 hora. Lo quitado de la lista ya no se pregunta.
- **Quien no sincroniza también lo usa:** la ruta no tiene credencial (§5.2), y el juego provisional es de cualquiera. Así que «quien no sincroniza no hace ninguna petición a `/api`» deja de ser cierto para `resolve`, y lo dice la política. Viaja el `appid`, y la IP llega a Cloudflare como con cualquier fichero de la app.
- **CA4.5, en E2E:** el nombre llega en ≤1,5 s desde que se apunta (`e2e/inbox.spec.ts`).

### Textos legales (08-11-2026; CA4.7)

Lo detalla DECISIONES §10.41.

- **Qué hay:**
  - la política de privacidad (`/privacidad`), por capas;
  - el aviso legal y las condiciones de uso (`/aviso-legal`);
  - la primera capa en `[data-sync-legal]`.
- **Dónde está:** los textos son datos en `apps/web/src/legal/` (`texts.ts`, `first-layer.ts` y `controller.ts`), y la pantalla los pinta como texto, en el *chunk* de Ajustes.
- **El responsable, pendiente:** el nombre o alias y el correo los da el usuario. Hasta entonces los textos dicen «pendiente», y `scripts/legal-guard.test.ts` no deja `SYNC_ENABLED` a `"1"` sin ellos.
- **El registro de actividades:** `docs/legal/registro-actividades.md`.
- **El interruptor:** `SYNC_ENABLED` sigue a `"0"` en `wrangler.jsonc`. Se pone a `"1"` al desplegar (parte 5), con el responsable puesto.

### CPU por petición (08-11-2026; CA4.6)

- **Estimación local:** `node scripts/api-cpu.ts` le resta a cada petición el tiempo de D1 (`docs/medidas/ca4.6-20261108.md`).
  - En caliente, el peor p99 es 2,38 ms, en `sync` con 200 operaciones. Bajar 1 000 cambios se queda en 2,22 ms, y el resto no pasa de 1,6 ms.
  - La primera petición de un *isolate* nuevo cuesta ≈6 ms, porque Hono y Zod preparan cosas la primera vez.
- **Lo que cierra CA4.6** es el p99 del panel de Workers en producción (parte 5).

### Pruebas

- Las rutas se prueban con `app.request()` de Hono, en Vitest y en Node (§12). D1 va sobre `node:sqlite` (SQLite 3.53.4) con las migraciones, las claves foráneas activas y `batch()` atómico (`worker/test/d1-sqlite.ts`). Los límites, el reloj y los clientes, cada uno con su tarro de cookies, son falsos. El 06-11-2026 eran 55 pruebas de la micro-API y 4 de los códigos de `core`.
- **CA4.1, con 1 000 casos cada una** (`sync.properties.test.ts`), con los generadores de las propiedades de `merge()` de `core`:
  - las mismas operaciones, barajadas, repetidas, en lotes y desde dos dispositivos, dan en D1 el estado de aplicarlas de una vez;
  - con datos incompletos (la marca sin su estado), Platinado ⇒ Completado se cumple en lo que guarda D1 tras cada petición;
  - dos réplicas que apuntan sin red y sincronizan en cualquier orden, con páginas de 7 y lotes de 1 a 30, acaban iguales entre sí y con D1.

  Con un servidor en el que gana lo último que llega, fallan las tres; con un cursor que se salta una fila, la tercera y dos de ejemplo. Tardan ≈15 s.
- **El cliente contra la micro-API en proceso** (`worker/test/sync-client*.test.ts`): réplicas con Dexie sobre `fake-indexeddb`, la agenda de verdad y su tarro de cookies, con `Replica.open()` de `sync-client-support.ts` (desfase, fallos, Web Locks falsos con cola, dos pestañas del mismo navegador, peticiones y respuestas retenidas, IndexedDB borrada con la app abierta, cargas del motor que fallan).
  - `sync-client.test.ts`: 23 de ejemplo;
  - `sync-client.properties.test.ts`: dos réplicas que convergen, 200 casos;
  - `sync-client-protocol.test.ts`: 11, con `runMaintenance` de verdad (el *reset* cortado con páginas de 5, el *reset* de más páginas que el tope, las dos purgas, el restore con un lote y con varios dispositivos, las lápidas viejas al activar, el reloj);
  - `sync-client-lifecycle.test.ts`: 10 (dos pestañas con la petición o la respuesta retenidas, con y sin Web Locks; el reintento del candado; desemparejar con una ronda en vuelo; borrar con un 401; IndexedDB borrada con la app abierta; el fallo de carga del motor).

  Cada arreglo de la revisión lleva su prueba de regresión, que falla con el código de `0d8b9ba`.
- **E2E contra la micro-API real** (DECISIONES §10.38): la vista previa del modo `e2e` sirve `createApp()` en `/api/*` con la D1 de `worker/test/`, con un «mundo» (D1 y reloj propios) por prueba, elegido con la cookie `HttpOnly` `ga-e2e-api`, y rutas de apoyo `/__e2e/*` que nunca van en el Worker de producción.
  - **Espejo HTTPS:** el WebKit de Playwright para Windows guarda las cookies `__Host-` por HTTP, pero ni las envía (401) ni deja leerlas en `document.cookie`. Por eso va por un espejo HTTPS de la misma vista previa (puerto + 10 000, certificado autofirmado de `node:crypto`). Chromium no registra el Service Worker con un certificado así, y va por `http://127.0.0.1`, como en el CI.
  - **Trampas de WebKit:** `page.route()` no ve las peticiones de una página con Service Worker, así que para retener o cortar la micro-API se usa `holdServer()` (`/__e2e/hold`); un clic no deja el foco en un botón, así que el foco se comprueba pulsando con `press('Enter')`; las cookies salen siempre con `SameSite=None`; y anota en la consola el `registration.update()` sin red y la carga del *chunk* `persist` del Worker de búsqueda al navegar.
  - `sync-api.spec.ts` (cookies, cabeceras, rutas de apoyo), `sync.spec.ts` (CA4.2, CA4.3, flujos de dos dispositivos, la purga semanal y el restore con época nueva) y `sync-settings.spec.ts` (Ajustes, con axe y a 320 px). El 07-11-2026: 134 E2E por proyecto, con 130 en verde y 4 omitidas en Chromium y 101 y 33 en WebKit.
- **`workerd` real** (07-11-2026, `wrangler dev` 4.155 con el *build* de producción, un `persist-to` nuevo y las migraciones 0001 y 0002): activar, emparejar, convergencia, CA4.3 al recargar y con la app abierta, la purga de un lunes, desemparejar y borrarlo todo. La época va en todas las respuestas de `/sync`, y las cabeceras de `/api`, con `no-store`, su CSP y `no-referrer`.
- `@cloudflare/vitest-pool-workers` sigue descartado (§6: exige otra versión mayor de Vitest). Lo que Node no imita (la versión de SQLite de D1, los límites reales) se comprueba con `wrangler dev` y en producción.

### Consecuencias

- Bien, porque la API vive en el mismo origen que la SPA: cookie de primera parte, sin CORS y con la CSP de siempre.
- Bien, porque el contrato está en un solo sitio, `core`, para el Worker y para la app.
- Bien, porque con el interruptor se puede desplegar el Worker antes de tener los textos legales, sin abrir nada.
- Bien, porque las pruebas de la micro-API corren en Node, en menos de 1 s, sin `workerd`.
- Mal, porque la D1 de las pruebas no es D1. Lo que dependa de su motor (versión de SQLite, límites, `json_each`) se comprueba con `wrangler dev` antes de subirlo.
- Mal, porque los tipos de Workers van escritos a mano: si se usa algo más del entorno, hay que declararlo.
- Bien, porque el servidor y la app fusionan con el mismo código: lo que comprueban las propiedades de `merge()` vale también para D1.
- Mal, porque el *bundle* lleva Zod entero: 309 KiB (69 KiB con gzip) con `sync`. Cabe de sobra, pero cuenta en el arranque en frío.
- Mal, porque `sync` lee antes de escribir: dos dispositivos que sincronizan a la vez pueden repetir la petición, y con más de 3 choques seguidos la app recibe 503 y reintenta más tarde.
- Bien, porque quien no sincroniza no paga nada: el JS inicial sube de 132,0 a 136,9 KB brotli (de 150) con la fachada y los textos, y el motor (5,7 KB brotli), Zod y el QR van en *chunks* diferidos.
- Bien, porque la purga semanal deja cada dispositivo igual que D1, y lo que pierda un restore con Time Travel vuelve con la época.
- Mal, porque cada purga cuesta un *reset* por dispositivo, que baja la agenda entera y la guarda en memoria.
- Mal, porque los E2E de WebKit van por un espejo HTTPS y con sus propias trampas: no son el Safari de un iPhone.
- Bien, porque el Atajo de iOS apunta sin abrir la app con un *token* que solo puede dejar enlaces, y lo apuntado pasa por la misma agenda que un enlace pegado.
- Mal, porque `resolve` hace que quien no sincroniza pueda llamar a `/api`, aunque solo para un juego que no está en el catálogo, sin cookies.
- **Pendiente:**
  - **el responsable** de los textos legales (nombre o alias y correo), que da el usuario, en `legal/controller.ts`;
  - **parte 5, desplegar:** crear D1 con `--jurisdiction=eu`; el permiso de D1 del *token* de `deploy-web`; las migraciones 0001 y 0002 en el flujo, antes del Worker; `SYNC_ENABLED` a `"1"`; medir CA4.6 en el panel de Workers; y las pruebas en el iPhone (CA4.3 con los datos de Safari, CA4.5 con el Atajo de verdad y el QR con la app en la pantalla de inicio).
- **A verificar al desplegar:**
  - que el plan gratuito admite la jurisdicción UE de D1 y el *binding* `ratelimits`, porque la documentación no lo dice;
  - el id real de D1 en `wrangler.jsonc`;
  - que `navigator.standalone` solo existe en iOS: si Safari de macOS lo diera como `false`, la nota de Safari saldría en un Mac.

### Confirmación

- `apps/web/worker/test/` (`rules`, `agenda`, `pairing`, `sync`, `sync.properties`, `maintenance`, `inbox`, `resolve` y los cinco `sync-client*`), `packages/core/test/api.codes.test.ts` y `sync.client.test.ts`, y las pruebas de `apps/web/src/sync/`, `agenda/` (`catalog-refresh` y `resolve-client`), `legal/` y `screens/settings/`, y `scripts/legal-guard.test.ts`, dentro de `npm run check`. El 08-11-2026, `npm test` da 94 ficheros y 1 264 pruebas.
- E2E: `e2e/sync-api.spec.ts`, `e2e/sync.spec.ts` y `e2e/sync-settings.spec.ts`, en Chromium y en WebKit en local; los tres con `--repeat-each=3` en verde el 07-11-2026. `e2e/inbox.spec.ts` (el Atajo, `resolve` y los textos legales), con `--repeat-each=3` en verde el 08-11-2026.
- Biome: la micro-API no importa `apps/web/src/`, `node:*`, React, Dexie ni `pipeline/`, y la SPA no importa `worker/` (comprobado con un fichero que lo incumple).
- `wrangler dev` el 06-11-2026: alta, cookies, lista, código de un solo uso, 404 de la API, *fallback* de la SPA, límite y borrado en cascada; `sync` con la derivada de Platinado, el rechazo de una acción entera, texto con ñ y emoji y la repetición idempotente; y la purga de un lunes. El 07-11-2026, el recorrido del cliente con el *build* de producción (ver «Pruebas»).
- `wrangler dev` el 08-11-2026, con las migraciones 0001 y 0002 en una D1 local nueva: el buzón (enlace canónico, sin repetir el juego, un `appid` que empieza igual sí entra, `invalid_link`, el orden en `sync`, la confirmación y el 401 tras revocar) y `resolve` con Steam de verdad (322 ms; de la caché, 9 ms; `name: null` para un `appid` que no existe; 404 si está mal formado).
- CA4.1–CA4.7, al cerrar M4.

## Pros y contras de las opciones

### 1. Micro-API en `/api/*` de `ga-web`, con D1 en la UE

- Bien, porque es el mismo origen: cookie de primera parte, sin CORS y `connect-src 'self'`.
- Bien, porque D1 es SQL y se prueba con `node:sqlite`; Hono y el SQL se llevan a otro sitio (§5.4).
- Bien, porque la jurisdicción UE se fija al crear la base.
- Mal, porque cada petición a `/api/*` cuenta para las 100 000 diarias del Worker y su CPU, para los 10 ms.

### 2. Worker aparte, en otro origen

- Bien, porque `ga-web` seguiría siendo solo *assets*.
- Mal, porque la cookie sería de terceros. Safari las bloquea (ITP), y la de la pantalla de inicio de iOS va aparte de todos modos.
- Mal, porque obliga a CORS con credenciales y a otro origen en `connect-src`.

### 3. Un Durable Object con SQLite por agenda

- Bien, porque serializa las escrituras de cada agenda sin pensar en `batch()`.
- Mal, porque es una pieza más, con su propio modelo y su despliegue de clases.
- Mal, porque las pruebas en Node necesitarían imitar también el Durable Object.
- Mal, porque D1 ya da lo que hace falta: `batch()` atómico y en serie (§7.7).

## Más información

- `prototipe.md`: §5.2 (rutas), §5.3 (flujo), §7.2, §7.4 y §7.7 (`meta`, HLC, `merge()` y D1), §9.1 y §9.5–§9.9 (Ajustes › Sincronización), §11.2 y §11.4 (privacidad y seguridad), §12 (pruebas) y §15.7 (M4).
- `docs/planificacion/DECISIONES.md`: D-13, D-15, D-16 y §10.34–§10.38.
- ADR-001 (arquitectura), ADR-003 (*hosting* y despliegue) y ADR-004 (datos del usuario).
- Fuentes, consultadas el 06-11-2026: Cloudflare, [jurisdicción de D1](https://developers.cloudflare.com/d1/configuration/data-location/), [*binding* de límites](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [`run_worker_first`](https://developers.cloudflare.com/workers/static-assets/binding/) y [SPA con Worker](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/); Congreso, [enmiendas de ponencia del proyecto 121/000052](https://www.congreso.es/enmiendas/comisiones/15_303_121_000052/121-52_Enm_in_voce_aprobadas_en_Ponencia_24-06-2026.pdf). El 07-11-2026: `uqr` 0.1.3 en npm (MIT, sin dependencias, publicada el 03-04-2026), y [Time Travel de D1](https://developers.cloudflare.com/d1/reference/time-travel/).
