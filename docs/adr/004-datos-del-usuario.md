# ADR-004 · Datos del usuario: Dexie, ids naturales, estados y marcas, HLC y `outbox`

- **Estado:** aceptada
- **Fecha:** 29-10-2026
- **Deciden:** el usuario y el asistente

## Contexto y problema

La agenda vive en el dispositivo (ADR-001) y no hay servidor hasta M4. En M4, el mismo usuario apuntará desde el móvil y desde el PC, y las dos réplicas tendrán que converger sin preguntar. Además:

- cada acción tiene que verse en ≤100 ms (RNF-03);
- la agenda no se puede perder (RNF-08).

¿Cómo se guardan, identifican y fusionan las entradas para que M1 responda al instante y la sincronización de M4 sea un añadido, no una reescritura?

## Factores de la decisión

- Toque → respuesta visible ≤100 ms, sin tareas de más de 50 ms en el hilo principal (RNF-03).
- Durabilidad: exportar → borrar → importar devuelve el mismo estado, HLC incluidas (RNF-08).
- Convergencia sin coordinación: dos dispositivos que apuntan el mismo juego sin red acaban en la misma fila.
- Un estado exclusivo y marcas independientes, con reglas que se cumplen aunque los datos lleguen incompletos (Platinado ⇒ Completado; §3.3).
- JS inicial ≤150 KB brotli (§6.2).
- CSP sin `unsafe-eval` (§11.3).
- Varias pestañas abiertas a la vez.

## Opciones consideradas

1. Dexie (IndexedDB) con ids naturales, LWW por campo con HLC y `outbox` desde M1.
2. SQLite WASM en el cliente: el modelo de datos de la planificación y la web de la arquitectura B.
3. Un backend desde el primer día, con cuentas de invitado y D1 (arquitectura C).
4. Un servicio de sincronización: InstantDB.

Dentro de la opción 1 también se evaluaron:

- ids derivados del juego (UUIDv5 de `game_id`);
- LWW por fila en vez de por campo;
- pintar desde IndexedDB con `useLiveQuery`, como decía el plan, o desde una agenda en memoria, que es lo que se ha construido.

## Decisión

Opción elegida: **1**. Es la única que cumple el presupuesto de JS y la respuesta inmediata sin servidor, y deja preparada la sincronización de M4.

### Almacén

- Dexie 4.4.7 con la base `gameagenda` y el esquema 1 tal cual la §7.2 (`apps/web/src/db/database.ts`).
- Tablas: `entries`, `outbox`, `settings` y `meta`.
  - En `meta`, la interfaz usa `hlcClock`, `backup` y `errorLog`.
  - El Worker de búsqueda no toca la base en M1 (ver ADR-005).
- `navigator.storage.persist()` se pide en la primera escritura.

### Modelo (`packages/core/src/entries`)

- **Estado:** uno de los cinco de la §3.3, siempre exactamente uno.
- **Marcas:** `platinum`, `owned` y `next`, en el registro abierto `flags`.
- **Otros campos:** `rank` (clave fraccionaria en base 62), `note`, `platform`, las cinco fechas, copias de `title` y `cover`, la lápida `deletedAt` y `mergedInto`.
- **Ids naturales:** `steam:<appid>` (solo lo construye `steamEntryId()`) y `manual:<uuidv7>`. Un enlace pegado que no está en el catálogo queda como provisional, con el mismo id.
- **Acciones:** funciones puras que devuelven la entrada nueva, sus operaciones y el paso de Deshacer. Deshacer es otra acción.
- **Apuntar** escribe unos 15–17 campos con la HLC de la acción:
  - en un alta nueva son 15: el estado, las tres marcas, `rank`, `note`, `platform`, las cinco fechas, `title`, `cover` y `deletedAt`;
  - volver a apuntar una lápida añade `mergedInto`, si lo tenía, y pone a `false` cada marca propia que tuviera.

### Relojes y operaciones (`packages/core/src/sync`)

- **HLC:** 27 caracteres que se comparan como texto.
- **Nodo:** aleatorio por pestaña, con `randomNode()` sobre `crypto.getRandomValues`.
- **Reloj:** se guarda en `meta.hlcClock` con cada lote. Al arrancar, recibe la mayor HLC guardada.
- **Ids nuevos:** los `opId` y los ids manuales son uuidv7.
- **Operaciones:** cada acción escribe la entrada y sus operaciones `{ opId, entryId, field, value, hlc }`, todas con la misma HLC.
- **`merge()`:**
  - aplica LWW por campo; a igual HLC, gana el mayor `canon(value)`;
  - una operación de una entrada desconocida crea un esqueleto invisible;
  - Platinado ⇒ Completado se deriva por relojes, con la HLC de la marca.

