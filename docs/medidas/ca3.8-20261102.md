# CA3.8: la app de escritorio sin red y con el atajo ocupado (02-11-2026)

**Criterio** (§15.6 de `prototipe.md`): tras una primera apertura con red, la app de escritorio abre, busca y apunta en modo avión; la página de `ga-web` no puede invocar ninguna orden de Tauri; si otra aplicación ya usa el atajo, el menú del icono de la bandeja lo indica en lugar de fallar en silencio.

**Resultado: cumplido**, con el modo avión simulado solo para la app (ver «Método»). Lo hizo el asistente a petición del usuario («pruébalo tú en segundo plano en la segunda pantalla»), en la app que instaló el usuario (0.2.0) y contra producción.

## Sin red

| Paso | Resultado |
|---|---|
| Primera apertura, con red | El catálogo llega a `full` (`20261102.1`). El Service Worker instala la versión del día (`index-DVWpP37Q.js`), que entra en el arranque siguiente |
| Arranque sin red | Abre desde el Service Worker; una petición a `ga-web` falla (`TypeError: Failed to fetch`) |
| Recarga con `navigator.onLine` en `false` | El catálogo llega a `full` en 118 ms, con el índice guardado. Sale el aviso «Sin conexión. Puedes seguir apuntando: tus cambios se guardan en este dispositivo.» |
| Buscar y apuntar | `Ctrl+K` y «celeste»: Celeste sale la primera a los 4 ms de la última tecla. Con Intro, «Apuntado en Quiero jugar: Celeste» |
| Reinicio sin red | Celeste sigue en Mi lista, en IndexedDB y a la vista; `full` en 158 ms |
| Limpieza | Quitada con «Quitar de mi lista», también sin red. Mi lista queda como estaba: Dota 2 y Counter-Strike 2 |

## Órdenes de Tauri

La página tiene `__TAURI_INTERNALS__` (lo inyecta Tauri), pero las 6 llamadas acaban en `not allowed by ACL`:
- `plugin:global-shortcut|is_registered`;
- `plugin:autostart|is_enabled`;
- `plugin:app|version`;
- `plugin:window|title`;
- `plugin:event|emit`;
- una orden inventada, `ca38_inventada`.

## El atajo ocupado

| Paso | Resultado |
|---|---|
| Otra aplicación coge `Ctrl+Mayús+Espacio` y luego arranca GameAgenda | El atajo sigue siendo de la otra (al intentar registrarlo, error 1409) |
| Pulsar el atajo | Le llega a la otra aplicación; GameAgenda sigue oculta, sin ningún error a la vista |
| Menú de la bandeja | «Abrir» · **«Ctrl+Mayús+Espacio lo usa otra aplicación · Reintentar»**, que se puede pulsar · «Iniciar con Windows» · «Salir» |
| La otra aplicación lo suelta y se elige «Reintentar» | GameAgenda lo coge (otro intento de registrarlo da 1409). El menú pasa a «Atajo: Ctrl+Mayús+Espacio», en gris |
| Pulsar el atajo | GameAgenda, delante a los 36 ms; la paleta, con el foco a los 40 ms. La segunda pulsación la oculta y devuelve el foco a la ventana de antes. A la otra aplicación ya no le llega nada |
| «Salir» | La app se cierra |

El texto de ayuda del icono no se pudo leer: el icono está en los ocultos de la bandeja.

## Método

Dos *scripts* que no se versionan, como los de CA3.7: un ayudante de PowerShell con Win32 y uno de Node con Playwright `connectOverCDP`.
- **La red:** el asistente no apaga la red del PC, porque se cortaría también la suya. Se la corta solo a la app:
  - WebView2 arranca con `--proxy-server=http://127.0.0.1:9`, un *proxy* que no existe, así que toda petición falla;
  - por CDP, la página pasa además a «sin conexión» (`navigator.onLine` en `false`, que es lo que mira la app para el aviso) y se recarga así.

  La diferencia con el modo avión de verdad es que Windows no avisa de ningún cambio de red. La app no lo usa: mira `navigator.onLine` y si las peticiones fallan, y aquí pasan las dos cosas.
- **La segunda pantalla:** la app arranca oculta (`--autostart`). La ventana se pasa a la segunda pantalla antes de mostrarla, con el mismo mensaje que el clic en el icono, y el foco vuelve enseguida a la ventana que lo tenía.
- **«Otra aplicación»:** el ayudante registra el atajo con `RegisterHotKey` antes de arrancar GameAgenda y cuenta las pulsaciones que le llegan.
- **El menú, sin tocar el ratón:**
  - el ayudante manda a la ventana del icono el mensaje de la bandeja al soltar el botón derecho, y el menú se abre como con un clic;
  - lo lee con `MN_GETHMENU` y `GetMenuItemInfo` y lo cierra;
  - «Reintentar» y «Salir» se eligen con el `WM_COMMAND` que mandaría el menú.
- **La página, por CDP:** WebView2 con `--remote-debugging-port=9333`, en `127.0.0.1` y solo durante la prueba.
- **Al acabar:** la app queda cerrada, como estaba, con el puerto cerrado y el atajo libre. «Iniciar con Windows» no se tocó y sigue desactivado.

## Hallazgo: la app de escritorio tarda en ponerse al día

Al empezar, la app cargó una versión anterior de `ga-web` (`index-CVMtonbU.js`), aunque producción ya servía otra. El Service Worker no usa `skipWaiting`: una versión nueva se instala y espera a que no quede ninguna ventana de la app.
- **En el navegador,** eso pasa al cerrar la pestaña.
- **En la app de escritorio,** la ventana sigue viva en la bandeja. La versión nueva solo entra después de «Salir» o de reiniciar Windows, y con «Iniciar con Windows» va siempre un reinicio por detrás.

No afecta a CA3.8: el catálogo sí se pone al día solo (pasó de `20261101.1` a `20261102.1` en la primera apertura). **Resuelto el mismo día,** a petición del usuario (DECISIONES §10.29):
- la versión nueva entra al recargar, con la ventana 1 minuto en la bandeja y nada a medias;
- la app de escritorio oculta también el WebView, para que la página sepa que está oculta.
