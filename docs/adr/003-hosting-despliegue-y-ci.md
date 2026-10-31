# ADR-003 · *Hosting*, despliegue y CI: Workers Static Assets para `ga-web` y `ga-catalog`, y GitHub Actions

- **Estado:** aceptada
- **Fecha:** 30-10-2026. Se decidió el 28-10-2026, al planificar (D-12), y se confirmó con los primeros despliegues de M0.
- **Deciden:** el usuario y el asistente

## Contexto y problema

ADR-001 deja la app sin servidor hasta M4: la nube solo sirve ficheros estáticos. Hacen falta dos orígenes:

- `ga-web`, la SPA, cuyos enlaces profundos (`/juego/steam:730`) tienen que devolver `index.html`;
- `ga-catalog`, el catálogo: un `manifest.json` que se revalida siempre y ficheros inmutables con el *hash* en el nombre, que desde M2 el pipeline publica a diario.

La CSP va por cabecera y sin `unsafe-inline` (§11.3). El catálogo se pide desde otro origen, con CORS solo para la app. El núcleo ocupa 7,00 MB sin comprimir y tiene que llegar comprimido, pero Cloudflare solo comprime los tipos de su lista, que no incluye `text/tab-separated-values`, el que Wrangler da a los `.tsv` (R-16). Despliega una persona, desde GitHub Actions, y la clave de Steam no puede llegar nunca al *bundle*.

¿Dónde se sirven la app y el catálogo, y cómo se prueban y despliegan, a 0 €/mes?

## Factores de la decisión

- 0 €/mes, con un despliegue del catálogo al día y uno de la app por cada *push* a `main`.
- Cabeceras propias por ruta: CSP, HSTS, CORS, `Cache-Control` y `Content-Type`.
- Núcleo comprimido en la primera visita: ≈2,6–3,1 MB en vez de 7,00 MB (§7.6).
- *Fallback* de la SPA y vuelta atrás con un comando.
- En M4, la micro-API en el mismo origen que la app, por la cookie `__Host-` y `connect-src 'self'` (D-12).
- Solo se despliega un SHA con el CI en verde, y el CI tarda ≤10 min y no usa secretos (CA0.1).
- Salida fácil: ficheros planos que pueda servir cualquier *hosting* (§5.4).

## Opciones consideradas

1. Cloudflare Workers Static Assets, con dos Workers en `workers.dev`.
2. Cloudflare Pages.
3. GitHub Pages.
4. Netlify Free o Vercel Hobby.

El CI y los despliegues van en GitHub Actions, donde ya están el repositorio y el pipeline (D-07, D-17).

## Decisión

Opción elegida: **1, Workers Static Assets**, porque:

- sirve los *assets* estáticos gratis y sin límite de peticiones (§5.4);
- aplica `_headers` a todo lo que sirve, también a los 404 y al *fallback* de la SPA;
- tiene *fallback* de SPA (`not_found_handling`) y `wrangler rollback`;
- en M4 admite un *script* solo en `/api/*` (`run_worker_first`), en el mismo origen que la app.

### *Hosting*

Dos Workers, cada uno en su cuenta de Cloudflare. El subdominio `gameagenda.workers.dev` se registró el 30-10-2026 con la API de Cloudflare (elección del usuario). Desde el 31-10-2026 (M2), `ga-catalog` va en una segunda cuenta gratuita, con el subdominio `gameagenda-cat.workers.dev` y su propio *token* (§11.3). Hasta entonces, el mini-catálogo de M0 se servía en https://ga-catalog.gameagenda.workers.dev:

| Worker | URL | Configuración | Qué sirve |
|---|---|---|---|
| `ga-web` | https://ga-web.gameagenda.workers.dev | `apps/web/wrangler.jsonc` | `apps/web/dist`, con `not_found_handling: single-page-application` y las cabeceras de `apps/web/public/_headers` |
| `ga-catalog` | https://ga-catalog.gameagenda-cat.workers.dev | `pipeline/wrangler.jsonc` | `pipeline/dist/`, sin *fallback*. Lo monta `scripts/assemble-catalog.ts` desde `fixtures/catalog/` (M0) o `pipeline/out/` (M2), con las cabeceras de `pipeline/catalog.headers` |

