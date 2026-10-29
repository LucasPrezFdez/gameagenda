## T3 · Benchmark empírico: búsqueda instantánea sobre el catálogo completo de Steam

> **Equipo y fecha.** AMD Ryzen 5 3600 (6 núcleos / 12 hilos, 2019) · 16 GB de RAM · Windows 11 Pro 10.0.26200 · Node.js v24.21.0 (V8 13.6) · `node:sqlite` con SQLite 3.53.4 · Microsoft Edge 156 en modo headless, controlado por CDP (`Emulation.setCPUThrottlingRate` ×1, ×4 y ×10) · 2026‑10‑28. **Datos reales**, no sintéticos.

### Resumen

- **Catálogo:** 196.577 juegos reales. Es la lista `include_games` de `IStoreService/GetAppList`, tomada de un espejo público que se publica a diario. Entran unos 250–290 juegos nuevos al día.
- **Cabe en el cliente.** `[appid, name]` ocupa 5,98 MB en bruto, **1,91 MB en brotli** y 2,64 MB en gzip. En formato columnar con deltas de appid baja a **1,54 MB brotli**. El delta diario real pesa **3,7 KB brotli**.
- **La búsqueda local ya es instantánea sin índice.** Un escaneo `indexOf` sobre un único string, ordenado por popularidad, da en Edge:
  - Escritorio: **p50 2,2 ms / p95 6,7 ms**.
  - CPU ×4 (≈ móvil de gama media): **9,7 / 33 ms**.
  - CPU ×10 (≈ gama baja): **26,5 / 89 ms**.
  - Usa unos 28 MB de heap y no hay que construir índice.
- **Los índices clásicos no compensan en móvil:**
  - FlexSearch responde en microsegundos, pero ocupa 112–180 MB y tarda en estar listo 1,9 s en escritorio, 10,7 s a ×4 y 40 s a ×10.
  - MiniSearch y Orama ya tienen en escritorio un p95 de 65 y 230 ms.
  - Fuse.js tarda unos 0,3 s por pulsación.
- **SQLite FTS5** (para Tauri o servidor), con el `rowid` igual al rango de popularidad: **p50 0,20 ms / p95 0,41 ms** y una BD de 17,4 MB.
- **La calidad depende de los datos, no del motor.** Ordenar por nº de reseñas, dar más peso a los nombres que empiezan por lo tecleado y añadir alias sube el top‑1 de 14–17/22 a **20/22** (top‑5: 21/22). Así el juego aparece en el top‑5 **con 1 pulsación** (6 de 7 juegos; GTA V con 3), frente a las 5–11 que hacen falta sin popularidad. → **Requisito de datos: nº de reseñas (o equivalente) por appid.**

### 1. Método

- **Ejecución:**
  - Cada motor corre en su propio proceso Node (`node --expose-gc`), uno detrás de otro.
  - Se prueban dos órdenes del catálogo: por `appid` (sin popularidad) y por popularidad (reseñas de mayor a menor).
