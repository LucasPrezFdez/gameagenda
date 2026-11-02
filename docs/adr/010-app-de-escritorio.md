# ADR-010 · App de escritorio: envoltorio Tauri de `ga-web` con atajo global

- **Estado:** aceptada el 02-11-2026, con CA3.7 y CA3.8 cumplidos en la app instalada (los midió el asistente, a petición del usuario)
- **Fecha:** 31-10-2026
- **Deciden:** el usuario y el asistente

## Contexto y problema

La PWA no puede registrar un atajo del sistema: en el PC solo se apunta con la ventana de la app delante (`Ctrl+K` o `/`). Desde el 29-10-2026, M3 incluye una app de escritorio para Windows que envuelve la misma web y aporta `Ctrl+Mayús+Espacio` desde cualquier aplicación (DECISIONES §10.16; §17.3 y §15.6 de `prototipe.md`). La §17.3 la describe así: la ventana carga el origen de `ga-web` (`frontendDist` con la URL de producción), la parte nativa lanza en la página un evento fijo que atiende el *router* y ninguna *capability* declara `remote`.

Al construirla con Tauri 2.12.5 apareció un matiz que cambia la protección de CA3.8: Tauri trata como **origen local** cualquier página que cuelgue de `frontendDist` cuando este es una URL (`Webview::is_local_url`, que compara con `get_app_url`). Con la §17.3 al pie de la letra, `ga-web` sería local: le llegarían las *capabilities* locales de la ventana y las órdenes propias de la app, que para un origen local se permiten sin manifiesto. «Ninguna *capability* declara `remote`» no la protegería.

¿Cómo se construye la app de escritorio para que el atajo abra la paleta desde cualquier aplicación sin recargar, sin que la página de `ga-web` pueda dar ninguna orden a la parte nativa?

## Factores de la decisión

- **CA3.7:** el atajo pone delante la ventana con la paleta y el foco, sin recargar; volver a pulsarlo la oculta; cerrar la deja en la bandeja; abrir otra vez muestra la misma; apuntar p50 ≤3 s en 10 altas.
- **CA3.8:** la página no invoca ninguna orden de Tauri; si otra aplicación tiene el atajo, el menú de la bandeja lo dice; tras una primera apertura con red, funciona sin red.
- **Un solo cliente:** cada despliegue de `ga-web` actualiza también la app de escritorio, con la misma CSP, el mismo Service Worker y el mismo `connect-src` (§17.3).
- **Parte nativa mínima,** mantenible por una persona, y un CI que no compila Rust (§12.5).
- **Instalador** NSIS por usuario, sin derechos de administrador y sin firma (§17.3).

## Opciones consideradas

1. La ventana se crea en código con `ga-web` como **URL externa** (origen remoto para Tauri), sin `frontendDist`, sin *capabilities* ni órdenes propias; el atajo ejecuta en la página un evento fijo.
2. **`frontendDist` con la URL de `ga-web`**, como decía la §17.3, con el mismo evento fijo.
3. **Eventos de Tauri** (`emit` en Rust y `listen` de `@tauri-apps/api` en la página), con una *capability* `remote` solo para `core:event`.
4. **La web empaquetada** dentro del binario (`frontendDist` con el *build* de `apps/web`).

## Decisión

Opción elegida: **1**, porque es la única en la que el propio Tauri trata `ga-web` como remota y rechaza cualquier `invoke` que no autorice una *capability* `remote` (no hay ninguna). Además no hay *capabilities* ni órdenes propias, así que no queda nada que invocar. El mecanismo de la §17.3, el evento fijo, se conserva tal cual.

### Ventana y origen (`apps/desktop/src-tauri/`)

- `tauri.conf.json` declara la ventana `main` con `"create": false` y `"url": "https://ga-web.gameagenda.workers.dev/"`, sin `frontendDist`: no se empaqueta nada, y el único origen local, `http://tauri.localhost`, no sirve ningún fichero. `main.rs` crea la ventana con `WebviewWindowBuilder::from_config`; con `tauri dev` (`tauri::is_dev()`) carga `devUrl`, `http://127.0.0.1:5173`.
- **Navegación:** solo el origen de la app. Un `target="_blank"` («Ver en Steam») u otro enlace `https://` se abre en el navegador del sistema con `ShellExecuteW`; los demás esquemas se ignoran. Sin manejador, el WebView2 de wry descartaba en silencio la ventana nueva y «Ver en Steam» no hacía nada.
- **Datos:** WebView2 guarda los suyos en `%LOCALAPPDATA%\dev.workers.gameagenda\EBWebView`, aparte de Edge y de Chrome (la agenda propia de la §17.3 y el R-18). El identificador `dev.workers.gameagenda` es el dominio de `ga-web` al revés.

