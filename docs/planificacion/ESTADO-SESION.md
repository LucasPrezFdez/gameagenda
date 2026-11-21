# Estado del proyecto — punto de partida de la próxima sesión

**Actualizado:** 21-11-2026 (Mi lista en cuadrícula y la columna a todo el ancho, en la rama `cuadricula-mi-lista`, sin pasar a `main`; antes, ese mismo día, las llaves de acceso, en `main` y en producción; las construyó el 20-11-2026, en la rama `llaves-acceso`; antes, ese mismo día, la revisión responsive, de 320 a 3 840 px, en `main` y en producción; antes, ese mismo día, la Fase 2, parte 3 de la importación de Steam: los logros, el resumen, aplicar y el estado «Sin empezar», en `main`, en producción y encendida; antes, ese mismo día, la parte 2, probada a mano con Steam de verdad, en `main` y desplegada, apagada en producción). Antes, el 19-11-2026 (la parte 2, hecha en la rama `steam-parte-2`), el 17-11-2026 (Fase 2, parte 1: Mi lista con miles de juegos, en `main` y en producción), y el 16-11-2026 (la revisión completa y sus arreglos, en `main` y desplegados; y la sincronización de M4, en `main` y en producción). Antes, el 08-11-2026, en la sesión 12 (M4 parte 4: el buzón del Atajo de iOS, `resolve`, los textos legales y la estimación de CA4.6, en la rama `m4-sincronizacion`). Antes, el 07-11-2026, en la sesión 11 (M4 parte 3: el cliente de sincronización, Ajustes › Sincronización y los E2E de CA4.2 y CA4.3). Antes, el 06-11-2026, en la sesión 10 (M4 empezado en la rama `m4-sincronizacion`: la base de la micro-API y el ADR-011). Antes, en la sesión 9 (el cliente del núcleo de arranque, en `main` y desplegado: el núcleo de arranque, entero en producción). Antes, el 05-11-2026, en la sesión 8 (CA2.1 cumplido: M2 cerrado con `v0.2.0`; la parte del pipeline del núcleo de arranque, en `main`; y el rediseño visual «Tinta», en `main` y desplegado).
**Cómo retomar:** escribe *«Retoma GameAgenda desde docs/planificacion/ESTADO-SESION.md»*.

## 0. Lo primero en la próxima sesión

**Mi lista en cuadrícula y la columna a todo el ancho (21-11-2026), EN LA RAMA `cuadricula-mi-lista`, sin pasar a `main` ni desplegar.** El árbol principal está en esa rama.
- **Lo que pidió el usuario:** abrió la app de escritorio maximizada en su monitor de 2 560 × 1 440 y vio márgenes enormes. Pidió «que no quedaran esos márgenes gigantes» y «un modo grid en el apartado de Mi lista».
  - La app de escritorio aún iba con la versión anterior: una versión nueva solo entra tras un minuto con la ventana en la bandeja (§10.29).
  - Aun con la versión al día, la columna de 1 440 px dejaba 436 px vacíos a cada lado.
- **Lo hecho** (el detalle, en DECISIONES §10.53):
  - `--content-max` pasa a 2 560 px: las pantallas de listas llenan el ancho. Ajustes y los textos legales no cambian;
  - la cuadrícula del Catálogo pone más columnas (`lib/card-grid.ts`);
  - Mi lista tiene el conmutador Lista / Cuadrícula (`listLayout`), con tarjetas (`EntryCard.tsx`), la lista virtual por filas de tarjetas y las flechas en dos ejes (`grid-nav.ts`). Sin asa `::` ni gestos en la cuadrícula.
- **Comprobado:**
  - `check`: 1 525 pruebas, y el JS inicial pasa a 145,1 KB;
  - `e2e/list-grid.spec.ts` y las E2E relacionadas, en Chromium y en WebKit móvil;
  - capturas a 2 560, 1 920, 1 100, 390 y 320 px, en claro y en oscuro. Están en el *scratchpad* de la sesión (`capturas/`, con su *script* `fotos.mjs` y una copia del perfil de pruebas).
  - el CI de la rama (44901055905), en verde: comprobaciones, E2E de Chromium y rendimiento.
- **Queda:**
  1. que el usuario lo vea y dé el visto bueno para pasarlo a `main` y desplegar. La app de escritorio se pondrá al día sola tras un minuto en la bandeja;
  2. por decidir con él: si las filas de la lista, estiradas a 2 240 px, necesitan más columnas (las otras fechas, la nota), y si quiere el asa `::` en la cuadrícula.

**Llaves de acceso (20-11-2026), EN PRODUCCIÓN desde el 21-11-2026** (el usuario: «despliega»). `main` avanzó hasta la rama `llaves-acceso` (`9b979c1`), que se conserva; el árbol principal sigue en ella. `ci` 44838295229 (falló solo `boot.spec.ts:273`, la intermitente conocida, y pasó al repetir los trabajos fallidos) y `deploy-web` 44839354214 (migración `0004` aplicada; versión `031d300f`), en verde. En producción, la `Permissions-Policy` permite las llaves y `POST /api/v1/passkeys/challenge` da 201 con el `rpId` correcto. El usuario preguntó por crear una cuenta para guardar la información, porque le preocupa perder los datos. El asistente desaconsejó el email con contraseña y propuso llaves de acceso; el usuario dijo «prepara lo de las llaves de acceso» y, con la propuesta, «si». El detalle, en el ADR-013 (propuesta, con la sección «Construida») y en DECISIONES §10.52.
- **Qué hacen:** abren la agenda sincronizada en otro dispositivo, o tras perderlos todos, con la cara, la huella o el PIN y la llave del llavero de iCloud, Google o Windows, como el código de recuperación, que sigue valiendo. Se ofrecen al activar, tras el código; en Ajustes › Sincronización se ven, se crean y se quitan; y sin sincronizar sale «Entrar con una llave de acceso».
- **Hecho y en verde:**
  - seis rutas en `/api/v1/passkeys`, la verificación propia (`worker/webauthn.ts`) y la migración `0004`, con el interruptor `PASSKEYS_ENABLED`;
  - la `Permissions-Policy` arreglada: bloqueaba `publickey-credentials-get`;
  - los textos legales, versión 4;
  - `check`: 1 511 pruebas y JS inicial de 144,0 KB;
  - el CI de la rama (44830007457) y 54 E2E en Chromium y WebKit.
- **Queda, para el usuario:** probarlas en sus dispositivos, en https://ga-web.gameagenda.workers.dev: Face ID con iCloud en el iPhone, también en la app de la pantalla de inicio; Windows Hello en Edge y en la app de escritorio (se pone al día sola al abrirla); y del móvil al PC con el QR. Después, el ADR-013 pasa a «aceptada».
- **Ojo:**
  - el E2E va por `http://localhost:<puerto>`, no por `127.0.0.1`, y solo en Chromium (autenticador virtual de CDP);
  - para capturas, `vite preview --mode e2e` con la *cookie* `ga-e2e-api` (un mundo) y el autenticador virtual. El *script* está en el *scratchpad* de la sesión.

**Revisión responsive (20-11-2026), EN PRODUCCIÓN desde el 20-11-2026** (el usuario: «haz lo que queda pendiente y decide tú según sea lo mejor»). `main` avanzó hasta la rama `responsive` (`0c3fa7f`), que se conserva; el árbol principal sigue en ella. `ci` 44810799091 y `deploy-web` 44811564946, en verde; `smoke:web`: «Todo en orden» (justo después de desplegar, búsqueda a los 7,7 s y `full` a los 8,9 s; repetida, a los 1,0 y 2,4 s), y las 108 medidas de producción, iguales a las del *build* de la rama. El detalle, en DECISIONES §10.51 y en la §9.1 del plan.
- **Lo que pidió:** que la app se viera equilibrada de 320 a 3 840 px, en cinco fases (auditoría, base, maqueta y componentes, pulido y comprobación), sin tocar la lógica ni la identidad. Eligió tras la auditoría: la columna crece en pantallas anchas (`--content-max`, hasta 1 440 px) y las filas de Mi lista enseñan «Juego en» y una fecha; la cuadrícula del Catálogo (§10.45) entra con esto; en la tablet, la barra lateral empieza encogida y se recuerda aparte (`sidebarCollapsedNarrow`); el móvil en horizontal lleva la maqueta del móvil; y solo el `h1` es fluido.
- **Lo que decidió el asistente:** la cuadrícula del Catálogo no pasa de 1 440 px (el porqué, en §10.51); no hay escala de espaciados nueva (`--space-*`): cambiaría miles de líneas sin efecto visible.
- **Comprobado:** 18 tamaños × 6 pantallas con Chromium, sin desbordes, y lo mismo al píxel en Firefox 157; la ventana de la app de escritorio (1 100 × 760); el tema oscuro; `check` (1 479 pruebas, JS inicial de 143,3 KB) y el CI con `perf` (18 de 18). En local, la batería E2E: 262 en verde y 3 de tiempos de WebKit que pasan solas.
- **De paso:** el primer CI de `main` (44810227449) falló en una prueba de la sincronización que esta rama no toca, «con Web Locks, el borrado espera…» (`sync-client-lifecycle.test.ts`). Su espera `until` contaba 500 vueltas del bucle de eventos, que pasan en vacío mientras `crypto.subtle` trabaja en otro hilo; ahora espera hasta 5 s (`0c3fa7f`). En local, 8 de 8 seguidas y 6 de 6 a la vez.
- **Queda, para el usuario:** mirarlo en el iPhone (el fundido de las filas de chips, los márgenes del notch en horizontal y los campos a 16 px), con las demás pruebas del iPhone; y la app de escritorio, que se pone al día sola al abrirla.
- **Ojo:**
  - las animaciones del fundido (`animation-timeline: scroll()`) no acaban nunca: las pruebas que esperan a las animaciones filtran por `a.timeline === document.timeline`;
  - las condiciones de las *media queries* van escritas en cada sitio (CSS no admite variables en `@media`): la tabla está al principio de `tokens.css`, y las de JavaScript, en `lib/breakpoints.ts`;
  - a igual especificidad, una *container query* tiene que ir **después** de las reglas que cambia (Ajustes, `settings.css`).

**Fase 2, parte 3 de la importación de Steam: los logros, el resumen y aplicar (20-11-2026), EN PRODUCCIÓN Y ENCENDIDA desde el 20-11-2026 (con el visto bueno del usuario, «A main y encenderla»: `main` avanzó hasta `783fc54`; `ci` 44783034568 y `deploy-web` 44783715656 en verde, con `STEAM_ENABLED` a "1", `RL_STEAM_ACH` y el secreto `STEAM_WEB_API_KEY`, que puso el usuario).** La rama `steam-parte-3` se conserva; el árbol principal sigue en ella. El detalle, en el ADR-012 («Parte 3») y en DECISIONES §10.50.
- **Lo que decidió el usuario:** todos los juegos de la biblioteca entran como Comprado y, si tienen todos los logros, como Platinado (Completado, con el día del último logro); los nuevos, según lo jugado: sin jugar, **Sin empezar**, un estado nuevo (`not_started`) que pidió al probarlo, porque «la importación no puede saber qué juegos sí y qué juegos no» van a Quiero jugar (DECISIONES §10.50); jugados en los últimos 14 días, Jugando; los demás, En pausa. Lo que ya estaba solo gana las marcas. No contestó a dos preguntas, y se hizo lo prudente: la lista de deseados va como casilla del resumen, **desmarcada**, y nada se aplica hasta pulsar «Aplicar», con un solo «Deshacer». Cambiarlo es poco: díselo si quiere otra cosa.
- **Hecho y en verde:**
  - micro-API: el pase de la importación en `redeem` (`worker/steam-token.ts`: el SteamID64 cifrado con AES-GCM, clave de la de Steam por HKDF, 15 min) y `POST /api/v1/steam/achievements` (`worker/steam-achievements.ts`: `GetPlayerAchievements`, 40 juegos por petición, 8 a la vez, `RL_STEAM_ACH` 1106 y el tope diario);
  - core: `planSteamImport`, `applySteamImport` (`entries/steam-import.ts`) y el alta compacta `addImported` (5 a 9 operaciones en vez de 15), y `markImported`;
  - app: `steam/steam-apply.ts` (*chunk* aparte), los estados nuevos de `steam-flow.ts` (`checking`, `review`, `applying`, `applied`, `undone`), la pantalla y `agenda.applyBatch`/`undoer`;
  - legal: la política y el registro de actividades en su versión 3;
  - pruebas: 27 de la ruta de logros, 23 de core (con una de propiedades), 10 del flujo con una agenda de verdad y el E2E (9 en Chromium y WebKit, con axe). `check`, en verde: 1 467 pruebas y JS inicial de 141,5 KB.
