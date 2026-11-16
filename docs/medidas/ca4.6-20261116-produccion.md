# CA4.6 · CPU de la micro-API en producción (primera muestra, 16-11-2026)

**Criterio (§15.7):** CPU del Worker ≤5 ms por petición en el p99. El límite gratuito es de 10 ms.

**Resultado:** todavía no se puede dar por cumplido. Con muy poco tráfico, casi cada ruta cae en un *isolate* frío, y la primera petición de una ruta en un *isolate* gasta de 9 a 14 ms. Las siguientes, de 1 a 4 ms. Ninguna petición fue cortada: todas dieron `outcome: ok`. Lo que cierra CA4.6 sigue siendo el p99 del panel de Workers tras un tiempo de uso real.

## Cómo se ha medido

- **Versión:** `ga-web` `241ab113`, la del segundo despliegue de M4 (`deploy-web` 43965893460). D1 `ga-agenda` en la UE.
- **Tráfico:** un *script* desde el PC hace tres veces un recorrido entero: activar, subir 4 operaciones (apuntar un juego), pedir un código, canjearlo en otro «dispositivo», bajar lo apuntado, listar los dispositivos, borrarlo todo y comprobar el 401. Son 24 peticiones (8 por pasada). No dejó nada en D1: se comprobó al final, con todas las tablas a 0.
- **Medida:** `wrangler tail ga-web --format json` durante las tres pasadas; el campo `cpuTime` de cada evento. Los ficheros del `tail` llevaban la IP del PC y se borraron.

## Tabla (CPU en ms, por petición y en orden)

| Ruta | Peticiones | CPU (ms) |
|---|---|---|
| `POST /api/v1/agenda` (activar) | 3 | 9, 11, 2 |
| `POST /api/v1/sync` | 9 | 14, 4, 1, 12, 4, 2, 12, 3, 1 |
| `POST /api/v1/pairing` | 3 | 5, 7, 3 |
| `POST /api/v1/pairing/redeem` | 3 | 4, 9, 3 |
| `GET /api/v1/devices` | 2 | 2, 2 |
| `POST /api/v1/agenda/delete` | 2 | 3, 4 |

El `tail` recogió 22 de las 24 peticiones: le faltan una lista de dispositivos y un borrado (`wrangler tail` puede perder eventos). Las 9 de `sync` incluyen las 3 que dan 401 tras el borrado.

## Lectura

- **En caliente, cabe con holgura:** de 1 a 4 ms, en línea con la estimación local (`ca4.6-20261108.md`, peor p99 de 2,38 ms).
- **La primera petición de cada ruta** en un *isolate* pasa del criterio y, en `sync` y al activar, también de los 10 ms del límite. Es más que los ≈6 ms medidos en local: en `workerd` cuenta también compilar el código de esa ruta (Hono, Zod y `applyOps()` de `core`). Con tráfico de verdad, un *isolate* atiende muchas peticiones y estas primeras pesan poco en el p99. Con 22 peticiones repartidas, pesan casi todo.
- **El plan gratuito no las cortó.** Si el panel enseñara errores `exceededCpu` o un p99 por encima de 10 ms con uso real, habría que abaratar el arranque de esas rutas.

## Siguiente

Mirar el p99 de «CPU time» en el panel de Workers (`ga-web` › Métricas) tras una semana de uso con varios dispositivos, y apuntarlo aquí.
