---
status: propuesta
date: 2026-10-31
decision-makers: Lucas (propietario del proyecto)
---

# ADR-007 · Pipeline diario, *manifest* firmado y plan B sin clave

## Contexto y planteamiento del problema

En M1 el catálogo se construyó una vez, en el PC y sin clave (ADR-006). En M2 se construye **cada día**, en GitHub Actions, con la clave de la Web API, y la app lo actualiza sola (§15.5). Eso trae preguntas nuevas: cómo se calculan los **recientes** que cubren el hueco hasta que el núcleo local se renueva, qué **detalles** van en los *shards* de la ficha completa, qué pasa si Steam falla **a medias**, cómo se **firma** el *manifest* sin que la clave privada salga de GitHub y qué **puertas** impiden publicar un catálogo malo. Desarrollo: §4.5–4.10, §7.6, §11.3 y DECISIONES §10.4, §10.5 y §10.12.

¿Cómo construye, comprueba y firma el pipeline el catálogo de cada día, y qué hace cuando Steam o los datos fallan?

## Factores de decisión

- Educado con Steam: ≤230 llamadas al día, ≤10 con clave, ≤0,4 peticiones/s y ≤30 min por ejecución (§4.7; CA2.1).
- Nunca publicar algo peor que lo de ayer: si falla una puerta, la versión anterior sigue servida (CA2.2).
- Seguir publicando si solo falla el enriquecimiento: nombres al día y `enrichmentAgeDays` creciendo (§4.6 y §4.8; CA2.2).
- Integridad de punta a punta: *manifest* firmado con una clave que solo vive en un secreto de GitHub (§11.3; DECISIONES §10.12).
- Ligero para el cliente: `recent` y el índice de *shards* caben en los ≤200 KB diarios del CA2.4.
- Un estado pequeño y autocontenido para la *Release* `catalog-state` (§4.6).
- Formatos y esquemas de `packages/core/src/catalog-format`, sin tocarlos.

## Opciones consideradas

**Recientes:**

1. Guardar en el estado los núcleos de los últimos 14 días y comparar con cada uno.
2. Guardar en cada fila del estado el día de su alta (`addedOn`) y de su último cambio de nombre (`renamedOn`) mientras caigan en la ventana.

**Detalles cuando falla Query:**

1. Guardarlos en el estado, con el resto del último enriquecimiento.
2. Reutilizar los *shards* de la versión desplegada.

**Cuándo «falla el enriquecimiento»:**

1. Solo si Query lanza un error.
2. También si devuelve demasiado pocos juegos de `GetAppList` (<95 %; el 29-10-2026, el 99,88 %).

## Resultado de la decisión

Opciones elegidas: **2** para los recientes, **1** para los detalles de reserva y **2** para el fallo del enriquecimiento, porque así el estado sigue siendo un solo fichero, cada ejecución es completa e idempotente y una Query que «funciona» pero devuelve media lista no deja el catálogo sin reseñas.

### La ejecución

Los pasos 0–5 de la §4.5 y la firma del paso 6 (`pipeline/build.ts` y `pipeline/src/run.ts`):

0. **Estado:** `master.ndjson.gz`, con una cabecera (`{format: "gacat-state", v: 2, version, enrichedOn}`: última versión publicada y día de la última Query correcta) y una fila por juego con sus detalles, `addedOn` y `renamedOn`. El de M1, sin cabecera, se sigue leyendo.
1. **Lista:** `GetAppList` con clave, en páginas de 50 000. **La clave solo va a `GetAppList`**: en M1 el cliente la mandaba a todas las peticiones si la tenía, y Query y `GetItems` son sin clave (§4.4).
2. **Enriquecer:** Query sin clave. Si con clave falla (cualquier error de Steam, o <95 % de L), se publican los nombres de `GetAppList` con el enriquecimiento del estado, detalles incluidos, y `enrichmentAgeDays` = días desde `enrichedOn`. Las altas de ese día van sin reseñas ni detalles hasta que vuelva Query. Sin clave, Query es también la lista: si falla, no hay catálogo.
3. **Huecos:** `GetItems` de H1 ∪ H2, como mucho 4 000 `appid` (20 lotes, el margen de la §4.7). Sin Query no se clasifica H1, que sería toda la lista. Si `GetItems` falla, lo no clasificado se conserva como está en el estado y la ejecución queda «degradada» en el informe.
4. **Construir:** núcleo, `recent`, alias, *shards* e índice (§7.6), con los serializadores de `core`.
5. **Puertas** (§4.6): recuento, renombrados, centinelas, integridad, tamaño, humo y calidad de búsqueda. Si pasan y hay clave de firma, se firma y se comprueba la firma como lo hará la app.

