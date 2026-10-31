# ADR-007 · Parte de publicación: `catalog.yml`, secretos y *runbook*

> **Borrador para fusionar** en `007-pipeline-del-catalogo.md`, el ADR que escribe la parte del pipeline (A1). Cubre el paso 6 de la §4.5 y lo que lo rodea: el flujo diario, el estado entre ejecuciones, la conservación de la versión anterior, la vía del PC (`catalog-staging`), los secretos y el *runbook*. Las secciones siguen MADR: al fusionar, «Decisión», «Consecuencias» y «Confirmación» van dentro de las del ADR.

## Contexto y problema

Desde M2 el catálogo se publica solo, cada día, desde GitHub Actions (§4.5, §12.5 y §15.5). Condiciones que fijan el diseño:

- **Repositorio público:** los minutos no cuentan, pero el cron se desactiva tras 60 días sin actividad (R-04) y los artefactos y las *Releases* son públicos.
- **`ga-catalog` en otra cuenta de Cloudflare:** el *token* de «Workers Scripts: Edit» abarca toda la cuenta, así que el del pipeline no debe poder desplegar `ga-web` (§11.3). La cuenta y el *token* aún no existen.
- **La firma ed25519 solo en un secreto de GitHub:** desde M2 el PC nunca firma ni despliega `ga-catalog` (DECISIONES §10.12).
- **CA2.4:** tras un despliegue, un cliente con el *manifest* anterior sigue funcionando. Pero cada `wrangler deploy` sustituye todos los *assets*.
- **CA2.2:** si falla una puerta, no se publica nada, la versión anterior sigue servida y se abre un *issue*.

¿Cómo se publica cada día, con qué secretos y permisos, y qué se hace cuando falla?

## Decisión

### Flujo `.github/workflows/catalog.yml`

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
  - `CATALOG_ORIGIN`, por defecto `https://ga-catalog.gameagenda.workers.dev`;
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
| 7 | Construye y firma | `npm run catalog:build -- --version=<v>` (+ `--keyless`, `--skip-delta-gates`; con `staging`, `--from-raw` y `--now`), con `STEAM_WEB_API_KEY`, `CATALOG_SIGNING_KEY` y `CATALOG_SIGNING_KID`. Puertas: las del pipeline | Para: no se publica (CA2.2) |
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

### Conservar la versión anterior (CA2.4)

**Opción elegida: descargarla del `ga-catalog` publicado.** `assemble-catalog.ts --previous=<origen>` lee el `manifest.json` vigente y baja los ficheros que cita: el índice y los *shards* que no están ya en la versión nueva. Cada uno se comprueba con su SHA-256 o el prefijo de su nombre. La carpeta de despliegue lleva:

- la versión nueva entera;
- los ficheros de la anterior que no están en la nueva;
- solo el `manifest.json` nuevo.

Si una ruta está en las dos, tiene que tener el mismo contenido.

- **Por qué no del estado de la *Release*:**
  - lo publicado es exactamente lo que tienen los clientes;
  - el estado no carga con el catálogo entero (≈7 MB de núcleo y ≈31 MB de *shards*, sin comprimir) siete veces;
  - vale igual para `staging`.
- **Qué cuesta:** ≈1 030 peticiones al propio `ga-catalog` (16 a la vez, unos segundos). Los *assets* estáticos son gratis.
- **404 del *manifest*:** es la primera publicación y no hay nada que conservar. Cualquier otro fallo para el montaje: sin saber qué hay publicado, no se despliega.
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
- **Sin *Release*:** es la primera ejecución de M2 y todo es alta; las puertas de variación se saltan como en la primera versión. La *Release* se crea en el primer `save-state`, como *prerelease* y sin `latest`.
- **Herramienta:** `gh` con el `GITHUB_TOKEN`.

### Pipeline desde el PC (`catalog-staging`)

`npm run catalog:stage`:

1. Baja el estado de `catalog-state`, el mismo que restaurará el flujo.
2. Construye en el PC con `--now` y `--raw` fijos, sin `CATALOG_SIGNING_KEY` y con `--dev-sign`. Si falla una puerta, no sube nada.
3. Busca la clave en las páginas crudas descomprimidas.
4. Sube `stage.tgz` a la *Release* `catalog-staging`: `stage.json` (estado usado, `runAt`, con o sin clave, *commit*) y `raw/`, las páginas crudas.

`--no-upload` deja el paquete en `%TEMP%` sin subirlo.

Después, `gh workflow run catalog.yml -f source=staging`, que:

- comprueba que el estado vigente es el que usó el PC y que el paquete tiene ≤36 h;
- **vuelve a derivar el catálogo sin red** (`--from-raw` y el mismo `--now`), con el código de `main`;
- pasa las puertas, firma, monta, despliega y guarda el estado.

Es una variación sobre el texto del plan, que hablaba de subir `pipeline/out/` y el estado nuevo. Así no hace falta una orden aparte para «puertas y firma sobre un catálogo ya hecho», las puertas corren en el CI y del PC solo se usan las respuestas de Steam. El cliente de Steam en modo `offline` falla antes de tocar la red, así que con `staging` no hay llamadas.

`catalog:publish` se niega fuera de GitHub Actions y sin una firma `prod`: el PC no puede desplegar `ga-catalog` ni por error.

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

## Secretos y variables

| Nombre | Tipo | Valor | Quién lo usa | Estado |
|---|---|---|---|---|
| `STEAM_API_TOKEN` | Secreto | La clave de la Web API; el flujo la pasa como `STEAM_WEB_API_KEY` | Canario, construcción, configuración (*hash*) | Existe |
| `STEAM_KEY_SHA256` | Variable | SHA-256 de la clave (`ci.yml` y el *issue*) | `ci.yml`, `deploy-web.yml`, `report` | Existe |
| `CATALOG_SIGNING_KEY` | Secreto | Privada ed25519, PEM PKCS#8 | Construcción | **Por crear** |
| `CATALOG_SIGNING_KID` | Variable (opcional) | `kid` de su pública en `CATALOG_SIGNING_KEYS`; por defecto `prod-1` | Construcción | Opcional |
| `CATALOG_CLOUDFLARE_API_TOKEN` | Secreto | *Token* de la cuenta de `ga-catalog` con solo «Account › Workers Scripts › Edit» | Despliegue | **Por crear** |
| `CATALOG_CLOUDFLARE_ACCOUNT_ID` | Secreto | Id de esa cuenta | Despliegue | **Por crear** |
| `HEALTHCHECKS_PING_URL` | Secreto | `https://hc-ping.com/<uuid>` del *check* | Avisos | **Por crear** (sin él, avisa y sigue) |
| `CATALOG_ORIGIN` | Variable (opcional) | `https://ga-catalog.<subdominio>.workers.dev` de la cuenta nueva | Versión, montaje, prueba de humo | Al cambiar de cuenta |
| `WEB_ORIGIN` | Variable (opcional) | Origen de `ga-web`; por defecto `https://ga-web.gameagenda.workers.dev` | Configuración, prueba de humo | Solo con dominio propio |
| `CATALOG_SCHEDULE` | Variable | `on` activa el cron diario; `off` lo pausa | `publish` | **Por crear al final** |

`CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`, los de `ga-web`, ya no los usa ningún flujo del catálogo.

## *Runbook*

### Puesta en marcha (una vez)

1. **Cuenta de Cloudflare para `ga-catalog`.**
   1. Créala y registra su subdominio de `workers.dev` en el panel (Workers & Pages). Sin él, `wrangler deploy` falla.
   2. Crea un *token* propio con solo «Account › Workers Scripts › Edit».
   3. Guarda los secretos: `gh secret set CATALOG_CLOUDFLARE_API_TOKEN` y `gh secret set CATALOG_CLOUDFLARE_ACCOUNT_ID`, que piden el valor.