### Atajo → paleta, sin recargar

- `tauri-plugin-global-shortcut` registra `Ctrl+Mayús+Espacio` en `setup`, y no con `with_shortcuts`: así, si falla, la app sigue en marcha y lo dice en la bandeja.
- **Al pulsarlo,** si la ventana está visible, sin minimizar y delante, se oculta. Si no, se restaura, se muestra, recibe el foco y se ejecuta en la página `window.dispatchEvent(new Event('gameagenda:capture'))` (`CAPTURE_SCRIPT`). Para saber si está delante se usa `GetForegroundWindow`: `is_focused()` da `false` mientras el foco del teclado lo tiene la ventana hija de WebView2.
- **El *script* se ejecuta fuera de la CSP de la página.** `eval` de Tauri es `ExecuteScript` de WebView2, que va por fuera de la CSP, como las DevTools. Comprobado en la app instalada: con la CSP de `ga-web` en vigor (un `<script>` en línea inyectado se bloquea con `script-src-elem`), el evento llega y abre la paleta.
- **En la página,** `apps/web/src/desktop/desktop-capture.ts` y un `useLayoutEffect` de `App.tsx`:
  - en Mi lista o en `/apuntar`, la paleta se abre ahí mismo, con `palette.open()` como `Ctrl+K`, sin perder los filtros de la URL;
  - desde otra pantalla, `navigate('/apuntar')` (con `pushState`, sin recargar) y el efecto de `/apuntar` la abre sobre Mi lista; Atrás vuelve a la pantalla anterior.

  Cualquier *script* de la página podría lanzar el evento, pero solo abre la paleta. La web sigue sin importar `@tauri-apps/*` (regla de Biome de la §14.3).

### Bandeja, una sola instancia y arranque con Windows

- **Bandeja:**
  - «Abrir»;
  - el estado del atajo: «Atajo: Ctrl+Mayús+Espacio», desactivado, o «Ctrl+Mayús+Espacio lo usa otra aplicación · Reintentar», que vuelve a intentarlo;
  - «Iniciar con Windows», desactivado por defecto;
  - «Salir».

  El *tooltip* repite el estado del atajo y el clic izquierdo muestra la ventana.
- **Cerrar** (X o Alt+F4) oculta la ventana; «Salir» cierra la app.
- **Una sola instancia:** `tauri-plugin-single-instance` va el primero, y una segunda instancia muestra la ventana de la primera y sale.
- **Arranque con Windows:** `tauri-plugin-autostart` escribe `HKCU\…\Run\GameAgenda` con `--autostart`. Con ese argumento la ventana empieza oculta, pero la página carga, así que el primer atajo ya es inmediato. El desinstalador de Tauri borra ese valor salvo en una actualización.

### La página no recibe órdenes (CA3.8)

- No hay carpeta `capabilities/` ni nada en `app.security.capabilities`: una lista vacía significaría «todos los ficheros de `capabilities/`». Tampoco hay `invoke_handler` ni `#[tauri::command]`, y `withGlobalTauri` es `false`.
- Tauri inyecta igualmente `window.__TAURI_INTERNALS__` en todas las páginas; la barrera es su ACL:
  - las órdenes de los *plugins* siempre pasan por ella;
  - desde un origen remoto, también las de la app.

  Los *plugins* registran sus órdenes de JS (`autostart|enable`, `global-shortcut|register`…), pero sin *capability* nadie puede usarlas.
- **Guarda sin Rust:** `apps/desktop/desktop.test.ts`, dentro de `npm run check`, falla si aparece una `capability`, un `frontendDist`, una orden propia o `@tauri-apps/` en la web; si cambia el evento de un lado y no del otro; o si un *crate* deja de ir fijado con `=` o no coincide con `Cargo.lock`.

### Instalador y versiones

- NSIS `currentUser` en `%LOCALAPPDATA%\GameAgenda` (`RequestExecutionLevel user`), en español y sin firma: SmartScreen avisa («Más información» → «Ejecutar de todas formas»). El *bootstrapper* de WebView2 solo actúa si falta. Pesa 1,10 MiB y lo genera `npm run desktop:build`.
- Versiones, sin cambios respecto a la §6 (comprobadas en crates.io y npm el 31-10-2026; lo único más nuevo son las 3.0 alfa):
  - *crates*: `tauri` 2.12.5 (con `tray-icon`), `tauri-build` 2.7.4, `tauri-plugin-global-shortcut` 2.4.1, `tauri-plugin-single-instance` 2.5.5 y `tauri-plugin-autostart` 2.7.0;
  - CLI: `@tauri-apps/cli` 2.12.4;
  - se añade `windows` 0.62.2, la misma que ya usa `tauri`, por `ShellExecuteW` y `GetForegroundWindow`; no entra ningún *crate* nuevo en el árbol.

  `@tauri-apps/cli` no tiene *scripts* de instalación (binarios por `optionalDependencies`), así que no toca `allowScripts`.

