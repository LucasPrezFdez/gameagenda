# ADR-009 · Arranque rápido: índice persistido y núcleo de arranque

- **Estado:** propuesta
- **Fecha:** 05-11-2026
- **Deciden:** el usuario y el asistente

## Contexto y problema

La búsqueda es local, en un Web Worker, sobre el núcleo del catálogo: 197 000 juegos, ≈7 MB de TSV y 2,16 MiB con brotli 11 (ADR-005, ADR-006 y §7.6). En M1 y M2 hay que esperar a dos cosas antes de buscar en todo el catálogo:

- **En cada reinicio,** el Worker lee el TSV de Cache Storage, normaliza las claves y construye el índice. Mientras tanto responde el escaneo lineal (`scan`), listo en 1,64 s con CPU ×4 (CA1.11); el índice completo (`full`), en ≈4 s.
- **En la primera visita,** además, baja el núcleo entero antes de leer nada: 3 017 KB con el *manifest*, los alias y lo demás, que tardaron 1,9 s en llegar a `full` con la fibra del PC (31-10-2026) y muchos más con un móvil en 4G. Entretanto se puede apuntar a mano o pegar un enlace, pero no buscar.

Los presupuestos de M3 son una búsqueda lista ≤1,5 s tras la primera carga (RNF-05) y un índice restaurado en ≤0,4 s con CPU ×4 (CA3.2), dentro de los ≤2 s del reinicio con caché (RNF-04). No hay servidor de búsqueda (ADR-001): el catálogo es estático, firmado y servido por `ga-catalog` (ADR-007).

¿Cómo se busca pronto en la primera visita y en cada reinicio, sin servidor y sin tocar el catálogo firmado?

## Factores de la decisión

- RNF-05 (≤1,5 s tras la primera carga, «gracias al núcleo de arranque», §3.2), CA3.2 (≤0,4 s con CPU ×4) y RNF-04 (reinicio con caché ≤2 s).
- La integridad del catálogo (§11.3): todo lo que busca la app sale de un fichero citado, con su `sha256`, en el *manifest* firmado.
- La compatibilidad: la app 0.2.0 ya está en producción y los catálogos de M2 no traen nada nuevo. Ni un *manifest* nuevo puede romper a un cliente viejo ni uno viejo a un cliente nuevo, sin subir `minClientVersion`.
- La regla de los 7 días (CA2.4): una actualización no vuelve a bajar lo que ya hay.
- Los límites del despliegue de `ga-catalog` (≤20 000 ficheros y ≤25 MiB por fichero, §7.6) y del Worker (*chunk* de entrada ≤40 KB brotli, §6.2).
- El espacio en el dispositivo: la agenda va en la misma base de IndexedDB (ADR-004).

## Opciones consideradas

1. **Índice persistido en IndexedDB y núcleo de arranque publicado:** el Worker guarda el índice que ya ha construido y lo restaura en el siguiente reinicio; el pipeline publica, además, las 20 000 primeras filas del núcleo (los más populares) en un fichero pequeño que la primera visita baja antes que el resto.
2. **Publicar el índice ya construido** en `ga-catalog`, para no construirlo nunca en el cliente.
3. **Búsqueda en el servidor para la primera visita** (la de la arquitectura C, §5).
4. **Solo el índice persistido:** la primera visita sigue como en M2.

## Decisión

Opción elegida: **1**, porque es la única que cumple a la vez RNF-05 y CA3.2 sin servidor: el reinicio restaura lo que el Worker ya ha construido (sin red ni CPU de más), y la primera visita busca en un fichero de 269 KB, un 12 % del núcleo, firmado y comprobado como los demás.

### Índice persistido (CA3.2; `DECISIONES.md` §10.25)

- **Cuándo:** cada índice que llega a `full` se guarda después, a trozos que ceden el turno, solo sin construcción en marcha. En el arranque siguiente, con el mismo catálogo, se restaura sin leer el TSV ni construir: de `none` a `full`.
- **Clave:** el formato (`INDEX_FORMAT`, hoy 2), la ruta del *chunk* del Worker (que lleva el *hash* de su contenido) y los `sha256` del núcleo, de `recent` y de los alias. Un catálogo nuevo o una versión nueva de la app no lo usan: se construye como en M1 y su índice sustituye al anterior.
- **Dónde:** en la tabla `meta`, en tres filas: `searchIndexKey` (la clave, que se lee primero), `searchIndex` (≈22 MB, para los niveles 0–2) y `searchIndexHaystack` (el pajar del nivel 3, ≈5 MB, que se lee justo después). Si falta o no cuadra, el índice se construye en segundo plano desde la caché y se vuelve a guardar.
- **Formato:** *typed arrays*; las listas de cadenas, en UTF-8. Los nombres, las claves base y el diccionario de tokens se decodifican una vez y se recortan al pedirlos, en vez de partirlos al restaurar.
- **Código:** `@gameagenda/core/search-persist`, un *chunk* diferido del Worker que no importa nada (lo vigila `npm run size`).

