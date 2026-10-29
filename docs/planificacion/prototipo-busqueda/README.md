# Prototipo de búsqueda medido (28-10-2026)

Código JavaScript puro con el que se midió la búsqueda descrita en la §8 de `prototipe.md`, sobre el catálogo real de Steam descargado ese día sin clave con `IStoreQueryService/Query` (196 684 juegos, 208 páginas, sin ningún 429). Es el **punto de partida de M1**: se porta a TypeScript en `packages/core/src/search/`.

| Fichero | Qué es |
|---|---|
| `src/search-core.mjs` | Normalización, claves, índice de prefijos en *typed arrays*, niveles de *ranking* y siglas |
| `src/engines.mjs` | Motor del índice y motor de escaneo lineal (el puente de M1) con la misma interfaz |
| `src/catalog.mjs`, `src/prep.mjs` | Lectura y escritura del núcleo TSV y de los alias; preparación de los ficheros |
| `src/golden.mjs`, `src/vectors.mjs` | Conjunto dorado (98 consultas), negativas y vectores de normalización |
| `src/fetch_query.mjs`, `src/derive_tsv.mjs` | Descarga del catálogo con Query (≥3 s entre peticiones) y derivación del TSV |
| `src/bench_node.mjs`, `src/edge_driver.mjs`, `browser/` | Banco de pruebas en Node 24 y en Edge (CDP, CPU ×1/×4/×10) |
| `resultados/` | Resultados en JSON (latencias, calidad, tamaños y estadísticas de la descarga) |

El núcleo medido y sus alias están congelados en `fixtures/catalog-frozen/` (`core.20261028.1.tsv.gz` y `aliases.20261028.1.tsv`), que son también la entrada de las puertas de calidad de búsqueda en CI.

Uso (los scripts reciben las rutas como argumentos; los datos descargados no se ejecutan nunca):

```text
node src/fetch_query.mjs <carpetaDatos>            # ≈11 min; una petición cada ≥3 s
node src/derive_tsv.mjs <carpetaDatos> <applist.json> <catalogo.tsv> <stats.json>
node src/prep.mjs <catalogo.tsv> <carpetaFicheros>  # núcleo, núcleo de arranque y alias
node src/bench_node.mjs <modo> <carpetaFicheros> <salida.json> [d09|scan]
```

`uFuzzy` 1.0.19 (`@leeoniya/ufuzzy`) es la única dependencia, para el nivel 4.