- **La batería E2E entera, a medias en local:** se cortó a las 211 de 298 porque el equipo se quedaba sin memoria (Claude Code paró la ejecución y quedaron 37 procesos de WebKit sueltos, ya cerrados), sin fallos hasta ahí. **El CI de la rama, en verde** (44752908424: Biome, tsc, Vitest, *build*, tamaño, clave y E2E de Chromium). El primero (44751937362) falló en una prueba de la parte 2 con una espera fija de 5 ms (`steam-client.test.ts`, «al volver sola…»): en el *runner*, el canje automático seguía en vuelo. Ahora espera a las peticiones (`settle`), y pasa 20 de 20. **La batería de WebKit entera, en local (20-11-2026, con Brave cerrado y 4 *workers*):** 115 en verde, 33 omitidas y 1 en rojo, `boot.spec.ts:273`, la intermitente conocida (a veces no se ve `scan` entre `boot` y `full`): repetida 5 veces, 4 en verde. La parte 3 no toca la búsqueda ni el arranque.
- **Paso 0 (con la cuenta del usuario, sin escribir nada de ella):** con clave solo sirve `GetPlayerAchievements`, un juego por llamada; `GetAchievementsProgress` pide la sesión del usuario (401). Su cuenta: 105 juegos, 73 jugados con estadísticas y 1 platinado.
- **Queda, por orden:**
  1. ~~la prueba a mano con la cuenta del usuario~~: hecha el 20-11-2026, «vale todo ok» (en `wrangler dev` en `127.0.0.1:8787` con el catálogo publicado), con «Sin empezar»: «vale todo ok». La vuelta de Steam, 0,40 s; `redeem`, 0,53 s; y los logros de sus 73 juegos jugados con estadísticas, en dos lotes de 2,2 y 1,5 s);
  2. ~~el visto bueno para pasarla a `main`~~ y 3. ~~encenderla en producción~~: hecho el 20-11-2026 («A main y encenderla»). El usuario puso el secreto en su terminal (`npx wrangler secret put STEAM_WEB_API_KEY`, desde `apps/web`; con `-c apps/web/wrangler.json`, sin la «c», falla). En producción, `start` da 201 con el *realm* de `ga-web`, `achievements` rechaza un pase inventado, Ajustes › Datos enseña «Importar desde Steam», la barra lateral, «Sin empezar», y `smoke:web` da «Todo en orden» (`boot` a los 4,4 s y `full` a los 5,9 s, justo después de desplegar).
- **Para apagarla deprisa:** `STEAM_ENABLED` a `"0"` en `wrangler.jsonc` y desplegar (la app dice que no está disponible). Para quitarla del *build*, `VITE_STEAM_IMPORT=0`: ahora va dentro por defecto (JS inicial de 143,0 KB, en tres ficheros).
- **Siguiente, si el usuario quiere:** la parte 4 (repasar los logros más tarde sin volver a preguntar por todo, los conjuntos de logros), y lo de siempre: las pruebas en el iPhone y el p99 de CA4.6.
- **Ojo:**
  - la pantalla de Steam (`SteamImport.tsx`) no puede importar módulos del JS inicial (`i18n/es.ts`, `palette-model.ts`): Rolldown arma los *chunks* antes de quitarla, y el JS inicial de producción pasaba a seis ficheros y 145,7 KB. Sus textos van en `steam/texts.ts`;
  - `storedEntry` de los E2E da `null`, no `undefined`, si el juego no está;
  - en los E2E, `page.goto` recarga la página y el flujo de la importación (en memoria) se pierde: para ir y volver de Mi lista, el enlace y `page.goBack()`;
  - En pausa sale plegada en Mi lista: un juego de ahí no se ve sin desplegarla.

**Fase 2, parte 2 de la importación de Steam: iniciar sesión y traer la biblioteca (19 y 20-11-2026), EN `main` Y DESPLEGADA desde el 20-11-2026, APAGADA EN PRODUCCIÓN** (`STEAM_ENABLED` a `"0"` y `__STEAM_IMPORT__` apagada). Con el visto bueno del usuario («Cerrar la parte 2 primero»), `main` avanzó hasta la rama `steam-parte-2` (`682060a`); el árbol principal sigue en la rama, que se conserva. El detalle, en el ADR-012 (**aceptada**) y en DECISIONES §10.49; el encargo, en `docs/planificacion/prompts/importacion-steam-parte-2.md`.
- **Las cinco decisiones** (el usuario dijo «sigue» a las recomendaciones): `verifyLogin` de `steam-signin` portado a `fetch`; la biblioteca y los deseados en *streaming*, tal cual; `RL_STEAM` por IP y un tope diario de 50 000 llamadas en D1; sin exigir la sincronización; y `STEAM_ENABLED` con la constante de compilación `__STEAM_IMPORT__` en la app.
- **Lo que hay:** la micro-API (`start`, `callback` y `redeem`, migración `0003`, un Cron Trigger cada 5 min para los tickets caducados, `RL_STEAM` y el tope diario), «Importar desde Steam» en Ajustes › Datos (solo en el *build* con `__STEAM_IMPORT__`), el arreglo del Service Worker para las navegaciones a `/api/`, la política y el registro en su versión 2 y la clave buscada también en el *bundle* del Worker.
- **Prueba a mano con Steam de verdad (20-11-2026), con la cuenta del usuario:** el login y el canje, a la primera. La vuelta de Steam en 316 ms y `redeem` en 634 ms, con 105 juegos y 7 deseados que pasan los esquemas; la app dice «Hemos encontrado 105 juegos en tu biblioteca y 7 deseados». Las *fixtures* de la Web API, ajustadas (`has_leaderboards` en vez de `has_dlc` y el orden de `playtime_2weeks`). **Sin comprobar:** el perfil privado (el usuario no quiso cambiar su privacidad), la biblioteca y la lista de deseados vacías o privadas (no hay otra cuenta), y el juego compartido en familia y el privado.
- **Cómo repetir la prueba a mano** (lo que sirvió; el modo automático no deja al asistente abrir un túnel público, y no hace falta):
  1. `VITE_STEAM_IMPORT=1 npm run build` y `npx wrangler d1 migrations apply DB --local -c apps/web/wrangler.jsonc`;
  2. el catálogo publicado, copiado en `apps/web/dist/catalog-dev/` (`manifest.json`, los ficheros de `files` y los 1 024 *shards* de `details/`, ≈42 MB, de `ga-catalog`). Los de `pipeline/out` y `fixtures/catalog` van firmados con la clave de desarrollo, que el *build* de producción rechaza, y `ga-catalog` solo admite por CORS su origen: sin esto, la app no busca ni pone nombres. **Al terminar, borrar `dist/catalog-dev/`**, para que no acabe en un despliegue a mano;
  3. `npx wrangler dev -c apps/web/wrangler.jsonc --env-file <ruta ABSOLUTA de .env.local> --var STEAM_ENABLED:1 --ip 127.0.0.1 --port 8787`. Con una ruta relativa, `--env-file` no carga nada y no avisa (la micro-API responde `steam_disabled`);
  4. el usuario abre `http://127.0.0.1:8787/ajustes/datos` en su navegador. Steam acepta el *realm* con puerto. Para mirar lo que devuelve Steam sin escribir nada de la cuenta: `node .cache/steam-probe/steam-shape.ts` (toma la cuenta del cliente de Steam).
- **Verificación final:** `perf`, dos pasadas de la rama y una de `main`, con Discord y Brave abiertos: todo dentro de presupuesto salvo «tareas largas al teclear o apuntar», que también falla en `main` (2 y 2 en la rama frente a 3). El CI de la rama (44624179226) y el de `main` (44744007037), en verde.
- **Despliegue (20-11-2026):** `deploy-web` 44744546137 aplicó la migración `0003` en D1 y desplegó con los dos *cron* (`17 3 * * *` y `*/5 * * * *`). `POST /api/v1/steam/start` responde `steam_disabled`, el JS de producción no lleva nada de la importación y `smoke:web` da «Todo en orden» (`boot` a los 2,1 s y `full` a los 4,4 s, justo después de desplegar).
- **Parte 3 (revisar y aplicar), lo siguiente.** Lo que decidió el usuario el 20-11-2026: **todos los juegos de la biblioteca entran en la agenda como «Comprado» y, si tienen todos los logros, también como «Platinado». «Y ya, de momento.»** Eso adelanta a la parte 3 la comprobación de logros de la 4 y cambia la tabla de la §10.1 del plan (DECISIONES §10.49). Queda por decidir o resolver, al empezar:
  - con qué estado entran los juegos nuevos (cada entrada lleva uno: Quiero jugar, Jugando, En pausa, Completado o Abandonado) y qué pasa con los deseados (el plan: «Quiero jugar», al final);
  - los logros: `GetPlayerAchievements` con clave o `GetUserAchievements` sin ella (§10.1), ≈1 llamada por juego con logros, en lotes de ≤20 por las 50 subpeticiones del plan gratuito, y los *Achievement Sets* (los DLC en conjuntos aparte y los logros archivados);
  - dónde se guarda lo traído (`meta` con caducidad o solo en memoria) y cómo aplicar sin 15 operaciones por juego en la `outbox` (§10.48);
  - el texto «No guardamos nada de tu cuenta de Steam» de Ajustes › Privacidad, si se guarda algo;
  - encenderla en producción: `STEAM_ENABLED`, `__STEAM_IMPORT__` y la clave como secreto del Worker, que pone el usuario (`! npx wrangler secret put STEAM_WEB_API_KEY -c apps/web/wrangler.jsonc`).
- **Ojo:**
  - `wrangler deploy --dry-run --outdir` necesita una ruta absoluta (con una relativa reparte los ficheros en dos carpetas), y `wrangler check startup` necesita `--worker` con el *bundle* de `deploy --dry-run --outfile`;
  - si una prueba de Vitest con `rejects` falla con una respuesta de muchos MiB, Vitest se cuelga intentando pintarla: se compara un valor pequeño;
  - en la vista previa de los E2E, lo de Steam va a los mundos `steam-http` (Chromium) y `steam-https` (WebKit), no al de la prueba (`e2e-api-server.ts`);
  - el WebKit de Playwright no deja responder una ruta con un 302: la página falsa de Steam redirige con `<meta http-equiv="refresh">`;
  - los *heredocs* largos de Bash se rompen en este entorno: los *scripts* de edición van en ficheros `.mjs` (con la herramienta de escribir ficheros).

**Fase 2, parte 1: Mi lista con miles de juegos (16 y 17-11-2026), EN PRODUCCIÓN desde el 17-11-2026** (con el visto bueno del usuario, `main` avanzó hasta la rama `lista-grande`, en `d50a941`; el árbol principal sigue en la rama). Es lo previo a importar la biblioteca de Steam, que pidió el usuario («empieza por la parte 1»). El detalle, en DECISIONES §10.48 y en `docs/medidas/lista-grande-20261117.md`.
- **Mi lista virtual** (`2a409af`): desde 300 filas a la vista (`VIRTUAL_FROM`), cada sección pinta solo las cercanas a la pantalla, entre huecos `li.entry-list__gap` con el alto de las demás (`SectionRows.tsx`, sin librería). La fila del foco no se desmonta; ↑/↓, Inicio, Fin, J y K van por `id`; el asa `::` congela las filas al arrastrar; y Mi lista publica su orden para J y K en la ficha (`publishListOrder`). Con 5 000 juegos y CPU ×4: abrir Mi lista, de 8,0 s a 0,48 s; «Empezar», de 2,4 s a 0,13 s; filtrar, de 3,1 s a 0,43 s.
- **Pruebas** (`8beb84a`): la unitaria de `visibleRange` (con una propiedad de fast-check) y `e2e/list-large.spec.ts`, con 600 juegos en Chromium y WebKit, también el alto de la fila en el móvil con «Estado debajo». Pasa 6 de 6, y con J y K rotos a propósito falla donde debe. Guarda los juegos directamente en IndexedDB (`putEntries`, en `e2e/storage.ts`).
- **Importar por lotes** (`21558f0`): la copia JSON, en lotes de 250 (`IMPORT_BATCH`, `importBatches` en `data-actions.ts`), cediendo el turno entre uno y otro (`yieldToMain`, que pasa a `lib/yield.ts`). Cada lote se fusiona y se aplica seguido, así que lo que se apunte entretanto no se pisa (con su prueba). Con 5 000 juegos, la tarea más larga pasa de 1 192 a ≈80 ms (×1) y de 5 112 a ≈400 ms (×4); el total, de 4,2 a 5,0 s (×1). El CSV sigue de una vez.
- **Comprobado:**
  - `check` en verde: 1 291 pruebas y JS inicial de 141,3 KB;
  - la batería E2E entera (antes de los lotes): 239 en verde, 37 omitidas y 2 en rojo, las dos de portadas del Catálogo. `covers.spec.ts:123` falla en WebKit con carga **también con el código de `main`** (3 de 4 en los dos casos), y `covers.spec.ts:104` (Chromium) pasó al repetirla. Tras los lotes, los E2E de datos, sincronización y la lista grande, 50 en verde;
  - `npm run perf`, dos pasadas de la rama y dos de `main`: todo dentro de presupuesto salvo «tareas largas al teclear o apuntar», que también falla en `main` (1 y 2 tareas, frente a 3 y 3; ver §10.48 y la medida). Mi lista visible tras reiniciar, de 640–701 a 258–297 ms.
