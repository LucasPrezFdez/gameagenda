# ADR-005 · Búsqueda local en un Web Worker

- **Estado:** aceptada
- **Fecha:** 29-10-2026. El 31-10-2026 se añadió la parte de M2: firma del *manifest*, recientes, regla de los 7 días y recuperación ante un 404.
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

### M2 · Catálogo vivo en el cliente (31-10-2026)

**Firma del *manifest*** (`catalog-store.ts`; §7.6 y §11.3):

- `fetchManifest()` lee el JSON, lo pasa por el esquema y verifica la firma ed25519 con WebCrypto (`Ed25519`) antes que nada más, también antes de `minClientVersion`.
- Se firma y se verifica el objeto de `JSON.parse`, no el del esquema: Zod quita los campos desconocidos, y también van firmados (`manifestSigningBytes` de `core`).
- Las claves en las que confía el *build* salen de `signingKeysForMode(import.meta.env.MODE)`:
  - producción: solo las `prod` de `CATALOG_SIGNING_KEYS`;
  - `development` y `e2e`: también la de desarrollo, `dev-1`, cuya privada está en `fixtures/signing/`.
- Se descarta, con el código `signature`, un *manifest* sin `sig`, con un `kid` desconocido o con una firma que no cuadra. El catálogo vigente sigue respondiendo.
- Sin Ed25519 (`importKey` da `NotSupportedError`: Chrome <137, Safari <17 o el WebKit de Playwright en Windows), no se acepta ningún *manifest*. El código es `browser-too-old`, sin reintento: la interfaz puede pedir que se actualice el navegador (RNF-12).
- La caché es de confianza. Solo se escribe tras verificar la firma y los `sha256`, así que al arrancar no se vuelve a verificar. Por eso un navegador sin Ed25519 sigue con el último catálogo válido, también con el de M1.

**Recientes:**

- `recent` se baja y se guarda con los demás ficheros.
- Al arrancar se lee de una vez y `applyRecent` lo aplica al núcleo leído antes de construir el índice (§8.8).
- Con el catálogo completo y 4 000 filas, `applyRecent` tarda 16–27 ms sin estrangular, en un solo bloque (no es cooperativo). En una actualización en segundo plano puede retrasar una consulta una vez; si el Android de referencia lo nota, `core` tendría que ofrecer una versión por trozos.

**Regla de los 7 días** (§5.4; CA2.4):

- Con un *manifest* nuevo, `download()` reutiliza el núcleo en uso si es el mismo fichero o si el *manifest* trae `recent` y el núcleo local no tiene más de 7 días. Los días se cuentan entre las fechas de las versiones `AAAAMMDD`.
- Así solo se piden a la red el *manifest*, `recent` y, si ha cambiado su *hash*, los alias y el índice de *shards*. Un fichero con el mismo *hash* sale de cualquier caché `gacat-*`.
- La caché nueva, `gacat-<versión>`, guarda el núcleo antiguo con su nombre y apunta cuál es en `gacat-local.json` (`path`, `sha256`, `bytes` y la `version` que lo trajo). Una caché de M1, sin ese fichero, usa el núcleo de su *manifest*.
- «Actualizar catálogo» (la petición `refresh`) baja también el núcleo nuevo.
- Si el núcleo en uso ya no está en la caché, se baja el del *manifest*.
- Con el *kill switch* `details`, no se baja el índice de *shards*.
- Una versión que da el mismo índice (mismo núcleo en uso, mismos recientes y mismos alias; por ejemplo, la que solo cambia un *kill switch*) se adopta sin reconstruir nada.
- Al terminar se borran las demás cachés de versión, `gacat-AAAAMMDD.N`. La de los *shards*, `gacat-details`, no se toca.

**Recuperación ante un 404** (§5.4, principio 8; §15.5):

