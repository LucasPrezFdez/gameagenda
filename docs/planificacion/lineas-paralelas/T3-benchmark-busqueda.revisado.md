## T3 · Benchmark de búsqueda — revisión crítica y nueva medición sobre el diseño elegido (D-09)

> **Equipo y fecha.** AMD Ryzen 5 3600 (6 núcleos / 12 hilos) · 16 GB · Windows 11 Pro 10.0.26200 · Node.js 24.21.0 · Microsoft Edge 156.0.4314.50 sin interfaz, controlado por CDP (`Emulation.setCPUThrottlingRate` ×1, ×4 y ×10) · 28-10-2026. **Datos reales descargados hoy** (catálogo de juegos de Steam vía `IStoreQueryService/Query`, contexto `spanish`/`ES`).

### 0. Resumen

- **El diseño D-09 cumple los presupuestos con holgura.** Por pulsación, tecleando carácter a carácter 150 nombres reales (2 084 pulsaciones): p50/p95/máx **0,03/1,9/7,4 ms** en Node; **<0,1/2,1/8,4 ms** en Edge ×1; **0,2/8,7/25 ms** a ×4; **0,3/17/66 ms** a ×10. El escaneo lineal del borrador, en las mismas condiciones: 2,5/9,3/33 ms (×1), 11/42/109 ms (×4) y 24/96/222 ms (×10).
- **Calidad con popularidad real** (nº de reseñas de Query para todo el catálogo): conjunto dorado de 98 consultas en español **top-1 94,9 % / top-5 98,0 %** (escaneo: 86,7 % / 87,8 %); 2 000 nombres exactos al azar **99,9 %** en el top-5 (escaneo: 99,3 %); prefijos de 4 letras de los 1 000 más populares **93,7 %** en el top-10 (escaneo: 94,6 %).
- **El precio es la construcción:** 0,61 s en Node; 0,70 s / 4,0 s / 10,3 s de índice en Edge ×1/×4/×10 (+ el pajar de subcadena: 0,14/0,66/1,3 s), ≈40 MiB. Sin el índice persistido y el núcleo de arranque de M3 no se llega a «búsqueda lista ≤1,5 s» en un móvil medio. Restaurar el índice desde IndexedDB: **0,15 s ×1 / 0,55 s ×4 / 1,37 s ×10**; escribirlo en IndexedDB tarda 2,7 s a ×1 (en segundo plano).
- **Tamaños (D-08 real):** núcleo `core` 7,00 MB · 3,05 MB gzip · **2,25 MB brotli 11** (2,59 MB brotli 5); núcleo de arranque de 20 000 juegos **269 KB** brotli; `aliases` **15,8 KB**. El índice serializado ocupa 19,2 MB (6,66 MB brotli): no compensa publicarlo; se construye en el cliente y se persiste.
- **Query sin clave funciona a escala:** 208 páginas, 196 684 juegos, **0 errores y 0 respuestas 429** en 624 s (una petición cada 3 s). Con `include_basic_info` cada página pesa 1,15 MB (218 KB gzip); `basic_info.short_description` supone ≈¾ del gzip y D-08 no lo usa.
- **Hallazgo de método:** el estrangulamiento de CPU por CDP **no se aplica a los Workers dedicados** (tiempo interno p95 2,4 ms a ×1 y a ×4). Las cifras ×4/×10 se midieron en el hilo principal de la página de prueba; el arnés de `npm run perf` debe hacer lo mismo.

### 1. Problemas del borrador

