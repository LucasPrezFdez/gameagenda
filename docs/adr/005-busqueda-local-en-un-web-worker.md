# ADR-005 · Búsqueda local en un Web Worker

- **Estado:** aceptada
- **Fecha:** 29-10-2026
- **Deciden:** el usuario y el asistente

## Contexto y problema

La paleta busca en todo el catálogo de Steam en cada pulsación, también sin red. En la copia congelada del 28-10-2026 son 196 665 juegos. El navegador no puede llamar a Steam (ADR-001), y el hilo principal tiene que quedar libre: ninguna tarea de más de 50 ms al teclear (RNF-03).

¿Dónde y con qué motor se busca para que la pulsación sea rápida en escritorio y tarde ≤50 ms con CPU ×4 (RNF-02), con una calidad medible?

## Factores de la decisión

- Pulsación → resultados p95 ≤50 ms con CPU ×4 y, en escritorio, ≤16 ms a ≥120 Hz y ≤2 fotogramas por debajo (≈33 ms a 60 Hz), también mientras se construye el índice. Al escribir este ADR, el presupuesto de escritorio era ≤16 ms a cualquier frecuencia; ver las consecuencias.
- Calidad (§8.10):
  - conjunto dorado: top-1 ≥90 % y top-5 ≥95 %;
  - exactos: ≥99 % en el top-5;
  - prefijos: ≥90 % en el top-10;
  - negativas: ningún resultado de nivel 0–1.
- Reinicio con caché ≤2 s hasta poder buscar (RNF-04).
- Worker ≤40 KB brotli y memoria asumible en un móvil de gama media.
- Sin red tras la primera visita y sin servidor.
- La misma normalización y el mismo *ranking* en el Worker, en el pipeline y en las pruebas.

## Opciones consideradas

1. Índice propio en un Web Worker de módulo, con puente de escaneo y uFuzzy para el nivel difuso.
2. Una librería de búsqueda: Fuse.js, FlexSearch, Orama o MiniSearch.
3. SQLite FTS5 *trigram*, el motor de la arquitectura B (en la web, con SQLite WASM).
4. Búsqueda en el servidor durante la primera visita (arquitectura C).
5. Solo escaneo lineal, sin índice.
6. Publicar el índice ya construido.

## Decisión

Opción elegida: **1**, porque de las medidas es la única que cumple a la vez la latencia, la memoria y la calidad con el catálogo real.

### Motor (`packages/core/src/{normalize,search}`)

- Una sola `normalize()` (§8.1), con vectores de prueba compartidos.
- Índice (§8.3):
  - diccionario de tokens ordenado;
  - *postings* en `Uint32Array`, en orden de popularidad;
  - `fwd` y `fwp`;
  - *bitsets* de una letra;
  - salida temprana.
- *Ranking* por niveles 0–4, con el orden adoptado, `pop + 6` para el nivel 1 (§8.4). El modo estricto queda como alternativa documentada.

### Worker (`apps/web/src/search-worker/`)

- Es un Worker de módulo sin React ni Dexie, y en M1 tampoco abre IndexedDB.
- Sigue el protocolo de la §8.7 (`apps/web/src/search-client/`):
  - `seq` crece con cada cambio del texto;
  - hay como mucho una consulta en curso;
  - la interfaz solo pinta los resultados del `seq` actual;
  - Intro espera hasta 500 ms a los resultados de la consulta actual.

### Disponibilidad: `none` → `scan` → `full`

- El Worker lee el núcleo y construye el índice en bloques de unos 6 ms.
- Entre bloques cede el turno con `MessageChannel`, que no arrastra el mínimo de 4 ms de `setTimeout`.
- En `scan` responde el escaneo, con los mismos niveles y el mismo orden. Da la misma lista que `full` en el dorado, en los exactos y en los prefijos.

### Nivel 4

- uFuzzy 1.0.19, en un *chunk* diferido de 3,4 KiB.
- Se pide tras 150 ms sin teclear.
- Recorre los nombres en bloques de 20 000 y se abandona si llega un `seq` mayor.

### Pantalla Catálogo

`browse` filtra con los niveles 0–2, en el orden de las filas, y entrega ventanas de ≤200 filas. El catálogo nunca pasa entero al hilo principal.

### Ficheros del catálogo (`catalog-store.ts`)