2. **Clave de firma de producción.** Desde Git Bash:

   ```bash
   node -e "const c=require('node:crypto');const k=c.generateKeyPairSync('ed25519');require('node:fs').writeFileSync(process.env.TEMP+'/catalog-key.pem',k.privateKey.export({type:'pkcs8',format:'pem'}));console.log(k.publicKey.export({format:'jwk'}).x)"
   gh secret set CATALOG_SIGNING_KEY < "$TEMP/catalog-key.pem" && rm "$TEMP/catalog-key.pem"
   ```

   - La línea que imprime es la pública: va en `CATALOG_SIGNING_KEYS` como `{ kid: 'prod-1', ed25519: '…', use: 'prod' }`.
   - Despliega `ga-web` con esa clave **antes** de la primera publicación firmada.
   - Otro `kid`: variable `CATALOG_SIGNING_KID`.
   - La privada no se guarda en ningún otro sitio.
3. **healthchecks.io.**
   1. Crea un *check* «catalog» con periodo de 1 día y gracia de 12 h: avisa a las 36 h sin éxito, o 12 h después de un `/start` sin final.
   2. Guarda su URL: `gh secret set HEALTHCHECKS_PING_URL`.
4. **Orígenes.** Con el subdominio nuevo:
   - `gh variable set CATALOG_ORIGIN --body https://ga-catalog.<subdominio>.workers.dev`;
   - en la app, `VITE_CATALOG_URL` de `deploy-web.yml` y `connect-src` de `apps/web/public/_headers`.

   El CORS de `pipeline/catalog.headers` sigue siendo `https://ga-web.gameagenda.workers.dev`.
5. **Primera publicación.**
   - En la cuenta nueva no hay nada que conservar: `gh workflow run catalog.yml -f no_previous=true`.
   - Hazlo al día siguiente de la última publicación en la cuenta vieja. Sin versión anterior, la nueva es `AAAAMMDD.1` del día, y un cliente con una versión posterior de ese día la rechazaría hasta el siguiente.
   - Comprueba el resumen: canario, puertas, llamadas y prueba de humo.
6. **Activa el cron:** `gh variable set CATALOG_SCHEDULE --body on`. CA2.1 pide 3 ejecuciones programadas seguidas en verde.

### Cada día

Nada que hacer. Lo que hay que mirar está en:

- el resumen de la ejecución: versión, juegos, llamadas (≤230, ≤10 con clave), duración, puertas y cabeceras;
- el artefacto `run-report`.

### Cuando falla (llega el correo de GitHub y el *issue* `catalogo`)

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

### Volver atrás

- **Datos malos en las portadas o los detalles:** los *kill switches* del *manifest* (§7.6).
- **El catálogo entero:** la siguiente ejecución lo sustituye.
- **Pendiente:** republicar los ficheros de la versión buena con una `version` nueva (§5.4). `wrangler rollback` no sirve en `ga-catalog`: el cliente rechaza una versión anterior a la suya.

### Probar el *dead-man switch* (CA2.5)

1. `gh variable set CATALOG_SCHEDULE --body off`, o `gh workflow disable catalog.yml`.
2. Espera el correo, a las ≈36 h del último éxito.
3. Vuelve a activarlo.

## Consecuencias

- Bien, porque un fallo antes del despliegue no publica nada y la versión anterior sigue servida, y el *issue* dice qué falló (CA2.2).
- Bien, porque cada despliegue lleva la versión anterior, comprobada byte a byte en la prueba de humo (CA2.4).
- Bien, porque el *token* del pipeline no puede desplegar `ga-web`, la firma solo existe en un secreto y `catalog:publish` se niega fuera de Actions.
- Bien, porque la clave real de Steam se busca en `pipeline/out`, `pipeline/dist` y los artefactos (CA2.7), y `catalog:stage` la busca en las páginas crudas descomprimidas.
- Bien, porque `staging` reutiliza el pipeline entero (`--from-raw`), sin otra orden de puertas y firma.
- Mal, porque las *Releases* y los artefactos son públicos: el estado (nombres, clase, fechas) y las páginas crudas de `catalog-staging` se ven. Son datos que ya publica la tienda y, derivados, el propio catálogo.
- Mal, porque conservar la versión anterior depende de que `ga-catalog` responda al montar. Si no, no se despliega.
- Mal, porque la primera publicación en el origen nuevo no conserva nada, y numera desde `AAAAMMDD.1`.
- Pendiente (a verificar con la primera ejecución real):
  - `gh release create/upload/delete-asset` y `gh run download` de la propia ejecución con el `GITHUB_TOKEN`;
  - que «Workers Scripts: Edit» basta en la cuenta nueva;
  - la duración real y las llamadas (CA2.1);
  - lo que transfiere el núcleo completo (ADR-003);
  - el correo de healthchecks.io (CA2.5);
  - R-04 con el Cron Trigger, si llega a hacer falta.
