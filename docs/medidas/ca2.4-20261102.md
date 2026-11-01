# CA2.4 en producción: la actualización de un cliente con el catálogo de ayer (02-11-2026)

**Criterio** (§15.5 de `prototipe.md`). Un cliente con un núcleo de ≤7 días descarga solo el *manifest*, los recientes y, si cambiaron, los alias y el índice de *shards*: como mucho 200 KB transferidos (comprimidos; en régimen, ≈75 KB con brotli) y sin tareas largas. Tras un despliegue, un cliente con el *manifest* anterior sigue funcionando.

**Resultado: cumplido.** Baja 34,5 KB en 4 ficheros, sin núcleo y sin tareas largas en el hilo principal.

## Método

- **Cliente.** `npm run smoke:web -- --profile=<perfil>`: el Chromium de Playwright 1.64.1, sin estrangular la CPU, en el PC de desarrollo, contra <https://ga-web.gameagenda.workers.dev> (app 0.2.0).
- **Perfil.** Se sembró el 31-10-2026 a las 15:43 UTC con el catálogo `20261031.1`, y `meta.catalog` quedó con `checkedAt` a las 15:43:18 UTC. Se ha medido con copias de ese perfil, el 01-11-2026 a las 23:08 y a las 23:10 UTC (00:08 y 00:10 del 02-11 en Madrid), unas 31,5 h después. Como han pasado más de 12 h, la primera visita comprueba el *manifest* (§5.3).
- **Catálogo publicado.** `20261101.1`, de la primera ejecución programada de `catalog.yml` (41301033690, en verde). Trae 197 874 juegos, 3 563 alias (uno más que la anterior) y 93 recientes, y conserva los 1 003 ficheros que solo tenía la versión `20261031.1`.
- **Qué se cuenta.**
  - **Lo transferido:** la suma de `responseBodySize` (el cuerpo codificado, tal como llega) de las peticiones a `ga-catalog` que terminan en la primera visita. Llega hasta que la app apunta la comprobación en `meta.catalog` y usa ya la versión nueva.
  - **Las tareas largas:** las de un `PerformanceObserver` de `longtask` en la página, desde que el catálogo llega a `full` hasta que se adopta la versión nueva.
  - **El desglose por fichero:** sale aparte, con `curl` y `Accept-Encoding: br, gzip`.

## Resultados

| Ejecución | Perfil | `full` (caché) | Comprobación | Versión nueva | De `ga-catalog` | Núcleo | Tareas largas |
|---|---|---|---|---|---|---|---|
| A | `.cache/smoke-try` | 1,1 s | ≤1,5 s tras `full` | `20261101.1` | 4 ficheros, 34,5 KB | no | sin medir |
| B | `.cache/smoke-try2` | 1,1 s | ≤1,5 s tras `full` | `20261101.1` | 4 ficheros, 34,5 KB | no | 0 |

En las dos, la segunda visita abre desde el Service Worker sin pedir el *manifest*, sin red el catálogo llega a `full` y no hay errores de JavaScript.

| Fichero | Con `curl` (br) |
|---|---|
| `manifest.json` | 593 B |
| `aliases.2b92bdec2aa299cf.tsv` (los alias cambiaron) | 20 550 B |
| `recent.53583ab8a42e656b.tsv` (93 filas) | 1 831 B |
| `details/index.7e746251d6fe89bc.json` | 9 780 B |
| **Total** | **32 754 B (32,0 KB)** |

Chromium cuenta 2,5 KB más que `curl`. La diferencia no se ha investigado: no cambia el resultado, y los dos quedan muy por debajo de los 200 KB y de los ≈75 KB de régimen.

**«Un cliente con el *manifest* anterior sigue funcionando».** No se mide aquí. Lo cubren `assemble-catalog` y la prueba de humo del pipeline, y el registro de 41301033690 lo confirma («conserva la versión 20261031.1: 1003 ficheros solo suyos»).

## Incidencias

1. **Fallo falso de `smoke:web`.** La primera ejecución, con el perfil original (`.cache/smoke-web`), no vio la comprobación en la primera visita: 0 ficheros de `ga-catalog`, y en cambio la segunda visita pidió el *manifest*.
   - **Causa:** la prueba solo esperaba 1,5 s tras `full` y luego navegaba. La comprobación termina al apuntarse en `meta.catalog`, después de bajar los ficheros, y esta vez no le dio tiempo. La navegación cortó el Worker y la segunda visita volvió a comprobar.
   - **Arreglo:** con un perfil al que le toca comprobar, `smoke-web.ts` espera ahora a que cambie `meta.catalog` (hasta 60 s) y a que el catálogo nuevo esté en uso (hasta 120 s). Después aplica CA2.4: ≤200 KB, sin núcleo y sin tareas largas.
   - **Consecuencia:** ese perfil quedó gastado. Por eso se ha medido con copias de la que se hizo antes de la ejecución.
2. **Perfiles en rutas largas.** Una copia del perfil en el *scratchpad* (una carpeta de 152 caracteres, con ficheros de hasta 291 dentro) daba `net::ERR_FAILED` en la primera visita. La misma copia, en `.cache/`, iba bien. Parece el límite de 260 caracteres de Windows (MAX_PATH).
   - `smoke-web.ts` avisa si la ruta del perfil pasa de 120 caracteres.
   - Con la página sin abrir, la prueba se rompía al leer `navigator.serviceWorker`; ya no.

## Para la próxima vez

- `.cache/smoke-web-20261031` guarda el perfil tal como se sembró (catálogo `20261031.1`, sin usar). No se versiona.
- **La otra rama de la regla de los 7 días.** Con la publicación `20261108.1` o una posterior, una copia de ese perfil tiene un núcleo de 8 días o más, así que debería bajar el núcleo nuevo (§5.4).
- Para no gastarlo, se mide siempre sobre una copia en una ruta corta, por ejemplo `cp -r .cache/smoke-web-20261031 .cache/smoke-try3`.