- **`ga-web`:**
  - la CSP de la §11.3, sin `unsafe-inline`, con `connect-src 'self' https://ga-catalog.gameagenda-cat.workers.dev` y `upgrade-insecure-requests`;
  - `nosniff`, `Referrer-Policy`, COOP, HSTS y `Permissions-Policy`;
  - `/assets/*` se cachea un año (`immutable`), y el resto conserva el valor por defecto, `public, max-age=0, must-revalidate`.
- **`ga-catalog`:**
  - CORS solo para el origen de `ga-web`, y `nosniff`, en todas las rutas;
  - `manifest.json`, `no-cache`;
  - los TSV (`core`, `recent`, `aliases` y `boot`), como `text/plain; charset=utf-8` e `immutable`; `details/*`, `immutable`.
- **Sin *script* ni caché de Workers** sobre los *assets* (D-12): hasta M4 todo son *assets* estáticos.
- **Si el CDN no comprimiera el TSV** (R-16, CA0.3): se publicarían los ficheros ya comprimidos con gzip y el Worker de búsqueda los descomprimiría con `DecompressionStream`. No hace falta, porque llegan comprimidos (ver abajo).

### CI (`.github/workflows/ci.yml`)

- **Cuándo:** en cada PR, en cada *push* a `main` (salvo cambios solo en `**/*.md` o `docs/**`) y a mano.
- **Tres trabajos en paralelo** en `ubuntu-latest`:
  - `check`: Biome, `tsc`, Vitest, *build*, puerta de tamaño y búsqueda de la clave. Bloquea;
  - `e2e`: solo Chromium. Bloquea;
  - `perf`: con `continue-on-error`, porque los *runners* son ruidosos. Regenera `pipeline/out` con `npm run catalog:frozen`.
- **Cadena de suministro:** *actions* fijadas por SHA (`checkout` v7.0.1 `3d3c42e5…`, `setup-node` v7.1.0 `949feb24…` y `upload-artifact` v7.0.2 `cf430e03…`), `permissions: contents: read` y ningún secreto. La búsqueda de la clave lee la variable `STEAM_KEY_SHA256`, que es un *hash*.
- **Búsqueda de la clave** (`scripts/scan-secrets.ts`, CA0.4): falla con `x-webapi-key`, con `STEAM_WEB_API_KEY` o con una palabra de 32 caracteres alfanuméricos cuyo SHA-256, tal cual o en mayúsculas, coincida con `STEAM_KEY_SHA256`. Las candidatas se buscan con *lookarounds* y no con `\b`, así que también la encuentra pegada a un `_`.
- **Puerta de tamaño** (`npm run size`): falla si el JS inicial pasa de 150 KB o el Worker de 40 KB, en brotli. Hoy pesan 114,9 KB y 32,7 KB.

### Despliegues

- **`deploy-web.yml`:** se lanza con el `workflow_run` de `ci`, solo si acabó en `success` tras un *push* a `main`, o a mano.
  - Construye `head_sha` con `VITE_CATALOG_URL`, busca la clave y comprueba que `connect-src` incluye el origen del catálogo y que no hay `unsafe-inline`.
  - Despliega con `wrangler deploy --message <sha>` y hace una prueba de humo: 200, `index.html` y la CSP exacta en `/` y en `/juego/steam:730`.
- **`deploy-catalog.yml`:** a mano, con el mini-catálogo de M0. Montaba, buscaba la clave, desplegaba, hacía la prueba de humo y dejaba una tabla de cabeceras en el resumen. Se retiró el 31-10-2026: lo sustituye `catalog.yml` (ADR-007), porque podía desplegar el mini-catálogo sin firmar encima del real.
- **Secretos:** `CLOUDFLARE_API_TOKEN` (permiso «Workers Scripts: Edit») y `CLOUDFLARE_ACCOUNT_ID`, como secretos de repositorio.
- **Vuelta atrás:** en `ga-web`, `npx wrangler rollback -c apps/web/wrangler.jsonc`; cada versión lleva su SHA como mensaje. En `ga-catalog` se republican los ficheros de la versión buena con una `version` nueva, porque el cliente rechaza las anteriores a la suya (§5.4).
- **Repositorio público.** El plan lo daba por privado, en el plan Free. Al ser público, los minutos de los *runners* estándar no cuentan, y la estimación de la §12.5 ya no limita nada. Los secretos siguen siendo de repositorio.