- **El *manifest*:**
  - se pide con `cache: 'no-cache'`;
  - se valida con Zod: en M1 lleva `format: 'gacat'` y `v: 1`, a confirmar en M2 (ver ADR-006);
  - se comprueba su `minClientVersion`.
- **Cada fichero:**
  - se comprueba con su `sha256` (WebCrypto) y su tamaño;
  - se guarda en Cache Storage, en `gacat-<versión>`.
- **El orden:** el *manifest* se guarda el último y marca la versión como completa.
- **Al arrancar:**
  - se usa la caché, sin esperar a la red; sin red, basta con ella;
  - después se comprueba el *manifest*;
  - una versión nueva se descarga e indexa en segundo plano y sustituye a la anterior al llegar a `full`;
  - una versión anterior a la vigente se rechaza.

### Resultados de M1

**Calidad**, medida con Vitest (`search.quality.test.ts`) sobre la copia congelada:

- conjunto dorado: 94,9 % en el top-1 y 99,0 % en el top-5;
- exactos: 99,9 %;
- prefijos: 93,1 %;
- negativas: bien;
- `scan` da lo mismo que `full`.

**Tiempos**, en Chromium sin estrangular, con el catálogo completo:

| Medida | Primera visita | Con caché |
|---|---|---|
| `search:ready` | 0,87–1,13 s | ≈0,5 s |
| `search:full` | 1,21–1,54 s | 0,72–1,38 s |

| Pulsación, dentro del Worker | p50 | p95 |
|---|---|---|
| En `full` | 0,2 ms | 2,2 ms |
| En `scan` | 2,3 ms | 7–12 ms |

**Tamaño:** el Worker pesa 31,8 KiB brotli (límite 40), con el esquema Zod del *manifest* dentro. De momento no hace falta `zod/mini` (§6.2).

### Consecuencias

- Bien, porque se busca en todo el catálogo sin red, con la misma calidad en `scan` que en `full`.
- Bien, porque la búsqueda está lista en ≈0,5 s tras un reinicio con caché, frente a los 2 s de RNF-04.
- Bien, porque el pipeline y las pruebas usan el mismo código que el Worker.
- Mal, porque hasta M3 el índice se construye en cada arranque en frío: ≈40 MiB en memoria y 4,56 s con CPU ×4 en el benchmark, aunque el escaneo responde antes.
- Mal, porque la primera visita espera a la descarga del núcleo (ver ADR-001).
- Mal, porque es un índice propio, con más código que mantener que una librería.
- Resuelto el 30-10-2026: la pulsación hasta el fotograma (`search:keystroke-to-results`) daba un p95 de 19,7–21,0 ms sin estrangular a 60 Hz, frente a los ≤16 ms que pedía entonces el presupuesto de escritorio (CA1.5). Antes de corregir la paleta y Mi lista daba ≈31 ms; la tabla está en `docs/medidas/perf-m1-20261029.md`.
  - La búsqueda no es el cuello de botella: el Worker responde en 0,2 ms.
  - Chromium retiene el mensaje del Worker hasta el primer fotograma tras la tecla (`DeferRendererTasksAfterInput`).
  - Aun sin esa retención, a 60 Hz el suelo es p95 ≈17 ms, porque el primer fotograma cae en una fase de vsync al azar. A 120 Hz pasa (p95 14,8 ms).
  - **Decisión del usuario:** ≤16 ms a ≥120 Hz y ≤2 fotogramas por debajo (≈33 ms a 60 Hz). Se descarta precalcular en el Worker la siguiente tecla, porque gastaría CPU en el móvil. `npm run perf` aplica el límite según la frecuencia que mide (`DECISIONES.md` §10.17).
- Pendiente de confirmar: con CPU ×4 en la página de prueba, el escaneo tardaba ≈2,2 s tras un reinicio con caché, frente a ≤2 s de CA1.11. La mayor parte, ≈1,7 s, eran claves, exactos y pajar en el *builder* de `core`. Optimizado el 30-10-2026: con ×4, claves −20 a −36 % y lectura del TSV −20 %. La medición se hizo con el equipo cargado; falta repetirla en reposo (`docs/medidas/builder-m1-20261030.md`).
- Pendiente: medir el Worker real en el Android de referencia.
- Medido: CDP no estrangula el Worker dedicado. `Emulation.setCPUThrottlingRate` responde «Operation is only supported for pages, not workers», aun adjuntado con `Target.setAutoAttach`. Por eso la parte 1 de `perf` busca en el hilo principal de una página de prueba.
- Pendiente (M2): guardar `meta.catalog` y comprobar el *manifest* solo si han pasado ≥12 h (en M1 se comprueba en cada arranque).
- Pendiente (M2): `recent`, la regla de los 7 días para el núcleo y la firma del *manifest*.
- Pendiente (M3): índice persistido y núcleo de arranque (ADR-009).

