# CA4.6 · CPU de la micro-API en producción (panel de Workers, 27-11-2026)

**Criterio (§15.7), desde el 27-11-2026:** en producción, durante al menos una semana de uso, mediana ≤5 ms por petición y ninguna cortada por pasarse de CPU (`exceededCpu`). El p99 se apunta, pero no decide (DECISIONES §10.60). **Con él, CA4.6 se cumple:** mediana de 2,4 ms y ninguna cortada en 206 peticiones.

**El criterio de antes:** CPU del Worker ≤5 ms por petición en el p99. El límite gratuito es de 10 ms.

**Resultado con el criterio de antes: no se cumple.** Del 16 al 27-11-2026, `ga-web` atendió 206 peticiones HTTP. El p50 es de 2,4 ms, pero el p99 llega a 19,1 ms. Sin la prueba del 16-11 y sin la importación de Steam, el p99 baja a 13,0 ms, y en la tarde más tranquila se queda en 9,0 ms. Aun así, no se cortó ninguna petición: las 206 acabaron en `success`, sin errores, sin excepciones y sin `exceededCpu`.

Esto sustituye a la primera muestra (`ca4.6-20261116-produccion.md`), que se tomó con `wrangler tail` y solo 22 peticiones.

## Cómo se ha medido

- **Fuente:** la API GraphQL de analítica de Cloudflare (`https://api.cloudflare.com/client/v4/graphql`), con el conjunto `workersInvocationsAdaptive` filtrado por `scriptName: "ga-web"`. Es lo mismo que enseña el panel de Workers en `ga-web` › Métricas. La consulta se lanzó con el *token* OAuth de `cf` 0.15.0 (ámbito `account-analytics.read`), porque `cf` no tiene un comando de GraphQL y Wrangler no da la analítica de Workers.
- **Periodo:** del 16-11-2026 a las 00:00 UTC al 28-11-2026 a las 00:00 UTC. Antes del 16-11, la micro-API no existía.
- **Qué cuenta:** solo las invocaciones `fetch`. Los ficheros estáticos no llegan al Worker (`run_worker_first` solo cubre `/api/*`), así que son peticiones a la micro-API: la sincronización, las llaves, las cuentas, Steam, `resolve` y las pruebas de humo, que esperan un 404. El cron (`eventType: "cron"`) va aparte.
- **Sin datos personales:** la consulta agrega por hora, estado HTTP y versión. No trae IP, rutas ni cabeceras.
- **Sin desglose por ruta:** este conjunto no tiene la ruta de la petición, y `ga-web` no tiene Workers Logs. Lo que se sabe de cada ruta se deduce de la hora, del estado HTTP y de las subpeticiones.

La consulta (con `$a` = el id de la cuenta de `ga-web`, `$start` y `$end`):

```graphql
query($a: string!, $start: Time!, $end: Time!) {
  viewer { accounts(filter: {accountTag: $a}) {
    workersInvocationsAdaptive(limit: 100, filter: {scriptName: "ga-web", datetime_geq: $start, datetime_lt: $end}) {
      dimensions { eventType status }
      sum { requests errors cpuTimeUs subrequests }
      quantiles { cpuTimeP50 cpuTimeP75 cpuTimeP90 cpuTimeP95 cpuTimeP99 cpuTimeP999 startupCpuTimeUsP99 wallTimeP99 }
    }
  } }
}
```

Los cuantiles de CPU vienen en microsegundos. Para quitar un tramo de tiempo se añade `OR: [{datetime_lt: …}, {datetime_geq: …}]` al filtro, y para agrupar por hora, `datetimeHour`, `httpResponseStatus` y `scriptVersion` en `dimensions`.

## Tablas

### Todo el periodo (CPU en ms)

| Invocaciones | Número | Estado | p50 | p75 | p90 | p95 | p99 | p99,9 |
|---|---|---|---|---|---|---|---|---|
| HTTP (`fetch`) | 206 | todas `success`, 0 errores | 2,4 | 3,9 | 7,9 | 11,9 | 19,1 | 31,5 |
| Cron | 2 015 | todas `success`, 0 errores | 1,4 | 1,8 | 2,4 | 2,7 | 3,5 | 4,5 |

- **Arranque de un *isolate*** (`startupCpuTimeUs`, aparte de la CPU de la petición): p99 de 67 ms en `fetch` y de 84 ms en el cron.
- **Tiempo de pared** p99 de 666 ms en `fetch`, por D1 y por las llamadas a Steam.
- **Cron:** 288 al día (la purga de Steam cada 5 min, desde el 20-11) más el diario, de 1,4 ms de mediana.