- `fetchFile` ya reintentaba una vez con `cache: 'reload'`.
- Si un fichero con *hash* sigue dando un error HTTP (un 404 tras un despliegue), el host relee el *manifest* una vez y, si cita otros ficheros, sigue con él.
- Si no, la actualización se abandona y sigue el catálogo vigente: la búsqueda nunca se rompe.
- Se reintenta con una espera que se dobla, de 1 min a 1 h como mucho (`HostDeps.setTimer`), y vuelve a 1 min tras una comprobación correcta. Cada reintento empieza por el *manifest*. Sin red ni para el *manifest* no se programa nada: lo repite `online()`.
- Un fallo de red al bajar un fichero no relee el *manifest* al momento, aunque el principio 8 de la §5.4 lo pida:
  - sin red, tampoco llegaría;
  - al cerrar la página, WebKit corta las descargas del Worker y da por un error la petición nueva; en `data.spec.ts` salía en la consola;
  - lo relee el reintento, al minuto.

  Un 404 sin CORS llega como fallo de red, pero `ga-catalog` manda CORS también en los 404 (ADR-003).

**Errores en `status.error`:**

- Sin catálogo, el de la carga, como en M1.
- Con catálogo, solo los de la actualización que piden algo: `signature`, `browser-too-old` y `client-too-old`. Mientras se lee la caché, el estado `none` no los muestra, para que la interfaz no diga «No hemos podido descargar…» con el catálogo a punto.
- Los textos, en `es.catalogState.browserTooOld` y `es.catalogState.signatureRejected`.

**E2E en `webkit-movil`:**

- El WebKit de Playwright en Windows no tiene Ed25519 (`docs/medidas/verificaciones-m0-20261030.md`). Sin más, ese proyecto no tendría catálogo.
- **Decisión:** un gancho explícito del modo `e2e`, `unverifiedDevSignature`, encendido salvo que la prueba pase `false` (`search-client/e2e-hooks.ts`):
  - solo actúa si `importKey` da `NotSupportedError`;
  - solo con una clave `use: 'dev'` de las de confianza, y la firma tiene que estar con un `kid` conocido;
  - en Chromium no cambia nada: la firma se verifica en todos los E2E.
- No debilita producción:
  - el gancho vive en `search-worker/e2e-hooks.ts`, que el *build* de producción no lleva (se ha comprobado en `dist/`);
  - aunque lo llevara, producción no confía en ninguna clave `dev`.
- El camino de RNF-12 sí se prueba en `webkit-movil`, con el gancho apagado (`catalog-update.spec.ts`):
  - con caché, sigue buscando y anuncia `browser-too-old`;
  - sin caché, no hay catálogo, avisa sin «Reintentar» y se puede apuntar a mano.
- El *manifest* manipulado (CA2.3) solo se prueba en Chromium.

**Fixtures:**

- `npm run catalog:frozen` firma con `dev-1` el mini-catálogo (`fixtures/catalog/`) y el completo (`pipeline/out/`). Les añade `recent` y *shards* de detalles **sintéticos**:
  - `asset_url_format` falso, `steam/apps/<appid>/${FILENAME}`, con `library_600x900.jpg` y `header.jpg`;
  - lanzamiento el 1 de enero de `year`;
  - unas reseñas que dan su `pop`;
  - `plat` 1 y `deck` 0.
- Es determinista: la firma ed25519 también lo es.
- `recent` son las filas de `appid` más alto (≈4 000 y 8), iguales a las del núcleo, como el `recent` del mismo día. No cambian el recuento.
- `publish()` de `test-helpers.ts` firma con la misma clave.

**Resultados de M2:**

- **Bytes de una actualización** con el núcleo local y el catálogo completo (`pipeline/out/`):

  | Ficheros | Sin comprimir | brotli 11 | gzip -6 |
  |---|---|---|---|
  | *Manifest* + `recent` | 136 KB | 49 KB | 60 KB |
  | Más alias e índice de *shards* | 201 KB | 74 KB | 91 KB |

  Los alias y el índice llevan la versión en la cabecera, así que cambian de *hash* cada día aunque su contenido no cambie.