### Consecuencias

- Bien, porque `ga-web` es remota para Tauri. Aunque mañana alguien añada una orden propia o una *capability* local, la página no la alcanza sin declarar `remote`.
- Bien, porque un despliegue de `ga-web` actualiza también la app de escritorio, que no lleva código de la web.
- Bien, porque el atajo responde en ≈20 ms (p50 de 10, de pulsarlo a la paleta con el foco), sin recargar, y la parte nativa es un solo `main.rs` de ≈400 líneas, con comentarios y pruebas.
- Bien, porque el CI sigue sin Rust y vigila lo que protege CA3.8.
- Mal, porque **el atajo solo abre la paleta cuando `ga-web` tenga desplegado `desktop-capture.ts`**. Hasta entonces, la ventana sale delante, pero sin la paleta. Hay que publicar la web antes de repartir el instalador.
- Mal, porque la primera apertura necesita red y, hasta M4, la agenda de escritorio es otra distinta de la del navegador (R-18). Ojo: el desinstalador ofrece «borrar los datos de la aplicación», que borra esa agenda. Antes, exportar.
- Mal, porque sin firma SmartScreen avisa al instalar (se decide en Fase 2).
- Mal, porque `auto-launch` 0.6.0 escribe la ruta en `Run` sin comillas e intenta antes `HKLM` (sin elevar cae a `HKCU`). Con la ruta por defecto solo importa si el nombre del usuario lleva espacios; Windows suele resolverla aun así. Además, al desactivarlo deja `StartupApproved\Run\GameAgenda`, que el desinstalador tampoco borra: no arranca nada, pero queda en el registro.
- Mal, porque un atajo pulsado antes de que React monte la página (en el primer segundo tras abrir la app) muestra la ventana sin abrir la paleta.
- CA3.7, medido el 02-11-2026 con la app que instaló el usuario y `ga-web` de producción (`docs/medidas/ca3.7-20261102.md`). A petición suya, con tecleo simulado y no con una persona al teclado.
- Pendiente: CA3.8 en modo avión de verdad y con el atajo cogido por otra aplicación, con la app instalada desde `ga-web` ya desplegada.
- Pendiente: Dependabot para Cargo (§6.5). Aún no hay `.github/dependabot.yml` en el repositorio.

### Confirmación

- **Vitest, sin red ni Rust:**
  - `apps/desktop/desktop.test.ts`: sin *capabilities*, sin órdenes, sin `frontendDist`, la URL de `ga-web`, NSIS por usuario, la versión de la app, los *crates* fijados con `=` y en `Cargo.lock`, y el mismo evento en `main.rs` y en la web;
  - `apps/web/src/desktop/desktop-capture.test.ts`: el evento, el `timeStamp` y a qué pantalla va cada ruta.
- **E2E** (`apps/web/e2e/desktop.spec.ts`, Chromium y `webkit-movil`), con el evento lanzado como lo hace Tauri:
  - en `/?vista=todos`, abre la paleta con el foco, sin recargar ni perder el filtro, y apunta;
  - desde `/ajustes`, va a `/apuntar` sobre Mi lista, y Esc y Atrás vuelven;
  - con la paleta abierta, conserva el texto y devuelve el foco.
- **`cargo test`** (`apps/desktop/src-tauri`): el *script*, el atajo, los textos del menú y el filtro de origen.
- **En la app instalada (31-10-2026)**, con un *script* que no se versiona: Win32 con `SendInput` y `RegisterHotKey`, y la página por CDP con `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port`.
  - **Instalación:** instalada con `/S` en 1,6 s, sin elevar.
  - **Órdenes:** desde la página, 11 `invoke` (de `global-shortcut`, `autostart`, `window`, `webview`, `app`, `event`, `path` y `opener`, y una orden propia inventada) acaban en `not allowed by ACL`. Otra aplicación no puede registrar el atajo mientras la app lo tiene (error 1409).
  - **Atajo:** con la web de esta rama servida en local (la de producción aún no lleva el cambio), desde otra ventana delante, el atajo pone GameAgenda delante con la paleta y el foco: 10 de 10, p50 de 20 ms, en el mismo documento (sin recarga). La segunda pulsación la oculta y devuelve el foco a la otra ventana. De pulsar el atajo al aviso «Apuntado», con el texto tecleado por `SendInput`, p50 de 1,23 s.
  - **Ventana:** `WM_CLOSE` la deja en la bandeja; una segunda instancia sale con código 0 y muestra la misma ventana; el menú de la bandeja tiene el texto esperado; con el atajo ocupado por otra aplicación lo dice, y «Reintentar» lo recupera cuando se libera.
  - **Arranque:** «Iniciar con Windows» escribe y borra el valor `Run`; con `--autostart`, la ventana empieza oculta y el atajo funciona igual (20 ms).
  - **Enlaces:** «Ver en Steam» se abre en el navegador del sistema y una navegación a otro origen no sale de la ventana.
  - **Sin red:** con el servidor parado, la app arranca desde el Service Worker, busca (76 ms) y apunta, y lo conserva al reiniciar.