| # | Problema | Efecto | Corrección en esta revisión |
|---|---|---|---|
| 1 | `norm()` aplicaba NFKD **antes** de quitar ™ ® © | 645 nombres mal indexados («HELLDIVERS™ 2» → `helldiverstm 2`; «DARK SOULS™ III» perdía el nivel exacto) | ™ ℠ ® © y apóstrofos se quitan antes de NFKD (vectores en §8.1 del plan) |
| 2 | Sin ligaduras ni `&` | «Straße», «Æon», «Łódź» no se encuentran sin el carácter especial; «Ratchet & Clank» ≠ «ratchet and clank» | ß, æ, œ, ø, ł, đ (+ð, þ, ı) y `&` → `and` |
| 3 | Popularidad de SteamSpy (top 4 000 por propietarios; 3 587 casaban) | el 98 % del catálogo tenía popularidad 0: la calidad medida era la de la cabeza y el desempate en la cola era la longitud del nombre | reseñas de `Query` (`summary_filtered.review_count`) para los 196 684 juegos; 120 643 tienen ≥1 reseña |
| 4 | Consultas poco realistas: 25 finales sobre 7 superventas, 216 pulsaciones repetidas 5 veces | JIT, cachés internas y predictores calientes; nada de la cola larga, CJK ni números | conjunto realista retenido: 150 nombres estratificados por rango (50 del top 5 000, 50 del 5 000–50 000, 50 de la cola) tecleados hasta 25 caracteres + las consultas pedidas + CJK; se informa la 1.ª pasada (fría) aparte |
| 5 | Calidad sobre 22 consultas que además sirvieron para ajustar el *ranking* | sobreajuste; ningún control de regresión masivo | dorado de 98 consultas en 18 categorías + 2 000 exactos al azar + 1 000 prefijos de 4 letras |
| 6 | Memoria = `heapUsed` | no cuenta los `ArrayBuffer` (los *typed arrays* viven fuera del *heap*) | `heapUsed` + `arrayBuffers` en Node; `usedJSHeapSize` en Edge (cuenta los *typed arrays* del *renderer*) |
| 7 | Condiciones desiguales: Fuse coincidió con la prueba de navegador y había otros procesos | máximos ruidosos | ejecuciones secuenciales, mismo núcleo, misma normalización y mismo orden para los dos motores (queda ruido de fondo del PC, sobre todo en los máximos) |
| 8 | Se asumía que CDP ×4 representa el Worker | falso: el Worker no se estrangula | ×4/×10 en el hilo principal de la página; el Worker se midió aparte (ida y vuelta) |
| 9 | Corte de 100 candidatos por popularidad antes de reordenar | los exactos poco populares se pierden (99,3 % frente a 99,9 %); y, sin romanos ni nombre ES, fallan «hades 2», «dark souls 3», «civilization 6» o «mafia edicion definitiva» | niveles completos con salida temprana (§8.4 del plan) |
| 10 | Difuso en el camino de cada pulsación (política «<5 resultados») | p95 de 69 ms a ×4 en el híbrido | difuso diferido tras una pausa y medido aparte |
| 11 | Tamaños con brotli 11 y columnar por `appid` | optimistas para un CDN que comprime al vuelo y para el orden por rango de D-08 (impide deltas de `appid`) | TSV real de D-08 ordenado por rango, con gzip 6/9 y brotli 5/11 |
| 12 | Reloj del navegador | `performance.now()` está redondeado a 0,1 ms sin aislamiento de origen cruzado: los p50 <0,1 ms salen como 0 | se dice explícitamente; los p50 finos se toman de Node |
| 13 | Dataset de un espejo de GetAppList del 27-10 | sin flags, sin nombres en español; 271590 (GTA V Legacy) ausente | Query del 28-10: tipo, próximamente, acceso anticipado, adulto (descriptores 3/4), gratis, año, reseñas y nombre ES; 271590 tampoco está en Query (ES) |

### 2. Método