- **Hallazgos:**
  - en el WebKit de Playwright para Windows, cada petición a IndexedDB tarda ≈15 ms: importar 600 juegos lleva 155 s (también en `main`). No afecta al iPhone ni a la app de escritorio;
  - cada juego importado deja **15 operaciones en la `outbox`**, una por campo: 5 000 juegos serían 75 000 operaciones y 375 peticiones de `sync`. **Hay que decidirlo en la parte 3** de la importación de Steam;
  - las tareas largas de la paleta (borrar las opciones anteriores con cada tecla y maquetar sus textos) son la causa de casi todas las de `perf`. Abaratarlas es una mejora aparte.
- **Ojo al medir con Playwright y miles de filas:** `getByRole` recorre todo el árbol de accesibilidad (selectores CSS); la traza (`retain-on-failure`) fotografía el DOM en cada acción (`--trace off`); y entregar un fichero de 5 MB con `setInputFiles` deja un fotograma de ≈400 ms sin *scripts* que no es de la app. Las pruebas temporales están en `.cache/lista-grande/` (se copian a `apps/web/e2e/`).
- **Ojo (React):** la *ref* de un elemento del padre se asigna después de los efectos de los hijos. Por eso el `<ol>` va dentro de `WindowRows`.
- **Queda:**
  1. ~~pasarla a `main` y desplegar~~: hecho el 17-11-2026. `ci` 44114760794 (falló solo `boot.spec.ts:273`, la intermitente conocida, y pasó al repetir), `deploy-web` 44116619894 y `smoke:web`, en verde;
  2. opcional: lo que aún recorre toda la agenda en cada cambio (`SidebarLibrary`, ≈6 ms con 5 000 sin minificar, y las uniones de `appid` en `useReleases`), y el CSV por lotes;
  3. ~~la parte 2 de la importación de Steam~~: hecha en la rama `steam-parte-2` el 19-11-2026 (arriba). Era: iniciar sesión con Steam y traer la biblioteca. El encargo está escrito en `docs/planificacion/prompts/importacion-steam-parte-2.md`: se empieza con *«Lee docs/planificacion/prompts/importacion-steam-parte-2.md y empieza por el paso 0»*. Después vienen la 3 (revisar y aplicar) y la 4 (logros). El usuario tiene que poner la clave como secreto del Worker. **Se llama `STEAM_WEB_API_KEY`**, como en el *pipeline* y en `scan-secrets.ts`, no `STEAM_API_KEY` como decía antes este punto: `! npx wrangler secret put STEAM_WEB_API_KEY -c apps/web/wrangler.jsonc`.

**M4 · Sincronización, en producción desde el 16-11-2026** (parte 5, con el visto bueno del usuario; DECISIONES §10.47 y ADR-011, «Despliegue»). `main` avanzó hasta la rama `m4-sincronizacion` (`426d0fa`), y las dos apuntan al mismo *commit*.
- **Despliegue:** el primer `deploy-web` (43964492038) aplicó las migraciones 0001 y 0002 en D1 y desplegó, y el plan gratuito admite `ratelimits`. Salió en rojo solo por la comprobación del 404 de `/assets/` (abajo), que ya no se hace. El segundo (43965893460), en verde.
- **Comprobado en producción:** una prueba contra la micro-API pasó tres veces en verde (activar, apuntar, emparejar otro dispositivo, bajar lo apuntado, lista de dispositivos, borrarlo todo y el 401) y dejó D1 vacía. `smoke:web`, en verde, con la búsqueda a los 0,7 s (justo después de desplegar dio 5–7 s una vez, como otras veces).
- **CA4.6, primera muestra** (`docs/medidas/ca4.6-20261116-produccion.md`): en caliente, de 1 a 4 ms; la primera petición de cada ruta en un *isolate*, de 9 a 14 ms; ninguna cortada. **Pendiente:** el p99 de «CPU time» en el panel de Workers tras una semana de uso real. Si pasa de 10 ms o salen errores `exceededCpu`, habría que abaratar el arranque de `sync` y de activar.
- **D1:** `ga-agenda`, en la jurisdicción UE (región EEUR), en la cuenta de `ga-web`. `CLOUDFLARE_API_TOKEN` lleva «D1: Edit». **Ojo:** hay dos cuentas de Cloudflare; el *token* del catálogo (`github-ga-catalog`) es de la otra y no lo necesita.
- **El responsable de los textos legales** (`ab3de52`): el nombre del README y el correo que dio el usuario.
- **El 404 de `/assets/` no actúa en producción:** con `run_worker_first` en forma de lista, lo que no está en ella no pasa por el Worker. Arreglarlo (`/assets/*` en la lista) es una mejora aparte, por probar antes: cuenta peticiones del plan gratuito, y no se sabe si `_headers` vale para `ASSETS.fetch()` (DECISIONES §10.47).
- **Si algo falla:** `SYNC_ENABLED` a `"0"` y desplegar apaga la micro-API; `wrangler rollback` devuelve el código, pero no D1.
- **Le toca al usuario:** probar en el iPhone el Atajo, el QR y la recuperación (CA4.3 y CA4.5), y usar la sincronización entre sus dispositivos.
- **Ojo al parar `wrangler tail`:** buscar los procesos con `wrangler.*tail` en la línea de órdenes también encuentra el propio *shell* que lanza la orden, y lo cierra. Hay que filtrar por `node.exe`.

**Revisión completa y arreglos rápidos (16-11-2026).** El usuario pidió una revisión «como experto programador, diseñador, tester y experto en aplicaciones». Veredicto: lista para su uso diario; para unos amigos faltan el dominio definitivo (los datos van atados al origen), el responsable de los textos legales y desplegar M4; para un lanzamiento público, además, importar la biblioteca de Steam, el inglés y una página de presentación. Capturas e informes, en `.cache/revision-20261116/` del árbol principal.
- Los arreglos rápidos se hicieron en la rama `arreglos-revision` (*worktree* `.claude/worktrees/arreglos-revision`, que se conserva) y entraron en `main` con avance rápido el 16-11-2026, en `389149b`, con el visto bueno del usuario: DECISIONES §10.46. Desplegados: `ci` 43940043402, `deploy-web` 43940645399 y `smoke:web` en verde (en la segunda pasada, `boot` a los 1,2 s y `full` a los 2,6 s). La licencia la decidió el usuario: todos los derechos reservados (`LICENSE`).
- **Dominio:** el usuario solo cambiaría si fuera gratis, y no lo es (unos 10–15 € al año). Se queda `workers.dev` por ahora; con M4 desplegado, cambiar de dirección solo pide el código de recuperación en la nueva (y tocar el `Origin` de la micro-API, las etiquetas Open Graph y el instalador de escritorio).
- En la rama de M4, el 404 de `/assets/*` que no existe y hono 4.13.18 (arreglos de seguridad de `hono/cookie` y del validador).
- **La racha del catálogo ya está cumplida:** 14 ejecuciones programadas seguidas en verde, del 03-11 al 16-11 (M3 pedía 7).
- **El *cron* del catálogo se apaga a los 60 días sin *commits* en el repositorio:** con el último de `main` del 10-11, hacia el 09-01-2027.

**Pulido visual y animaciones (10-11-2026): en `main` y desplegado.** Elegido por el usuario entre varias opciones (página en `docs/diseno/pulido/`, que se monta en `.cache/pulido/index.html`); el detalle, en DECISIONES §10.44 (los números 34 a 43 son de M4, en su rama).
- Se hizo en la rama `pulido-visual` (*worktree* `.claude/worktrees/pulido-visual`, que se conserva) y entró en `main` con avance rápido, en `6bb3345`.
- `check` (972 pruebas, JS inicial de 133,1 KB), E2E de Chromium y WebKit en verde salvo los dos intermitentes ya conocidos (`boot.spec.ts:273` y `data.spec.ts:50` en WebKit), `ci` 42851918207, `deploy-web` 42852474560 y `smoke:web`, en verde.
- `perf`: no pasa «tareas largas al teclear o apuntar», igual que `main` medido a continuación (4 de 51–55 ms frente a 2 de 50–53 ms, con la CPU al 16 %). Lo demás, dentro de presupuesto.
- La app de escritorio, abierta oculta, se puso al día sola en 123 s (`index-Vw-YmuG2.js`) y se ha dejado abierta. No hizo falta instalador: la parte nativa no cambia.
- **Al juntar M4 con `main`:** las dos ramas tocan `shell.css`, `settings.css` y DECISIONES; se conservan las dos partes.

**M4 · Sincronización: empezado el 06-11-2026 (sesión 10), en la rama `m4-sincronizacion`** (subida; el árbol de trabajo está en ella). No iba a `main` sin la base de D1 en Cloudflare y el permiso de D1 en el *token* de `deploy-web`, porque con el *binding* en `wrangler.jsonc` cada despliegue habría fallado. Las dos cosas están desde el 16-11-2026 (parte 5, arriba).

- **Parte 1, hecha** (`07720f7` y `29d0d39`): la base de la micro-API. ADR-011 («propuesta») y DECISIONES §10.34.
  - `apps/web/worker/`: Hono solo en `/api/*`, con el interruptor `SYNC_ENABLED` apagado; reglas de la §11.4; crear agenda con la edad y el código de recuperación; dispositivos; emparejar; recuperar; borrar en cascada. Esquema en `worker/migrations/0001_inicial.sql`. Contrato en `@gameagenda/core/api`.
  - Pruebas con `app.request()` y D1 sobre `node:sqlite`: `check` da 1 008. Comprobado también con `wrangler dev` (`workerd` y D1 locales).
  - **Ojo:** parar `wrangler dev` con TaskStop deja vivos sus procesos de Node y `workerd` en Windows. Se buscan con `Get-CimInstance Win32_Process` (línea de órdenes con `wrangler`) y se paran, y después los `workerd` de `node_modules`.
- **Parte 2, hecha** (06-11-2026): `POST /api/v1/sync` y el mantenimiento diario de D1. ADR-011 y DECISIONES §10.35.
  - El LWW lo decide la `applyOps()` de `core` en el servidor (`worker/sync-plan.ts`), con concurrencia optimista (`write_id`). Rechazos por acción, `purgedSeq` en la petición para el `reset`, renovación diaria de la cookie y lotes de 200 (`SYNC_BATCH_SIZE`; con 500, 8,5 ms de CPU en frío).
  - Cron Trigger `17 3 * * *`: *tokens* caducados y agendas de más de 13 meses; los lunes, la purga de lápidas y esqueletos de 90 días.
  - CA4.1: 3 propiedades con 1 000 casos cada una, por la micro-API (`sync.properties.test.ts`). `check` da 1 031 pruebas. Comprobado en `workerd` local, también la purga (API local: `POST /cdn-cgi/local/explorer/api/local/scheduled?worker=ga-web` con `cron` y `scheduled_time`).
- **Parte 3, hecha** (07-11-2026, sesión 11; `0d8b9ba` y el commit siguiente): el cliente. ADR-011 («Cliente», «Ajustes › Sincronización» y «Pruebas») y DECISIONES §10.36–§10.38.
  - Motor en `apps/web/src/sync/`: fachada en el *chunk* inicial y motor diferido (quien no sincroniza no pide nada a `/api`). Ajustes › Sincronización con QR (`uqr` 0.1.3) y `/emparejar#código`. «Borrar todos mis datos» borra también D1.
  - Una revisión independiente, con 6 lentes y verificación adversarial (y una prueba real en `workerd`), encontró unos 30 fallos, todos arreglados con su prueba de regresión. Los más serios:
    - *reset* a medias;
    - la purga local, quitada: ahora la purga de D1 fuerza un *reset*;
    - D1 vuelto atrás con operaciones en la petición, con época nueva (migración `0002_epoca.sql`);
    - carreras al borrar o desemparejar con una ronda en vuelo;
    - el 401 tomado por «agenda borrada».
  - `check` en verde: 1 221 pruebas; JS inicial de 136,9 KB y chunk del motor de 5,7 KB. E2E en verde: Chromium 130 y WebKit 101; los de sincronización, también con `--repeat-each=3`. CA4.2 y CA4.3 comprobados en E2E con dos contextos.
  - **Lo que quedaba, cerrado el 08-11-2026 (sesión 12):**
    - la segunda revisión de los arreglos, repetida con la de la parte 4 (DECISIONES §10.43, abajo);
    - las secciones del plan, al día con las §10.36–§10.43 y `prototipe.md` montado otra vez;
    - `boot.spec.ts:273` no se reproduce en 40 ejecuciones, ni con 8 *workers*: se deja como está.