### Núcleo de arranque (RNF-05)

- **Qué es:** `boot.<hash>.tsv`, las `BOOT_ROWS` (20 000) primeras filas del núcleo, en su orden y con sus seis columnas, y la cabecera `#gacat-boot v1`. El núcleo va ordenado por reseñas (D-08), así que su prefijo son los más populares: no hay otra lista que elegir ni mantener. Con un núcleo más corto, lleva todas sus filas. Lleva los +18, que la app oculta como en el núcleo.
- **En el *manifest*:** `files.boot` y `counts.boot`, dentro de lo firmado. El esquema los admite como opcionales desde M2 y la firma se verifica sobre el JSON tal como llega, así que la app 0.2.0 los ignora sin rechazar el catálogo: `minClientVersion` no cambia.
- **Puertas del pipeline** (§4.6): la de integridad comprueba que es el prefijo exacto del núcleo, fila a fila, de su misma versión, con `min(20 000, filas)` filas, y que `counts.boot`, el `sha256`, los bytes y la ruta casan. La de tamaño falla por encima de 512 KiB con brotli 11 (hoy, 269 KB). Las consultas de humo se repiten sobre él con los mismos alias. `assemble-catalog` comprueba la cabecera antes de desplegar, y `catalog-smoke` avisa si llega sin comprimir.
- **En la primera visita** (sin núcleo en Cache Storage): si el *manifest* trae `files.boot`, el Worker baja a la vez el núcleo de arranque y los alias, antes que el resto, y los guarda en `gacat-<versión>` sin el *manifest* (la versión sigue incompleta, y `download()` los reutiliza; si se corta la visita, la siguiente también). Los indexa solo hasta `scan`, con prioridad sobre el núcleo, y entonces responde: es el estado `boot`. Cuando el núcleo llega a `scan`, lo sustituye.
- **Nunca es el catálogo en uso:** no se guarda su índice, no lo mira una actualización ni lo baja una versión nueva (CA2.4). Un reinicio con caché tampoco lo usa.
- **En `boot`:**
  - `query` y `suggest` responden con él; la ficha y `lookup`, solo si todo lo pedido está en él; el Catálogo y `matchExact` esperan a `scan`;
  - la paleta dice, junto a los resultados, «De momento buscamos en los 20 000 juegos más populares; el catálogo completo está llegando». Sin resultados, no resalta la fila manual ni dice que el juego no está en Steam: Intro no crea un juego manual que quizá llega unos segundos después;
  - al pasar a `scan`, el cliente repite la consulta abierta, y los provisionales se vuelven a buscar.
- **Si algo falla:** un núcleo de arranque que no baja o no se lee se ignora, y la visita sigue como en M2. Si falla el núcleo estando en `boot`, se sigue buscando en el de arranque, se anuncia el error con «Reintentar» y la carga se repite sola con la espera creciente (1 min … 1 h). «Actualizar catálogo» y la vuelta de la red durante la primera carga van detrás de ella: nunca hay dos descargas a la vez.

### Consecuencias

