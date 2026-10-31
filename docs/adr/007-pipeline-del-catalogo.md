---
status: propuesta
date: 2026-10-31
decision-makers: Lucas (propietario del proyecto)
---

# ADR-007 · Pipeline diario, publicación firmada y plan B sin clave

## Contexto y planteamiento del problema

En M1 el catálogo se construyó una vez, en el PC y sin clave (ADR-006). En M2 se construye **cada día**, en GitHub Actions, con la clave de la Web API, y la app lo actualiza sola (§15.5). Eso trae preguntas nuevas: cómo se calculan los **recientes** que cubren el hueco hasta que el núcleo local se renueva, qué **detalles** van en los *shards* de la ficha completa, qué pasa si Steam falla **a medias**, cómo se **firma** el *manifest* sin que la clave privada salga de GitHub y qué **puertas** impiden publicar un catálogo malo. Desarrollo: §4.5–4.10, §7.6, §11.3 y DECISIONES §10.4, §10.5 y §10.12.

Además, el catálogo se **publica** solo (paso 6 de la §4.5, §12.5), con estas condiciones:

- **Repositorio público:** los minutos no cuentan, pero el cron se desactiva tras 60 días sin actividad (R-04), y los artefactos y las *Releases* son públicos.
- **`ga-catalog` en otra cuenta de Cloudflare:** el *token* de «Workers Scripts: Edit» abarca toda la cuenta, así que el del pipeline no debe poder desplegar `ga-web` (§11.3).
- **Cada `wrangler deploy` sustituye todos los *assets*:** sin más, un cliente con el *manifest* anterior se quedaría sin sus ficheros.

¿Cómo construye, comprueba, firma y publica el pipeline el catálogo de cada día, con qué secretos y permisos, y qué hace cuando Steam, los datos o la publicación fallan?

## Factores de decisión

- Educado con Steam: ≤230 llamadas al día, ≤10 con clave, ≤0,4 peticiones/s y ≤30 min por ejecución (§4.7; CA2.1).
- Nunca publicar algo peor que lo de ayer: si falla una puerta, no se publica nada, la versión anterior sigue servida y se abre un *issue* (CA2.2).
- Seguir publicando si solo falla el enriquecimiento: nombres al día y `enrichmentAgeDays` creciendo (§4.6 y §4.8; CA2.2).
- Tras un despliegue, un cliente con el *manifest* anterior sigue funcionando (CA2.4).
- Integridad de punta a punta: *manifest* firmado con una clave que solo vive en un secreto de GitHub, y el PC nunca firma ni despliega `ga-catalog` (§11.3; DECISIONES §10.12).
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

**De dónde sale la versión anterior que se vuelve a desplegar (CA2.4):**

1. Del `ga-catalog` publicado.
2. Del estado de la *Release* `catalog-state`.

**Pipeline desde el PC (429 en los *runners* compartidos, R-03):**

1. Subir `pipeline/out/` y el estado nuevo, como decía el plan.
2. Subir las páginas crudas de Steam y volver a derivar el catálogo en el CI.

## Resultado de la decisión

Opciones elegidas: **2** para los recientes, **1** para los detalles de reserva, **2** para el fallo del enriquecimiento, **1** para la versión anterior y **2** para el PC. Así:

- el estado sigue siendo un solo fichero y cada ejecución es completa e idempotente;
- una Query que «funciona» pero devuelve media lista no deja el catálogo sin reseñas;
- lo que se vuelve a desplegar es justo lo que tienen los clientes;
- las puertas y la firma corren siempre en el CI, y del PC solo se usan las respuestas de Steam.

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