### Ficheros

- **`recent.<hash>.tsv`:** los juegos cuyo `addedOn` o `renamedOn` cae en los últimos 14 días, con sus valores de hoy y en el orden del núcleo. Un renombrado es un cambio de `name` o de `nameEs`, los dos nombres que se buscan. Sin estado (primera versión), no hay altas.
- **Detalles:** `[fmt, capsule, header, [t, p], [score, reviews, pct], plat, deck]`, de lo que ya trae Query con el `data_request` de la §4.5.
  - `asset_url_format` tiene que ser `steam/apps/<appid>/${FILENAME}` (con `?t=` o sin él). Si no lo es, el juego va sin detalles, porque el esquema exige `fmt`: el 29-10-2026, 9 de 197 031.
  - `library_capsule` y `header` se guardan tal cual si tienen forma de fichero de imagen (`[<sha1>/]nombre.jpg|png|…`). Si no, `null`: el 29-10-2026 uno traía `manuals/…pdf#/../../../`.
  - Con `language: spanish`, Steam ya devuelve la variante en español (`…_spanish.jpg`) o, si no la hay, `…_latam.jpg`. Es la que se guarda (§4.10).
  - `t` es `steam_release_date` u `original_release_date`. `p` sale de `coming_soon_display` (`date_full` → `day`…). `soon` y `tba` llevan `t = null`, como el bit 32 del núcleo, que deja `year` vacío.
  - Un *shard* es JSON compacto con las claves en orden: si sus juegos no cambian, conserva su nombre entre versiones.
- ***Manifest*:**
  - `files.recent`, `files.details` y `counts.recent`;
  - `killSwitches`, de `pipeline/kill-switches.json` (versionado, todo `false`);
  - `enrichmentAgeDays`;
  - firmado: `minClientVersion` `0.2.0` y `sig`; sin firma, `0.0.0`.

  Se firma el objeto publicado, no la salida de Zod, y solo si pasan las puertas: lo rechazado no se firma.

### Firma