- **Datos.** `IStoreQueryService/Query` sin clave (§3) → TSV derivado (`appid`, nombre base de GetAppList si existe, `nameEs` si difiere, tipo, próximamente, acceso anticipado, adulto, gratis, fecha por confirmar, año, reseñas). Núcleo D-08 = 196 665 juegos de tipo 0 con nombre, **ordenados por reseñas descendentes y, a igualdad, por `appid` descendente** (más reciente primero); `pop = min(63, ⌊2·log2(reseñas+1)⌋)`; `flags` con los bits de D-08 en su orden (1 próximamente, 2 acceso anticipado, 4 adulto, 8 gratis, 16 retirado, 32 fecha por confirmar).
- **Motores.** (a) **Índice D-09** (prototipo puro en JS, reutilizable en `packages/core`): normalización, claves, diccionario ordenado + *postings* `Uint32Array` en orden de rango, índice de primera palabra, *bitsets* de 1 letra, niveles 0–4 con salida temprana; alias = 47 curados + 3 549 siglas generadas. (b) **Escaneo del borrador** (`indexOf` sobre un único string en orden de rango, 100 candidatos, reordenación por clase + 0,5·log10(reseñas), mismos alias), con la normalización corregida para que la comparación sea justa.
- **Latencia.** Cada secuencia simula una sesión de paleta (se reinicia el estado incremental). Node: 1 pasada fría + 5 calientes. Edge: 1 fría + 3 (×1), 2 (×4) o 1 (×10) calientes; la secuencia realista lleva una pasada caliente menos. Se mide `query()` completo hasta `limit` = 20 (la paleta pide 8). El nivel 4 (difuso) se mide aparte en las consultas finales que lo activan.
- **Edge.** Una pestaña nueva por escenario en el mismo navegador; ficheros servidos desde `localhost` sin caché; `--enable-precise-memory-info`, `gc()` antes de medir memoria. Persistencia: `serializeIndex()` → `ArrayBuffer` en IndexedDB; restauración en otra pestaña: lectura + `deserializeIndex()` + primera consulta.
- **Calidad.** Lista final como la vería el usuario: niveles 0–3 (≤8) y, si los niveles 0–2 dan <5, hasta 3 sugerencias difusas detrás. Exactos y prefijos con +18 visible (para no penalizar juegos ocultos por defecto).

### 3. Descarga del catálogo con Query (datos para el pipeline)

`GET https://api.steampowered.com/IStoreQueryService/Query/v1/?input_json=…` con `start` = 0, 950, 1 900… (`count` 1 000, `sort` 2, solo juegos, `spanish`/`ES`, `data_request` con `include_basic_info`, `include_release` e `include_reviews`), un solo hilo, ≥3 s entre peticiones, `Accept-Encoding: gzip`.

| Medida | Valor |
|---|---|
| Páginas / errores / 429 | 208 / 0 / 0 |
| Tiempo total | 624 s (10,4 min); respuesta media 1 255 ms |
| `total_matching_records` | 196 683 → 196 684 durante la descarga (el índice es vivo) |
| Juegos únicos / repetidos por el solapamiento | 196 684 / 10 334 |
| Bytes por página (media) | 1 153 389 B sin comprimir · **217 609 B gzip** en el cable |
| Total transferido | 239,9 MB sin comprimir · 45,3 MB gzip |
| Peso de `basic_info` | en la página 95 000, `short_description` ocupa 208 KB, editores 41 KB y desarrolladores 38 KB (sin comprimir). En tres páginas de muestra, gzip medio: 191 KB completa, **73 KB sin `basic_info`** y 51 KB sin `basic_info`, `best_purchase_option`, `categories` ni `related_items` |
| Campos | `is_coming_soon` 62 642 · `is_early_access` 19 313 · `is_free` 23 722 · descriptor 3: 9 685, descriptor 4: 10 214 (adulto = 3 o 4: 10 213) · fecha por confirmar (próximamente con `text_tba`/`text_comingsoon` o sin fecha): 44 250 · con reseñas 120 643 · máximo 9 953 844 (CS2) |
| Nombre en español distinto del base | 3 221 (1,6 %); tras normalizar, 3 110 aportan claves nuevas («Mafia: Edición Definitiva», «STAR WARS Jedi: La Orden caída™»); «The Sims™ 4» y «Middle-earth™» **no** vienen traducidos |
| Cruce con GetAppList (27-10) | 323 juegos solo en Query (altas del día y huecos), 234 solo en GetAppList; 271590 no está en ninguno |
| Rareza | 1 elemento con `type` 14 |