### Confirmación

- **Vitest, sin red:** las puertas de la §8.10 sobre `fixtures/catalog-frozen/` con los dos motores, más:
  - las consultas de humo;
  - `scan` frente a `full`;
  - el tecleo realista de 150 nombres, carácter a carácter;
  - las pruebas del protocolo y de la caché del catálogo (`host.test.ts`, `catalog-store.test.ts` y `client.test.ts`).
- **E2E:** `search.spec.ts`, `palette.spec.ts`, `catalog.spec.ts` y `full-catalog.spec.ts`. Cubren el puente de escaneo, la carrera de Intro, el Catálogo completo y la búsqueda sin red.
- **Rendimiento:** `npm run perf` (CA1.5 y CA1.11) y, al cerrar M1, el Android de referencia. La puerta de tamaño del Worker llega con el CI.

## Pros y contras de las opciones

### 1 · Índice propio en un Web Worker

- Bien, porque en el benchmark la pulsación da 2,1 ms p95 con ×1 y 8,7 ms con CPU ×4, con ≈40 MiB de memoria.
- Bien, porque pasa todas las puertas de calidad.
- Mal, porque necesita construir el índice en el cliente y mantener código propio.

### 2 · Fuse.js, FlexSearch, Orama o MiniSearch

- Mal, porque Fuse.js tardó ≈394 ms por pulsación en la prueba de uFuzzy, con 162 000 frases.
- Mal, porque FlexSearch, Orama y MiniSearch retienen 316, 192 y 67 MB de *heap* en esa prueba.

### 3 · SQLite FTS5 *trigram*

- Mal, porque solo el motor WASM ocupa ≈397 KiB gzip.
- Mal, porque el índice del catálogo ocupa 19,2 MiB (11,5 MiB brotli), frente a los 2,25 MB brotli del núcleo.

### 4 · Búsqueda en el servidor para la primera visita

- Bien, porque se podría buscar antes de descargar el núcleo.
- Mal, porque pone un servidor y la red en el camino caliente, en contra de ADR-001. La sustituye el núcleo de arranque de M3.

### 5 · Solo escaneo lineal

- Bien, porque está listo antes: 1,72 s con CPU ×4, frente a 4,56 s del índice.
- Mal, porque el motor de escaneo medido daba 86,7 % / 87,8 % en el dorado y 42 ms p95 con CPU ×4.
- Mal, porque, incluso con los niveles del índice, la pulsación tarda más: 2,3 ms de p50 en el Worker, frente a 0,2 ms. Por eso solo hace de puente.

### 6 · Publicar el índice construido

- Mal, porque ocupa 19,2 MB (6,66 MB con brotli 11), el triple del núcleo comprimido. Se construye en el cliente y, desde M3, se guarda en local.

## Más información

- **En `prototipe.md`:**
  - [§8](../../prototipe.md#8-búsqueda-instantánea): normalización, índice, niveles, protocolo y disponibilidad;
  - [§8.9](../../prototipe.md#89-presupuestos-y-cómo-se-miden): presupuestos;
  - [§8.11](../../prototipe.md#811-resultados-del-benchmark-28-10-2026): benchmark;
  - [§5.2](../../prototipe.md#52-componentes-y-responsabilidades): el Worker no importa Dexie;
  - [§6.2](../../prototipe.md#62-presupuesto-de-js): presupuesto de JS;
  - [§12.4](../../prototipe.md#124-rendimiento-tamaño-y-dónde-se-mide): dónde se mide.
- **Porqué:** [`DECISIONES.md`](../planificacion/DECISIONES.md), en D-09. Las §10.1 a 10.3, §10.8 y §10.9 ajustan el *ranking*, el puente, la normalización, la medición y las puertas.
- **Prototipo medido:** `docs/planificacion/prototipo-busqueda/`.
- **Relacionados:** ADR-006 (formato del catálogo) y ADR-009 (arranque rápido, M3).
