# CA4.6 · CPU de la micro-API por petición (estimación local, 08-11-2026)

**Criterio (§15.7):** CPU del Worker ≤5 ms por petición en el p99. El límite gratuito es de 10 ms.

**Resultado en local:** se cumple. El peor p99 es de 2,38 ms, en `sync` al subir un lote de 200 operaciones. La medida en producción, que es la que cierra CA4.6, se hace en la parte 5, en el panel de Workers (CPU time, p99), con D1 ya creada.

## Cómo se mide

`node scripts/api-cpu.ts` llama a cada ruta con la misma `createApp()` que el Worker, en V8 (Node 24.21), sobre la D1 de las pruebas (`node:sqlite`).

- **Se resta el tiempo de D1:** en Workers, D1 es otra máquina y su tiempo no es CPU del Worker.
- **«En caliente»:** 300 peticiones tras 30 de calentamiento, en el mismo proceso.
- **«Primera»:** la primera petición de esa ruta en un proceso nuevo.
  - Antes se cargan `Request`, `Response` y WebCrypto. En Node se cargan la primera vez que se usan (≈23 ms medidos), y en `workerd` son nativos.
  - En «crear agenda» y en «`resolve` que pregunta», es además la primera petición del proceso. Ahí se nota lo que Hono y Zod preparan la primera vez.
- **Sesgos:**
  - Optimista: lo que la D1 de las pruebas hace en JavaScript al montar las filas cuenta como D1, y en Workers lo haría el Worker al recibirlas.
  - Pesimista: el `crypto.subtle` de Node va a otro hilo, y aquí se cuenta su espera.
- **El equipo:** Windows 11. No había ningún juego abierto, pero no se miró la carga de la CPU.

## Tabla

| Petición | p50 (ms) | p99 (ms) | Máx. (ms) | Primera (ms) |
|---|---|---|---|---|
| Activar la sincronización (crear agenda) | 0,27 | 1,12 | 1,52 | 6,62 |
| Pedir un código de emparejamiento | 0,17 | 0,87 | 1,70 | 1,08 |
| Canjear un código de emparejamiento | 0,34 | 1,52 | 1,91 | 2,11 |
| Lista de 6 dispositivos | 0,10 | 0,17 | 1,23 | 0,41 |
| `sync` sin cambios (agenda de 1 000 juegos, al día) | 0,15 | 0,25 | 3,25 | 0,34 |
| `sync` que sube un lote de 200 operaciones (50 juegos nuevos) | 1,44 | 2,38 | 2,68 | 1,97 |
| `sync` que baja una página de 1 000 cambios | 1,38 | 2,22 | 6,88 | 2,01 |
| El Atajo de iOS deja un enlace | 0,16 | 0,27 | 0,38 | 1,31 |
| `resolve` con el nombre en la caché | 0,08 | 0,19 | 5,09 | 0,64 |
| `resolve` que pregunta a Steam (falso, sin esperar) y guarda | 0,15 | 0,27 | 0,48 | 5,89 |

## Lectura

- **En caliente, todo cabe:** el p99 más alto es 2,38 ms. Las dos rutas de `sync` con trabajo de verdad rondan los 1,4 ms de p50. Las demás no pasan de 0,4 ms.
- **Los máximos aislados** (6,88 ms al bajar 1 000 cambios y 5,09 ms en `resolve` desde la caché) son una petición entre 300, y no se repiten de una pasada a otra. Coinciden con recolecciones de basura de V8.
- **La primera petición de un *isolate* nuevo** cuesta ≈6 ms: Hono monta su *router* y Zod valida por primera vez. Pasa de los 5 ms del criterio, pero no de los 10 del límite. Además, solo ocurre una vez por *isolate* nuevo, así que en el p99 de producción pesa poco: un *isolate* atiende muchas peticiones.
- **Si en producción el p99 pasara de 5 ms,** lo primero es `sync` con lotes de 200. La palanca es `SYNC_BATCH_SIZE`, que ya bajó de 500 a 200 por esto (ADR-011).

## Pendiente

- La medida en producción, en la parte 5: el panel de Workers da los percentiles de CPU por invocación. Con unas 50 sincronizaciones reales de dos dispositivos, más el Atajo y `resolve`.