- **Reinicio con caché** (CA1.11, `npm run perf`, CPU ×4, 31-10-2026, con el equipo en reposo):

  | Medida | M1 | Con recientes |
  |---|---|---|
  | Escaneo listo (`scan`), dos reinicios | 1 463 y 1 677 ms | 1 825 y 1 848 ms |
  | Desglose sin ceder el turno | 1 668 ms | 1 884 ms, con 119 ms de recientes |
  | App real: `search:ready` | 616 ms | 643 ms |

  - Los recientes cuestan 119–129 ms con ×4 en todas las pasadas; el resto de la diferencia es ruido.
  - Sigue dentro de los 2 s, pero el margen baja a ≈150 ms. Con el equipo cargado por otros procesos, cinco de doce reinicios pasaron de 2 s (hasta 2,5 s); con el código de M1, en las mismas condiciones, el peor fue de 1,87 s.
  - Para recuperarlo hay dos caminos: un `applyRecent` más barato en `core` (hoy rehace las seis columnas fila a fila, con un `Map` por fila) o el índice persistido de M3.
- **Tamaño:** el Worker pasa a 36,9 KB brotli (límite 40). Parte es de los esquemas de detalles, que entran por el índice de `@gameagenda/core/catalog-format` aunque el Worker no los use.

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
- Resuelto el 30-10-2026: con CPU ×4 en la página de prueba, el escaneo tardaba ≈2,2 s tras un reinicio con caché, frente a ≤2 s de CA1.11. La mayor parte, ≈1,7 s, eran claves, exactos y pajar en el *builder* de `core`. Tras optimizar el *builder* y el lector del TSV, está listo en 1,55–1,64 s (claves 1 179 ms y TSV 287 ms); el detalle está en `docs/medidas/builder-m1-20261030.md`.
- Pendiente: medir el Worker real en el Android de referencia.
- Medido: CDP no estrangula el Worker dedicado. `Emulation.setCPUThrottlingRate` responde «Operation is only supported for pages, not workers», aun adjuntado con `Target.setAutoAttach`. Por eso la parte 1 de `perf` busca en el hilo principal de una página de prueba.
- Pendiente (M2): guardar `meta.catalog` y comprobar el *manifest* solo si han pasado ≥12 h (aún se comprueba en cada arranque).
- Hecho (M2, 31-10-2026): `recent`, la regla de los 7 días para el núcleo, la firma del *manifest* y la recuperación ante un 404 (ver «M2 · Catálogo vivo en el cliente»).
- Mal, porque un *build* de producción solo confía en las claves `prod`, y `CATALOG_SIGNING_KEYS` aún no tiene ninguna. Hasta que se añada la pública de producción, ese *build* descarta todos los *manifest*: no hay que desplegar `ga-web` con esta parte sin ella, ni sin un `ga-catalog` firmado.
- Pendiente (M3): índice persistido y núcleo de arranque (ADR-009).

### Confirmación

- **Vitest, sin red:** las puertas de la §8.10 sobre `fixtures/catalog-frozen/` con los dos motores, más:
  - las consultas de humo;
  - `scan` frente a `full`;
  - el tecleo realista de 150 nombres, carácter a carácter;
  - las pruebas del protocolo y de la caché del catálogo (`host.test.ts`, `catalog-store.test.ts` y `client.test.ts`).
- **E2E:** `search.spec.ts`, `palette.spec.ts`, `catalog.spec.ts` y `full-catalog.spec.ts`. Cubren el puente de escaneo, la carrera de Intro, el Catálogo completo y la búsqueda sin red.
- **M2:**
  - en Vitest, la firma (válida, manipulada, otro `kid`, la clave de desarrollo en producción y sin Ed25519), los recientes, la regla de los 7 días y el 404 con sus reintentos;
  - en E2E, `catalog-update.spec.ts`: la regla de los 7 días con una versión firmada del día siguiente, el *manifest* manipulado y RNF-12 en `webkit-movil`.
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