- En GitHub Actions: `CATALOG_SIGNING_KEY` (privada ed25519, PKCS#8 en PEM) y `CATALOG_SIGNING_KID`.
- El `kid` tiene que estar en `CATALOG_SIGNING_KEYS` y la privada, casar con su pública.
- Una clave `prod` fuera de GitHub Actions (`GITHUB_ACTIONS` distinto de `true`) es un error: el PC nunca firma con ella.
- En el PC y en las pruebas, `--dev-sign` firma con `fixtures/signing/dev-catalog-key.pem` (`dev-1`), en la que ningún *build* de producción confía.
- `--require-signature` hace fallar la ejecución si no hay una clave `prod`: es para `catalog.yml`.

### Salida y códigos

- Si pasan las puertas, `--out` recibe la versión nueva **y conserva la anterior** (cada despliegue la reincluye; CA2.4), y se escribe el estado.
- Si falla una puerta, no se tocan ni `--out` ni el estado, y el catálogo va a `pipeline/state/rejected/<versión>/`.
- El informe (`pipeline/state/reports/<versión>/`) trae `build.json`, con el presupuesto del CA2.1, y `gates.md`, el cuerpo del *issue*.
- Códigos de salida:
  - 0: publicado;
  - 1: falla una puerta;
  - 2: falla una etapa o la configuración;
  - 3: 403 con clave, para relanzar con `--keyless` (§4.8).

### Consecuencias

- Bien, porque la pasada con clave del 31-10-2026, sobre el estado de M1 del 29-10, cumple el presupuesto del CA2.1:
  - 217 llamadas, todas 200 y sin un 429: 4 de `GetAppList` (las únicas con clave), 208 de Query y 5 de `GetItems`;
  - una cada 3 s como mucho (0,333/s);
  - 10,9 min de pasada y 11,3 min en total, con la construcción (4,6 s) y las puertas (20,7 s);
  - 53,7 MB gzip en total; `GetAppList`, 1,2 MB por página.
- Bien, porque esa versión (`20261031.1`) pasa todas las puertas:
  - 197 706 juegos (+0,34 %) y 1 472 renombrados (0,747 %, ≤1 %): la primera ejecución con clave no necesita `--skip-delta-gates`;
  - H1 = 221 y H2 = 18;
  - 205 bloqueados en ES, que ya entran;
  - 3 239 `nameEs`;
  - núcleo 2,26 MB con brotli 11 (2,16 MiB);
  - dorado: top-1 94,9 % y top-5 100 %;
  - exactos: 99,8 %;
  - prefijos: 93,1 %;
  - 2 059 ficheros por despliegue con la versión anterior (≤20 000).
- Bien, porque volver a derivar sin red y sin clave las páginas de esa pasada (`--from-raw`) da los mismos bytes, firma incluida (ed25519 es determinista).
- Bien, porque los tamaños medidos el 31-10-2026 quedan dentro de lo estimado en la §7.6:

  | Fichero | Sin comprimir | gzip -9 | brotli 11 |
  |---|---|---|---|
  | *Shard* (media de 1 024; 193 juegos) | 31,3 KB (máx. 39,9 KB) | 9,0 KB | 7,7 KB (máx. 9,7 KB) |
  | Los 1 024 *shards* | 32,1 MB | 9,21 MB | 7,89 MB (estimado: ≈9,4 MB) |
  | Índice de *shards* | 19,5 KB | 10,1 KB | 9,0 KB |
  | `recent` del 31-10-2026 (2 154 filas) | 125,7 KB | 63,4 KB | 51,5 KB |
  | `recent` en régimen (≈3 934 filas, estimado) | 133 KB | 59 KB | 48,6 KB |

  El de régimen se estima con las 3 696 filas de `appid` más alto de la copia congelada (14 días × ≈264 altas) y 238 al azar (14 × ≈17 renombrados).
- Mal, porque el estado pasa de 3,7 MB a 13,9 MB con gzip -9, sobre todo por los detalles de reserva: con 7 copias, ≈100 MB en la *Release* `catalog-state`.
- Mal, porque 179 juegos van sin detalles:
  - 169 están bloqueados en ES y en US, y `GetItems` solo da su nombre;
  - 10 no traen `asset_url_format`, y el esquema exige `fmt`: pierden también su fecha, sus reseñas y sus plataformas.
- Mal, porque dentro de un mismo `pop` el cliente coloca las altas por `appid` y el núcleo, por reseñas, hasta que se renueva el núcleo local (§7.6; `applyRecent`).
- Neutral, porque el primer `recent` de M2 trae 679 altas en dos días (con los bloqueados de H1) y 1 475 renombrados. Casi todos los renombrados son el paso del nombre base del plan B al de `GetAppList`. A los 14 días baja al tamaño de régimen.
- Pendiente:
  - 3 ejecuciones programadas seguidas en verde (CA2.1): hasta entonces, «propuesta»;
  - la clave pública de producción en `CATALOG_SIGNING_KEYS` (sin ella, `--require-signature` falla);
  - medir `recent` en régimen, a los 14 días.

### Confirmación

- Pruebas sin red en `pipeline/test/`:
  - `publish.test.ts`: el CA2.2 de punta a punta, con un Steam de mentira sacado de la copia congelada del núcleo real (≈3 000 juegos, dorado real y todas las puertas). Fuerza el fallo de cada puerta (recuento, centinela, humo, calidad de búsqueda y tamaño) y comprueba que `--out` y el estado no cambian y que lo rechazado no se firma. Comprueba también que, si Query pide clave o devuelve poco, se publican los nombres y `enrichmentAgeDays` crece (1, 2 y vuelve a 0). Los recientes aplicados al núcleo del día anterior dan el del día siguiente.
  - `details.test.ts`, `signing.test.ts` y `gates.test.ts`: detalles y rutas validadas, ventana de 14 días, firma y salvaguardas, e integridad de `recent` y de los *shards*.
  - `pipeline.test.ts`: la orden con `--source=fixtures`; con `--dev-sign` da los mismos bytes dos veces, y los códigos 1 y 2.
- Cada `catalog:build` pasa las puertas con `@gameagenda/core/search-quality` sobre el núcleo nuevo y guarda el presupuesto del CA2.1 en `build.json`.
- Pendiente de la parte de publicación: CA2.1 con `catalog.yml`, y que se abra el *issue* y siga servida la versión anterior en un fallo real.

## Pros y contras de las opciones

### Recientes: 1 · Núcleos de 14 días

- Bien, porque es la definición literal: lo que cambió frente a cada núcleo que puede tener un cliente.
- Mal, porque son ≈14 × 3 MB más en el estado y 14 comparaciones de 197 000 filas al día.

### Recientes: 2 · Fechas en cada fila (elegida)

- Bien, porque el estado ya trae los nombres de la versión anterior: basta una comparación al día, y la ventana se arrastra en ≈4 000 filas.
- Bien, porque un juego renombrado dos veces en la ventana sigue en `recent` aunque vuelva a su nombre de hace 14 días.
- Mal, porque, si el estado se pierde, la ventana empieza de cero (como la primera versión).

### Detalles de reserva: 1 · En el estado (elegida)

- Bien, porque es lo que pide la §4.6 («último enriquecimiento fechado») y el estado basta para reconstruir todo.
- Mal, porque el estado ocupa ≈8,7 MB más con gzip.

### Detalles de reserva: 2 · Los *shards* desplegados

- Bien, porque no crece el estado.
- Mal, porque ata la construcción al despliegue: en un *runner* limpio no están, y habría que bajarlos de `ga-catalog` antes de construir.

### Fallo del enriquecimiento: 1 · Solo si Query lanza un error

- Mal, porque una Query que cambia sus filtros y devuelve media lista pasaría por buena: H1 crecería a miles de juegos (≈decenas de lotes de `GetItems`) y el catálogo perdería sus reseñas.

### Fallo del enriquecimiento: 2 · Error o cobertura <95 % (elegida)

- Bien, porque protege el presupuesto y la popularidad: lo que no es fiable se trata como caído y se usa el último día bueno.
- Mal, porque un umbral fijo puede saltar en falso si Steam cambia mucho en un día; lo vería el informe y crecería `enrichmentAgeDays`.

## Más información

- **En `prototipe.md`:** §4.5 (algoritmo), §4.6 (estado, puertas y ficheros), §4.7 (presupuesto y política HTTP), §4.8 (plan B), §4.10 (portadas), §7.6 (formatos), §11.3 (firma) y §15.5 (M2).
- **Porqué:** [`DECISIONES.md`](../planificacion/DECISIONES.md), §10.4, §10.5 y §10.12.
- **Código:** `pipeline/src/` (`run.ts`, `recent.ts`, `details.ts`, `signing.ts`, `gates.ts`, `output.ts` y `state.ts`) y el contrato en `packages/core/src/catalog-format/`.
- **Relacionados:** ADR-003 (despliegue y CI), ADR-006 (alcance y formato del catálogo) y ADR-008 (portadas, M2).