- Bien, porque un reinicio con el mismo catálogo busca en 162 ms con CPU ×4 (CA3.2), frente a los 1,64 s de `scan` de M1, y con todos los niveles desde el principio.
- Bien, porque la primera visita busca en los 20 000 más populares antes de que llegue el núcleo: con CPU ×4, `boot` llega en 613–759 ms y la app, a `search:ready` en 841–859 ms (RNF-05: ≤1 500 ms), en local.
- Bien, porque el núcleo de arranque es otro fichero del catálogo firmado: sin servidor, sin datos nuevos que validar y con las mismas puertas.
- Bien, porque es compatible en los dos sentidos: un catálogo de M2 sin `files.boot` da la primera visita de M2, y la app 0.2.0 ignora el campo.
- Mal, porque la primera visita baja ≈269 KB más (un 12 % sobre el núcleo) y lee e indexa dos veces esas 20 000 filas.
- Mal, porque en `boot` no aparece un juego fuera de los más populares: la paleta lo avisa e Intro no lo apunta a mano hasta que llega el núcleo, pero sí se puede pegar su enlace.
- Mal, porque el índice persistido ocupa ≈27 MB de IndexedDB, que cuentan para la cuota con la agenda (§7.2).
- Mal, porque, tras una versión nueva del catálogo, el índice anterior no vale: si se cierra la app antes de que acabe la construcción en segundo plano, el arranque siguiente construye como en M1 (`scan` en ≈2 s). Guardar los dos índices lo evitaría, y no se ha hecho.
- Mal, porque cada versión publica un fichero más (dos, con la anterior): ≈1 032 por despliegue, lejos de los 20 000.
- Pendiente: medir RNF-04 y RNF-05 en el Android de referencia y en el iPhone, con la red de verdad (CA3.1, *issue* #1). En local, la red no cuenta.
- Pendiente: «Reinicio con caché → escaneo listo» (sin índice guardado) da ≈2,1 s con el equipo cargado, por encima de los ≤2 000 ms, también en `main`. Se mide con el equipo en reposo.
- Pendiente: entrar en `main` sin romper las ejecuciones programadas de CA2.1, por este orden: primero el pipeline; después, una ejecución programada que publique el núcleo de arranque, comprobada con `catalog-smoke`; al final, el cliente.

### Confirmación

- **Vitest, índice persistido:** `search.persist.test.ts` (ida y vuelta, formato, cadenas y surrogados sueltos), `search-index-store.test.ts` y `host.test.ts` (clave, dos fases, pajar que falta, versión nueva y los `hold` de los E2E).
- **Vitest, núcleo de arranque:**
  - `pipeline/test/gates.test.ts` (prefijo, recuentos, versión, tamaño y humo en `boot`), `pipeline.test.ts` y `publish.test.ts`;
  - `packages/core/test/catalog-format.test.ts` (ida y vuelta y *manifest* con `files.boot`);
  - `scripts/assemble-catalog.test.ts` (cabecera, versión anterior sin él y dos versiones con él) y `catalog-smoke.test.ts`;
  - `catalog-store.test.ts` (`downloadBoot`) y `host.test.ts` (`none` → `boot` → `scan` → `full`, las peticiones de la primera visita y las de M2, un núcleo de arranque que no vale, el fallo y el reintento del núcleo, la visita cortada, la caché completa y el índice guardado, que no lo usan, «Actualizar catálogo» durante la carga y el 404 con otra versión);
  - `client.test.ts` (la consulta se repite al salir de `boot`), `palette-model.test.ts` y `catalog-refresh.test.ts`.
- **E2E:** `search-index.spec.ts` (el reinicio con el mismo catálogo restaura el índice y busca igual) y `boot.spec.ts`: los estados, el orden de las peticiones, la paleta y el Catálogo en `boot`, axe, que una actualización nunca lo baja (CA2.4) y la primera visita sin `files.boot`, en Chromium; con el núcleo de arranque del mini-catálogo, también en WebKit.
- **Rendimiento** (`npm run perf`): «Primera visita → boot (×4)» y `search:ready` en la primera visita (≤1 500 ms, RNF-05), y el reinicio con el índice guardado (`search:index-restored`, ≤400 ms, CA3.2).
- **Producción:** `npm run smoke:web` guarda los estados de la primera visita y comprueba que pasa por `boot` si el catálogo lo trae, y que la segunda visita y una actualización no lo piden nunca.

## Pros y contras de las opciones

### 1 · Índice persistido y núcleo de arranque

- Bien, porque cubre los dos arranques: el reinicio, con lo que ya está en el dispositivo, y la primera visita, con un fichero pequeño.
- Bien, porque no añade servidor ni formato nuevo: el núcleo de arranque se lee con el lector del TSV y el índice no sale del dispositivo.
- Mal, porque hay un estado más (`boot`) que la interfaz tiene que explicar, y la paleta no puede decir «no está» mientras dura.

### 2 · Publicar el índice construido

- Bien, porque ningún cliente construiría nada.
- Mal, porque el índice serializado triplica el núcleo comprimido (§8.8): la primera visita bajaría más, no menos.
- Mal, porque cualquier cambio del formato o del *ranking* obligaría a publicar otro índice y a coordinarlo con la versión de la app.

### 3 · Búsqueda en el servidor para la primera visita

- Bien, porque la primera consulta no esperaría a ninguna descarga.
- Mal, porque añade un servidor que mantener y cada pulsación de la primera visita saldría del dispositivo (§11.2), al contrario de la arquitectura elegida (§5 y ADR-001).
- Mal, porque daría resultados distintos de los locales durante unos segundos.

### 4 · Solo el índice persistido

- Bien, porque es lo más sencillo: no toca el pipeline.
- Mal, porque no cumple RNF-05: la primera visita esperaría al núcleo entero, como en M2.

## Más información

- `prototipe.md`: §3.2 (RNF-04 y RNF-05), §7.6 (ficheros del catálogo), §8.8 (disponibilidad y estados), §8.9 (presupuestos) y §15.6 (CA3.1 y CA3.2).
- `docs/planificacion/DECISIONES.md`: §10.25 (índice persistido tal como se ha construido) y §10.30 (núcleo de arranque tal como se ha construido).
- `docs/medidas/ca3.2-20261102.md`.
- ADR relacionados: [ADR-005](005-busqueda-local-en-un-web-worker.md) (búsqueda en el Worker), [ADR-006](006-alcance-y-formato-del-catalogo.md) (formato del catálogo) y [ADR-007](007-pipeline-del-catalogo.md) (pipeline y firma).