### Por tramos (HTTP, CPU en ms)

| Tramo | Peticiones | p50 | p75 | p90 | p95 | p99 |
|---|---|---|---|---|---|---|
| Todo | 206 | 2,4 | 3,9 | 7,9 | 11,9 | 19,1 |
| Sin la importación de Steam (21-11, de 11:00 a 12:00 UTC) | 158 | 2,5 | 4,1 | 7,4 | 10,6 | 14,4 |
| Uso real: desde el 17-11 (sin la prueba del 16-11) y sin la importación | 105 | 2,4 | 3,4 | 6,7 | 9,0 | 13,0 |
| La importación de Steam (48 peticiones y 84 subpeticiones) | 48 | 2,2 | 3,5 | 8,5 | 19,1 | 31,5 |
| La tarde más tranquila (21-11, de 15:00 a 17:00 UTC), con una sola versión | 55 | 1,9 | 2,5 | 3,1 | 5,5 | 9,0 |

### Por días (HTTP, CPU en ms)

| Día | Peticiones | p50 | p99 | Qué hubo |
|---|---|---|---|---|
| 16-11 | 53 | 2,9 | 14,4 | El despliegue de M4 y la prueba de la micro-API (tres pasadas) |
| 17-11 | 1 | 4,1 | 4,1 | Una prueba de humo |
| 20-11 | 9 | 5,3 | 9,6 | Los despliegues de Steam (partes 2 y 3) |
| 21-11 | 128 | 2,1 | 24,9 | El primer inicio de sesión con Steam, la importación y el uso de la tarde |
| 26-11 | 15 | 3,1 | 13,0 | El despliegue de las cuentas y su prueba (un `invalid_login`, de 13,0 ms) |

## Lectura

- **En caliente, cabe:** la mediana se queda en 2–3 ms todos los días, como en la estimación local (`ca4.6-20261108.md`, peor p99 de 2,38 ms). En la tarde del 21-11, con una sola versión desplegada y uso seguido, el p95 es de 5,5 ms.
- **La cola es de peticiones frías.** Con 19 peticiones al día de media y 15 versiones desplegadas en 11 días, muchas peticiones son la primera de su ruta en un *isolate*, y esa primera vez compila el código de la ruta (Hono, Zod y `applyOps()` de `core`). Así lo indican las horas: la única petición de las 14:00 del 21-11, justo después de desplegar, gastó 16,1 ms, y el `invalid_login` del 26-11, también recién desplegado, 13,0 ms.
- **La importación de Steam es lo más caro:** en esa hora, el p99 llega a 31,5 ms. Son las peticiones de logros (hasta 40 juegos cada una, con una llamada a Steam por juego) y las de la biblioteca. Para Steam, el ADR-012 pedía un p99 por debajo de 10 ms, y tampoco se cumple.
- **El plan gratuito no cortó nada,** ni las peticiones de 31 ms. Aun así, Cloudflare no promete dejar pasar siempre lo que supere los 10 ms. Si algún día aparecen errores `exceededCpu` (el error 1102), la importación de Steam sería lo primero en fallar.
- **Con tan poco tráfico, el p99 es casi un máximo:** con 206 peticiones, el p99 son las 2 o 3 más caras. Más uso con varios dispositivos bajaría la parte fría, pero no la de Steam.

## Siguiente

**Decidido el 27-11-2026 (DECISIONES §10.60):** las opciones 1 y 3. El criterio cambia como dice la 3, y el Worker prepara al arrancar el *router* y los esquemas de Zod (`apps/web/worker/warm-up.ts`); en local, la primera petición baja de 7,5 a 4,6 ms. Queda repetir la consulta una semana después de desplegarlo.

Las opciones que se dieron (DECISIONES §10.59):

1. **Abaratar las rutas en frío, empezando por Steam:** medir en local la primera petición de cada ruta en un *isolate* nuevo (con `scripts/api-cpu.ts` en frío y un perfil de CPU de `workerd`), y quitar lo que se prepara en la primera llamada.
2. **Ver la CPU por ruta en producción** encendiendo Workers Logs (`observability` en `wrangler.jsonc`). Guarda los metadatos de cada petición (la ruta y el país, entre otros) durante 3 días, así que pediría tocar la política de privacidad y el registro de actividades.
3. **Ajustar el criterio:** el p99 de ≤5 ms, solo para las peticiones en caliente, y para las frías, que no haya ningún `exceededCpu`.