- Pendiente: una entrada de `workflow_dispatch` para volver a la versión buena con una `version` nueva.

## Confirmación

- **Vitest** (`scripts/*.test.ts`):
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

## Suposiciones sobre la CLI del pipeline (A1)

`catalog.yml` y `catalog:stage` usan `npm run catalog:build` / `pipeline/build.ts` así:

- **Opciones:**
  - `--version=<v>` fija la versión. El flujo la calcula con la publicada, porque en el *runner* `pipeline/out/` está vacío;
  - `--keyless` y `--skip-delta-gates`;
  - `--from-raw=<carpeta>` rederiva sin red; `--now=<ISO>` fija el momento de la ejecución; `--raw=<carpeta>` dice dónde guardar las páginas crudas;
  - `--dev-sign` firma con `fixtures/signing/dev-catalog-key.pem` (`dev-1`).
- **Firma:** con `CATALOG_SIGNING_KEY` (PEM) firma `manifest.json` con el `kid` de `CATALOG_SIGNING_KID`. Una variable vacía cuenta como ausente.
- **Salida:** escribe `pipeline/out/` con `manifest.json` y los ficheros que cita: `core`, `recent`, `aliases`, `details/index.<hash>.json`, que va en `files.details`, y `details/NNNN.<hash>.json`.
- **Si falla una puerta:** sale con error y no escribe en `--out`.
- **Estado:** todo lo que deja en `pipeline/state/` fuera de `raw-*`, `reports/` y `rejected/`.
- **Informe:** `pipeline/state/reports/<versión>/build.json`, con `version`, `mode`, `counts`, `requests` (por *endpoint*, con `network`), `timingsMs` y `gates`. `catalog-report.ts` lee todo como opcional.
- **Páginas crudas:** no llevan la clave, que viaja en una cabecera. Con el mismo estado y `--now`, `--from-raw` no hace ninguna petición nueva.

## Más información

- `prototipe.md`:
  - §4.5–§4.9: algoritmo, estado, puertas, presupuesto y plan B;
  - §5.4: publicación atómica y versión anterior;
  - §7.6: formatos y límites;
  - §11.3: firma y *token*;
  - §12.5 y §12.7: CI/CD y observabilidad;
  - §13.3: `catalog:stage` y `catalog:publish`;
  - §15.5: CA2.1–CA2.7;
  - §16: R-02, R-03, R-04 y R-16.
- `docs/planificacion/DECISIONES.md` §10.12: el PC nunca firma ni despliega.
- **ADR relacionados:**
  - ADR-003 (*hosting* y CI): su «`catalog.yml` sustituye a `deploy-catalog.yml`» queda hecho;
  - ADR-006 (formato del catálogo).
- **Ficheros:**
  - `.github/workflows/catalog.yml` y `pipeline/wrangler.jsonc`;
  - `scripts/assemble-catalog.ts`, `scripts/catalog-live.ts`, `scripts/catalog-smoke.ts`, `scripts/catalog-release.ts`, `scripts/catalog-stage.ts`, `scripts/catalog-publish.ts`, `scripts/catalog-canary.ts`, `scripts/catalog-report.ts` y `scripts/tar.ts`.
