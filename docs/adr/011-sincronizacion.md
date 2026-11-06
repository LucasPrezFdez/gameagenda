# ADR-011 · Sincronización: micro-API, D1 en la UE y emparejamiento

- **Estado:** propuesta. Pasa a «aceptada» con CA4.1–CA4.7 cumplidos en producción.
- **Fecha:** 06-11-2026 (al empezar M4)
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

Opción elegida: **1**, porque es la del plan (D-13), mantiene la cookie de primera parte y la CSP con `connect-src 'self'`, y D1 se prueba en Node con el mismo SQL. Lo que sigue es lo construido el 06-11-2026 en la rama `m4-sincronizacion`: la base (DECISIONES §10.34) y `POST /api/v1/sync` con la purga (§10.35). El cliente, el buzón y `resolve` se añadirán aquí al hacerlos.

### Encaminamiento

- `apps/web/wrangler.jsonc` lleva `main: ./worker/index.ts` y `assets.run_worker_first: ["/api/*"]`. El *script* solo corre en `/api/*`, y el resto lo sirven los *assets*, gratis. Si llega otra petición al *script* (con `run_worker_first`, Cloudflare no garantiza dejar fuera las navegaciones), se devuelve con `env.ASSETS.fetch()`, que aplica el *fallback* de la SPA.
- Comprobado con `wrangler dev` (`workerd` y D1 locales) el 06-11-2026: `/juego/steam:730` da el 307 de siempre y luego `index.html`, y un fichero que no existe, el `index.html` del *fallback*.
- **Interruptor:** la variable `SYNC_ENABLED` vale `"0"` en `wrangler.jsonc`, y con ella toda `/api/*` responde 503 `sync_disabled` sin tocar D1. Se pone a `"1"` cuando estén publicados los textos legales (CA4.7).

### Código y tipos

- `apps/web/worker/`: `app.ts` (Hono), `http.ts` (reglas), `device.ts` (credencial), `crypto.ts` y `routes/`. Importa `core` y Hono, nunca `apps/web/src/` ni `node:*`. Lo vigila Biome, y la SPA tampoco puede importar `worker/` (§14.3, regla 3).
- **Hono 4.13.16:** un parche sobre la 4.13.14 de la §6, comprobado en npm el 06-11-2026 y sin dependencias.
- **Sin `@cloudflare/workers-types`:** `env.ts` declara a mano lo que se usa: seis métodos de D1, `ratelimits` y `ASSETS`. Así la D1 de las pruebas, en Node, implementa la misma interfaz sin mezclar sus tipos con los de `@types/node`. Sin `nodejs_compat`.
- **El contrato, en `core`:** `@gameagenda/core/api` tiene los esquemas Zod de cada petición (objetos estrictos: un campo de más da 400) y de cada respuesta (abiertos: un cliente antiguo acepta campos nuevos), los códigos de error y el formato de los códigos. El Worker valida con ellos, y la app los usará igual.
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
- **Emparejar:** `POST /api/v1/pairing` (con cookie) da un código de 10 min. `POST /api/v1/pairing/redeem` lo canjea con un `DELETE … RETURNING`, así que el que lo encuentra es el único que lo usa. Usado, caducado e inventado dan la misma respuesta, 400 `invalid_code`.
- **Recuperar:** `POST /api/v1/recovery/redeem` da un dispositivo nuevo y el código sigue valiendo. **Ruta nueva**, que no estaba en la §5.2: `POST /api/v1/recovery` (con cookie) crea otro código y anula el anterior, por si se pierde o alguien lo ve.
- **Un dispositivo ya emparejado** no crea agenda ni canjea códigos: 409 `already_paired`. Para cambiar de agenda, antes se desempareja.
- **Revocar** borra la fila, porque el *hash* de una credencial solo se guarda hasta revocarla (§11.2). Revocarse a uno mismo es desemparejar, y quita las cookies.
- **Edad (CA4.7; R-10):** `POST /api/v1/agenda` exige `ageConfirmed: true` y la `minAge` que se le pidió declarar. Si no coincide con la variable `MIN_AGE` del servidor (14), responde 409 `age_policy_changed`. Así, subirla a 16 no deja pasar a un cliente que preguntó por 14. El 06-11-2026 la ley que la sube seguía en el Congreso (enmiendas de ponencia del 24-06-2026).

### Límites (§11.4)