### Hallazgos al desplegar (M0, 30-10-2026)

- **Primeros despliegues**, a mano desde el PC, con el OAuth de `wrangler`:
  - `ga-catalog`, versión `d2f7c0f9-4df1-4222-885e-5e0cd285ee99`;
  - `ga-web`, versión `9e385a4b-3ee1-44ac-a15b-b85a662441c6`, construida desde `cf286e1` con `VITE_CATALOG_URL=https://ga-catalog.gameagenda.workers.dev/`.
- **Subdominio nuevo:** tardó ≈90 s en servir HTTPS. Hasta entonces, curl fallaba en el *handshake* TLS.
- **Primer CI** (ejecución `41132070723`): en verde en **2 min 52 s**. `check` tardó 74 s, `e2e` 83 s y `perf` 2 min 49 s.
- **Cabeceras en producción**, comprobadas con curl por HTTPS:

| Petición | Respuesta |
|---|---|
| `ga-web` `/` | 200, `text/html`, `public, max-age=0, must-revalidate`, HSTS, `nosniff`, `Referrer-Policy`, COOP y la CSP de `_headers` |
| `ga-web` `/juego/steam:730` | **307 → `/juego/steam%3A730`**, que da 200 con `index.html`: Workers Static Assets recodifica los `:` |
| `ga-catalog` `manifest.json` | 200, `application/json`, `no-cache`, CORS para `ga-web` y `nosniff` |
| `ga-catalog` `core.*.tsv` | `text/plain; charset=utf-8`, `public, max-age=31536000, immutable` y CORS |
| `ga-catalog` `/core.0000000000000000.tsv` | 404 con `text/plain`, CORS, `nosniff` y también `immutable` durante un año |
| `ga-catalog` `/no-existe.json` | 404 con CORS y `nosniff` |

- **Compresión del mini-núcleo** (11 219 bytes):

| `Accept-Encoding` | `Content-Encoding` | Bytes transferidos |
|---|---|---|
| `gzip, deflate, br, zstd` (Chrome) | zstd | 5 745 |
| `br` | br | 5 737 |
| `gzip` | gzip | 5 402 |
| `identity` | — | 11 219 |

  Cloudflare comprime al vuelo, así que lo que transfiere el núcleo completo se medirá en M2. Como referencia, la §7.6 da 3,05 MB con gzip -9 y 2,59 MB con brotli 5. En `wrangler dev`, en local, el mismo TSV servido como `text/tab-separated-values` (el tipo por defecto de Wrangler) llegaba **sin comprimir**: por eso `_headers` fuerza `text/plain`.
- **Prueba de humo de la app desplegada**, con Playwright y Chromium: el catálogo llegó desde `ga-catalog`, en otro origen. Al buscar «celeste», «Celeste» (2018) salió el primero, e Intro lo apuntó con el aviso «Apuntado en Quiero jugar: Celeste». El Service Worker se registró, sin errores en la consola ni violaciones de la CSP.

### Otras comprobaciones de M0

Detalle en [`docs/medidas/verificaciones-m0-20261030.md`](../medidas/verificaciones-m0-20261030.md):

- **Ed25519 en WebCrypto:** funciona en Node 24 y en Chromium, en la página y en un Worker. El WebKit de Playwright en Windows no lo trae, y eso afecta a M2 y a RNF-12.
- **Clave de Steam:** son 32 dígitos hexadecimales, en mayúsculas, según fuentes secundarias.
- **Query sin `include_basic_info`:** sigue devolviendo `is_free` y los demás campos (ver ADR-006).
- **CDP no estrangula el Worker:** ya estaba en la §8.9.

### Consecuencias