- **CA3.7 con producción (02-11-2026)**, en la app que instaló el usuario (`docs/medidas/ca3.7-20261102.md`):
  - el método es el mismo, con una ventana de prueba propia en lugar del Bloc de notas, y comprueba que delante está GameAgenda antes de cada tecla;
  - 10 altas a 100 ms por carácter, con 300 ms de reacción antes de Intro;
  - del atajo a «Apuntado», p50 de 1,24 s y máximo de 1,98 s; ventana delante en 28 ms (p50) y paleta con el foco en 37 ms;
  - 10 de 10 sin recargar, y la segunda pulsación oculta la ventana y devuelve el foco 10 de 10.
- **CA3.8 con producción (02-11-2026)**, en la misma app y en la segunda pantalla (`docs/medidas/ca3.8-20261102.md`):
  - **sin red** (un *proxy* muerto en WebView2 y la página «sin conexión» por CDP; la red del PC no se toca): abre, el catálogo llega a `full` en 118 ms, busca «celeste» en 4 ms, apunta y lo conserva al reiniciar;
  - **órdenes:** 6 `invoke` desde la página de producción, todas `not allowed by ACL`;
  - **atajo ocupado** por otra aplicación antes de arrancar: el menú dice «Ctrl+Mayús+Espacio lo usa otra aplicación · Reintentar»; cuando se libera, «Reintentar» lo recupera, el menú pasa a «Atajo: Ctrl+Mayús+Espacio» y el atajo pone la paleta con el foco en 40 ms.
  - **Hallazgo:** la ventana vive en la bandeja, así que una versión nueva de `ga-web` solo entra tras «Salir» o al reiniciar Windows (el Service Worker no usa `skipWaiting`). Queda para decidir.

## Pros y contras de las opciones

### 1 · `ga-web` como URL externa, sin `frontendDist`

- Bien, porque la barrera es la regla por defecto de Tauri para contenido remoto, no la disciplina de no añadir nunca nada.
- Mal, porque la URL de producción va en la ventana y `main.rs` elige `devUrl` en desarrollo: un poco más de código que dejarlo todo en `frontendDist`.

### 2 · `frontendDist` con la URL de `ga-web` (la §17.3)

- Bien, porque es lo que proponía el plan y `tauri dev` cambia de URL solo.
- Mal, porque `ga-web` sería un origen local: una *capability* local o una orden propia que se añadiera más adelante le llegarían sin aviso. CA3.8 dependería de no añadir nunca ninguna.

### 3 · Eventos de Tauri con una *capability* `remote`

- Bien, porque es el mecanismo de mensajes previsto por Tauri.
- Mal, porque abre la IPC a la página (justo lo que prohíbe CA3.8) y obliga a la web a importar `@tauri-apps/api`, que la §14.3 prohíbe.

### 4 · La web empaquetada en el binario

- Bien, porque abriría sin red desde el primer arranque.
- Mal, porque habría que publicar un instalador por cada despliegue de la web, el origen ya no sería el de `ga-web` (la cookie `__Host-`, `connect-src 'self'` y el Service Worker de M4) y la página sería local para Tauri.

## Más información

- **En `prototipe.md`:** [§17.3](../../prototipe.md#173-app-de-escritorio-envoltorio-tauri-m3) (diseño), [§15.6](../../prototipe.md#156-m3--rápida-y-ágil-v030--46-días-ideales) (CA3.7 y CA3.8), [§6](../../prototipe.md#6-stack-con-versiones) (versiones), [§12.5](../../prototipe.md#125-cicd) (el CI no compila Rust) y [§14](../../prototipe.md#14-estructura-del-repositorio) (`apps/desktop` y la regla 8).
- **Porqué:** [`DECISIONES.md`](../planificacion/DECISIONES.md), §10.16 (la app de escritorio pasa a M3).
- **Relacionados:** ADR-001 (arquitectura: un solo cliente web), ADR-002 (stack y repositorio) y ADR-003 (*hosting* de `ga-web`).