- Con el *binding* `ratelimits`: `RL_AGENDA`, 5 por minuto, para crear agendas, y `RL_REDEEM`, 10 por minuto, para canjear códigos. Los dos van por IP, y al *binding* le llega el SHA-256 de la IP, no la IP.
- Son aproximados y por ubicación de Cloudflare. Protegen la cuota: adivinar 140 bits es inviable igual.
- En `workerd` local, la quinta alta del mismo minuto dio 429.

### Sincronización (`POST /api/v1/sync`)

Una ida y vuelta, como dice la §7.7: sube la `outbox` y baja los cambios desde el cursor. Lo que cambia respecto a la §7.7:

- **El LWW lo decide la `merge()` de `core`, no el SQL.** El servidor lee en una transacción la `seq` de la agenda y las filas de las entradas tocadas, reconstruye cada entrada, le aplica el lote con `applyOps()` (LWW, Platinado ⇒ Completado y reenvío de los manuales vinculados) y escribe las filas que cambian (`worker/sync-plan.ts`). Si una derivada toca otra entrada, lee sus filas y repite, hasta 8 saltos.
  - El motivo: el servidor tiene que leer las filas de todos modos, para las derivadas. Además, el `WHERE excluded.hlc > op.hlc` de la §7.7 necesitaba un desempate por valor, y SQLite compara UTF-8 donde JavaScript compara UTF-16. Así hay una sola implementación de LWW (§5.4, principio 6).
- **Concurrencia optimista:** el `batch()` de escritura hace `UPDATE agenda SET seq = seq + n, write_id = <uuid> WHERE seq = <la leída>`, y el `INSERT … SELECT … FROM json_each()` solo escribe si `write_id` sigue siendo el suyo. Si otro dispositivo escribió entre medias, se repite, hasta 3 veces (después, 503 `busy`). En el mismo `batch()` se lee la página de cambios, así que nadie ve la `seq` N+1 sin la N.
- **Rechazos por acción:** cada operación pasa por `strictOpSchema` y por el reloj. Si una no vale, se rechazan con ella todas las de su HLC, porque una acción no se parte. `invalid` se descarta; `clock` (más de 5 min por delante) se vuelve a sellar. Las demás van en `accepted`, ganen o no.
- **Cursor y purga:** la petición lleva `cursor` y el `purgedSeq` de la última respuesta. Hay `reset` (bajar desde 0 y, al acabar, borrar lo que el servidor ya no tiene) si `0 < cursor < purged_seq` y la app no ha visto esa purga (`purgedSeq < purged_seq`). Sin el `purgedSeq`, las páginas de un *reset* volverían a pedirlo. Un cursor por delante del servidor (D1 vuelto atrás con Time Travel) también baja desde 0; la app lo nota porque el cursor nuevo es menor, y entonces vuelve a subirlo todo.
- **Respuesta:** `cursor`, `purgedSeq`, `reset`, `more`, `serverTime`, `changes` (1 000 por página, también las propias: aplicarlas otra vez no cambia nada), `accepted` y `rejected` (`index`, `opId`, `reason`).
- **Cookie:** se renueva al sincronizar, como mucho una vez al día, con `device.last_seen_at` y `agenda.last_sync_at`.
- **Lotes de 200, no de 500:** en Node, filtrar y planificar 500 operaciones cuesta p50 3,1 ms y p99 4,9 ms, y 8,5 ms en frío, cerca de los 10 ms del plan gratuito. Con 200, p50 ≈1,4 ms y p99 ≈2,3 ms. `SYNC_BATCH_SIZE` pasa a 200. El servidor admite hasta 1 000, por si una sola acción tuviera más. CA4.6 se mide en producción.
- **Consultas:** 3 por petición con escritura (cookie, lectura y `batch()`), y una más por cada salto de reenvío. El límite gratuito es de 50.

### Mantenimiento (Cron Trigger `17 3 * * *`, `worker/maintenance.ts`)

Un solo `batch()` al día:

- borra los *tokens* de emparejamiento caducados;
- borra en cascada las agendas sin sincronizar en 13 meses (§11.2);
- los lunes, la purga semanal: las entradas con `deletedAt` de hace más de 90 días y los esqueletos (sin `status` o sin `title`) sin cambios en 90 días. `purged_seq` sube a la mayor `seq` de lo purgado, y la `seq`, 1, para que un `sync` que leyó antes de la purga lo note.

Comprobado en `workerd` local con la API de `wrangler dev` (`POST /cdn-cgi/local/explorer/api/local/scheduled?worker=ga-web` con `cron` y `scheduled_time`; `/__scheduled` ya no existe en la 4.155.0).

### Esquema de D1 (`worker/migrations/0001_inicial.sql`)