- Bien, porque el coste sigue siendo 0 €/mes y hasta M4 no hay *script* que facture.
- Bien, porque `_headers` también se aplica al *fallback* de `ga-web` y a los 404 de `ga-catalog`. Con CORS, el cliente ve el 404 y no un fallo de red (§5.4).
- Bien, porque el núcleo llega comprimido sin pasos propios. La alternativa de R-16 no hace falta.
- Bien, porque solo se despliega un SHA con el CI en verde, y volver atrás en `ga-web` es un comando.
- Bien, porque, con el repositorio público, los minutos no cuentan, y el CI tarda 2 min 52 s de los 10 que tiene.
- Mal, porque un 404 en una ruta con *hash* se puede quedar un año en la caché. Mitigado el 30-10-2026: si la respuesta de un fichero con *hash* no es `ok`, `catalog-store.ts` reintenta una vez con `fetch(…, { cache: 'reload' })`, y tiene una prueba unitaria.
- Mal, porque, al recodificar los `:`, un enlace profundo en frío cuesta una ida y vuelta más. El *router* decodifica la ruta, así que funciona.
- Mal, porque Cloudflare comprime con su propio nivel: en el mini-núcleo, gzip (5 402 bytes) gana a brotli (5 737) y a zstd (5 745).
- Mal, porque en un repositorio público el cron de GitHub se desactiva tras 60 días sin actividad (R-04), y su mitigación «repo privado» ya no vale. Quedan `workflow_dispatch`, el *dead-man switch* y, si se repite, un Cron Trigger de Cloudflare (M2, ADR-007).
- Mal, porque «Workers Scripts: Edit» abarca toda la cuenta: un pipeline comprometido podría desplegar `ga-web` (§11.3).
- Hecho el 30-10-2026: el usuario creó los secretos `CLOUDFLARE_API_TOKEN` (*token* propio con solo «Account › Workers Scripts › Edit») y `CLOUDFLARE_ACCOUNT_ID`. El primer *push* después dio `ci` en verde en 3 min 2 s (ejecución 41140409104), y `deploy-web` desplegó `ga-web` solo, en 33 s (ejecución 41140742020). La versión `f5044388-039e-4e13-ae52-c77456dbfd4e` lleva como mensaje el SHA `d981870`. Con ese permiso bastó.
- Hecho el 31-10-2026: el usuario consiguió la clave y la guardó en `.env.local` y en el secreto `STEAM_API_TOKEN`; la variable `STEAM_KEY_SHA256` lleva su *hash*. Desde entonces, el CI también busca la clave.
- Hecho el 31-10-2026: `ga-catalog` pasa a otra cuenta gratuita con su propio *token* («Account › Workers Scripts › Edit», solo en esa cuenta) y el subdominio `gameagenda-cat.workers.dev`. Así, el *token* de `ga-web` no está en el pipeline, que procesa datos no confiables, y el del pipeline no llega a `ga-web` (§11.3). Los secretos son `CATALOG_CLOUDFLARE_API_TOKEN` y `CATALOG_CLOUDFLARE_ACCOUNT_ID`, y la variable `CATALOG_ORIGIN` lleva el origen nuevo (ADR-007).
- Pendiente (M2): medir lo transferido con el núcleo completo, `aliases` y `recent`. `catalog.yml` ya sustituye a `deploy-catalog.yml`.
- Pendiente (M4): `@cloudflare/workers-types` llega con el *script* de la micro-API (ver ADR-002).

### Confirmación

- **CA0.1:** el CI tarda ≤10 min (✓, 2 min 52 s) y `ga-web` responde por HTTPS con las cabeceras de `_headers`, sin `unsafe-inline` (✓, con el despliegue a mano). *Push* → despliegue: ✓ (ejecuciones 41140409104 y 41140742020: CI en 3 min 2 s y despliegue con prueba de humo en 33 s).
- **CA0.2:** ✓. *Manifest* con `no-cache` y CORS solo para `ga-web`.
- **CA0.3:** ✓. El núcleo llega con `zstd`, `br` o `gzip`, según lo que anuncie el navegador. `aliases` comparte la regla de `_headers`; `recent` llega en M2.
- **CA0.4:** Vitest prueba la búsqueda con una clave falsa, y una copia del *build* con una clave falsa añadida salió con código 1. La puerta de tamaño va en `check` y bloquea.
- **CA0.5:** ✓. Desde un clon limpio de GitHub, `npm run setup` tardó 15 s, con la caché de npm caliente y los navegadores de Playwright ya instalados. `npm run dev` sirvió la app en 2 s con el mini-catálogo de 298 juegos, sin acceso a Steam. Una máquina nueva de verdad necesita unos minutos más para las descargas.
- **En cada despliegue:** la prueba de humo de `deploy-web.yml` y la de `catalog.yml` (ADR-007).

## Pros y contras de las opciones