### Diferencia con el pseudocódigo de la §7.4

Cuando cambia `mergedInto`, `merge()` reenvía al destino el estado actual de todos los campos de usuario del manual, no solo las operaciones del lote. También reenvía la derivada de Platinado.

Con el pseudocódigo literal, el resultado en el destino dependía del orden de llegada de la vinculación y de las operaciones del manual. `applyOps()` sigue las derivadas entre entradas hasta 8 saltos.

### Escritura en dos tiempos (`apps/web/src/agenda/agenda.ts`)

1. La agenda aplica cada acción en memoria, de forma síncrona, y React la pinta con `useSyncExternalStore`.
2. Después del fotograma (`requestAnimationFrame` más una tarea; como mucho 50 ms en una pestaña oculta), guarda el lote en una transacción `rw` de Dexie que escribe `entries`, `outbox` y `meta.hlcClock`.
3. Los lotes se guardan en una cola ordenada. Si uno falla, se queda en la cola y se reintenta antes del siguiente.

Medido en WebKit, empezar la transacción en el mismo evento subía la respuesta a 64–134 ms; empezarla después del fotograma la deja en 7–33 ms. En WebKit para Windows, IndexedDB tarda unos 15 ms por petición y unos 260 ms por alta.

### Pestañas

- No se usa `useLiveQuery`.
- La agenda escucha el evento `storagemutated` de Dexie, que llega también de las demás pestañas por `BroadcastChannel`.
- Solo relee las claves cambiadas, o todas si el evento trae `all`.
- Lo que esta pestaña aún no ha guardado no se pisa.
- Si otra pestaña ha cambiado una entrada desde que se leyó, la transacción fusiona las operaciones del lote sobre lo guardado con `merge()`, en vez de pisarlo (`apps/web/src/db/agenda-storage.ts`).

### Exportar, importar y borrar (`packages/core/src/schemas` y `apps/web/src/data`)

- **Exportar** en JSON (`gameagenda-export`, versión 1, con lápidas y HLC) y en CSV para Excel en español.
- **Importar un JSON** es fusionar con `applyOps()`:
  - antes valida con Zod (≤10 MB), rechaza las HLC que van más de 5 min por delante y guarda una copia en `meta.backup`;
  - también aplica los ajustes del fichero.
- **Importar un CSV** solo da altas.
- **«Borrar todos mis datos»** vacía las cuatro tablas, las cachés `gacat-*` y la pila de Deshacer.

### Zod sin JIT

`packages/core/src/zod-config.ts` activa `z.config({ jitless: true })`, porque la CSP no admite `unsafe-eval`: Zod prueba `new Function` y el navegador lo informa como violación.

La exportación, la importación y Zod van en un *chunk* diferido de 25,9 KiB, fuera del JS inicial.

### Degradación

- Si IndexedDB no está disponible o no contesta en 8 s, la app funciona solo en memoria y avisa con «Guardado fallido · Exportar».
- Si falla un guardado, el aviso ofrece «Exportar · Reintentar».

### Consecuencias

- Bien, porque cada acción se pinta en su fotograma y el guardado nunca compite con él.
- Bien, porque todas las réplicas convergen con la misma `merge()`, conmutativa e idempotente y sin claves foráneas: dos pestañas, una importación y, en M4, otro dispositivo.
- Bien, porque vincular un manual da el mismo resultado sea cual sea el orden de llegada.
- Bien, porque Dexie cabe en el presupuesto: el JS inicial pesa 113 KiB brotli (ver ADR-002).
- Mal, porque cada entrada ocupa ≈0,8–1,1 KB con sus HLC.
- Mal, porque la `outbox` crece con cada acción y no se compacta hasta M4. `compactOutbox()` y `takeBatch()` ya están en `core`, pero la web no los usa.
- Mal, porque un cambio solo vive en memoria hasta que su lote se guarda (un fotograma más la transacción). Si la pestaña se cierra entretanto, se pierde.
- Mal, porque en WebKit para Windows IndexedDB es lento. No retrasa la respuesta, pero sí el momento en que el cambio queda guardado.
- Pendiente: falta el aviso para exportar tras 30 días sin copia (RNF-08). No está en el código de M1.
- Pendiente: probar la primera migración de Dexie cuando exista la versión 2 del esquema.
- Pendiente: decidir si `dexie-react-hooks` se queda. El plan contaba con `useLiveQuery` (§6.1 y D-02).