- **Parte 4, hecha** (08-11-2026, sesión 12): el buzón, `resolve`, los textos legales y CA4.6 en local. ADR-011 (cuatro secciones nuevas) y DECISIONES §10.39–§10.43.
  - **Buzón del Atajo de iOS** (§10.39): `POST /api/v1/inbox/token` (con la cookie: un `device` `inbox`, se ve una vez) y `POST /api/v1/inbox` (`Authorization: Bearer`, sin `Origin` ni cookie, solo enlaces de Steam, `RL_INBOX` y tope de 200). `sync` lo entrega en la última página (`inbox`) y la petición siguiente lo confirma (`inboxAck`). La app lo apunta como un enlace pegado (`links/inbox-capture.ts`) y solo confirma lo guardado. Ajustes › Sincronización tiene la sección «Atajo de iOS», con la dirección, el encabezado y los 7 pasos.
  - **`resolve`** (§10.40): `GET /api/v1/resolve/<appid>` con `GetItems` sin clave, caché en D1 y `RL_RESOLVE`. Si Steam no lo conoce, 200 con `name: null`, porque un 404 dejaría un error en la consola. La app (`agenda/resolve-client.ts`, desde `catalog-refresh.ts`) lo pide sin cookies, solo para lo que no está en el catálogo entero y **solo si este dispositivo sincroniza** (decisión del usuario, 08-11-2026).
  - **Textos legales** (§10.41): `/privacidad` y `/aviso-legal` (datos en `apps/web/src/legal/`, pantalla en el *chunk* de Ajustes) y la primera capa en `[data-sync-legal]`. El registro de actividades está en `docs/legal/registro-actividades.md`. **El responsable está sin rellenar** (`legal/controller.ts`): los textos dicen «pendiente», y `scripts/legal-guard.test.ts` no deja `SYNC_ENABLED` a `"1"` sin él.
  - **CA4.6 en local** (§10.42): `node scripts/api-cpu.ts` da un peor p99 de 2,38 ms, de 5 (`docs/medidas/ca4.6-20261108.md`). La primera petición de un *isolate* nuevo, ≈6 ms. Lo que cierra CA4.6 es el panel de Workers.
  - `check`: 1 264 pruebas, y el JS inicial en un solo fichero de 138,9 KB brotli (+2,0). Con la pantalla legal en un *chunk* propio, Rolldown partía el inicial en tres (140,7 KB).
  - E2E: `inbox.spec.ts` (6), con `--repeat-each=3`; la batería entera, 234 en verde y 37 omitidas, con dos fallos ya arreglados (una prueba de Ajustes que encontraba dos textos con «Cloudflare en la Unión Europea»).
  - **Ojo:** `data.spec.ts:50` falla en WebKit en local unas 4 de cada 12 veces, también en `HEAD` sin la parte 4 (comprobado con un *stash*). Una navegación corta la descarga de `recent.tsv` del Worker de búsqueda y WebKit lo anota como error («access control checks»). El CI solo corre Chromium. Se arreglaría esperando al catálogo antes de navegar (`catalogSettled`, como en `sync.spec.ts`).
  - `wrangler dev` (`workerd` y D1 locales): el buzón y `resolve` con Steam de verdad, en verde (ADR-011, «Confirmación»).
  - **Revisión del 08-11-2026** (`code-review` de nivel alto sobre `4b46155^..HEAD`, DECISIONES §10.43): 10 hallazgos, verificados uno a uno.
    - Se arreglan 9, cada uno con su prueba (`460f361`): el enlace del buzón con tope; lo que llega vivo en la misma página se confirma sin volver a apuntarlo; `message` en todos los errores del buzón; la respuesta de Steam leída con tope; y `resolve` en la app (un juego que falla no para a los demás, lo que llega mientras tanto, 7 días de memoria en `meta.resolveAsked` y la agenda solo se recorre al crecer).
    - Se descarta acotar el `receive()` de la agenda: `core` rechazaría las acciones.
  - **`resolve`, solo con la sincronización activada** (decisión del usuario, 08-11-2026): quien no sincroniza no hace ninguna petición a `/api`, y lo comprueba `sync.spec.ts` con un juego provisional.
  - **`data.spec.ts:50`, arreglada:** espera al catálogo antes de navegar, y pasa 12 de 12 en WebKit.
  - **Tras los arreglos:** `check` con 1 275 pruebas y el JS inicial en 139,2 KB brotli; la batería E2E entera, 237 en verde y 37 omitidas, ninguna en rojo; y `wrangler dev`, en verde, también con el enlace enorme y los mensajes del Atajo.
  - **Pendiente de esta parte (lo hace el usuario):** los pasos del Atajo, en un iPhone de verdad. El responsable de los textos lo dio el 16-11-2026.
- **Parte 5, preparada el 16-11-2026** (arriba, al principio de esta sección): queda pasarla a `main` con el visto bueno del usuario, medir CA4.6 en el panel de Workers y las pruebas en el iPhone.
- **Le tocará al usuario:** probar en el iPhone (CA4.3, CA4.5 con el Atajo de verdad y el QR).

Lo de M3 está en `main` y subido, con el CI y el despliegue en verde. Por orden:

0. **Rediseño visual «Tinta» (05-11-2026, sesión 8): en `main` y desplegado.** Se hizo en la rama `rediseno-visual` (*worktree* `.claude/worktrees/rediseno-visual`, que se conserva) y entró en `main` sin *merge*, en `51b5563`.
   - Encargo: `docs/planificacion/prompts/rediseno-visual.md`. Auditoría, opciones, elecciones del usuario y medidas: `docs/diseno/rediseno-visual/propuesta.md`. El porqué, en DECISIONES §10.31; los tokens, en la §9.8.
   - Lo que eligió el usuario:
     - la dirección B, «Tinta»: monocroma, con el acento en tinta;
     - los iconos de estado macizos de Phosphor (MIT), con el trofeo de Platinado propio, en platino, y la chincheta de Próximo roja;
     - el logo «Grafito»;
     - el estado de la fila como «Punto».
   - Medido con la CPU al 10 %: `check` (945 pruebas), E2E en Chromium y WebKit (177) y `perf` entero, todo en verde. JS inicial de 131,1 KB.
   - Herramientas:
     - `scripts/rediseno-capturas.ts`: capturas de `ga-web` real, con `--css` para inyectar hojas y `--dist` para servir el *build* de la rama bajo el origen de producción;
     - `scripts/generar-iconos.ts`: todos los iconos a partir de `public/icons/icon.svg` e `icons/icon-sangre.svg`;
     - `scripts/rediseno-contraste.ts` y `scripts/rediseno-iconos.ts`.
   - **Después, en la misma sesión (06-11-2026), por decisión del usuario:**
     - `Ctrl+Mayús+Espacio` solo pone la app de escritorio delante (§10.32);
     - el estado de la fila, como «Punto»;
     - la navegación nueva (§10.33). En el PC, una barra lateral de altura completa que se encoge a un riel de 64 px (`sidebarCollapsed`), con las vistas de Mi lista y su contador, «Jugando ahora» y «A continuación» con portadas, y un pie (`SidebarLibrary`, solo a ≥768 px). En el móvil, una cápsula flotante con el buscador redondo aparte. Se hizo en la rama `rediseno-navegacion`, en el mismo *worktree*, y entró en `main` sin *merge* en `f85c4ee`.
     - Los E2E que pulsaban las pestañas de vista usan `viewControl`, porque en el PC no se ven con la barra desplegada.
     - **Despliegue de la navegación:** `ci` 42140175663 se canceló en el E2E de Chromium por lentitud del *runner* y pasó al repetirlo. Después, `deploy-web` 42141698774 (29 s) y `smoke:web`, en verde. La app de escritorio, reiniciada oculta, se puso al día sola en 120 s (`index-E_oPSGxS.js`) y quedó en la bandeja.
     - **Ojo con el CI:** esta noche el *runner* de GitHub fue lento. Dos veces un trabajo agotó su tiempo y canceló la ejecución, y entonces `deploy-web` se salta. `gh run rerun <id> --failed` lo arregla, y el asistente sí puede lanzarlo.
   - ~~**Al pasar el cliente del núcleo de arranque (`m3-arranque`) a `main`:**~~ **Hecho el 06-11-2026** (sesión 9; ver el punto 3). Solo chocaron `docs/adr/README.md` y DECISIONES. El aviso y el estado `boot` de la paleta usan clases que ya existían (`.notice`, `.palette__notice`), así que «Tinta» ya los estiliza. El pie de la barra lateral dice «Cargando el catálogo…» en `boot`.
   - **Despliegue:** `ci` 42125904771 en verde (3 min 21 s), `deploy-web` 42126367721 (41 s) y `smoke:web` en verde.
   - **App de escritorio, reinstalada en la noche del 05 al 06-11-2026** a petición del usuario, con el instalador nuevo (icono Grafito, comprobado en el `.exe`):
     - antes, copia de sus datos en el *scratchpad* de la sesión (`copia-escritorio-20261105`, con IndexedDB entera). Después, desinstalación silenciosa de la anterior (`uninstall.exe /S`, que conserva `%LOCALAPPDATA%\dev.workers.gameagenda`) e instalación con `/S`;
     - «Iniciar con Windows» no estaba activado;
     - abierta oculta con `--autostart`, se puso al día sola a los 120 s, del bundle `index-D8AJgvtc.js` al `index-D8Qw9-uI.js` y del rosa a la tinta, con la agenda igual. Se miró por CDP en crudo, con `.cache/cdp-escritorio.mjs`. Ha quedado abierta en la bandeja, sin puerto de depuración.

1. **Mirar las ejecuciones programadas del catálogo:** del 03-11 al 05-11 a las 04:17 UTC (05:17 en Madrid); GitHub las arranca hasta 8 h tarde. Con `gh run list --workflow catalog.yml --limit 5`, o en la web de Actions.
   - **CA2.1 cumplido (05-11-2026): 3 de 3.** Las del 03-11 (41631319596), el 04-11 (41826370273) y el 05-11 (42025966457), en verde en 12 min 30 s, 12 min 31 s y 12 min 55 s. Versiones `20261103.1` (198 213 juegos, 462 recientes), `20261104.1` (198 490, 766 recientes) y `20261105.1` (198 684, 986 recientes), con todas las puertas. GitHub las arrancó hacia las 12:00 UTC. Los recientes crecen cada día hasta llenar la ventana de 14 días. **Antes de cerrar M3 tienen que ser 7 seguidas** (§15.5): la racha va por 6 el 08-11-2026, con las del 06-11 (42214891787, en verde en 12 min 22 s: versión `20261106.1`, con 198 951 juegos, 1 282 recientes y el primer núcleo de arranque), el 07-11 (42366441977, 12 min 18 s) y el 08-11 (42474950856, 12 min 42 s). Si la del 09-11 sale en verde, se cumple.
   - **La del 02-11 (41444097606): en rojo**, aunque publicó bien `20261102.1`. Justo después de desplegar, la prueba de humo vio 4 de ≈1 030 ficheros en 404; unos minutos después estaban todos. No se guardó el estado del día ni se avisó a healthchecks.io, y se abrió el *issue* #2. El usuario decidió arreglarlo aunque sea el pipeline: `catalog-smoke.ts` reintenta los 404 hasta 90 s. **CA2.1 vuelve a empezar:** hacen falta las del 03-11, el 04-11 y el 05-11.
   - **La del 01-11 (41301033690): en verde** en 12 min 10 s. Versión `20261101.1`: 197 874 juegos (+0,044 %), 3 563 alias y 93 recientes, los primeros. Todas las puertas en verde, también las de variación, y conserva la versión `20261031.1`.
   - **GitHub la arrancó a las 11:15 UTC, no a las 04:17:** casi 7 h tarde, algo normal en los *cron* de Actions con carga. El *check* de healthchecks.io (1 día + 12 h) lo aguanta. Las del 02-11 y el 03-11 pueden llegar igual de tarde.
   - Si alguna falla, se abre el *issue* `catalogo`; se sigue el *runbook* del ADR-007.
   - Relanzar el flujo a mano lo tiene que hacer el usuario: el modo automático no deja al asistente.