Es el de la §7.7, con seis cambios:

- `created_at` en `agenda` y en `inbox_item`, y `label`, `created_at` y `last_seen_at` en `device`, para la lista de dispositivos de Ajustes;
- sin `revoked_at` ni `used_at`, porque revocar y canjear borran la fila;
- `recovery_hash` único, para buscarlo por índice;
- índices por `agenda_id` en las tablas hijas, para las cascadas;
- `write_id` en `agenda`, para la concurrencia optimista de `sync`.

D1 aplica las claves foráneas, así que borrar una agenda se lleva sus dispositivos, *tokens*, operaciones y buzón (CA4.7). `STRICT`, `WITHOUT ROWID`, `RETURNING`, `json_each`, `->>`, el *upsert* y la purga con CTE funcionan en el `workerd` de `wrangler` 4.155.0.

### Pruebas

- Las rutas se prueban con `app.request()` de Hono, en Vitest y en Node (§12). D1 va sobre `node:sqlite` (SQLite 3.53.4) con las migraciones, las claves foráneas activas y `batch()` atómico (`worker/test/d1-sqlite.ts`). Los límites, el reloj y los clientes, cada uno con su tarro de cookies, son falsos. En total, 55 pruebas de la micro-API y 4 de los códigos de `core`.
- **CA4.1, con 1 000 casos cada una** (`sync.properties.test.ts`), con los generadores de las propiedades de `merge()` de `core`:
  - las mismas operaciones, barajadas, repetidas, en lotes y desde dos dispositivos, dan en D1 el estado de aplicarlas de una vez;
  - con datos incompletos (la marca sin su estado), Platinado ⇒ Completado se cumple en lo que guarda D1 tras cada petición;
  - dos réplicas que apuntan sin red y sincronizan en cualquier orden, con páginas de 7 y lotes de 1 a 30, acaban iguales entre sí y con D1.

  Con un servidor en el que gana lo último que llega, fallan las tres; con un cursor que se salta una fila, la tercera y dos de ejemplo. Tardan ≈15 s.
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
- **Pendiente:**
  - el cliente de sincronización (Web Locks, disparadores, cursor, `reset`, desfase de la HLC y volver a sellar), con CA4.2 y CA4.3;
  - el buzón y `resolve` (CA4.5), con sus límites `RL_INBOX` y `RL_RESOLVE`;
  - Ajustes › Sincronización y los textos legales (CA4.7);
  - medir CA4.6.
- **A verificar al desplegar:**
  - que el plan gratuito admite la jurisdicción UE de D1 y el *binding* `ratelimits`, porque la documentación no lo dice;
  - el id real de D1 en `wrangler.jsonc`;
  - el permiso de D1 del *token* de `deploy-web` y las migraciones en el flujo.

### Confirmación

- `apps/web/worker/test/` (`rules`, `agenda`, `pairing`, `sync`, `sync.properties` y `maintenance`) y `packages/core/test/api.codes.test.ts`, dentro de `npm run check`.
- Biome: la micro-API no importa `apps/web/src/`, `node:*`, React, Dexie ni `pipeline/`, y la SPA no importa `worker/` (comprobado con un fichero que lo incumple).
- `wrangler dev` el 06-11-2026: alta, cookies, lista, código de un solo uso, 404 de la API, *fallback* de la SPA, límite y borrado en cascada; `sync` con la derivada de Platinado, el rechazo de una acción entera, texto con ñ y emoji y la repetición idempotente; y la purga de un lunes.
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

- `prototipe.md`: §5.2 (rutas), §5.3 (flujo), §7.4 y §7.7 (HLC, `merge()` y D1), §11.2 y §11.4 (privacidad y seguridad), §12 (pruebas) y §15.7 (M4).
- `docs/planificacion/DECISIONES.md`: D-13, D-15, D-16 y §10.34.
- ADR-001 (arquitectura), ADR-003 (*hosting* y despliegue) y ADR-004 (datos del usuario).
- Fuentes, consultadas el 06-11-2026: Cloudflare, [jurisdicción de D1](https://developers.cloudflare.com/d1/configuration/data-location/), [*binding* de límites](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [`run_worker_first`](https://developers.cloudflare.com/workers/static-assets/binding/) y [SPA con Worker](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/); Congreso, [enmiendas de ponencia del proyecto 121/000052](https://www.congreso.es/enmiendas/comisiones/15_303_121_000052/121-52_Enm_in_voce_aprobadas_en_Ponencia_24-06-2026.pdf).