### Confirmación

- **Propiedades** (fast-check, 1 000 casos cada una, en `packages/core/test/sync.properties.test.ts`):
  - las mismas operaciones, en cualquier orden, en lotes o repetidas, dan el mismo estado;
  - las réplicas con datos incompletos convergen;
  - `merge(a, b)` = `merge(b, a)`;
  - Platinado ⇒ Completado se cumple tras cada fusión;
  - compactar la `outbox` no cambia el estado al que se llega.
- **Vitest con `fake-indexeddb`** (`apps/web/src/agenda/agenda.test.ts`):
  - persistir y reabrir conserva las HLC;
  - Deshacer devuelve el estado exacto;
  - dos cambios en la misma entrada se fusionan campo a campo;
  - borrar en una pestaña vacía la otra;
  - la agenda funciona solo en memoria;
  - «Reintentar» guarda en orden.
- **E2E:**
  - `agenda-dexie.spec.ts`: CA1.6, CA1.8, CA1.12 y dos pestañas;
  - `data.spec.ts`: exportar → borrar → importar deja lo mismo y reimportar no duplica (CA1.9), el CSV, un fichero no válido y borrar todo;
  - `storage-failed.spec.ts`: la app sin IndexedDB.

## Pros y contras de las opciones

### 1 · Dexie, ids naturales, LWW por campo con HLC y `outbox`

- Bien, porque tiene esquema versionado e índices compuestos (`[view+rank]`).
- Bien, porque cabe en el presupuesto: React con Dexie y la lista virtual pesan 94,5 KB brotli.
- Bien, porque reduce la sincronización de M4 a subir la `outbox` y fusionar lo que llega.
- Mal, porque guarda una HLC por campo y una operación por cada cambio.

### 2 · SQLite WASM en el cliente

- Bien, porque el modelo sería el mismo SQL que D1 en M4.
- Mal, porque solo el motor ocupa ≈397 KiB gzip, cuando el presupuesto de JS inicial es de 150 KB brotli para toda la app.

### 3 · Backend con cuentas de invitado desde el primer día

- Bien, porque habría una copia fuera del dispositivo desde M1.
- Mal, porque exige un backend multiusuario (invitados, sesiones, fusión de cuentas y purgas) antes de apuntar el primer juego.

### 4 · InstantDB

- Mal, porque cerró las altas y apaga su nube el 31-08-2027.

### Variantes descartadas dentro de la opción 1

- **Ids derivados (UUIDv5 de `game_id`):** dejan de corresponder al juego si una fusión reescribe ese campo. Entonces se duplican filas o se atasca la sincronización.
- **LWW por fila:** una escritura automática con una HLC nueva pisa lo que el usuario ha cambiado en otros campos.
- **`useLiveQuery`:**
  - pintaría lo guardado y no lo pulsado, así que cada cambio esperaría a IndexedDB;
  - además, repetiría la consulta entera tras cada transacción.
- **Empezar la transacción en el mismo evento:** en WebKit, 64–134 ms hasta la respuesta.

## Más información

- **En `prototipe.md`:**
  - [§3.3](../../prototipe.md#33-modelo-de-estados): estados, marcas y fechas;
  - [§7.2](../../prototipe.md#72-esquema-dexie): esquema de Dexie;
  - [§7.3](../../prototipe.md#73-identificadores-naturales-y-vinculación): ids y Vincular;
  - [§7.4](../../prototipe.md#74-hlc-por-campo-outbox-y-merge): HLC, `outbox` y `merge()`;
  - [§7.5](../../prototipe.md#75-exportación-e-importación): exportar e importar;
  - [§9.6](../../prototipe.md#96-estados-del-sistema): avisos;
  - [§12.2](../../prototipe.md#122-propiedades-contrato-y-canario): pruebas de propiedades.
- **Porqué:** [`DECISIONES.md`](../planificacion/DECISIONES.md), en D-03 a D-06. La §10.7 fija los relojes y el nodo por pestaña.
- **Revisión del modelo de datos:** `docs/planificacion/lineas-paralelas/T2-modelo-de-datos.revisado.md`, donde está el porqué de los ids naturales y de LWW por campo.
- **Relacionados:** ADR-001 (arquitectura), ADR-005 (el Worker no importa Dexie) y ADR-011 (sincronización, M4).