2. ~~**Medir CA2.4 en producción**~~ **Hecho el 02-11-2026:** `docs/medidas/ca2.4-20261102.md`. Un cliente con `20261031.1` baja 34,5 KB en 4 ficheros, sin núcleo y sin tareas largas.
   - `smoke-web.ts` ha cambiado: con un perfil al que le toca comprobar, espera a la comprobación y a la versión nueva, y aplica la puerta de CA2.4. La versión anterior solo esperaba 1,5 s y dio un fallo falso.
   - `.cache/smoke-web` quedó gastado en ese fallo. El perfil sembrado el 31-10, sin usar, está en `.cache/smoke-web-20261031`. Se mide siempre sobre una copia en una ruta corta, porque en Windows una ruta larga da `net::ERR_FAILED`.
   - **Pendiente:** desde la publicación `20261108.1`, una copia de ese perfil prueba la otra rama de la regla de los 7 días, en la que sí baja el núcleo.

   Sin `--profile`, `smoke:web` es la prueba de humo de cada despliegue: primera visita (el 31-10, en `full` en 1,9 s con 3 017 KB), segunda visita sin pedir el *manifest*, y sin red.
3. ~~**Cerrar M2**~~ **Hecho el 05-11-2026** (sesión 8): la tabla de CA del CHANGELOG al día, la cabecera `## [0.2.0] · M2 Catálogo vivo · 05-11-2026`, ADR-007 y ADR-008 en «aceptada» (también en `docs/adr/README.md`) y la etiqueta anotada `v0.2.0`, subida. CA2.5 (el *dead-man switch* con el cron parado) y CA2.6 (la agenda de 300 juegos reales) quedan en «Pendiente» del CHANGELOG.

   Ya se puede tocar el pipeline: núcleo de arranque, abaratar `applyRecent` y ADR-009. Cada cambio sale en la siguiente ejecución programada, que usa `main`.
   - ~~**Abaratar `applyRecent`**~~ **Hecho el 06-11-2026** (sesión 9; ADR-005, «Recientes»). La puerta del pipeline también lo usa, así que sale en la ejecución programada del 07-11.
     - Copia las columnas del núcleo en bloques (`set` y `slice` más `concat`) y coloca después las sustituciones y los nombres en español, con una tabla abierta de `appid`.
     - Da lo mismo que antes: las mismas firmas en tres casos con el núcleo congelado, y una prueba de propiedad nueva (2 000 casos) contra la regla aplicada fila a fila, que también pasa con la versión anterior y caza una mutación.
     - Medido en frío, que es como cuenta (una llamada por arranque): ≈21 → ≈10 ms sin estrangular. Escribir la consulta a la tabla dentro del bucle no ganaba nada; lo que ganó fue copiar los nombres con operaciones nativas.
     - En Chromium con CPU ×4, «recientes» del desglose pasa de 116–152 a 55–57 ms. En el mismo rato, con la CPU al 18–29 %, `scan` dio 1 930–2 033 ms con la nueva y 2 016–2 149 ms con la anterior: el resto del desglose («claves, exactos y pajar», ≈1 450 ms) es lo que sube con la carga.
     - El Worker pasa de 38,7 a 39,0 KB de 40. `check`: 972 pruebas.
   - **El núcleo de arranque está hecho en la rama `m3-arranque`** (04-11-2026, subida a GitHub; `main` no lo lleva). Son los 20 000 juegos más populares, en `boot.<hash>.tsv` (773 KB, 269 KB en brotli 11). En la primera visita se puede buscar en ellos mientras llega el núcleo. Con CPU ×4, el estado `boot` llega en 613–759 ms (RNF-05: ≤1 500 ms), y la app, en `search:ready` a los 841–859 ms. `check`, los E2E de Chromium y WebKit y `size` (Worker en 38,7 KB) pasan.
   - ~~**Falta:** la revisión con verificación, el ADR-009 y la documentación.~~ **Hecho el 05-11-2026** en la rama:
     - ADR-009 («propuesta») y DECISIONES §10.30, con las secciones 4.6, 7.6, 8.8, 9.2, 9.6 y 12.4 al día (`e8ff675`);
     - la revisión dio 10 hallazgos; verificados uno a uno, se arreglan 3 (`ff15aae`): las sugerencias del nivel 4 al salir de `boot` y el reintento de la carga en `boot`. Los demás, con su motivo, en la §10.30;
     - `check` (905 pruebas, Worker en 38,7 KB) y los E2E de `boot.spec` y `search.spec`, en verde.
   - **Orden para pasarlo a `main`:**
     1. ~~Tras cerrar M2, `main` avanza hasta el último *commit* del pipeline (`e78eea2`).~~ **Hecho el 05-11-2026** con el *merge* `947efd4`. Antes de subirlo, `check` (879 pruebas) y los E2E de Chromium y WebKit (177), en verde. El cliente en producción ya admite `files.boot` como opcional y no lo lee.
     2. ~~Una ejecución programada publica el boot.~~ **Hecho el 06-11-2026:** la del 06-11 (42214891787, con `catalog-smoke` en verde) publicó `20261106.1` con `files.boot` y `counts.boot` = 20 000 (`boot.4a415a34ad39b7cc.tsv`, 773 256 bytes, 200 e `immutable`).
     3. ~~Después entra el cliente.~~ **Hecho el 06-11-2026** (sesión 9) con el *merge* `d001730` (`--no-ff`, hasta `ff15aae`).
        - Antes de subirlo: `check` (971 pruebas, JS inicial de 131,9 KB y Worker de 38,7 KB) y los E2E de Chromium y WebKit (187), en verde.
        - Después: `ci` 42227747890 y `deploy-web` 42228220058, en verde.
        - `smoke:web`, todo en orden: `none → boot → scan → full`. En la primera pasada, `boot` llegó a los 2,0 s y `full` a los 4,9 s; en la segunda, a los 0,9 s y a los 2,0 s, con 3 392 KB de `ga-catalog`. La segunda visita no usa el núcleo de arranque.
        - `ga-catalog` sirve el núcleo de arranque en 343 KB con brotli, no en 269: Cloudflare comprime al vuelo con un nivel más bajo. La puerta (≤512 KiB con brotli 11) mide el fichero, no lo servido.
        - **ADR-009, aceptada el 06-11-2026** por decisión del usuario, sin esperar a CA3.1. La medida en el móvil (`search:boot` en el panel de rendimiento) sigue pendiente, con el resto de CA3.1.
   - **Perf (06-11-2026, CPU al 11 %, con Discord y Steam abiertos):**
     - primera visita hasta `boot`: 556 ms con CPU ×4;
     - reinicio con caché hasta `scan`: 1 923 ms (≤2 000 ms; el 05-11 daba ≈2,1 s, con el equipo más cargado);
     - restaurar el índice: 161 ms.
     - **Falla una puerta:** 1 tarea larga de 58–59 ms al apuntar, sin fotograma largo, en dos pasadas. `main` sin el *merge* (`caa473f`) da lo mismo justo después, en las mismas condiciones: 2 tareas (90 y 58 ms) y 1 (58 ms). No es del núcleo de arranque. Ya salía tras la navegación nueva con la CPU al 16 %; con la CPU al 5 % pasaba. Si se repite con el equipo en reposo, mirar el `onkeydown` de `#root` (81 ms en una de las de `main`) y los contadores de `SidebarLibrary`, que se recalculan al apuntar.
4. **App de escritorio:** el usuario la instaló y la probó el 02-11-2026. Encontró dos cosas, arregladas ese día (`279c10a`):
   - **el menú de «Orden» de Mi lista sacaba una barra horizontal**, porque a 1 100 px se salía 48 px. Ahora se abre hacia la izquierda, y cualquier menú que no quepa se da la vuelta;
   - **el Catálogo no tenía portadas.** Las quiere siempre: ahora las lleva, pedidas con el desplazamiento parado (DECISIONES §10.22).

   Llegan a la app sin reinstalar, porque carga `ga-web`.
   - **CA3.7: medido el 02-11-2026** por el asistente, a petición del usuario (`docs/medidas/ca3.7-20261102.md`). Fueron 10 altas con el atajo desde otra ventana y tecleo simulado a 100 ms por carácter: p50 de 1,24 s y máximo de 1,98 s, todas sin recargar. Las altas de prueba se quitaron después, y la app quedó abierta otra vez sin el puerto de depuración.
   - **CA3.8: hecho el 02-11-2026** por el asistente, a petición del usuario, en la segunda pantalla (`docs/medidas/ca3.8-20261102.md`). Sin red (cortada solo a la app: el asistente no apaga la red del PC), abre, busca, apunta y lo conserva al reiniciar. La página no logra ninguna orden de Tauri. Con el atajo cogido por otra aplicación, el menú de la bandeja lo dice y «Reintentar» lo recupera.
   - **Hallazgo, resuelto el mismo día** (DECISIONES §10.29): una versión nueva de `ga-web` solo entraba en la app de escritorio tras «Salir» o al reiniciar Windows. Ahora entra sola, con una recarga, cuando la página lleva 1 minuto oculta y sin nada a medias. Vale también para una pestaña del navegador. La app de escritorio oculta también el WebView al ir a la bandeja, para que la página lo sepa. Eso necesitaba el instalador nuevo: el asistente lo instaló en el PC del usuario el 02-11-2026, con `/S`, después de copiar sus datos (la agenda de escritorio sigue igual: Dota 2 y Counter-Strike 2).
   - **Comprobado en la app instalada:** el usuario lanzó `deploy-web` a mano (el modo automático no deja al asistente). La app se abrió oculta con `--autostart` y no se tocó nada: a los 51 s tenía la versión nueva en espera, y a los 112 s ya iba con ella (`index-D8AJgvtc.js`). Para mirarlo, CDP en crudo, porque Playwright fuerza `visibilityState` a `visible`. Los *commits* solo de documentación no despliegan.
   - El ADR-010 pasa a «aceptada». El instalador está en `apps/desktop/src-tauri/target/release/bundle/nsis/GameAgenda_0.2.0_x64-setup.exe`; si no está, `npm run desktop:build`.
