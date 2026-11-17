# Importación de Steam, parte 2: «Iniciar sesión con Steam» y traer la biblioteca

> Encargo escrito el 17-11-2026 para la sesión siguiente. Para empezar: *«Lee `docs/planificacion/prompts/importacion-steam-parte-2.md` y empieza por el paso 0»*. Se trabaja en una rama nueva, `steam-parte-2`, que sale de `main` (`49dbd6c`). No se integra en `main` sin mi visto bueno.

## Tu papel

Eres un desarrollador sénior de *full stack* con experiencia en seguridad de aplicaciones web: autenticación federada (OpenID 2.0), Cloudflare Workers y D1, y PWA *local-first*. Trabajas en el repositorio de GameAgenda (https://github.com/LucasPrezFdez/gameagenda), en Windows 11 con Node 24.21 y npm 11.19, sin Docker ni Python. Eres riguroso: cada comprobación de seguridad lleva una prueba que falla sin ella, y no das nada por verificado sin haberlo medido o ejecutado.

## Contexto

GameAgenda es una agenda personal de videojuegos (Mi lista, estados, marcas) sobre el catálogo completo de Steam. Es una PWA de React 19 con IndexedDB (Dexie), y la app de escritorio (Tauri) carga la misma web. La sincronización (M4) va por una micro-API de Hono en `/api/*` del Worker `ga-web`, con D1 `ga-agenda` en la UE.

La Fase 2 empezó con la **parte 1, ya en producción desde el 17-11-2026**: Mi lista aguanta miles de juegos (lista virtual) y la copia JSON se importa por lotes (DECISIONES §10.48). La importación de la biblioteca de Steam queda en tres partes:

| Parte | Qué | Estado |
|---|---|---|
| **2** | Iniciar sesión con Steam (OpenID 2.0) y traer biblioteca, horas y deseados | **este encargo** |
| 3 | Pantalla de revisar y aplicar, con Deshacer; y qué hacer con la `outbox` | después |
| 4 | Logros, como sugerencia de Platinado | después |

## Lee antes de tocar nada

1. `docs/planificacion/ESTADO-SESION.md` §0 y §5 (reglas de trabajo).
2. `prototipe.md` §10 entera (o `docs/planificacion/secciones/10-cuenta-steam.md`). Es la especificación: qué se importa, las cinco comprobaciones de OpenID, el canje tipo PKCE, el flujo y qué se guarda.
3. `prototipe.md` §11: obligaciones de los ToU de Steam (≤100 000 llamadas al día, clave confidencial, botón oficial, nada de insinuar respaldo de Valve), retención de datos (ticket con SteamID64 ≤10 min en D1) y reglas de la micro-API (§11.4: `Origin`, `Content-Type`, *rate limiting*).
4. `docs/adr/011-sincronizacion.md` y `docs/planificacion/DECISIONES.md` §10.34–§10.48: cómo está hecha la micro-API, sus pruebas y su despliegue (sobre todo §10.40, `resolve`, que ya llama a Steam desde el Worker, y §10.47, migraciones solo aditivas).
5. El código de la micro-API: `apps/web/worker/` (`app.ts`, `env.ts`, `http.ts`, `routes/resolve.ts`, `maintenance.ts`, `migrations/`), sus pruebas en `apps/web/worker/test/` (`harness.ts`, `d1-sqlite.ts`, `resolve.test.ts`), `apps/web/wrangler.jsonc` y `scripts/api-cpu.ts`.
6. El lado de la app: `apps/web/src/screens/settings/` (Ajustes › Datos), `apps/web/src/sync/api-client.ts`, `apps/web/src/legal/` y `scripts/legal-guard.test.ts`; la navegación externa de escritorio en `apps/desktop/src-tauri/src/main.rs` (`on_navigation`, `open_in_browser`); y el Steam falso de los E2E (`apps/web/e2e/sync-server.ts`, `POST /__e2e/steam`).

## Objetivo

Que el usuario pulse **«Importar desde Steam»**, inicie sesión en Steam con el botón oficial y vuelva a GameAgenda con su biblioteca (juegos, horas y última partida) y su lista de deseados en el dispositivo, listas para la parte 3. En esta parte la app solo muestra el resumen («Hemos encontrado 287 juegos en tu biblioteca y 25 deseados») y **no cambia nada de la agenda**.

## Alcance

**Entra:**

- **Micro-API:**
  - `POST /api/v1/steam/start`: recibe el `challenge` y devuelve el ticket y la URL de OpenID;
  - `GET /api/v1/steam/callback`: comprueba la aserción y responde la página «Listo. Vuelve a GameAgenda»;
  - `POST /api/v1/steam/redeem`: canjea el ticket con su verificador y trae `GetOwnedGames` y `GetWishlist`;
  - la migración `0003` con la tabla de tickets;
  - la purga de tickets en el mantenimiento diario;
  - el *rate limiting* y el interruptor (abajo).
- **App:**
  - la entrada en Ajustes › Datos, con el botón oficial de Steam;
  - generar el verificador y el `challenge`, abrir el login y canjear el ticket al volver (pestaña, PWA de iOS y app de escritorio);
  - los estados: esperando, perfil privado (con la guía de §10.1), biblioteca vacía, error, sin red y ticket caducado;
  - el resumen;
  - lo traído, guardado solo en memoria, o en `meta` con caducidad si lo pide el diseño de la parte 3.
- **Legal:** la política de privacidad y el registro de actividades, al día con el SteamID64 y los datos que vienen de Steam.
- **Documentación:**
  - el ADR-012 (`docs/adr/012-cuenta-de-steam.md`) y su línea en `docs/adr/README.md`;
  - la entrada §10.49 de DECISIONES;
  - las secciones del plan que cambien, con `prototipe.md` montado;
  - el CHANGELOG y el traspaso en ESTADO-SESION.

**No entra:**

- revisar y aplicar los cambios en la agenda (parte 3);
- los logros (parte 4);
- el *token* de importación firmado para los lotes de logros (§10.4), salvo que el diseño de esta parte lo necesite;
- cualquier otra plataforma (IGDB).

## Lo que ya está decidido (no lo reabras sin motivo)

- **Ninguna llamada a Steam por usuario antes de un login OpenID verificado**, ni con clave ni sin ella.
- Las cinco comprobaciones de la §10.2, todas. `steam-signin` solo compara esquema y host: la ruta, el ticket, la URL fija de `check_authentication` y el formato de `claimed_id` los comprueba la micro-API (CVE-2026-82183).
- **Canje tipo PKCE:** el ticket caduca en 10 minutos, es de un solo uso y se liga a `challenge = SHA-256(verificador)`. Solo lo canjea quien tiene el verificador. Es lo que hace que funcione la PWA de iOS (el login acaba en Safari, con otras *cookies*) y lo que impide el *login CSRF*.
- **Las respuestas de Steam no se guardan en D1** y van con `Cache-Control: no-store`. No se registra nada de `/api/v1/steam/*`.
- D1 guarda solo el *hash* del ticket, el `challenge`, la caducidad y, tras el login, el SteamID64, y nada más de 10 minutos. Las migraciones son solo aditivas: la versión anterior del código tiene que funcionar con la base nueva.
- **Sin `GetPlayerSummaries`:** ni nombre, ni avatar, ni ubicación.
- **El CI nunca llama a Steam:** las aserciones de OpenID y las respuestas de la Web API van grabadas en *fixtures*.
- **La clave de la Steam Web API** se llama `STEAM_WEB_API_KEY`, como en el *pipeline* y en `scripts/scan-secrets.ts`, y pasa a ser también un secreto del Worker. Nunca va en el chat, el repositorio, los registros ni el *bundle* del cliente. En local, en un `.dev.vars` que esté en `.gitignore` **antes** de crearlo.

## Decisiones que tienes que proponerme (y esperar mi respuesta)

Para cada una, dame las opciones, lo que mediste y tu recomendación:

1. **`steam-signin` 1.0.5 con `nodejs_compat`, o portar su `verifyLogin` (MIT) a `fetch`.** Mide el coste de `nodejs_compat`: tamaño del Worker y CPU del arranque en frío (CA4.6: p99 ≤10 ms en el plan gratuito). Comprueba en npm que 1.0.5 sigue siendo la última y tiene más de dos semanas.
2. **Cómo devolver la biblioteca sin pasarse de CPU.** Con 5 000 juegos, `GetOwnedGames` con `include_appinfo` pesa del orden de 1 MB. Parsearlo en el Worker puede comerse los 10 ms. Una opción es pasar el cuerpo de Steam tal cual, en *streaming*, comprobando antes el estado y el tipo de contenido, y normalizar en el dispositivo. Mídelo con `scripts/api-cpu.ts` y una *fixture* de 5 000 juegos.
3. **El tope de llamadas** para los ToU (§11.1: «con tope por agenda»): por IP, por SteamID64 o un contador diario. Ten en cuenta que los *ratelimits* del Worker solo admiten periodos de 10 o 60 s. Hoy los espacios ocupados van del 1101 al 1104.
4. **Si importar exige tener la sincronización activada.** El usuario decidió que `resolve` solo se usa sincronizando (08-11-2026). Aquí lo lanza el usuario a propósito, pero puede que quiera lo mismo.
5. **El nombre y el valor por defecto del interruptor** (p. ej., `STEAM_ENABLED`, a `"0"` en producción hasta tener la parte 3). Y qué ve la app con él apagado.

## Restricciones

**Seguridad y privacidad**

- Cada una de las cinco comprobaciones de la §10.2 lleva su prueba con una aserción grabada que falla sin ella: firma falsa, campo sin firmar, `op_endpoint` ajeno, `return_to` con otra ruta u otro ticket, `claimed_id` con otro formato, ticket repetido, ticket caducado y verificador equivocado.
- Una prueba que demuestra que ni `start` ni un `callback` no válido hacen ninguna llamada a la Web API.
- El `realm` y el `return_to` salen del origen de la petición, no de un valor fijo. El túnel de las pruebas a mano tiene otro *host*, y OpenID 2.0 exige el mismo puerto.
- Las reglas de la §11.4: `Origin` propio y `Content-Type: application/json` en los POST, y `Cache-Control: no-store`.
- El escáner de secretos sigue mirando `apps/web/dist` (que no lleve ni los nombres ni la clave). Añade una comprobación de que el valor de la clave no está en el *bundle* del Worker (`wrangler deploy --dry-run --outdir`).
- No se activa en producción sin la política de privacidad al día: amplía `scripts/legal-guard.test.ts` para que el interruptor no pueda estar a `"1"` sin ella.

**Rendimiento**

- La CPU de las rutas nuevas, con `scripts/api-cpu.ts` y una biblioteca de 5 000 juegos: p99 por debajo de 10 ms en caliente y la primera petición de un *isolate*, medida. El plan gratuito permite 50 subpeticiones por invocación.
- `npm run size` en verde. Lo de Steam no puede ir en el *chunk* inicial: va en un *chunk* diferido, como Ajustes.
- La app no hace ninguna petición nueva a `/api` hasta que el usuario pulsa el botón. Comprúebalo como en `sync.spec.ts` («quien no sincroniza no hace ninguna petición a /api»).

**Técnica y convenciones**

- Hono y D1 como en el resto de la micro-API, pruebas con `app.request()` y la D1 sobre `node:sqlite`.
- Versiones exactas (`.npmrc` con `save-exact=true`) y ninguna dependencia más que, si acaso, `steam-signin`.
- Español de España en la interfaz y en los documentos; código e identificadores en inglés. Commits con Conventional Commits (tipo en inglés, descripción en español). Microcopia según la §9.9.
- Accesibilidad según la §9.7: el botón oficial lleva un nombre accesible en español, los estados van en `role="status"`, y axe pasa en Chromium y WebKit.

## Proceso, con puntos de control

0. **Preparación.**
   - Crea la rama `steam-parte-2` desde `main`.
   - Comprueba que `.dev.vars` está en `.gitignore`.
   - Lee lo de arriba y escríbeme un resumen de una pantalla: qué vas a hacer, qué te preocupa y las cinco decisiones con tu recomendación. **Espera mi respuesta.**
1. **ADR-012 en «propuesta»,** con las decisiones que yo haya tomado.
2. **Micro-API**, con un *commit* por pieza y `npm run check` en verde en cada uno:
   1. migración `0003` y purga;
   2. `start`;
   3. `callback`, con las comprobaciones y sus *fixtures*;
   4. `redeem`, con el Steam falso;
   5. *rate limiting* e interruptor;
   6. medida de CPU.
3. **App:** la entrada en Ajustes › Datos, el flujo en la pestaña, en la PWA (canje desde otro contexto distinto del del login) y en la app de escritorio, y los estados y el resumen. E2E en Chromium y WebKit con el Steam falso, axe incluido.
4. **Legal:** la política, el registro y `legal-guard`.
5. **Prueba a mano con Steam de verdad** (la hago yo contigo), con un túnel `cloudflared` en HTTPS. Casos: mi cuenta, perfil con «Detalles de juegos» privado, biblioteca vacía (si hay una cuenta), un juego compartido en familia y un juego marcado como privado. Anota qué campos devuelve Steam de verdad y ajusta las *fixtures*.
6. **Verificación final:**
   - `npm run check`;
   - la batería E2E entera, en Chromium y WebKit;
   - `npm run perf`, para comprobar que nada empeora;
   - el CI lanzado a mano en la rama (`gh workflow run ci.yml --ref steam-parte-2`).
7. **Documentación:**
   - el ADR-012 en «aceptada»;
   - DECISIONES §10.49;
   - las secciones del plan (§10, y la §11 si cambia) y `prototipe.md` montado;
   - el CHANGELOG;
   - el traspaso en ESTADO-SESION, con lo que queda para la parte 3.
8. **Pídeme el visto bueno** para pasarla a `main` con el interruptor apagado en producción. Después de desplegar, `npm run smoke:web`.

## Criterios de aceptación

- Las cinco comprobaciones de OpenID, el ticket de un solo uso, la caducidad y el verificador, cada uno con una prueba que falla si se quita.
- Ninguna llamada a Steam antes de un login verificado, comprobado por una prueba.
- D1 no guarda nada más que el ticket, y la purga lo borra. Ninguna respuesta de Steam llega a D1 ni a los registros.
- La clave no aparece en el cliente ni en el *bundle* del Worker, y el CI lo comprueba.
- CPU de `redeem` con 5 000 juegos por debajo de 10 ms en el p99, medida y documentada.
- Funciona en una pestaña, en la PWA de iOS (simulada en WebKit: el canje desde otro contexto) y en la app de escritorio (con el navegador del sistema).
- Con el perfil privado, la guía corta. Con el ticket caducado o sin red, un mensaje claro y la forma de volver a empezar.
- `check`, E2E (Chromium y WebKit), `size` y `perf` como en `main`, o mejor.
- La política de privacidad al día, y `legal-guard` lo exige.

## Qué no hacer

- Aplicar nada a la agenda: eso es la parte 3.
- Llamar a Steam desde el cliente con la clave, o pedir el perfil sin login («pegar la URL del perfil» está descartado en la §10.2).
- Guardar las respuestas de Steam en el servidor o registrarlas.
- Usar `passport-steam`, pedir contraseñas o *tokens* de Steam, o usar PICS.
- Imprimir, copiar o pedir la clave en el chat. Si hace falta, se pone con `wrangler secret put`.
- Borrar ramas, *worktrees* o borradores.
- Integrar en `main` o desplegar sin mi visto bueno.

## Lo que tengo que hacer yo (el usuario)

- **Poner la clave como secreto del Worker de `ga-web`,** con la cuenta de Cloudflare de `ga-web`:
  `! npx wrangler secret put STEAM_WEB_API_KEY -c apps/web/wrangler.jsonc`
- Hacer contigo la prueba a mano del paso 5, con mi cuenta de Steam.

## Para tener en cuenta (lo aprendido en la parte 1)

- **Cada juego importado deja 15 operaciones en la `outbox`,** una por campo: 5 000 juegos serían 75 000 operaciones y 375 peticiones de `sync`. Se decide en la parte 3, pero el formato de lo que trae `redeem` debería facilitar aplicar solo lo que cambia (p. ej., marcar Comprado = una operación).
- **En el WebKit de Playwright para Windows,** cada petición a IndexedDB tarda ≈15 ms: siembra los datos con `putEntries` (`e2e/storage.ts`), no importándolos.
- **Pruebas intermitentes ya conocidas:** `boot.spec.ts:273` (el CI de `main` del 17-11 falló por ella y pasó al repetir: `gh run rerun <id> --failed`) y `covers.spec.ts:123` en WebKit con carga (también en `main`).
- **El CI** solo corre en `main` y en las PR. En una rama se lanza a mano, y eso no despliega: `deploy-web` exige un `push` a `main` con el CI en verde.
- **Dos cuentas de Cloudflare:** `ga-web` y D1 van en una y el catálogo en otra. El secreto va en la de `ga-web`.