Implicaciones para el pipeline (a verificar en M2): no pedir `include_basic_info` (≈2,6× menos gzip; hasta ≈3,7× si además se pueden quitar `best_purchase_option`, `categories` y `related_items`); comprobar que `is_free` sigue llegando sin `basic_info` y si `data_request` admite `include_best_purchase_option: false` en Query como en `GetItems`. Con la página completa, la pasada diaria mueve ≈45 MB gzip.

### 4. Construcción, memoria y tamaños

| Medida | Node 24 | Edge ×1 | Edge ×4 | Edge ×10 |
|---|---|---|---|---|
| Parseo del TSV | 71 ms | — | — | — |
| Índice (niveles 0–2) | 610 ms (661–723 ms parseo incluido, en caliente) | 700 ms | 4 005 ms | 10 306 ms |
| «Lista» (descarga local + parseo + índice) | 0,68 s | 0,86 s | 4,56 s | 11,37 s |
| Pajar compacto del nivel 3 (después) | 111 ms | 138 ms | 660 ms | 1 324 ms |
| Memoria | 39,1 MiB (filas 7,9 + índice 18,2 + *buffers* 11,5) | 39,8 MiB | 39,8 MiB | 39,5 MiB |
| Serializar | 60 ms | — | — | — |
| Restaurar (IndexedDB + deserializar + 1.ª consulta) | 45–90 ms sin IndexedDB | **152 ms** (54 + 98) | **547 ms** (147 + 394) | 1 365 ms (368 + 987) |
| Escribir el índice en IndexedDB | — | 2 745 ms (serializar: 74 ms) | — | — |
| Escaneo: «lista» / memoria | — | 0,41 s / 53 MiB* | 1,72 s / 53 MiB* | 3,55 s / 53 MiB* |

\* En este arnés el escaneo convierte las columnas en objetos; el borrador midió 28 MB con su propio cargador. La pasada de calidad del escaneo se ejecutó a la vez que su medición a ×10 en Edge (otro núcleo): sus máximos a ×10 pueden estar algo inflados.

Estadísticas del índice: 117 849 tokens; 614 316 *postings* (3,1 tokens por juego); 209 560 entradas de primera palabra; 29 + 22 *bitsets* de 1 letra; 3 192 claves de alias; 3 110 claves en español; pajar de 3,15 M caracteres.

| Fichero | Registros | Bruto | gzip -9 | gzip -6 | brotli 11 | brotli 5 |
|---|---|---|---|---|---|---|
| `core` completo (D-08, orden por rango) | 196 665 | 6 999 253 | 3 051 664 | 3 057 273 | **2 251 845** | 2 590 012 |
| Núcleo de arranque (20 000 primeras filas) | 20 000 | 773 221 | 344 604 | 346 594 | **269 367** | 320 275 |
| `aliases` | 3 563 | 45 152 | 20 404 | 20 404 | **15 835** | 20 207 |
| Índice serializado | — | 19 230 204 | 10 621 409 | — | 6 659 825 | 9 317 784 |

Coste del orden por rango (brotli 11, mismas 196 665 filas): `[appid, name]` por `appid` con deltas 1 544 070 B; `[appid, name]` por rango 2 012 283 B; columnas de D-08 por rango sin `appid` 1 749 193 B; columnas de D-08 por `appid` + columna de rango 2 328 136 B. Es decir, el `appid` desordenado cuesta ≈0,5 MB, pero añadir una columna de rango para poder ordenar por `appid` cuesta más: el orden por rango de D-08 es la opción más pequeña de las que guardan el rango.

### 5. Latencia por pulsación

p50 / p95 / máx. en ms (pasadas calientes). En la primera columna, nº de consultas finales y de pulsaciones por pasada; en la fila del Worker, entre paréntesis, el tiempo interno.

