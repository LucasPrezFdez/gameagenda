# CA3.2: restaurar el índice persistido (02-11-2026)

**Criterio** (§15.6 de `prototipe.md`): con la misma versión de catálogo, el reinicio restaura el índice sin reconstruirlo, en ≤0,4 s con CPU ×4, medido como la búsqueda (§8.9); una versión nueva lo invalida.

**Resultado: cumplido.** Del arranque a la primera consulta respondida, **162 ms** (peor de 2) con CPU ×4 y el catálogo completo, con la restauración en dos fases. La primera versión, de una sola fase, daba 275 ms (tabla de abajo).

## Dos fases (02-11-2026, por la tarde)

En el *runner* del CI, leer de IndexedDB los ≈27 MB tardaba el doble que en el PC (251–263 ms frente a 117–124), y el trabajo «Rendimiento (informa)» salía en rojo: 463 ms. Por eso:
- el pajar del nivel 3 (≈5 MB) va en otra fila de `meta` y se lee después; los niveles 0–2 responden ya con lo principal (§8.8);
- el diccionario de tokens tampoco se parte al restaurar: es una columna que recorta cada token al pedirlo, como los nombres y las claves.

| Medida (CPU ×4, catálogo completo) | Una fase | Dos fases |
|---|---|---|
| Reinicio con el índice guardado → primera consulta (peor de 2) | 275 ms | **162 ms** (159 y 162) |
| · leer lo principal de IndexedDB | 124 ms | 119 ms |
| · restaurar (decodificar y montar el buscador) | 114 ms | 73 ms |
| Pulsación → resultados en `full` (p95) | 9,2 ms | 9,3 ms |

## Primera versión, de una sola fase

| Medida (CPU ×4, catálogo completo) | Valor |
|---|---|
| Reinicio con el índice guardado → primera consulta | **275,1 ms** y 268,1 ms (peor de 2 ≤400 ms) |
| · leer el *manifest* de Cache Storage | 11 ms |
| · leer `meta.searchIndex` de IndexedDB | 124 ms |
| · restaurar (decodificar y montar el buscador) | 114 ms |
| · primera consulta («elden») | 21 ms |
| Para comparar: reinicio con caché hasta `scan`, sin índice guardado | 1 854 y 1 946 ms |
| Para comparar: reinicio con caché hasta `full`, sin índice guardado | 4 030 ms |
| Guardar el índice tras `full`, sin estrangular | 212 ms, ≈27 MB |
| App real con CPU ×4 y 500 entradas: búsqueda lista tras recargar (`search:ready`) | 782 ms |

Todo `npm run perf` pasa (16 medidas con presupuesto). La pulsación en `full` no cambia (9,2 ms de p95) ni el nivel 4 (58,5 ms).

## Método

`npm run perf`, parte 1 (`apps/web/perf/search.perf.ts`), como el resto de medidas de la búsqueda con ×4: el `createSearchHost` del Worker corre en el hilo principal de la página de prueba, porque CDP no estrangula los Workers dedicados (§8.9).
- **`persist`, sin estrangular:** un *host* con `meta.searchIndex` (en una base propia de la página de prueba) construye el índice del catálogo completo y lo guarda.
- **`restoreIndex`, con ×4, dos veces:** un *host* nuevo arranca, restaura y responde a «elden». La cifra va desde `init` hasta la respuesta. La primera vez, el código de la consulta está en frío, como en un arranque de verdad.
- **`restoreBreakdown`:** el mismo camino por fases.

Equipo: Ryzen 5 3600, Windows 11, Chromium de Playwright 1.64.1, con Discord y Steam abiertos.

## Cómo se llegó aquí

| Versión del formato | Peor de 2 | Restaurar |
|---|---|---|
| Nombres, claves y tokens como listas partidas al restaurar | 473 ms | 226 ms |
| Nombres y claves sin partir (`nameOf` y `keyOf` recortan cada fila) | 287 ms | 136 ms |
| Lo mismo, en un *chunk* diferido que no importa nada | 275 ms | 114 ms |

| Dos fases y el diccionario sin partir | 162 ms | 73 ms |

Con CPU ×4, partir los nombres costaba 74 ms; las claves base, otros 74; los tokens, 45, y decodificar el pajar, 10. Detalle en `DECISIONES.md` §10.25.

## Lo que no se ha medido

- **El Worker de verdad en el Android de referencia:** CDP no lo estrangula, así que la cifra de ×4 sale de la página de prueba. Va con el resto de medidas en el dispositivo (*issue* #1).
- **Safari:** el E2E `search-index.spec.ts` comprueba en `webkit-movil` que el reinicio restaura y busca, pero no mide tiempos.