### 1 · Workers Static Assets

- Bien, porque los *assets* estáticos son gratuitos e ilimitados si no se activa la caché de Workers (§5.4, D-12).
- Bien, porque `_headers` fija las cabeceras por ruta, también en los 404, y `not_found_handling` da el *fallback* de la SPA.
- Bien, porque en M4 el *script* solo corre en `/api/*`: si se agota la cuota gratuita, `/api/*` responde 429 y la app se sigue sirviendo (§5.4).
- Bien, porque el catálogo cabe en los límites del plan gratuito, ≤20 000 ficheros de ≤25 MiB por despliegue. Hoy son ≤2 060 (§7.6).
- Mal, porque solo comprime los tipos de su lista, así que los TSV tienen que ir como `text/plain` (R-16).
- Mal, porque el *token* de despliegue abarca toda la cuenta (§11.3).

### 2 · Cloudflare Pages

- El plan no la evaluó aparte. D-12 y la §5.4 parten de Workers Static Assets, y sobre él se diseñaron el *fallback*, `_headers` y el *script* de M4 solo en `/api/*`. En el plan no hay ningún motivo para preferirla.

### 3 · GitHub Pages

- Bien, porque sirve ficheros planos, que es todo lo que publica el catálogo: queda como salida si cambian las condiciones de Cloudflare (§5.4).
- Mal, porque no admite cabeceras propias. Sin ellas no hay CSP por cabecera (§11.3), ni CORS limitado al origen de la app, ni `text/plain` para los TSV.
- Mal, porque no ejecuta código, así que la micro-API de M4 no podría ir en el mismo origen (D-12).

### 4 · Netlify Free o Vercel Hobby

- Mal, porque Vercel Hobby es solo para uso no comercial (§6.4).
- Mal, porque Netlify Free gasta 15 créditos por despliegue, de 300 al mes, y al agotarlos pausa todos los sitios. Eso da para 20 despliegues, y solo el catálogo diario hace 30 (§6.4 y la investigación del 28-10-2026, en `docs/planificacion/investigacion/`).

## Más información

- **En `prototipe.md`:**
  - [§5.2](../../prototipe.md#52-componentes-y-responsabilidades) y [§5.4](../../prototipe.md#54-principios-de-diseño): componentes y principios;
  - [§6.4](../../prototipe.md#64-qué-no-se-usa-y-por-qué): descartes;
  - [§7.6](../../prototipe.md#76-formatos-publicados-del-catálogo): formatos, tamaños y compresión;
  - [§11.3](../../prototipe.md#113-seguridad-de-la-app-y-del-catálogo): CSP, cabeceras y *token*;
  - [§12.5](../../prototipe.md#125-cicd): flujos, secretos, búsqueda de la clave y minutos;
  - [§15](../../prototipe.md#15-roadmap-e-hitos): M0, de CA0.1 a CA0.5, en la §15.3;
  - [§16](../../prototipe.md#16-riesgos-y-mitigaciones): R-04 y R-16.
- **Porqué:** [`DECISIONES.md`](../planificacion/DECISIONES.md), en D-12, D-16 y D-17, y en la §10.11.
- **Ficheros:** `apps/web/wrangler.jsonc`, `apps/web/public/_headers`, `pipeline/wrangler.jsonc`, `pipeline/catalog.headers`, `scripts/assemble-catalog.ts`, `scripts/scan-secrets.ts` y `.github/workflows/`.
- **Relacionados:** ADR-001 (arquitectura), ADR-002 (stack), ADR-005 (`catalog-store.ts`), ADR-006 (formato del catálogo), ADR-007 (pipeline diario y `catalog.yml`) y ADR-011 (micro-API en `ga-web`).
- **Cuándo revisarla:**
  - Si en M2 el núcleo completo llega sin `Content-Encoding`, se aplica la alternativa de R-16.
  - Con un dominio propio cambian el CORS de `pipeline/catalog.headers`, el `connect-src` de `_headers` y `VITE_CATALOG_URL`.
  - Si el repositorio vuelve a ser privado, los minutos cuentan (≈1 070–1 140 de los 2 000 al mes, §12.5) y vuelve la mitigación de R-04.
  - Si cambian las condiciones del plan gratuito, los ficheros planos se pueden servir en otro sitio (§5.4).