| Conjunto | Motor | Node | Edge ×1 | Edge ×4 | Edge ×10 |
|---|---|---|---|---|---|
| Borrador (25 finales, 216 pulsaciones) | Índice D-09 | 0,04 / 2,2 / 7,2 | 0,0 / 2,2 / 8,1 | 0,2 / 10,5 / 31,6 | 0,6 / 25,0 / 84,2 |
| | Escaneo | 2,6 / 9,3 / 21,0 | 2,5 / 8,8 / 12,4 | 11,5 / 42,0 / 49,1 | 21,0 / 90,2 / 106,0 |
| Pedidas + CJK (22 finales, 111) | Índice D-09 | 0,04 / 2,4 / 6,6 | 0,1 / 2,6 / 7,8 | 0,2 / 9,6 / 30,2 | 0,8 / 24,6 / 52,4 |
| | Escaneo | 2,6 / 9,4 / 11,3 | 2,5 / 8,9 / 10,0 | 11,8 / 43,1 / 48,5 | 27,7 / 86,1 / 125,1 |
| Realista (150 nombres, 2 084) | Índice D-09 | 0,03 / 1,9 / 7,4 | 0,0 / 2,1 / 8,4 | 0,2 / 8,7 / 25,3 | 0,3 / 17,3 / 65,9 |
| | Escaneo | 2,6 / 9,8 / 27,8 | 2,5 / 9,3 / 33,2 | 11,3 / 42,4 / 108,5 | 24,5 / 96,1 / 221,8 |
| Nivel 4 diferido (32–112 consultas) | uFuzzy | 10,4 / 13,7 / 16,1 | 9,2 / 13,4 / 13,7 | 46,1 / 62,3 / 63,6 | 109,5 / 149,6 / 156,8 |
| Worker: ida y vuelta (interno) | Índice D-09 | — | 0,1 / 2,8 / 7,3 (0,0 / 2,4 / 7,1) | 0,2 / 3,2 / 9,2 (0,1 / 2,4 / 7,6) | — |

- **Pasada fría (JIT):** en Node el realista da 0,04/2,0/16,6 ms en la 1.ª pasada frente a 0,03/1,9/7,4 en caliente: el máximo es la primera compilación, el resto no cambia.
- **De dónde sale el p95:** de las pulsaciones que activan el nivel 3 (subcadena) con una clave rara, que recorre el pajar completo (≈5–6 ms en Node: «elden», «abdo», «ropu»). Las siguientes pulsaciones reutilizan el resultado completo y vuelven a microsegundos.
- **×10:** el p95 (17–25 ms) sigue por debajo de 50 ms; el máximo (52–84 ms) son pulsaciones aisladas con subcadena completa o recolección de basura.
- **Worker:** el tiempo interno no cambia de ×1 a ×4 → CDP no estrangula el Worker; la ida y vuelta añade ≈0,1–0,8 ms.

### 6. Calidad

| Conjunto | Objetivo | Índice D-09 | Escaneo |
|---|---|---|---|
| Dorado (98) top-1 / top-5 | ≥90 % / ≥95 % | **94,9 % / 98,0 %** (sin nivel 4: 90,8 % / 92,9 %) | 86,7 % / 87,8 % |
| 2 000 exactos, top-5 | ≥99 % | **99,9 %** (fallan «Cube» ×9 y «Blackout» ×7, nombres repetidos) | 99,3 % |
| Prefijo de 4 letras de los 1 000 más populares, top-10 | ≥90 % | **93,7 %** (fallan sobre todo «the ») | 94,6 % |
| Negativas (pokemon, pokémon, zelda, mario kart, fortnite, valorant) | 0 resultados de nivel 0–1 | 6/6 (zelda: 2 subcadenas + 3 sugerencias difusas) | 6/6 |

Por categorías (D-09): exactas 30/30, siglas 12/12, alias 5/5, nombres ES 4/4, romanos 5/5, apóstrofo 7/7, artículo 3/3, diacríticos 2/2, compuestos 2/2, sin espacio 1/1, erratas 4/5 top-1 y 5/5 top-5. El escaneo falla romanos (0/5), nombres ES (1/4), compuestos (0/2) y «eldenring».