5. **Seguir con M3**, por este orden si el usuario no dice otra cosa:
   1. ~~atajos de una tecla, gestos y reordenar arrastrando (CA3.4)~~ **Hecho el 02-11-2026:**
      - los atajos de teclado (§9.4 y DECISIONES §10.23): `shortcuts/keymap.ts`, la ayuda con `?`, el ajuste «Atajos de una tecla» y `shortcuts.spec.ts`;
      - los gestos (§9.4 y DECISIONES §10.24), en `apps/web/src/gestures/`: deslizar una fila (→ avanza el estado, ← bandeja de marcas), mantener pulsado (menú de estado; en la paleta, «Apuntar como…»), ↓ cierra la hoja de la paleta y el asa `::` para ordenar con el ratón, el dedo o el lápiz. Ajuste «Gestos táctiles» y `gestures.spec.ts`, con toques de verdad por CDP en Chromium;
      - **falta probarlos en un móvil de verdad** (el Android de referencia y un iPhone, con el *issue* #1): en particular, que el toque en la bandeja llegue a la primera tras un deslizamiento rápido;
   2. ~~índice persistido (CA3.2)~~ **Hecho el 02-11-2026** (§8.8 y DECISIONES §10.25; `docs/medidas/ca3.2-20261102.md`): 162 ms con CPU ×4 del arranque a la primera consulta, en dos fases (el pajar del nivel 3 se lee después). El formato va en `@gameagenda/core/search-persist`, un *chunk* diferido del Worker que no puede importar nada (lo vigila `npm run size`). El ADR-009 lo recogerá junto con el núcleo de arranque;
   3. ~~«Compartir» en Android, `Ctrl+V` en cualquier pantalla y chip «Pegar enlace»~~ **Hecho el 02-11-2026** (§9.2 y DECISIONES §10.26): `/share` en el *manifest*, `Ctrl+V` con el evento `paste` y el chip en la paleta vacía, con el dedo. **Falta probarlo en el dispositivo:** la hoja de «Compartir» de Android con la PWA instalada, lo que manda la app de Steam y el «Pegar» de iOS;
   4. ~~panel de rendimiento~~ **Hecho el 02-11-2026** (§12.7 y DECISIONES §10.27): Ajustes › Rendimiento, con las medidas guardadas en `meta.perfSamples` y «Copiar informe». Es la herramienta para medir CA3.1 en el iPhone;
   5. ~~WCAG 2.2 AA (CA3.5)~~ **La parte automática, hecha el 02-11-2026** (§9.7 y DECISIONES §10.28): contraste de los tokens, axe en todo, 320 px, foco y 2.5.3. **Le toca al usuario** la pasada con NVDA, Narrador, TalkBack y VoiceOver: `docs/medidas/guia-lectores-pantalla-m3.md`. Después, la prueba guiada (CA3.6), que también hace el usuario: protocolo en `docs/medidas/protocolo-prueba-guiada-m3.md` (10 juegos dictados, comprobados sobre el catálogo congelado, y los tiempos del panel de rendimiento).

   Hay que avisar al usuario al acabar cada parte.

## 1. Dónde estamos

- **Planificación terminada.** `prototipe.md` (raíz del repo) es el plan completo del prototipo: 19 secciones, ≈226 KB (versión 0.2). Para leerlo rápido: §1 (resumen) y §15 (hitos con criterios de aceptación).
- **Cambio del 29-10-2026:** la app de escritorio para Windows (envoltorio Tauri de la misma web, con el atajo global `Ctrl+Mayús+Espacio`) pasa de Fase 2 a **M3**. M3 sube a 4–6 días y el total, a 23–32 días ideales. Detalle en la §17.3 y la §15.6 de `prototipe.md`; el porqué, en `DECISIONES.md` §10.16.
- **Repositorio:** <https://github.com/LucasPrezFdez/gameagenda> (`main`). El usuario pidió el 29-10-2026 ir haciendo *commits* y subirlos sin preguntar, dejar los despliegues para más adelante y centrarse en la app.
- **M0 · Esqueleto: cerrado** (30-10-2026, sin etiqueta; detalle en ADR-003 y en el CHANGELOG, «Sin publicar»):
  - **CI:** `ci.yml` en verde en 2 min 52 s.
  - **Despliegue:** `ga-web` (https://ga-web.gameagenda.workers.dev) y `ga-catalog` (https://ga-catalog.gameagenda.workers.dev), desplegados a mano con `wrangler`, en el subdominio `gameagenda` que eligió el usuario.
  - **Comprobaciones «a verificar en M0»:** cerradas (`docs/medidas/verificaciones-m0-20261030.md` y ADR-003).
  - **Falta:**
    - ~~los secretos de Cloudflare en GitHub~~ **hecho**: el usuario los creó y el despliegue automático funciona (`ci` 41140409104 y `deploy-web` 41140742020). CA0.1–CA0.5 cumplidos;
    - M0 no lleva etiqueta: `v0.0.1` quedaría después de `v0.1.0` (decisión del usuario, 30-10-2026). Su cierre va en el CHANGELOG, en «Sin publicar».
  - **Repositorio público:** el plan lo daba por privado. Los minutos de Actions no cuentan, pero el *cron* se desactiva a los 60 días sin *commits* (R-04).
- **M2 · Catálogo vivo: cerrado con `v0.2.0`** (05-11-2026, sesión 8, con CA2.1; empezado el 31-10-2026, en la sesión 4, con cuatro agentes en paralelo):
  - **Contrato en `core`** (`4f6877e`): JSON canónico y firma, *shards* de detalles, `applyRecent` y `StatusMessage.catalog`. Claves de firma `dev-1` (privada en `fixtures/signing/`) y `prod-1` (`9ace9f8`; privada solo para el secreto de GitHub).
  - **En `main`:**
    - A1, la construcción: recientes, *shards*, *kill switches*, firma, puertas, ADR-007 y el arreglo de la clave, que ahora solo va a `GetAppList`. Ejecución real: 217 llamadas, 4 con clave, 0,33 pet./s y 11,3 min.
    - A2, la publicación: `catalog.yml` (04:17 UTC, encendido con la variable `CATALOG_SCHEDULE=on`), estado en la *Release* `catalog-state`, canario, *issue* si falla una puerta, *dead-man switch*, versión anterior conservada y `catalog:stage`. Se retira `deploy-catalog.yml`. Su parte del ADR-007 ya está fundida en `007-pipeline-del-catalogo.md`; el borrador se conserva, marcado como desfasado.
    - C, la interfaz: portadas con «Cargar portadas» (activado por defecto), aviso de primera capa, Ajustes › Privacidad, ficha completa, Próximos, orden por lanzamiento, edad del catálogo y ADR-008.
    - B, el cliente (integrado el 31-10-2026 en la sesión 5, `5d0b95f`): la verificación de la firma, recientes, regla de los 7 días, 404 y mini-catálogo firmado con *shards* sintéticos. Pasan 698 pruebas unitarias y 122 E2E. `ga-web` apunta ya a `https://ga-catalog.gameagenda-cat.workers.dev` (`VITE_CATALOG_URL` y `connect-src`).
  - **Puesta en marcha (31-10-2026, sesión 5):**
    - El usuario creó los secretos `CATALOG_SIGNING_KEY`, `HEALTHCHECKS_PING_URL`, `CATALOG_CLOUDFLARE_API_TOKEN` y `CATALOG_CLOUDFLARE_ACCOUNT_ID`, y la segunda cuenta de Cloudflare, con el subdominio `gameagenda-cat.workers.dev` (§11.3; ADR-003). La variable `CATALOG_ORIGIN` lleva el origen nuevo. `CATALOG_SIGNING_KID` no hace falta: `catalog.yml` usa `prod-1` por defecto.
    - El modo automático no deja al asistente escribir secretos, lanzar `catalog.yml` (despliega en producción) ni cambiar `CATALOG_SCHEDULE`: lo hace el usuario, desde la web de GitHub o con `gh`. `CATALOG_ORIGIN` sí la pudo poner el asistente.
    - **Primera publicación firmada** (ejecución 41201112633, con `no_previous=true`): en verde en 12 min 7 s. Versión `20261031.1`: 197 786 juegos, 3 562 alias, 0 recientes (no hay estado anterior con el que comparar), 197 607 con detalles en 1 024 *shards*. Núcleo de 2,16 MiB en brotli. 218 llamadas a Steam, 4 con clave. Todas las puertas en verde; las de variación se saltan sin versión anterior. La firma con `prod-1` se ha comprobado aparte, con la pública de `core`.
    - **Tres arreglos al integrar B:**
      - **La app pasa a la versión 0.2.0** (`653db54`). Un *manifest* firmado pide `minClientVersion` 0.2.0, y el cliente entró como 0.1.0: en producción rechazaba el catálogo con `client-too-old` y la búsqueda se quedaba sin catálogo durante unos 20 min. Con el cambio, en un Chromium limpio el catálogo llega a `full` en 4,2 s. La etiqueta `v0.2.0` y el CHANGELOG van al cerrar M2.
      - **Prueba de `host.test.ts`** (`07ce4f5`): en el *runner*, el reintento se programaba antes de que la caché llegara a `full`; ahora espera las dos cosas.
      - **Tareas largas por `:has()` en `.app`** (`15090b6`): `npm run perf` daba 40 tareas largas con ×4 (dos por nombre tecleado, casi todo recálculo de estilos). Las causaban dos reglas de C, `.app:has(.cover-notice)` y `.app:has(.palette.is-open)`. No se veían porque el catálogo de `perf` no traía detalles hasta B. Ahora: 0 tareas largas, INP de 40 ms (antes, 88) y `perf` entero en verde. Se encontró con `PERF_TRACE=1` y el seguimiento de invalidaciones de la traza.
    - **`ga-web` no volvía a abrir tras la primera visita** (roto desde el despliegue del 30-10-2026; arreglado en `e8f6dd5`). Workers Static Assets redirige `/index.html` a `/` (307), el Service Worker precacheaba la respuesta redirigida y Chrome la rechaza para una navegación (`net::ERR_FAILED`). Lo encontró una prueba en producción con Playwright; `pwa.spec` lo reproduce ahora con `context.route`. Un navegador con la versión rota se recuperó solo en la primera visita tras el despliegue. En producción, la segunda visita ya no pide el *manifest* (regla de las 12 h). Ver ADR-003.
    - **`perf` en local** necesita un catálogo firmado con `dev-1`: `npm run catalog:frozen` (el de `pipeline/out/` de M1 no lleva firma y el cliente lo rechaza). Así se ha regenerado el 31-10-2026; el catálogo real se vuelve a sacar de las páginas crudas con `--from-raw`.
  - **Falta:**
    1. ~~`CATALOG_SCHEDULE=on`~~ **hecho** por el usuario (31-10-2026, 13:47 UTC);
    2. tres ejecuciones programadas en verde (CA2.1): la primera, el 01-11-2026 a las 04:17 UTC (05:17 en Madrid); como pronto, del 1 al 3 de noviembre;
    3. ~~borrar `%USERPROFILE%\gameagenda-firma-catalogo-PRIVADA.pem`~~ **hecho** (31-10-2026): la privada solo está en el secreto `CATALOG_SIGNING_KEY`;
    4. ~~fundir la parte de publicación en el ADR-007~~ **hecho** (31-10-2026), con la puesta en marcha real, el *runbook* al día y la primera publicación. El borrador no se borra (decisión del usuario): lleva un aviso de que está fundido y desfasado;
    5. CHANGELOG: **redactado** en «Sin publicar» con la forma de la 0.2.0, con la tabla de CA2.1–CA2.8. Al cerrar M2:
       - poner al día la fila de CA2.1 (y la de CA2.5, si se prueba);
       - cambiar la cabecera a `## [0.2.0] · M2 Catálogo vivo · <fecha>`;
       - pasar ADR-007 y ADR-008 a «aceptada»;
       - etiqueta anotada `v0.2.0`;
    6. ~~pasar al plan los cambios que anotaron los informes de M2~~ **hecho** (31-10-2026):
       - `DECISIONES.md` §10.19 (catálogo) y §10.20 (interfaz);
       - las secciones 4, 5, 7, 8, 9, 11, 12, 13 y 15, y `prototipe.md` montado de nuevo.

       Los informes estaban en las transcripciones de los subagentes de la sesión 4, en las llamadas `SubagentHandback` de `~/.claude/projects/…/ba53a48a-…/subagents/`. De ellos salieron dos pendientes de código:
       - `meta.catalog` con la comprobación cada 12 h: **hecho** (31-10-2026, `catalog-meta.ts`). Hay 13 pruebas unitarias nuevas, un E2E y el gancho `checkEveryStart` para los E2E que publican y recargan. El Worker pesa 37,4 KB de 40;
       - ~~abaratar `applyRecent` si el arranque pasa de 2 s~~ **hecho el 06-11-2026** (sesión 9; ver §0, punto 3);
    7. ~~borrar la rama `m2-cliente` y las ramas y carpetas `worktree-agent-*`~~ **No se borran** (decisión del usuario, 31-10-2026: «por si acaso»), aunque todas están integradas.
  - **Avisos de los agentes:** el reinicio con caché sube a ≈1,85 s con recientes (≤2 s; con el equipo cargado, a veces se pasa; el 31-10-2026, 1 893 ms); el Worker pesa 36,9 KB de 40; los cambios del plan de sus informes ya están aplicados (punto 6).
- **M3 · Rápida y ágil: empezado** (31-10-2026, sesión 5; adelantado mientras corren las ejecuciones de CA2.1). Hasta cerrar M2 no se tocó el pipeline (`pipeline/`, `scripts/catalog-*`, `catalog.yml`), porque cada ejecución programada usa el código de `main`. Por eso el núcleo de arranque esperó en la rama `m3-arranque` hasta el 05-11-2026.
  - **App de escritorio para Windows:** hecha e integrada (`a3bce6a`; ADR-010, «propuesta»). La hizo un agente en un *worktree*.
    - `apps/desktop` con Tauri 2: `ga-web` como origen remoto, sin *capabilities* ni órdenes propias, con `desktop.test.ts` en `npm run check`.
    - El atajo lanza `gameagenda:capture` en la página, y `App.tsx` abre la paleta.
    - Instalador: `npm run desktop:build` → `apps/desktop/src-tauri/target/release/bundle/nsis/GameAgenda_0.2.0_x64-setup.exe`.
    - El agente lo comprobó instalado: atajo → paleta en 20 ms (p50), atajo → «Apuntado» en 1,23 s con el tecleo simulado, sin red, y 11 llamadas de la página a Tauri rechazadas.
    - Plan al día: §6.1, §12.5, §13, §14.1, §16 (R-18), §17.3 y DECISIONES §10.21.
    - **Le toca al usuario:** instalarla y hacer 10 capturas reales (CA3.7, p50 ≤3 s); el modo avión de verdad; mirar el menú de la bandeja, también con el atajo cogido por otra aplicación; y el aviso de SmartScreen.
    - Limitaciones conocidas, en el ADR: el arranque con Windows deja un valor `StartupApproved` en el registro al desactivarlo, «borrar datos» del desinstalador borra la agenda de escritorio y un atajo pulsado antes de que cargue la página no abre la paleta.
    - **Incidencias del agente:** al preparar la prueba abrió el Bloc de notas, y Windows restauró la sesión con `.env.local` abierto. El agente dice que lo cerró sin leerlo. También abrió una pestaña de Steam en Brave al probar «Ver en Steam».
  - **Siguiente propuesto:** atajos de una tecla, gestos y reordenar arrastrando (CA3.4); índice persistido (CA3.2, sin pipeline); «Compartir», `Ctrl+V` y panel de rendimiento.
- **M1 · Apuntar: cerrado con `v0.1.0`** (30-10-2026; etiqueta anotada en GitHub, con `CHANGELOG.md`). Las mediciones en el dispositivo pasan a M3 (ver «Pendiente de M1», punto 6). Todo está en `main` y subido, sin agentes ni *worktrees* abiertos:
  - **Búsqueda.** En `core`: `normalize`, `catalog-format`, `search` y `search-quality`. Sobre la copia congelada: conjunto dorado 94,9 % / 99,0 %, exactos 99,9 %, prefijos 93,1 %, y `scan` da lo mismo que `full`.
  - **Worker y catálogo.** Worker real con Cache Storage `gacat-<versión>`, `/catalog-dev/` y Catálogo virtual. Mini-catálogo de 298 juegos en `fixtures/catalog/`, generado con `npm run catalog:frozen`.
  - **Agenda.** En `core`: `entries`, `sync`, `steam-link` y `schemas`. En la app, Dexie:
    - guarda después del fotograma y coordina las pestañas con `storagemutated`;
    - exporta e importa JSON y CSV, y «Borrar todos mis datos»;
    - pegar enlace (con juego provisional) y Vincular;
    - aviso «Guardado fallido · Exportar · Reintentar».
  - **Pipeline sin clave (CA1.1 ✓).** `npm run catalog:build -- --keyless`.
    - Núcleo real `20261029.1`: 197 031 juegos, que pasan todas las puertas.
    - Del volcado `jsnli`, los 225 que faltan tienen su motivo (204 bloqueados en ES, que entran en M2 por H1).
    - Las páginas crudas están en `pipeline/state/raw-2026-10-29/` (con `--from-raw` se rederiva sin red) y los informes, en `pipeline/state/reports/20261029.1/`. No se versionan.
    - `pipeline/out/` contiene ya ese catálogo real.
  - **Rendimiento.** `npm run perf` (con `PERF_PORT`) y `npm run size`, que va dentro de `check`: JS inicial de 113,8 KB y Worker de 32,5 KB, en brotli. La tabla está en `docs/medidas/perf-m1-20261029.md`.
  - **ADR:** 001, 002, 004, 005 y 006 (propuesta), con índice en `docs/adr/README.md`. ADR-003 espera a los despliegues.
  - **Pruebas:** 536 unitarias y 102 E2E en verde (6 saltadas a propósito). `npm run perf`, en verde desde el 30-10-2026.
  - **Nota para los E2E:** WebKit en Windows tarda ≈260 ms en guardar un alta en IndexedDB. Las pruebas que recargan después de una acción esperan con `expectStored` (`apps/web/e2e/storage.ts`). Si hay otra vista previa abierta, lanza los E2E con otro `E2E_PORT`, porque `reuseExistingServer` la reutilizaría.
- **Pendiente de M1** (M1 se cerró con `v0.1.0`; solo queda el punto 6, que pasa a M3):
  1. ~~**Presupuesto de la pulsación en escritorio.**~~ **Hecho el 30-10-2026** (sesión 4): ≤16 ms a ≥120 Hz y ≤2 fotogramas por debajo (≈33 ms a 60 Hz), decisión del usuario. Cambiados RNF-02, §8.9, §12.4, CA1.5, ADR-005 y `DECISIONES.md` §10.17. `npm run perf` mide la frecuencia y aplica el límite: 23,1 ms de p95 frente a ≤33,3 ms a 60 Hz.
  2. ~~**CA1.11.**~~ **Hecho el 30-10-2026:** con ×4, el escaneo está listo en 1 553–1 644 ms tras un reinicio con caché (antes, ≈2,2 s). Se optimizaron `normalize`, el pajar, los nombres españoles, la tabla de exactos, `articleLength` y el lector del TSV. Detalle en `docs/medidas/builder-m1-20261030.md`.
  3. ~~**Tareas largas con ×4.**~~ **Hecho el 30-10-2026:**
     - **Fuentes de reserva:** la primera maquetación de han, kana, hangul o emoji costaba 30–130 ms con ×4, por escritura y peso. `src/perf/fallback-fonts.ts` las calienta en ratos ociosos en cuanto se puede buscar; tras eso, ≤4 ms. `perf` lo comprueba con una fila nueva.
     - **El Intro que apunta:** analizado. En reposo no pasa de 50 ms. Con el equipo cargado, el primer Intro de la sesión (código en frío) llegaba a 58–60 ms. Si vuelve a pasar en el Android de referencia, la §9.5 prevé virtualizar Mi lista por secciones.
     - **`npm run perf` sale entero en verde por primera vez.** La pulsación de escritorio va justa: 31,2 ms frente a 33,3. Tabla y análisis en `docs/medidas/perf-m1-20261030.md`.
  4. ~~**RNF-08.**~~ **Hecho el 30-10-2026:** aviso arriba de Mi lista tras 30 días sin exportar (JSON o CSV), contando desde la primera entrada si nunca se ha exportado. «Ahora no» lo aplaza 7 días; no sale con el de iOS. Se guarda en `meta.copyReminder` (§7.2) y se describe en la §9.6. Tiene pruebas unitarias, de Dexie entre pestañas y E2E con `page.clock`.
  5. ~~**Arreglos del plan detectados al escribir los ADR.**~~ **Hecho el 30-10-2026:**
     - la §7.4 recoge el reenvío de `merge()` al cambiar `mergedInto`;
     - la §13.2 configura `core.longpaths` y `core.autocrlf` en el repositorio;
     - la §8.9 y la §12.4 anotan que CDP no estrangula el Worker, ni con `Target.setAutoAttach`;
     - `dexie-react-hooks` se ha retirado, y la §6, la §9.5, la §14, D-02, D-03 y la §10.18 lo recogen;
     - CSS Modules ya no aparece: son hojas CSS normales;
     - `biome.json` vigila la §14.3 con `noRestrictedImports` por carpeta y `noUndeclaredDependencies`, y se ha comprobado que cada regla salta;
     - en `DECISIONES.md`, la §2, D-01, la tabla de hitos y la de versiones llevan Tauri en M3, y la §5, el presupuesto de la §10.17.
     - De paso: `npm audit` da 4 avisos leves de `deepmerge` (vía `workbox-build`, solo en el *build*). npm propone bajar `workbox-build` a la 5.1.4, que rompe cosas; no se ha tocado.
  6. **Lo que mide el usuario:** el Android de referencia (CA1.4, CA1.11 y RNF-02) y la pasada con NVDA (CA1.10). Si no hay Android, se cierra con `perf` y su medición pasa a M3 con un *issue*.
     - Guía paso a paso en `docs/medidas/guia-dispositivo-m1.md` (30-10-2026), con un fragmento de DevTools para p50 y p95 y una tabla de resultados. El usuario pega la tabla en el chat y se guarda en `docs/medidas/dispositivo-m1-AAAAMMDD.md`.
     - Pasan a M3 por decisión del usuario (30-10-2026), en el *issue* [#1](https://github.com/LucasPrezFdez/gameagenda/issues/1).
     - Dudas abiertas de la guía: en Android, «con la barra» (la de Chrome no se arrastra) y «Fin» (necesita un teclado); y CA1.11 en el móvil con ≈10 entradas, frente a las 500 de `perf` (se puede generar una copia de 500 para importar).
- **Hallazgos de M0 para el ADR-002** (paso 7):
  - Biome 2.6.4 y `wrangler` 4.155.0 en lugar de 2.6.3 y 4.154.0 (publicados el 28-10-2026; la §6 ya está al día). `wrangler` 4.153–4.155 depende de `miniflare` 5.x *beta*: es su dependencia interna, no una elección nuestra.
  - npm 11.19 no ejecuta los *scripts* de instalación sin autorización: `esbuild` y `workerd` funcionan sin ellos y quedan denegados en `allowScripts` de `package.json`.
  - Biome 2.6 formatea Markdown y cambiaría `*cursiva*` por `_cursiva_`: los `.md` quedan fuera de Biome. `biome migrate` convirtió `"recommended": true` en `"preset": "none"` (apagaba todas las reglas); se fijó a mano `"preset": "recommended"` y se comprobó que las reglas saltan.
  - `tsc` rechaza en `core` imports sin `.ts`, `enum`, `document` y `process` (comprobado).
  - `git config core.longpaths true` y `core.autocrlf false` se han puesto en el repositorio, no en la configuración global, para no cambiar otros proyectos.

## 2. Antes de la próxima sesión (lo haces tú)

| Qué | Para qué | Cómo |
|---|---|---|
| ~~Pedir la clave de la Steam Web API~~ | **Hecho (31-10-2026):** en `.env.local` (`STEAM_WEB_API_KEY`) y en el secreto de GitHub `STEAM_API_TOKEN`, con su *hash* en la variable `STEAM_KEY_SHA256` del CI. Funciona: `GetAppList` responde 200 | `catalog.yml` (M2) mapea `STEAM_API_TOKEN` a `STEAM_WEB_API_KEY` |
| ~~Cuenta de GitHub~~ | **Hecho el 30-10-2026:** `gh` 2.103.3 instalado (`C:\Program Files\GitHub CLI\gh.exe`; una terminal abierta antes de instalarlo no lo encuentra en el `PATH`) y con sesión como `LucasPrezFdez` (ámbitos `repo`, `read:org` y `gist`). No toca las credenciales de git | — |
| ~~Cuenta gratuita de Cloudflare~~ | **Hecho el 30-10-2026:** `wrangler login` con la cuenta del usuario y subdominio `gameagenda.workers.dev` | Falta el *token* de la API para GitHub (ver §1) |
| ~~Cuenta de healthchecks.io~~ | **Hecho (31-10-2026):** *check* «catalog» (1 día + 12 h) y secreto `HEALTHCHECKS_PING_URL`. Si llega un correo suyo, el cron no ha corrido: ver el *runbook* del ADR-007 | — |
| Pasada con lectores de pantalla | CA3.5 (y CA1.10, con NVDA) | `docs/medidas/guia-lectores-pantalla-m3.md`: apuntar → cambiar estado → Deshacer con NVDA, Narrador, TalkBack y VoiceOver, unos 10 minutos cada uno. Pega la tabla en el chat |
| Prueba guiada con 3–5 personas | CA3.6 (O-1 y O-2) | `docs/medidas/protocolo-prueba-guiada-m3.md`: 10 juegos dictados a cada persona (al menos 2 ajenas al proyecto), con los tiempos de Ajustes › Rendimiento. Pega la tabla y los informes en el chat |
| Medir en el Android de referencia y en un iPhone | CA3.1 (y lo de M1 del *issue* #1) | En el Android, con `docs/medidas/guia-dispositivo-m1.md`; en el iPhone, con Ajustes › Rendimiento y «Copiar informe». También probar ahí «Compartir» con la PWA instalada, lo que manda la app de Steam y el «Pegar» del chip en iOS (CA3.3) |
| Mirar el correo de GitHub cada día hasta cerrar M3 (CA2.1 de M2 está cumplido; M3 pide 7 ejecuciones seguidas en verde, y van 6 el 08-11-2026) | CA2.1 | Un fallo de `catalog.yml` abre el *issue* `catalogo` y manda correo. Relanzar el flujo lo hace el usuario: Actions › catalog › Run workflow |
| Opcional: renovar la clave de Steam | Por si acaso | Un agente abrió por error `.env.local` en el Bloc de notas y dice que lo cerró sin leerlo. Si se renueva: `.env.local`, el secreto `STEAM_API_TOKEN` y la variable `STEAM_KEY_SHA256` |
| Móviles reales | Medir los presupuestos de rendimiento | Un Android de gama media de referencia (M1) y un iPhone, aunque sea prestado (M3 y M4) |
| Responder las preguntas de la §18 | Afinar el orden de los hitos y el alcance | Sobre todo PA-01 (¿apuntarás desde el móvil y el PC desde el principio?) y PA-02 (¿iPhone o Android?) |

## 3. Decisiones pendientes del usuario

| Pregunta | Supuesto mientras no respondas |
|---|---|
| ¿`docs/planificacion/` se queda en el repo? | **Sí.** `prototipe.md` remite a `docs/planificacion/prototipo-busqueda/`. No se borra nada sin confirmarlo |
| Preguntas abiertas PA-01…PA-10 (§18 de `prototipe.md`) | Los supuestos escritos en la propia §18 (por ejemplo: orden M3 → M4; Android de gama media como referencia) |
| ¿Importar un JSON también aplica los ajustes que trae? | **Sí** (el formato de exportación los incluye; antes se guarda copia en `meta.backup`) |
| Nombre base del catálogo sin clave: `GetItems` en inglés para los nombres que parecen españoles (+18 peticiones; recupera el 75,7 %) o una segunda pasada de Query en inglés (+208) | **`GetItems` en inglés**, como está. En M2 lo resuelve `GetAppList` con clave |

## 4. Guion de M0 (el detalle manda en §15.3, §12, §13 y §14 de `prototipe.md`)

1. `git init`, `.gitattributes` con `eol=lf`, `git config core.longpaths true`, `.npmrc` con `save-exact=true` y `.gitignore` (`.env.local`, `node_modules`, `dist`, `pipeline/out`).
2. npm workspaces y carpetas: `apps/web`, `packages/core`, `pipeline/`, `fixtures/` (ya existe `fixtures/catalog-frozen/`), `docs/adr/`, `scripts/` (§14).
3. Herramientas con las versiones exactas de la §6: TypeScript 7.0.2, Biome 2.6.4, Vitest 5.0.5, Playwright 1.64.1 (`npx playwright install chromium webkit`), Vite 8.3.5 + React 19.3.1, `wrangler` 4.155.0. Antes de instalar, comprueba con `npm view <paquete> version` si hay parches nuevos; cambiar de versión mayor obliga a actualizar la §6.
4. ✓ (30-10-2026) `ci.yml` (≤10 min): Biome, `tsc`, Vitest, Playwright, puerta de tamaño (JS inicial ≤150 KB brotli) y búsqueda de la clave en el *build*.
5. ✓ (30-10-2026, a mano; el automático espera a los secretos) Despliegues: `ga-web` (página mínima + `_headers` con la CSP) y `ga-catalog` (mini-catálogo de `fixtures/` + `_headers` con CORS y los TSV como `text/plain; charset=utf-8`).
6. ✓ (30-10-2026) Comprobaciones «a verificar en M0»: compresión del TSV (`br`, `gzip` o `zstd`); `_headers` y CORS también en los 404; campos de Query sin `include_basic_info` (`is_free`…); estrangulamiento del Worker por CDP (`Target.setAutoAttach`; **ya medido**: no se estrangula, ver §8.9); importación de la clave pública Ed25519 en WebCrypto; formato de la clave de Steam. Cada resultado va al ADR que corresponda o a un *issue*.
7. ✓ (30-10-2026) ADR-001 (arquitectura), ADR-002 (stack y repositorio) y ADR-003 (*hosting*, despliegue y CI) en `docs/adr/`.
8. Cerrar M0 con los criterios CA0.1…CA0.5 y la etiqueta `v0.0.1`.

## 5. Reglas para el asistente en la próxima sesión

- **Fuente de verdad:** `prototipe.md`. El porqué de cada decisión está en `docs/planificacion/DECISIONES.md` (su §10 recoge los ajustes hechos tras medir y manda sobre lo anterior). No reabras decisiones cerradas sin un motivo nuevo (una medición o un cambio externo).
- **No repitas** la investigación ni la redacción: costaron ≈11 M de tokens en total y sus resultados están guardados.
- **Editar el plan:** se cambian los ficheros de `docs/planificacion/secciones/NN-*.md` y se vuelve a montar con `node docs/planificacion/montar-prototipe.mjs . --write` (sin `--write`, solo pasa el *lint*).
- **Búsqueda:** el punto de partida es `docs/planificacion/prototipo-busqueda/`, que en M1 se porta a TypeScript en `packages/core/src/search/`. El núcleo real congelado está en `fixtures/catalog-frozen/`.
- **Seguridad:** la clave de Steam nunca va en el chat, el repo ni el *bundle*; solo en `.env.local` y en secretos de GitHub.
- **Idioma:** español de España en la interfaz y en la documentación; código e identificadores en inglés.
- **Commits:** desde el 29-10-2026, el usuario quiere que se hagan y se suban a `origin/main` en cuanto el trabajo esté en verde, sin preguntar cada vez.
- **Ritmo:** se pueden usar subagentes para trabajos independientes, pero hay que avisar al usuario al acabar cada parte y preguntar si sigue.
- **No borrar** ramas, *worktrees* ni borradores sin que el usuario lo pida (31-10-2026: «no borres nada por si acaso»).
- **Lo que el modo automático no deja hacer al asistente:** escribir secretos de GitHub, lanzar `catalog.yml` (despliega en producción) y cambiar `CATALOG_SCHEDULE`. Se le dan al usuario los pasos en la web de GitHub. Las variables normales, como `CATALOG_ORIGIN`, sí se pueden poner.
- **El pipeline ya se puede tocar** (M2 cerrado el 05-11-2026), pero con cuidado: las ejecuciones programadas usan `main`, así que cada cambio de `pipeline/`, `scripts/catalog-*` o `catalog.yml` sale en la siguiente, y M3 pide 7 seguidas en verde (CA2.1). Antes de subir un cambio así, `npm run check` y las pruebas del pipeline en verde.
- **Después de cada despliegue de `ga-web`, `npm run smoke:web`.** `vite preview` esconde diferencias con Workers Static Assets: el 31-10, el Service Worker roto desde el 30-10.
- **`npm run perf` en local** necesita antes `npm run catalog:frozen` (catálogo firmado con `dev-1`). Con procesos pesados en marcha (Discord, `cargo`), `perf` y los E2E de WebKit sensibles al tiempo fallan sueltos: se repiten antes de culpar al código.
- **Los informes de los subagentes** llegan por `SubagentHandback`; los antiguos están en `~/.claude/projects/<proyecto>/<sesión>/subagents/agent-*.jsonl`.
- **Nunca** meter comillas invertidas de Markdown dentro de un `node -e "…"` en Bash: la *shell* las ejecuta como órdenes. Para texto, Write o Edit.

## 6. Mapa de ficheros

| Ruta | Qué es |
|---|---|
| `prototipe.md` | El plan del prototipo |
| `CLAUDE.md` | Instrucciones del proyecto para Claude Code |
| `docs/adr/` | ADR del proyecto (índice en `README.md`) |
| `docs/medidas/` | Mediciones guardadas (p. ej., la tabla de `perf` de M1) |
| `pipeline/state/` | Estado, páginas crudas e informes del pipeline (no se versiona: solo en este PC) |
| `fixtures/catalog-frozen/` | Núcleo real del catálogo (196 665 juegos) y sus alias, del 28-10-2026 |
| `docs/planificacion/DECISIONES.md` | Decisiones cerradas y su porqué |
| `docs/planificacion/secciones/` | Fuente de cada sección de `prototipe.md` |
| `docs/planificacion/montar-prototipe.mjs` | Monta `prototipe.md` y pasa el *lint* |
| `docs/planificacion/prototipo-busqueda/` | Búsqueda medida: código, conjunto dorado, vectores y resultados |
| `docs/planificacion/medicion-js/` | Medición del tamaño de React + Dexie con Vite 8.3.5 |
| `docs/planificacion/investigacion/` | Investigación verificada de la sesión 1 (Steam, legal, UX, stack) |
| `docs/planificacion/lineas-paralelas/`, `panel-arquitectura/`, `borradores/` | Trabajo de la sesión 1: líneas paralelas, las tres arquitecturas con sus evaluaciones y borradores |
| `docs/planificacion/redaccion/` | Registros y datos de la redacción, la revisión y los retoques (sesión 2) |
| `docs/planificacion/workflows/` | Scripts de los 6 workflows (los de 5 y 6 leen ficheros que ahora están en `redaccion/`) |
| `docs/planificacion/historial/estado-sesiones-1-y-2.md` | Estado detallado de las sesiones 1 y 2 |

## 7. Historial

| Sesión | Fecha | Qué se hizo |
|---|---|---|
| 1 | 27/28-10-2026 (noche) | Investigación verificada (catálogo y API de Steam, cuenta de Steam y legal, otras fuentes, producto y UX, stack de 2026), cuatro líneas paralelas (UX, modelo de datos, benchmark de búsqueda, ingeniería) y evaluación de tres arquitecturas |
| 2 | 28-10-2026 | Decisiones cerradas; redacción en paralelo (9 agentes); benchmark de búsqueda con el catálogo real; revisión (4 críticos y 9 correctores); retoques (11 agentes); `prototipe.md` terminado |
| 3 | 29-10-2026 | App de escritorio (Tauri) adelantada de Fase 2 a M3 y plan 0.2. M0, pasos 1–3 (repositorio, *workspaces* y herramientas). M1 casi completo con agentes en paralelo: búsqueda, Worker y Catálogo virtual; agenda en Dexie con exportar/importar y enlaces; pipeline sin clave con el catálogo real (CA1.1); `npm run perf` y la puerta de tamaño; ADR-001, 002, 004, 005 y 006 |
| 4 | 30-10-2026 | Pendiente de M1, puntos 1–5: presupuesto de la pulsación según la frecuencia (§10.17); *builder* y lector del TSV más rápidos (CA1.11, 1,64 s); fuentes de reserva CJK y emoji calentadas; `npm run perf` entero en verde; aviso de copia a los 30 días (RNF-08); arreglos del plan, retirada de `dexie-react-hooks` y reglas de Biome de la §14.3. `CHANGELOG.md`, versión 0.1.0 y guía de medidas en el dispositivo |
| 5 | 31-10-2026 | M2, puesta en marcha: secretos, segunda cuenta de Cloudflare (`gameagenda-cat.workers.dev`) y healthchecks.io; primera publicación firmada con `prod-1` (`20261031.1`, 197 786 juegos, 12 min 7 s); cliente de M2 (B) integrado en `main` y `ga-web` apuntando al catálogo nuevo; la app pasa a la versión 0.2.0 (la que pide el catálogo firmado); fuera los `:has()` de `.app`, que daban 40 tareas largas con ×4 (`perf` entero en verde); ADR-007 fundido, CHANGELOG de la 0.2.0 y el plan al día con lo construido (DECISIONES §10.19–10.21); `meta.catalog` y la comprobación cada 12 h; arreglado el Service Worker de `ga-web`, que no volvía a abrir tras la primera visita desde el 30-10; M3 empezado con la app de escritorio (Tauri) |
| 6 | 01/02-11-2026 (noche) | Primera ejecución programada de `catalog.yml` en verde (CA2.1, 1 de 3); CA2.4 medido en producción (34,5 KB) y `smoke:web` al día; los dos hallazgos del usuario en la app de escritorio, arreglados (menú de «Orden» y portadas en el Catálogo, §10.22); CA3.7 medido en la app instalada (p50 de 1,24 s); atajos de una tecla de la §9.4 (§10.23) |
| 7 | 02-11-2026 | Gestos de la §9.4 y reordenar arrastrando `::` (§10.24), con el ajuste «Gestos táctiles» y E2E con toques de verdad por CDP: CA3.4 completo. Índice persistido (§10.25): CA3.2 en 275 ms con CPU ×4. «Compartir», `Ctrl+V` y el chip «Pegar enlace» (§10.26; CA3.3). Panel de rendimiento en Ajustes (§10.27). Auditoría WCAG 2.2 AA, parte automática (§10.28; CA3.5). Restauración del índice en dos fases (CA3.2 en 162 ms) y protocolo de la prueba guiada (CA3.6). CA3.8 en la app de escritorio, por el asistente en la segunda pantalla: ADR-010 aceptado. Versiones nuevas sin que se note (§10.29), en la web y en la app de escritorio. La ejecución programada del catálogo del 02-11 falló en la prueba de humo (404 pasajeros justo tras desplegar) |
| 8 | 04/05-11-2026 | Núcleo de arranque en la rama `m3-arranque` (20 000 juegos, `boot` con CPU ×4 en 613–759 ms), con ADR-009 propuesto, DECISIONES §10.30 y la revisión verificada (3 arreglos). CA2.1 cumplido con las ejecuciones programadas del 03 al 05-11: M2 cerrado con `v0.2.0`, y ADR-007 y ADR-008 aceptados |
| 9 | 06-11-2026 | Cliente del núcleo de arranque en `main` y desplegado (`d001730`); ADR-009 aceptada; `applyRecent` más barato (≈21 → ≈10 ms en frío) |
| 10 | 06-11-2026 | M4 empezado en la rama `m4-sincronizacion`: base de la micro-API (Hono solo en `/api/*`, reglas de la §11.4, agenda, dispositivos, emparejar, recuperar y borrar; D1 con su migración), contrato en `@gameagenda/core/api`, ADR-011 propuesto y DECISIONES §10.34 |
| 11 | 07-11-2026 | M4 parte 3: el cliente de la sincronización, Ajustes › Sincronización y los E2E de CA4.2 y CA4.3, con la revisión (≈30 arreglos) |
| 12 | 08-11-2026 | M4 parte 4: buzón del Atajo de iOS, `resolve`, textos legales (falta el responsable) y CA4.6 en local (peor p99, 2,38 ms). La ejecución programada del catálogo del 08-11 en verde: la racha va por 6 de 7 |