- En GitHub Actions: `CATALOG_SIGNING_KEY` (privada ed25519, PKCS#8 en PEM) y `CATALOG_SIGNING_KID` (por defecto, `prod-1`).
- El `kid` tiene que estar en `CATALOG_SIGNING_KEYS` y la privada, casar con su pública.
- Una clave `prod` fuera de GitHub Actions (`GITHUB_ACTIONS` distinto de `true`) es un error: el PC nunca firma con ella.
- En el PC y en las pruebas, `--dev-sign` firma con `fixtures/signing/dev-catalog-key.pem` (`dev-1`), en la que ningún *build* de producción confía.
- `--require-signature` hace fallar la ejecución si no hay una clave `prod`: es para `catalog.yml`.
- **`prod-1`:** generada el 31-10-2026; su pública está en `CATALOG_SIGNING_KEYS` (`9ace9f8`) y la privada, solo en el secreto. El fichero del PC se borró tras la primera publicación firmada.

### Salida y códigos

- **Opciones de `catalog:build`** que usan `catalog.yml` y `catalog:stage`:
  - `--version=<v>` fija la versión. El flujo la calcula con la publicada, porque en el *runner* `pipeline/out/` está vacío;
  - `--keyless` y `--skip-delta-gates`;
  - `--from-raw=<carpeta>` rederiva sin red; `--now=<ISO>` fija el momento de la ejecución; `--raw=<carpeta>` dice dónde guardar las páginas crudas, que no llevan la clave (viaja en una cabecera). Con el mismo estado y `--now`, `--from-raw` no hace ninguna petición;
  - `--dev-sign` y `--require-signature` (ver «Firma»).
- Si pasan las puertas, `--out` recibe la versión nueva **y conserva la anterior** (cada despliegue la reincluye; CA2.4), y se escribe el estado.
- Si falla una puerta, no se tocan ni `--out` ni el estado, y el catálogo va a `pipeline/state/rejected/<versión>/`.
- El informe (`pipeline/state/reports/<versión>/`) trae `build.json` y `gates.md`, el cuerpo del *issue*. `build.json` lleva `version`, `mode`, `counts`, `requests` (por *endpoint*, con `network` y `keyed`), `budget` (el presupuesto del CA2.1), `timingsMs` y `gates`; `catalog-report.ts` lo lee todo como opcional.
- Códigos de salida:
  - 0: publicado;
  - 1: falla una puerta;
  - 2: falla una etapa o la configuración;
  - 3: 403 con clave, para relanzar con `--keyless` (§4.8).

### Publicación: `.github/workflows/catalog.yml`

- **Disparadores:**
  - `schedule` a las **04:17 UTC** (`17 4 * * *`): las 05:17 en Madrid en invierno (CET, UTC+1) y las 06:17 en verano (CEST, UTC+2). Se escribe en UTC; el :17 evita la cola de las horas en punto. GitHub puede retrasarlo: lo cubre el *dead-man switch*.
  - El cron solo corre si la variable **`CATALOG_SCHEDULE`** vale `on`. Así, fusionar el flujo antes de crear los secretos no abre un *issue* cada mañana, y `off` lo pausa sin desactivarlo.
  - `workflow_dispatch`, con cuatro entradas:
    - `source`: `steam` o `staging`;
    - `skip_delta_gates`: tras un parón largo, §4.6;
    - `keyless`: plan B con la clave revocada, §4.8;
    - `no_previous`: primera publicación en un origen nuevo.
- **Solo desde `main`**, una ejecución cada vez (`concurrency: catalog`, sin cancelar la que corre) y ≤30 min (`timeout-minutes: 30`; la construcción tiene 22).
- **Permisos:** `contents: read` por defecto. El trabajo `publish` añade `contents: write` (las *Releases*) y `report`, `issues: write` y `actions: read`, para leer los pasos de la propia ejecución y bajar su artefacto. Las *actions* son las de `ci.yml`, fijadas por SHA (`checkout` v7.0.1, `setup-node` v7.1.0 y `upload-artifact` v7.0.2); no entra ninguna nueva.
- **Configuración en un solo sitio:** el `env` de arriba del flujo, con un valor por defecto que manda una variable del repositorio si existe:
  - `CATALOG_ORIGIN`, por defecto `https://ga-catalog.gameagenda-cat.workers.dev`;
  - `WEB_ORIGIN`, por defecto `https://ga-web.gameagenda.workers.dev`, que tiene que coincidir con el CORS de `pipeline/catalog.headers` (se comprueba);
  - `CATALOG_SIGNING_KID`, por defecto `prod-1`.

**Trabajo `publish`**, en orden:

| # | Paso | Qué hace | Si falla |
|---|---|---|---|
| 1 | Aviso de inicio | `GET $HEALTHCHECKS_PING_URL/start` | Avisa y sigue |
| 2 | Configuración | Secretos obligatorios; CORS de `catalog.headers` = `WEB_ORIGIN`; SHA-256 de la clave real (para la búsqueda) y aviso si no coincide con la variable `STEAM_KEY_SHA256` | Para |
| 3 | Canario (solo `steam`) | `scripts/catalog-canary.ts`: `GetAppList` con clave (10 juegos) y Query sin clave (10), con el cliente y los contratos Zod del pipeline. Con clave, un fallo de Query solo avisa (si falla solo el enriquecimiento se publican los nombres, §4.6) | Para en ≤4 min |
| 4 | Estado anterior | `catalog-release.ts restore-state` | Para |
| 5 | `catalog:stage` (solo `staging`) | `catalog-release.ts download-stage`: comprueba que se construyó con el estado vigente y tiene ≤36 h | Para |
| 6 | Versión | `catalog-live.ts next-version`: la publicada en `CATALOG_ORIGIN` y la siguiente (§11.3: el cliente rechaza las anteriores) | Para |
| 7 | Construye y firma | `npm run catalog:build -- --version=<v> --require-signature` (+ `--keyless`, `--skip-delta-gates`; con `staging`, `--from-raw` y `--now`), con `STEAM_WEB_API_KEY`, `CATALOG_SIGNING_KEY` y `CATALOG_SIGNING_KID`. Puertas: las del pipeline | Para: no se publica (CA2.2) |
| 8 | Búsqueda en `pipeline/out` | `scan-secrets.ts` con el *hash* de la clave real, y ninguna `PRIVATE KEY` | Para |
| 9 | Monta `pipeline/dist` | `assemble-catalog.ts pipeline/out --previous=$CATALOG_ORIGIN --signature=prod` | Para |
| 10 | Búsqueda en `pipeline/dist` | Igual que el 8 | Para |
| 11 | Despliega | `npm run catalog:publish`: `wrangler deploy` con `CATALOG_CLOUDFLARE_*` | Para |
| 12 | Prueba de humo | `catalog-smoke.ts`, ver abajo | Falla: ya está publicado |
| 13 | Estado nuevo | `catalog-release.ts save-state --version=<v>` | Falla: ya está publicado |
| 14 | Ejecución correcta | `POST $HEALTHCHECKS_PING_URL` | Avisa |
| — | Siempre | Resumen en `$GITHUB_STEP_SUMMARY`; búsqueda de la clave en lo que va a los artefactos; artefacto `run-report` (`pipeline/state/reports/`, 30 días) y, si falla, `rejected-catalog` (7 días) | — |

**Trabajo `report`**, si `publish` acaba en `failure` o `cancelled`, también por exceder el tiempo:

- lee los pasos fallidos (`gh run view --json jobs`) y el artefacto `run-report`;
- escribe el informe con `catalog-report.ts`: pasos, puertas, llamadas, final del registro y si se llegó a desplegar. Nada que parezca la clave sale del *runner*;
- envía `/fail` a healthchecks.io con ese informe;
- abre el *issue* con la etiqueta `catalogo`, o comenta el abierto. Se cierra a mano.

**Prueba de humo** (`scripts/catalog-smoke.ts`), contra la URL que devuelve `wrangler`:

- `manifest.json`: el mismo texto que el montado (espera ≤2 min al CDN), con una firma `prod` válida, `no-cache` y CORS para `WEB_ORIGIN`;
- **cada fichero de `pipeline/dist`**, los de la versión nueva y los de la anterior: 200, el mismo SHA-256, CORS e `immutable`. Los TSV, además, con `text/plain; charset=utf-8`; si el núcleo llega sin `Content-Encoding`, avisa (R-16);
- un fichero con *hash* que no existe: 404 con CORS (§5.4);
- que `wrangler` ha publicado en `CATALOG_ORIGIN`; si no, falla y pide cambiar la variable, o la siguiente ejecución no conservaría esta versión;
- la tabla de cabeceras que hacía `deploy-catalog.yml` en M0 queda en el resumen.

### Versión anterior (CA2.4)

`assemble-catalog.ts --previous=<origen>` lee el `manifest.json` vigente y baja los ficheros que cita: el índice y los *shards* que no están ya en la versión nueva. Cada uno se comprueba con su SHA-256 o el prefijo de su nombre. La carpeta de despliegue lleva:

- la versión nueva entera;
- los ficheros de la anterior que no están en la nueva;
- solo el `manifest.json` nuevo.

Si una ruta está en las dos, tiene que tener el mismo contenido.

- **Qué cuesta:** ≈1 030 peticiones al propio `ga-catalog` (16 a la vez, unos segundos). Los *assets* estáticos son gratis.
- **404 del *manifest*:** es la primera publicación y no hay nada que conservar. Cualquier otro fallo para el montaje: sin saber qué hay publicado, no se despliega. En un origen nuevo, `no_previous=true` se salta la descarga.
- **Solo la anterior:** un cliente con dos versiones de retraso recibe un 404, relee el *manifest* y reintenta (§5.4, principio 8).
- **Límites del plan gratuito,** comprobados antes de escribir nada: ≤20 000 ficheros de ≤25 MiB. Hoy son ≈2 060.
- **Lo que se valida, en la versión nueva y en la anterior:**
  - el *manifest* (esquema de `core`);
  - cada fichero: bytes, SHA-256 y prefijo del *hash* en el nombre;
  - el índice de *shards* (esquema y versión);
  - cada *shard*: prefijo del *hash* y, en la nueva, su esquema Zod y que cada `appid` cae en su *shard*;
  - que la nueva es posterior.

  Lo que hay en `pipeline/out` y no cita el *manifest* se avisa y no se publica.
- **La firma:**
  - con `--signature=prod`, es obligatoria y de una clave `prod` de `CATALOG_SIGNING_KEYS`. Si la pública aún no está en `packages/core/src/catalog-format/signature.ts`, no se despliega, porque el cliente lo rechazaría;
  - sin opción, una firma presente tiene que ser válida. El mini-catálogo de M0, sin firma, sigue montándose (`node scripts/assemble-catalog.ts`).

### Estado entre ejecuciones (*Release* `catalog-state`)

- **Qué es el estado:** todo `pipeline/state/` menos las páginas crudas (`raw-*`), los informes y los rechazados. Va en un `.tgz` (ustar, sin fechas ni dueños, `scripts/tar.ts`) llamado `state-<versión>.tgz`.
- **Copias:** se guardan las **7 más recientes**. Se restaura la de versión más alta y, al restaurarla, sustituye el estado local.
- **Cuándo se sube:** **solo después de desplegar y pasar la prueba de humo**. Un estado de algo que no se publicó haría que las puertas de variación compararan con un catálogo que no existe.
- **Sin estado:** es la primera ejecución de M2 y todo es alta; las puertas de variación se saltan como en la primera versión y no hay recientes. Si no existe, la *Release* se crea en el primer `save-state`, como *prerelease* y sin `latest`.
- **Herramienta:** `gh` con el `GITHUB_TOKEN`.

### Desde el PC (`catalog-staging`)

`npm run catalog:stage`:

1. Baja el estado de `catalog-state`, el mismo que restaurará el flujo.
2. Construye en el PC con `--now` y `--raw` fijos, sin `CATALOG_SIGNING_KEY` y con `--dev-sign`. Si falla una puerta, no sube nada.
3. Busca la clave en las páginas crudas descomprimidas.
4. Sube `stage.tgz` a la *Release* `catalog-staging`: `stage.json` (estado usado, `runAt`, con o sin clave, *commit*) y `raw/`, las páginas crudas.

`--no-upload` deja el paquete en `%TEMP%` sin subirlo.

Después, `gh workflow run catalog.yml -f source=staging`, que:

- comprueba que el estado vigente es el que usó el PC y que el paquete tiene ≤36 h;
- **vuelve a derivar el catálogo sin red** (`--from-raw` y el mismo `--now`), con el código de `main`. Si las páginas crudas traen `GetAppList`, la ejecución es con clave aunque el *runner* no la use;
- pasa las puertas, firma, monta, despliega y guarda el estado.

El cliente de Steam en modo `offline` falla antes de tocar la red, así que con `staging` no hay llamadas. `catalog:publish` se niega fuera de GitHub Actions y sin una firma `prod`: el PC no puede desplegar `ga-catalog` ni por error.

### `deploy-catalog.yml`: retirado

Se integra en `catalog.yml` y se borra:

- su prueba de humo, la tabla de cabeceras de M0 y el 404, está ahora en `catalog-smoke.ts`;
- ya no sirve: CA0.2 y CA0.3 están cerrados;
- desplegaría el mini-catálogo sin firmar encima del real, con una versión anterior que los clientes rechazan, así que los usuarios nuevos se quedarían sin catálogo;
- usa `CLOUDFLARE_*`, el *token* de la cuenta de `ga-web`.

Para mirar el mini-catálogo en local: `node scripts/assemble-catalog.ts` y `npx wrangler dev -c pipeline/wrangler.jsonc`.

### Cron desactivado (R-04)

- **Lo que ya lo cubre:**
  - `workflow_dispatch`;
  - el *dead-man switch*: el correo de healthchecks.io a las 36 h, y `gh workflow enable catalog.yml` lo reactiva;
  - cualquier *commit* reinicia la cuenta de 60 días.
- **Si se repite:** se quita el `schedule` (la desactivación solo afecta a los flujos con cron) y un **Cron Trigger de Cloudflare**, en la cuenta de `ga-catalog`, lanza cada día `POST /repos/LucasPrezFdez/gameagenda/actions/workflows/catalog.yml/dispatches` (`{"ref":"main"}`). Lo hace con un *token* *fine-grained* de solo «Actions: Read and write» en este repositorio, guardado como secreto del Worker. El plan gratuito admite 5 *triggers* por cuenta.
- **A verificar en M2:** que un flujo sin `schedule` no se desactiva y que `PUT …/actions/workflows/catalog.yml/enable` reactiva uno desactivado.

### Secretos y variables

| Nombre | Tipo | Valor | Quién lo usa | Estado (31-10-2026) |
|---|---|---|---|---|
| `STEAM_API_TOKEN` | Secreto | La clave de la Web API; el flujo la pasa como `STEAM_WEB_API_KEY` | Canario, construcción, configuración (*hash*) | Existe |
| `STEAM_KEY_SHA256` | Variable | SHA-256 de la clave (`ci.yml` y el *issue*) | `ci.yml`, `deploy-web.yml`, `report` | Existe |
| `CATALOG_SIGNING_KEY` | Secreto | Privada ed25519 de `prod-1`, PEM PKCS#8 | Construcción | Existe |
| `CATALOG_SIGNING_KID` | Variable (opcional) | `kid` de su pública en `CATALOG_SIGNING_KEYS`; por defecto `prod-1` | Construcción | Sin crear: vale el de por defecto |
| `CATALOG_CLOUDFLARE_API_TOKEN` | Secreto | *Token* de la cuenta de `ga-catalog` con solo «Account › Workers Scripts › Edit» | Despliegue | Existe |
| `CATALOG_CLOUDFLARE_ACCOUNT_ID` | Secreto | Id de esa cuenta | Despliegue | Existe |
| `HEALTHCHECKS_PING_URL` | Secreto | `https://hc-ping.com/<uuid>` del *check* «catalog» | Avisos | Existe |
| `CATALOG_ORIGIN` | Variable | `https://ga-catalog.gameagenda-cat.workers.dev` | Versión, montaje, prueba de humo | Existe |
| `WEB_ORIGIN` | Variable (opcional) | Origen de `ga-web`; por defecto `https://ga-web.gameagenda.workers.dev` | Configuración, prueba de humo | Sin crear: solo con dominio propio |
| `CATALOG_SCHEDULE` | Variable | `on` activa el cron diario; `off` lo pausa | `publish` | `on` desde las 13:47 UTC |

`CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`, los de `ga-web`, ya no los usa ningún flujo del catálogo.

### *Runbook*

#### Puesta en marcha (hecha el 31-10-2026)

1. **Cuenta de Cloudflare para `ga-catalog`.**
   1. Créala y registra su subdominio de `workers.dev` en el panel (Workers & Pages), o con `PUT /accounts/<id>/workers/subdomain`. Sin él, `wrangler deploy` falla. El 31-10-2026: `gameagenda-cat`.
   2. Crea un *token* propio, personalizado (no la plantilla «Edit Cloudflare Workers», que da más permisos), con solo «Account › Workers Scripts › Edit» en esa cuenta y sin caducidad ni filtro de IP.
   3. Guarda los secretos `CATALOG_CLOUDFLARE_API_TOKEN` y `CATALOG_CLOUDFLARE_ACCOUNT_ID`.
2. **Clave de firma de producción.** Desde Git Bash:

   ```bash
   node -e "const c=require('node:crypto');const k=c.generateKeyPairSync('ed25519');require('node:fs').writeFileSync(process.env.TEMP+'/catalog-key.pem',k.privateKey.export({type:'pkcs8',format:'pem'}));console.log(k.publicKey.export({format:'jwk'}).x)"
   gh secret set CATALOG_SIGNING_KEY < "$TEMP/catalog-key.pem" && rm "$TEMP/catalog-key.pem"
   ```

   - La línea que imprime es la pública: va en `CATALOG_SIGNING_KEYS` como `{ kid: 'prod-1', ed25519: '…', use: 'prod' }`.
   - Despliega `ga-web` con esa clave **antes** de la primera publicación firmada.
   - Otro `kid` (al rotar, `prod-2`): variable `CATALOG_SIGNING_KID`.
   - La privada no se guarda en ningún otro sitio.
3. **healthchecks.io.**
   1. Crea un *check* «catalog» con periodo de 1 día y gracia de 12 h: avisa a las 36 h sin éxito, o 12 h después de un `/start` sin final.
   2. Guarda su URL en el secreto `HEALTHCHECKS_PING_URL`.
4. **Origen nuevo.** `gh variable set CATALOG_ORIGIN --body https://ga-catalog.<subdominio>.workers.dev`. El CORS de `pipeline/catalog.headers` sigue siendo `https://ga-web.gameagenda.workers.dev`.
5. **Primera publicación.**
   - En la cuenta nueva no hay nada que conservar: `gh workflow run catalog.yml -f no_previous=true`.
   - Hazlo al día siguiente de la última publicación en la cuenta vieja. Sin versión anterior, la nueva es `AAAAMMDD.1` del día, y un cliente con una versión posterior de ese día la rechazaría hasta el siguiente.
   - Comprueba el resumen: canario, puertas, llamadas y prueba de humo.
6. **La app, al origen nuevo, después de la primera publicación.** Cambia `VITE_CATALOG_URL` de `deploy-web.yml` y el `connect-src` de `apps/web/public/_headers`. Antes, `ga-web` apuntaría a un origen vacío. **La versión de la app** (`package.json`) tiene que ser ≥ el `minClientVersion` del *manifest* (0.2.0 con firma): si no, el cliente rechaza el catálogo con `client-too-old` y la búsqueda se queda sin él. El 31-10-2026 pasó durante unos 20 min, hasta `653db54`.
7. **Activa el cron:** `gh variable set CATALOG_SCHEDULE --body on`. CA2.1 pide 3 ejecuciones programadas seguidas en verde.

El modo automático de Claude Code no deja al asistente escribir secretos, lanzar `catalog.yml` ni cambiar `CATALOG_SCHEDULE`: esos pasos los hace el propietario, con `gh` o desde la web de GitHub (Settings › Secrets and variables › Actions, y Actions › catalog › Run workflow).

#### Cada día

Nada que hacer. Lo que hay que mirar está en:

- el resumen de la ejecución: versión, juegos, llamadas (≤230, ≤10 con clave), duración, puertas y cabeceras;
- el artefacto `run-report`.

#### Cuando falla (llega el correo de GitHub y el *issue* `catalogo`)

El *issue* dice qué paso falló y si se llegó a desplegar. Si no se desplegó, sigue servida la versión anterior.

| Síntoma | Qué hacer |
|---|---|
| Falta un secreto (Configuración) | Créalo (tabla de arriba) y relanza: `gh workflow run catalog.yml` |
| Canario: 403 con clave | La clave está revocada o la cuenta limitada (R-02). Relanza sin clave (`-f keyless=true`) y renueva la clave, el secreto y la variable `STEAM_KEY_SHA256` |
| Canario o construcción: 429 seguidos o >30 min | *Runners* compartidos limitados (R-03): `npm run catalog:stage` en el PC y `gh workflow run catalog.yml -f source=staging` |
| Puerta de recuento o de renombrados tras un parón largo | `-f skip_delta_gates=true` (§4.6; lo anota el informe) |
| Otra puerta (centinela, integridad, tamaño, consultas de humo, calidad) | No se publica (CA2.2). El catálogo rechazado está en el artefacto `rejected-catalog`; arregla la causa en el pipeline |
| Montaje: «no es posterior a la publicada» | Otra publicación se adelantó. Relanza: la versión se recalcula |
| Montaje: no se puede leer la versión publicada | `CATALOG_ORIGIN` mal o `ga-catalog` caído. Si es un origen nuevo, `-f no_previous=true` |
| Montaje: clave sin pública en `CATALOG_SIGNING_KEYS` | Añádela a `signature.ts`, despliega `ga-web` y relanza |
| `staging`: «el estado ha cambiado» o «más de 36 h» | Vuelve a lanzar `npm run catalog:stage` |
| Prueba de humo: otro origen | `wrangler` publica en otra cuenta: `gh variable set CATALOG_ORIGIN …` |
| Prueba de humo o estado, tras desplegar | Ya está publicado. Revisa la tabla del resumen. Si el estado no se subió, la siguiente ejecución compara con el anterior y no pasa nada |
| Correo de healthchecks.io (36 h) sin *issue* | El cron no ha corrido. `gh workflow view catalog.yml` y, si está desactivado (R-04), `gh workflow enable catalog.yml` |
| La app: la búsqueda solo ofrece «Apuntar a mano» y el Worker da `client-too-old` | La app es anterior al `minClientVersion` del *manifest*: sube la versión de `package.json` y despliega `ga-web` |

#### Volver atrás

- **Datos malos en las portadas o los detalles:** los *kill switches* del *manifest* (§7.6).
- **El catálogo entero:** la siguiente ejecución lo sustituye.
- **Pendiente:** republicar los ficheros de la versión buena con una `version` nueva (§5.4). `wrangler rollback` no sirve en `ga-catalog`: el cliente rechaza una versión anterior a la suya.

#### Probar el *dead-man switch* (CA2.5)

1. `gh variable set CATALOG_SCHEDULE --body off`, o `gh workflow disable catalog.yml`.
2. Espera el correo, a las ≈36 h del último éxito.
3. Vuelve a activarlo.

### Consecuencias

- Bien, porque la pasada con clave en el PC (A1) del 31-10-2026, sobre el estado de M1 del 29-10, cumple el presupuesto del CA2.1:
  - 217 llamadas, todas 200 y sin un 429: 4 de `GetAppList` (las únicas con clave), 208 de Query y 5 de `GetItems`;
  - una cada 3 s como mucho (0,333/s);
  - 10,9 min de pasada y 11,3 min en total, con la construcción (4,6 s) y las puertas (20,7 s);
  - 53,7 MB gzip en total; `GetAppList`, 1,2 MB por página.
- Bien, porque esa versión pasa todas las puertas:
  - 197 706 juegos (+0,34 %) y 1 472 renombrados (0,747 %, ≤1 %): la primera ejecución con clave no necesita `--skip-delta-gates`;
  - H1 = 221 y H2 = 18;
  - 205 bloqueados en ES, que ya entran;
  - 3 239 `nameEs`;
  - núcleo 2,26 MB con brotli 11 (2,16 MiB);
  - dorado: top-1 94,9 % y top-5 100 %;
  - exactos: 99,8 %;
  - prefijos: 93,1 %;
  - 2 059 ficheros por despliegue con la versión anterior (≤20 000).
- Bien, porque la **primera publicación de `catalog.yml`** (ejecución 41201112633, a mano y con `no_previous=true`, 31-10-2026) salió en verde en 12 min 7 s:
  - versión `20261031.1`: 197 786 juegos, 3 562 alias, 197 607 con detalles en 1 024 *shards* y núcleo de 2,16 MiB en brotli;
  - 218 llamadas a Steam, 4 con clave, una cada 3 s como mucho (0,334/s), en 10,9 min; construcción en 4,3 s y puertas en 21,7 s;
  - todas las puertas en verde; las de variación, saltadas, porque no había estado anterior, y 0 recientes por lo mismo;
  - la prueba de humo comprobó 1 030 ficheros; la firma con `prod-1` se volvió a comprobar fuera, con la pública de `core`;
  - `save-state` subió `state-20261031.1.tgz` (13 MiB) a `catalog-state` con el `GITHUB_TOKEN`, y «Workers Scripts: Edit» bastó en la cuenta nueva.
- Bien, porque volver a derivar sin red y sin clave las páginas de una pasada (`--from-raw`) da los mismos bytes, firma incluida (ed25519 es determinista).
- Bien, porque los tamaños medidos el 31-10-2026 quedan dentro de lo estimado en la §7.6:

  | Fichero | Sin comprimir | gzip -9 | brotli 11 |
  |---|---|---|---|
  | *Shard* (media de 1 024; 193 juegos) | 31,3 KB (máx. 39,9 KB) | 9,0 KB | 7,7 KB (máx. 9,7 KB) |
  | Los 1 024 *shards* | 32,1 MB | 9,21 MB | 7,89 MB (estimado: ≈9,4 MB) |
  | Índice de *shards* | 19,5 KB | 10,1 KB | 9,0 KB |
  | `recent` de la pasada A1 (2 154 filas) | 125,7 KB | 63,4 KB | 51,5 KB |
  | `recent` en régimen (≈3 934 filas, estimado) | 133 KB | 59 KB | 48,6 KB |

  El de régimen se estima con las 3 696 filas de `appid` más alto de la copia congelada (14 días × ≈264 altas) y 238 al azar (14 × ≈17 renombrados).
- Bien, porque un fallo antes del despliegue no publica nada, la versión anterior sigue servida y el *issue* dice qué falló (CA2.2).
- Bien, porque cada despliegue lleva la versión anterior, comprobada byte a byte en la prueba de humo (CA2.4).
- Bien, porque el *token* del pipeline no puede desplegar `ga-web`, la firma solo existe en un secreto y `catalog:publish` se niega fuera de Actions.
- Bien, porque la clave real de Steam se busca en `pipeline/out`, `pipeline/dist` y los artefactos (CA2.7), y `catalog:stage` la busca en las páginas crudas descomprimidas.
- Bien, porque `staging` reutiliza el pipeline entero (`--from-raw`), sin otra orden de puertas y firma.
- Mal, porque el estado pasa de 3,7 MB a 13,9 MB con gzip -9, sobre todo por los detalles de reserva: con 7 copias, ≈100 MB en la *Release* `catalog-state`.
- Mal, porque 179 juegos van sin detalles:
  - 169 están bloqueados en ES y en US, y `GetItems` solo da su nombre;
  - 10 no traen `asset_url_format`, y el esquema exige `fmt`: pierden también su fecha, sus reseñas y sus plataformas.
- Mal, porque dentro de un mismo `pop` el cliente coloca las altas por `appid` y el núcleo, por reseñas, hasta que se renueva el núcleo local (§7.6; `applyRecent`).
- Mal, porque las *Releases* y los artefactos son públicos: el estado (nombres, clase, fechas) y las páginas crudas de `catalog-staging` se ven. Son datos que ya publica la tienda y, derivados, el propio catálogo.
- Mal, porque conservar la versión anterior depende de que `ga-catalog` responda al montar. Si no, no se despliega.
- Mal, porque la primera publicación en un origen nuevo no conserva nada y numera desde `AAAAMMDD.1`.
- Neutral, porque los recientes empiezan a contar desde la primera publicación de `catalog.yml`, que partió sin estado. En la pasada A1, sobre el estado de M1, el primer `recent` traía 679 altas en dos días y 1 475 renombrados, casi todos el paso del nombre base del plan B al de `GetAppList`.
- Pendiente:
  - 3 ejecuciones programadas seguidas en verde (CA2.1), desde el 01-11-2026: hasta entonces, «propuesta»;
  - el correo de healthchecks.io, deteniendo el cron (CA2.5);
  - `gh run download` del artefacto desde el trabajo `report` y el *issue* en un fallo real;
  - lo que transfiere el núcleo completo (ADR-003);
  - medir `recent` en régimen, a los 14 días;
  - R-04 con el Cron Trigger, si llega a hacer falta;
  - una entrada de `workflow_dispatch` para volver a la versión buena con una `version` nueva.

### Confirmación

- **Pipeline**, pruebas sin red en `pipeline/test/`:
  - `publish.test.ts`: el CA2.2 de punta a punta, con un Steam de mentira sacado de la copia congelada del núcleo real (≈3 000 juegos, dorado real y todas las puertas). Fuerza el fallo de cada puerta (recuento, centinela, humo, calidad de búsqueda y tamaño) y comprueba que `--out` y el estado no cambian y que lo rechazado no se firma. Comprueba también que, si Query pide clave o devuelve poco, se publican los nombres y `enrichmentAgeDays` crece (1, 2 y vuelve a 0). Los recientes aplicados al núcleo del día anterior dan el del día siguiente.
  - `details.test.ts`, `signing.test.ts` y `gates.test.ts`: detalles y rutas validadas, ventana de 14 días, firma y salvaguardas, e integridad de `recent` y de los *shards*.
  - `pipeline.test.ts`: la orden con `--source=fixtures`; con `--dev-sign` da los mismos bytes dos veces, y los códigos 1 y 2.
- Cada `catalog:build` pasa las puertas con `@gameagenda/core/search-quality` sobre el núcleo nuevo y guarda el presupuesto del CA2.1 en `build.json`.
- **Publicación**, con Vitest (`scripts/*.test.ts`):
  - `assemble-catalog`:
    - monta la versión nueva y la anterior desde una carpeta o desde el origen;
    - un 404 es la primera publicación;
    - el mini-catálogo de M0 se sigue montando;
    - rechaza un SHA-256, un nombre, un *shard* o un índice que no cuadran, y una versión que no es posterior;
    - comprueba los límites y la firma `optional`, `dev` y `prod`;
  - `catalog-smoke`: todo correcto; CORS, tipo y caché erróneos; ficheros que faltan o distintos; otro origen;
  - `catalog-release`: copias, poda a 7, qué es estado y validez de `stage.json`;
  - `catalog-live`: orden y siguiente versión con el día de Madrid;
  - `tar`: ida y vuelta, rutas largas, rutas peligrosas y suma de control;
  - `catalog-report`: resumen, presupuesto de llamadas, pasos fallidos y redacción de la clave;
  - `catalog-publish`: se niega fuera de Actions y extrae la URL de `wrangler`.
- **En local:**
  - `npx wrangler deploy --dry-run -c pipeline/wrangler.jsonc` con el mini-catálogo montado;
  - `actionlint`: la versión en wasm de npm 2.0.6 solo se queja de `vars`, que no conoce y que ya usaba `ci.yml`.
- **En cada ejecución:**
  - la prueba de humo, con la tabla de cabeceras en el resumen;
  - el resumen de llamadas frente a los límites de CA2.1, que avisa si se pasa.
- **En producción, el 31-10-2026:** con un Chromium limpio, `ga-web` (0.2.0) verifica la firma, llega a `full` con `20261031.1` en 4,2 s y encuentra Hollow Knight, Baldur's Gate 3, Elden Ring y Stardew Valley.

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

### Versión anterior: 1 · Del `ga-catalog` publicado (elegida)

- Bien, porque lo publicado es exactamente lo que tienen los clientes.
- Bien, porque el estado no carga con el catálogo entero, y vale igual para `staging`.
- Mal, porque depende de que `ga-catalog` responda al montar, y son ≈1 030 peticiones más por ejecución (gratis).

### Versión anterior: 2 · Del estado de la *Release*

- Bien, porque no depende de `ga-catalog`.
- Mal, porque el estado cargaría con ≈7 MB de núcleo y ≈31 MB de *shards*, sin comprimir, en cada una de sus 7 copias.
- Mal, porque, si un despliegue falla a medias, el estado podría no ser lo que se publicó.

### Desde el PC: 1 · Subir `pipeline/out/` y el estado nuevo

- Bien, porque es lo que decía el plan.
- Mal, porque haría falta una orden aparte de «puertas y firma sobre un catálogo ya hecho», y el CI publicaría algo construido fuera de él.

### Desde el PC: 2 · Páginas crudas y volver a derivar (elegida)

- Bien, porque las puertas corren en el CI con el código de `main` y sin llamadas a Steam, y del PC solo se usan sus respuestas.
- Mal, porque el paquete solo vale con el estado con el que se construyó y durante 36 h.

## Más información

- **En `prototipe.md`:**
  - §4.5–§4.10: algoritmo, estado, puertas, presupuesto, plan B y portadas;
  - §5.4: publicación atómica y versión anterior;
  - §7.6: formatos y límites;
  - §11.3: firma y *token*;
  - §12.5 y §12.7: CI/CD y observabilidad;
  - §13.3: `catalog:stage` y `catalog:publish`;
  - §15.5: CA2.1–CA2.8;
  - §16: R-02, R-03, R-04 y R-16.
- **Porqué:** [`DECISIONES.md`](../planificacion/DECISIONES.md), §10.4, §10.5 y §10.12 (el PC nunca firma ni despliega).
- **Código:**
  - pipeline: `pipeline/src/` (`run.ts`, `recent.ts`, `details.ts`, `signing.ts`, `gates.ts`, `output.ts` y `state.ts`) y el contrato en `packages/core/src/catalog-format/`;
  - publicación: `.github/workflows/catalog.yml`, `pipeline/wrangler.jsonc` y `scripts/` (`assemble-catalog.ts`, `catalog-live.ts`, `catalog-smoke.ts`, `catalog-release.ts`, `catalog-stage.ts`, `catalog-publish.ts`, `catalog-canary.ts`, `catalog-report.ts` y `tar.ts`).
- **Relacionados:** ADR-003 (despliegue y CI; su «`catalog.yml` sustituye a `deploy-catalog.yml`» queda hecho, y `ga-catalog` va en su propia cuenta), ADR-005 (Worker de búsqueda: firma, recientes y regla de los 7 días en el cliente), ADR-006 (alcance y formato del catálogo) y ADR-008 (portadas).
- Hasta el 31-10-2026, la parte de publicación estaba en un borrador aparte, [`007-pipeline-del-catalogo.parte-publicacion.md`](007-pipeline-del-catalogo.parte-publicacion.md). Se conserva sin cambios, y manda este ADR.