Pulsaciones hasta el top-5 / top-1 (D-09): Elden Ring 1/1; The Witcher 3, Cyberpunk 2077, Hollow Knight, Baldur's Gate 3, Counter-Strike 2, GTA V, Hades y Stardew Valley 1/2; «los sims 4» 5/6.

**Lo que D-09 no resuelve (top-1 fallados):** «hollow» (puesto 6: «Hollow» y dos «The Hollow» son exactos), «apex» (2: «Apex» exacto), «wukong» (**12**: «Wukong» exacto + 10 títulos que empiezan por «wukong» por delante de Black Myth: Wukong, nivel 2), «counter strike» (2: «Counter-Strike» exacto antes que CS2) y «witchr» (5, como sugerencia). Variantes medidas (no son D-09):

| Variante | Dorado top-1 / top-5 | Exactos | Prefijo 4 |
|---|---|---|---|
| D-09 estricto | 94,9 % / 98,0 % | 99,9 % | 93,7 % |
| Exacto siempre primero; niveles 1–2 por `pop` + 6 (nivel 1) / 0 (nivel 2) | 94,9 % / 99,0 % («wukong» 12 → 2) | 99,9 % | 93,2 % |
| Puntuación única `pop` + 12/6/0/−6 por nivel | 99,0 % / 100 % | **97,8 %** (incumple ≥99 %) | 94,1 % |

### 7. Conclusiones

1. **Mantener D-09** tal cual para M1: cumple latencia (p95 ×4 ≈ 9–11 ms frente a 50 ms de presupuesto) y las tres puertas de calidad.
2. **Construcción:** 4,0 s a ×4 y 10,3 s a ×10 confirman que M3 necesita el núcleo de arranque (10 % de las filas → ≈0,4 s a ×4, estimado) y el índice persistido. La restauración actual (0,55 s a ×4) supera el objetivo de 0,4 s: guardar los *bitsets* y decodificar nombres bajo demanda (a verificar en M3).
3. **Perf en CI:** medir el núcleo de búsqueda en el hilo principal de una página de prueba, porque CDP no estrangula Workers; el Worker real se valida en el Android de referencia.
4. **Nivel 4:** 46/62 ms a ×4 y 110/150 ms a ×10 bloquean el Worker si el usuario vuelve a teclear → trocear en bloques de 20 000 nombres y abandonar ante un `seq` nuevo.
5. **Propuesta para evaluar en M1 con el dorado** (no cambia D-09 hasta medir con usuarios): dejar que la popularidad cruce entre los niveles 1 y 2 sin tocar el exacto; mejora «wukong» sin coste en exactos.
6. **Pipeline:** quitar `include_basic_info` de Query; 271590 (GTA V Legacy) no sale ni en GetAppList ni en Query (ES): se cubre con «pegar enlace» y la resolución de M4.

### 8. Reproducibilidad

Código y salidas en `C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Programacion-GameAgenda\8bfa44f3-e578-483c-8387-cce517f4f6a7\scratchpad\t3`:
- `src/fetch_query.mjs` (descarga), `src/derive_tsv.mjs` (TSV derivado), `src/catalog.mjs` y `src/prep.mjs` (núcleo, arranque, alias), `src/search-core.mjs` (prototipo D-09), `src/engines.mjs` (D-09 y escaneo), `src/golden.mjs` (dorado y secuencias), `src/bench_node.mjs` (`build`, `latency`, `quality`), `src/edge_driver.mjs` + `browser/` (Edge por CDP).
- Datos en `data/` (páginas de Query y `derived/catalog_es.tsv`); resultados en `out/node/*.json`, `out/edge/results.json`, `out/files/` (núcleo, arranque, alias, tamaños).
- uFuzzy 1.0.19 tomado de la instalación del benchmark anterior (`…\56497ade-…\scratchpad\bench\app\node_modules`).