- **Normalización común**, la misma en cliente y servidor:
  ```js
  const norm = s => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')
    .toLowerCase().replace(/['’‘`´ʼ]/g, '').replace(/[™®©]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  ```
  Convierte "Baldur's" → "baldurs", "Counter‑Strike" → "counter strike", "España" → "espana" y "Déjà Vu" → "deja vu", sin romper kana ni hangul.
- **Consultas.** 25 consultas tecleadas carácter a carácter, que dan **216 pulsaciones** (sin repetir las que quedan iguales tras normalizar):
  - Los 7 juegos objetivo.
  - Variantes sin puntuación: "baldurs gate 3", "counter strike 2".
  - Erratas: "witchr", "cyberpnk", "hollow knigth", "eldenring".
  - Un número: "2077".
  - Abreviaturas: "gta", "cs2".
  - Ñ y acentos: "señorita"/"senorita", "españa"/"espana", "déjà vu"/"deja vu".
  - Negativas, que no existen en Steam: "zelda", "pokemon", "pokémon".
- **Latencia.** Una pasada de calentamiento y 5 medidas (Fuse: 1) con `performance.now()`. El p50, p95 y máximo se calculan sobre **todas** las pulsaciones, incluidas las de 1–2 letras, que son el peor caso.
- **Memoria.** `heapUsed` tras un `gc()` doble, antes y después de construir el índice. En SQLite se mide el Δ de RSS, porque su memoria es nativa. En Edge se usa `performance.memory` con `--enable-precise-memory-info`.
- **Calidad.** Top‑1 y top‑5 de 22 consultas con respuesta conocida, en cuatro escalones:
  1. **Base:** el ranking del propio motor.
  2. **+prefijo:** se reordenan 100 candidatos. Primero el nombre idéntico, luego los que empiezan por la consulta, luego aquellos en que alguna palabra empieza por ella y por último el resto; a igualdad, el nombre más corto.
  3. **+popularidad:** catálogo ordenado por reseñas y `score = −clase + 0,5·log10(1 + reseñas)`.
  4. **+alias:** acrónimos automáticos de los 4.000 juegos más populares ("gta", "cs2", "bg3"…), buscados por bisección en menos de 0,01 ms.
- **Ruido.** En la máquina corrían procesos de otros agentes, y la pasada de Fuse por popularidad coincidió con la primera prueba de navegador. Los p50 son estables; los máximos pueden variar unos ms.

### 2. Dataset

| | |
|---|---|
| Fuente | [`jsnli/steamappidlist`](https://github.com/jsnli/steamappidlist) → `data/games_appid.json`. Lo genera a diario una GitHub Action que llama a `IStoreService/GetAppList/v1?include_games=true` con una clave secreta |
| Frescura | Último commit: 2026‑10‑27T04:15:29Z (`chore: autopublish`). Descargado el 2026‑10‑27T23:52Z |
| Registros | 196.595; quitando 18 sin nombre quedan **196.577**. Campos: `appid, name, last_modified, price_change_number` |
| Nombres | 16,7 caracteres de media (p95 35, máx. 414). 8,1 % no ASCII, **6,3 % CJK/hangul**, 749 con diacríticos latinos y 24 con ñ |
| Cambios reales | Del 26 al 27 de oct: +264, −8 y 17 renombrados (3,7 KB br). Del 20 al 27 de oct: +2.051, −43 y 100 renombrados (25 KB br) |
| Popularidad (solo para el test) | [SteamSpy](https://steamspy.com/api.php) `request=all`, páginas 0–3: los 4.000 juegos con más propietarios, de los que 3.587 están en la lista. Se usa `positive + negative` |

Hallazgos que afectan al plan:
- **La lista no es exhaustiva.** `271590` "Grand Theft Auto V Legacy" tiene ficha (`appdetails` devuelve `type: game`) pero no aparece; solo está `3240220` "Grand Theft Auto V Enhanced". Hay que permitir dos cosas:
  - Añadir juegos por appid o URL.
  - Crear juegos manuales. Zelda y Pokémon no están en Steam, así que la búsqueda vacía debe ofrecer "Añadir «zelda» como juego propio".
- **Los nombres cambian:** hoy es "The Witcher 3: Wild Hunt — Remastered", con raya "—". La clave tiene que ser siempre el **appid**.
- **SteamSpy tiene nombres desfasados:** para el 730 sigue diciendo "Counter‑Strike: Global Offensive". Hay que unir solo por appid.
- **Contenido adulto.** Sin popularidad, "cyberpnk" devuelve "CyberpunkXXX" y "Cyberpunk sex". Hace falta ranking por popularidad y, probablemente, filtrar ese contenido con los descriptores de contenido de `GetItems`.

### 3. Tamaños

**Snapshot JSON** (N = 196.577; gzip ‑9, brotli q11):

| Variante | Bruto | gzip | brotli | `JSON.parse` (Node) |
|---|---|---|---|---|
| `[[appid, name], …]` | 5,98 MB | 2,64 MB | **1,91 MB** | 68 ms |
| Columnar `{d: Δappid, n: names}` | 4,64 MB | 2,04 MB | **1,54 MB** | 29 ms |
| `[appid, name, reseñas?]` | 6,00 MB | 2,66 MB | 1,92 MB | 63 ms |
| Columnar + clave normalizada cuando ≠ `toLowerCase()` (53.561 nombres) | 6,59 MB | 2,77 MB | 2,02 MB | — |
| Extendida `[appid, name, año, flags, coverHash]`* | 15,81 MB | 8,17 MB | 6,53 MB | 67 ms |
| Extendida columnar* | 13,88 MB | 6,45 MB | 5,60 MB | 36 ms |
| Lista de arranque: los 3.585 más populares | 112 KB | 49 KB | **41 KB** | — |
| Delta de 1 día / de 7 días | 8,3 / 64,6 KB | 4,7 / 31,7 KB | **3,7** / 25,3 KB | — |

\* Año, flags y hash son valores de relleno plausibles. El hash de 40 caracteres hexadecimales no se comprime y supone unos 4 MB de los 5,6 MB. **Las portadas no deben ir en el snapshot de búsqueda**: se piden bajo demanda.

En memoria (V8), los nombres ocupan 8,5 MB y los nombres normalizados 9,3 MB: unos **18 MB** en total. Durante el parseo hay un pico de 32 MB con el formato de filas y de 18,5 MB con el columnar.

**SQLite** (`node:sqlite`, tras `VACUUM`; gzip ‑9 y brotli q9):

| BD | Tamaño | gzip | brotli | Construcción |
|---|---|---|---|---|
| Mínima `games(appid, name, pop)` | 5,61 MB | 3,59 MB | 3,07 MB | 0,4 s |
| + FTS5 `unicode61 remove_diacritics 2`, `prefix='1 2 3'`, contentless | **17,44 MB** | 9,79 MB | 8,71 MB | 1,4 s |
| + FTS5 prefix + `trigram` | 32,11 MB | 18,88 MB | 17,28 MB | 2,6 s |
| Extendida (año, flags, cover) | 14,68 MB | 9,25 MB | 8,46 MB | 0,9 s |
| Extendida + FTS5 sin / con prefix | 20,39 / 26,51 MB | 12,14 / 15,45 MB | 11,17 / 14,12 MB | 1,1 / 1,5 s |
| Extendida + trigram / + ambos | 29,34 / 41,17 MB | 18,35 / 24,54 MB | 17,04 / 22,69 MB | 1,7 / 2,8 s |

Capacidades:
- `node:sqlite` funciona sin flag ni `ExperimentalWarning` en v24.21.0.
- Disponible: **FTS5 ✓, `trigram` ✓ y `remove_diacritics` ✓** (con unicode61 y con trigram). No hay ICU ni `spellfix1`.
- `trigram` con `detail='none'` **no** admite búsquedas de subcadena (error `phrase queries are not supported (detail!=full)`).
- `trigram` no encuentra consultas de menos de 3 caracteres.

### 4. Motores

Las latencias son de Node, con el catálogo ordenado por popularidad, 216 pulsaciones × 5. Se mide el pipeline completo: 100 candidatos + reordenación + alias, en ms. La calidad se da en los cuatro escalones: base → +prefijo → +popularidad → +alias, sobre 22.

| Motor | Versión | Build | Heap Δ | Índice serializado (bruto / gzip) · carga | p50 | p95 | máx | top‑1 | top‑5 |
|---|---|---|---|---|---|---|---|---|---|
| Escaneo `indexOf` (JS propio) | — | 20 ms | 6,9 MB | sin índice | 2,27 | 7,17 | 8,7 | 14→15→16→17 | 16→16→16→18 |
| **Híbrido PWA** (`indexOf` + uFuzzy si < 5) | uFuzzy 1.0.19 | 32 ms | 7,0 MB | sin índice | 2,67 | 14,7 | 20,1 | 16→16→19→**20** | 18→18→19→**21** |
| Bucle `startsWith`/`includes` | — | 0 | 0 | sin índice | 8,49 | 10,7 | 14,5 | 14→15→16→17 | 16→16→16→18 |
| `@leeoniya/ufuzzy` (100 candidatos) | 1.0.19 | 18 ms | 0,1 MB | sin índice | 7,91 | 10,3 | 13,4 | 17→16→18→19 | 18→18→18→20 |
| `@leeoniya/ufuzzy` (reordena ≤ 1.000) | 1.0.19 | 15 ms | 0,1 MB | sin índice | 7,74 | 10,3 | 13,9 | 17→16→19→**20** | 18→18→19→**21** |
| `flexsearch` (`forward`, LatinBalance) | 0.8.212 | 2.058 ms | 180 MB | 23,6 / 7,4 MB · 212 ms | 0,04 | 8,6 | 14,5 | 14→15→17→18 | 17→16→17→19 |
| `minisearch` (prefix, fuzzy si < 5) | 7.2.0 | 909 ms | 128 MB | 12,9 / 3,7 MB · 2.131 ms | 1,01 | 65,4 | 148,7 | 15→15→18→19 | 16→16→18→20 |
| `@orama/orama` (tolerance si < 5) | 3.1.18 | 1.689 ms | 163 MB | 43,2 / 13,0 MB · 878 ms | 0,61 | 229,7 | 409,0 | 15→15→17→18 | 17→17→17→19 |
| `fuse.js` (threshold 0,3) | 7.5.0 | 28 ms | 13,7 MB | 8,9 / 2,7 MB · 56 ms | 305 | 921 | 1.272 | 16→17→19→**20** | 19→18→19→**21** |
| SQLite FTS5 prefix (rowid = popularidad) | 3.53.4 | 1.109 ms | ≈ 4,6 MB RSS | BD 17,5 / 9,1 MB · 2 ms | **0,20** | **0,41** | 1,9 | 15→15→16→17 | 16→16→16→18 |
| SQLite FTS5 + trigram (fallback) | 3.53.4 | 2.052 ms | ≈ 5,7 MB RSS | BD 33,3 / 19,1 MB · 2 ms | 0,25 | 14,1 | 56,5 | 17→15→17→18 | 18→16→19→**21** |

Observaciones:
- **SQLite:** con `ORDER BY rank` (bm25) sube a un p95 de 32 ms y un máximo de 73 ms por los prefijos de 1 letra. Hay que **ordenar por `rowid` (= popularidad) con `LIMIT`** y reordenar después los 100 candidatos.
- **Fuzzy en cada pulsación:** Orama llegaba a un p95 de unos 860 ms y MiniSearch también empeoraba. El fuzzy tiene que ser solo un **fallback**.
- **`fuse.js` `useTokenSearch`:** igual de lento, 130–650 ms por consulta en una muestra.
- **Nombres CJK:** uFuzzy solo maneja por defecto el alfabeto latino ("大巫" no se puede buscar sin `unicode: true`). El escaneo `indexOf` y SQLite sí encuentran nombres CJK por prefijo.

**Pulsaciones hasta que aparece el juego.** Los resultados coinciden en el escaneo, FlexSearch, SQLite, uFuzzy y el híbrido:

| Juego | Sin popularidad (+prefijo): top‑5 / top‑1 | Con popularidad + alias: top‑5 / top‑1 |
|---|---|---|
| ELDEN RING | 5 / 5 | **1 / 1** (basta con "e") |
| The Witcher 3 | 11 / 13 | **1 / 3** |
| Cyberpunk 2077 | 9 / 11 | **1 / 2** |
| Hollow Knight | 8 / 8 | **1 / 4** |
| Baldur's Gate 3 | 5 / 5 | **1 / 3** |
| Counter‑Strike 2 | 9 / 16 | **1 / 1** |
| Grand Theft Auto V | 8 / 13 | **3 / 18*** |

\* GTA IV tiene más reseñas que "GTA V Enhanced", y "GTA V Legacy" no está en la lista. Para entrar en el top‑5, MiniSearch necesita 1–5 pulsaciones, Orama 3–10 y Fuse 4–7: su puntuación (BM25 o fuzzy) no respeta la popularidad con prefijos cortos.

**Calidad por categoría** (con popularidad + alias):
- **Exactas (7) y sin puntuación (2):** 9/9 en todos los motores, gracias a `norm()`.
- **Acentos y ñ (6):** 6/6 en todos con `norm()`. Con la configuración **por defecto** de cada motor (16 casos de prueba):

  | Motor (por defecto) | Aciertos |
  |---|---|
  | uFuzzy | 9/16 (13/16 con `latinize()`) |
  | FlexSearch | 14/16 |
  | MiniSearch | 10/16 |
  | Orama, tokenizer inglés | 10/16 (parte "España" en "espa" + "a") |
  | Orama `spanish` | 12/16 (la "à" queda fuera) |
  | Fuse | 16/16 (por tolerancia, no porque pliegue acentos) |
  | SQLite unicode61 | 14/16 |
  | SQLite trigram | 12/16 |

  → **Conviene normalizar siempre con nuestra propia función.**
- **Número "2077":** solo sale top‑1 con popularidad, porque 14 títulos lo contienen.
- **Erratas** (witchr, cyberpnk, hollow knigth, eldenring):

  | Motor | Aciertos |
  |---|---|
  | uFuzzy reordenando todo / híbrido | 3/4 |
  | Fuse | 3/4 |
  | SQLite trigram | 3/4 |
  | uFuzzy con 100 candidatos | 2/4 |
  | MiniSearch | 2/4 |
  | FlexSearch | 1/4 |
  | Orama | 1/4 |
  | Escaneo y FTS5 por prefijo | 0/4 |

  "eldenring" (sin espacio) solo lo resuelven Fuse y trigram.
- **Abreviaturas (gta, cs2):** 0/2 sin alias. Con alias, "cs2" sale top‑1 y "gta" top‑2.
- **Negativas (zelda, pokemon, pokémon):**
  - Los motores de prefijo devuelven 0 resultados. Es lo correcto: se ofrece el alta manual.
  - uFuzzy y el híbrido dan 3 falsos positivos para "zelda" ("Zelash…").
  - Fuse y SQLite trigram devuelven 10 resultados en cada una ("Grizzelda", "Cockemon").

### 5. Navegador y móviles

**Medido en Edge 156.** Pipeline completo; "listo" incluye el fetch local, el parseo, la ordenación, la normalización y la construcción del índice:

| Motor | ×1 (escritorio): listo · p50 / p95 | ×4 (≈ gama media): listo · p50 / p95 | ×10 (≈ gama baja): listo · p50 / p95 | Heap |
|---|---|---|---|---|
| Escaneo `indexOf` | 0,27 s · 2,2 / 6,7 ms | 1,30 s · 9,7 / 33 ms | 3,4 s · 26,5 / 89 ms | 28 MB |
| Híbrido PWA | 0,29 s · 2,5 / 12,9 ms | 1,33 s · 12,1 / 69 ms | 3,7 s · 33,6 / 194 ms | 28 MB |
| uFuzzy | 0,29 s · 7,1 / 9,6 ms | 1,22 s · 34,5 / 44 ms | 4,3 s · 110 / 150 ms | 21 MB |
| Bucle `startsWith` | 0,34 s · 8,3 / 10,9 ms | 1,12 s · 52,7 / 60 ms | 3,8 s · 172 / 208 ms | 21 MB |
| FlexSearch | 1,89 s · < 0,1 / 3,4 ms | 10,7 s · 0,2 / 19,5 ms | 40,3 s · 0,6 / 51 ms | 112 MB |
| MiniSearch | 1,02 s · 1,3 / 53 ms | 6,1 s · 7,9 / 319 ms | 22,8 s · 25 / 1.044 ms | 84 MB |

- **Node frente al navegador.** En escritorio, Node da prácticamente lo mismo que Chromium, porque ambos usan V8: el escaneo da 2,27 / 7,17 ms en Node y 2,2 / 6,7 ms en Edge. No se ha medido Safari (JavaScriptCore).
- **Móviles.**
  - Lighthouse aplica ×4 para llevar un escritorio potente al tramo de móvil de gama media, y sugiere ×10 (rango 5–20) para la gama baja ([Lighthouse throttling](https://github.com/GoogleChrome/lighthouse/blob/main/docs/throttling.md)).
  - Un Galaxy A24 de 175 $ es "más de 4,25× más lento" en un solo núcleo que el iPhone puntero ([Russell, 2024](https://infrequently.org/2024/01/performance-inequality-gap-2024/)).
  - En las medidas, la latencia escala casi en proporción: el p95 se multiplica por 5 a ×4 y por 13 a ×10.
  - Este Ryzen de 2019 no es un escritorio de gama alta, así que los resultados a ×4 y ×10 son estimaciones prudentes.
- **Web Worker.** Es imprescindible para cargar, normalizar y buscar sin bloquear la interfaz: a ×10, construir FlexSearch es una tarea larga de 36 s, y el umbral de [INP "bueno" es ≤ 200 ms](https://web.dev/articles/inp).
  - El `postMessage` de ida y vuelta cuesta unos 0,1 ms de p50 y 0,2 ms de p95 en Edge (0,06 / 0,17 ms con `worker_threads` en Node).
  - Hay que aplicar la regla de que "la última consulta gana" y descartar las respuestas antiguas.
- **Arranque.** El coste dominante es la **normalización**: 170–200 ms a ×1, 0,8–0,9 s a ×4 y 2,4–3,2 s a ×10. Hay dos formas de reducirlo:
  - Una ruta rápida para nombres ASCII, que baja de 153 a 100 ms en Node (−35 %).
  - Enviar la clave normalizada cuando difiere de `toLowerCase()`. Cuesta +0,48 MB en brotli; aplicar `toLowerCase()` a todo el catálogo tarda 21 ms.
- **Memoria.** Ni WebKit ni Android publican un límite por pestaña. Un objetivo razonable es que la búsqueda ocupe menos de 50 MB, lo que descarta FlexSearch, Orama y MiniSearch (84–180 MB). El escaneo y uFuzzy se quedan en 21–28 MB.
- **Primera carga.** Transferir 1,54–1,91 MB cuesta 1,7–2,1 s con la red P75 (7,2 Mbps y 94 ms de RTT; Russell 2024) y 7,7–9,6 s con el perfil "Slow 4G" de Lighthouse (1,6 Mbps y 150 ms de RTT).
  - **Enviar un índice ya construido no compensa.** El export de FlexSearch ocupa 7,4 MB en gzip (3,9 veces el snapshot), el `loadJSON` de MiniSearch tarda 2,1 s (más que construirlo, 0,9 s) y el `save()` de Orama ocupa 43 MB.
  - Mientras llega el snapshot, se puede buscar en la **lista de arranque** de los 3.585 juegos más populares (41 KB br, embebida en el bundle) o en el servidor.

### 6. Recomendación

**(a) Web/PWA**
- **Datos:**
  - Snapshot columnar ordenado por popularidad, versionado e inmutable, servido desde un CDN: 1,54 MB en brotli, o 2,02 MB si incluye las claves normalizadas.
  - Lo cachea el Service Worker y se actualiza con un **delta diario de unos 3,7 KB brotli**.
  - La lista de arranque (41 KB) va dentro del bundle.
- **Búsqueda, dentro de un Web Worker:**
  1. Escaneo `indexOf` sobre un único string, que para al reunir 100 candidatos.
  2. Reordenación por clase (idéntico o prefijo) + 0,5·log10(reseñas).
  3. Capa de alias.
  4. Se muestran los 8 primeros.

  Si hay menos de 5 resultados, entra uFuzzy 1.0.19 (`intraMode: 1`) como fallback. Mejor **diferirlo a la pausa de tecleo** (unos 150 ms) para que nunca penalice una pulsación.
- **Números medidos en Edge:**
  - Escritorio: p50 2,2 / p95 6,7 ms.
  - CPU ×4: 9,7 / 33 ms.
  - CPU ×10: 26,5 / 89 ms.
  - El fuzzy diferido, aparte: p95 de 69 ms a ×4 y 194 ms a ×10.
  - Listo para buscar en 0,27 s, 1,3 s y 3,4 s respectivamente.
  - Unos 28 MB de memoria.
  - Calidad: 20/22 en top‑1 y 21/22 en top‑5.
- No usar FlexSearch, MiniSearch, Orama ni Fuse con 196k títulos en móvil.

**(b) Tauri**
- SQLite FTS5 nativo, con rusqlite (la feature `bundled` compila con `SQLITE_ENABLE_FTS5`) o con `tauri-plugin-sql`.
- Tabla contentless con `unicode61 remove_diacritics 2` y `prefix='1 2 3'`, cuyo `rowid` es el rango de popularidad; sin `ORDER BY rank`.
- Números:
  - **p50 0,20 / p95 0,41 ms.**
  - Abrir la BD y responder la primera consulta: 2 ms.
  - Unos 5 MB de RSS.
  - BD de 17,4 MB (8,7 MB en brotli), incluida en el instalador o descargada una sola vez.
- Las actualizaciones diarias se aplican con `INSERT` y `DELETE` (`contentless_delete=1`).
- Para tolerar erratas: una tabla `trigram` (la BD pasa a 32,1 MB y el p95 a 14 ms con el fallback), o reutilizar el fallback uFuzzy en el WebView.
- En escritorio, WebView2 es Chromium: si se prefiere compartir código, el worker de la PWA da los mismos números que Edge. No se ha medido el coste del IPC de Tauri.

**(c) Servidor**
- El mismo SQLite FTS5 detrás de `GET /search?q=`, cacheable en el CDN. Node 24 ya trae `node:sqlite`, así que no hacen falta Docker ni Postgres.
- Cada consulta consume unos 0,2–0,4 ms de CPU: más de 1.000 consultas por segundo y núcleo (estimado).
- Pero cada pulsación paga la red: entre 94 ms (RTT P75) y 150 ms (Slow 4G), es decir, 100–300 ms por pulsación. No se percibe instantáneo.
- Por eso debe hacer de **respaldo** y de **generador**:
  - Respaldo: primera visita, dispositivos con ≤ 2 GB de RAM y otras plataformas.
  - Generador del snapshot y de los deltas, con la clave de Steam (`IStoreService` + `GetItems`).
- En el cliente, *debounce* de 120–150 ms y `AbortController`.

### 7. Supuestos y dependencias del otro flujo

- **Fuente de popularidad en producción:** la decidirán los tracks de API y legal. SteamSpy solo se ha usado para el test (`request=all` admite una petición cada 60 s). Alternativas a verificar: `appreviews/<appid>?json=1` (resumen de reseñas, una llamada por juego) o `GetItems` con reseñas.
- **CORS y ToS de Steam:** se asume que el cliente **no** llama a Steam; el snapshot se genera en un servidor o cron y se sirve desde nuestro CDN.
- **Licencia y uso de datos:** el track legal debe validar la licencia del espejo (el README muestra un badge MIT, pero el campo `license` de GitHub está vacío) y el uso de nombres e imágenes de Steam.
- **Versiones fijadas el 2026‑10‑28** (`npm --save-exact`): ufuzzy 1.0.19, flexsearch 0.8.212, minisearch 7.2.0, @orama/orama 3.1.18 y fuse.js 7.5.0.

**Reproducibilidad.**
- Scripts: `C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Programacion-GameAgenda\56497ade-bd80-409d-8199-9f2b9ba10c3e\scratchpad\bench\app` (`bench.mjs`, `bench2.mjs`, `snapshot.mjs`, `browser_driver.mjs`, `browser\`).
- Resultados: `C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Programacion-GameAgenda\56497ade-bd80-409d-8199-9f2b9ba10c3e\scratchpad\bench\out`, con `final\res_*.json`, `browser_results.json`, `browser_results2.json`, `snapshot_results_json_variants.json` y `snapshot_results_db.json`.
