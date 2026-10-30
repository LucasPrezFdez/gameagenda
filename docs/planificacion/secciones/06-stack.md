## 6. Stack con versiones

Versiones exactas comprobadas en el registro de npm el 28-10-2026 (Biome y `wrangler`, el 29-10-2026, al instalarlos en M0); se instalan sin rangos (ver §6.5).

### 6.1 Elecciones

| Capa | Elección | Versión | Por qué | Descartada |
|---|---|---|---|---|
| Entorno de ejecución | Node.js | 24.21.0 | Instalado; LTS de mantenimiento hasta el 30-04-2028; ejecuta el pipeline `.ts` sin compilar | Node 26, de momento |
| Paquetes | npm *workspaces* | 11.19 | Viene con Node (ver §14) | pnpm |
| Lenguaje | TypeScript | 7.0.2 | Compilador nativo; el stack no necesita su API (ver §6.3) | 6.0.3, solo de reserva |
| Interfaz | React + React DOM | 19.3.1 | Ecosistema maduro; admite TS 7 | SvelteKit, Next.js |
| *Build* | Vite + `@vitejs/plugin-react` | 8.3.5 / 6.1.2 | Rolldown; Workers de módulo sin configurar. Estilos: CSS nativo con *tokens*, una hoja por pantalla, sin CSS Modules | — |
| PWA | `vite-plugin-pwa` (`injectManifest`) + `workbox-window` + `workbox-build` | 2.0.0 / 7.4.1 / 7.4.1 | Service Worker propio con la precaché del *build*; `injectRegister: false`: el Service Worker se registra desde la app con `workbox-window`; `workbox-build`, solo en desarrollo (ver §6.3) | — |
| Datos en el cliente | Dexie | 4.4.7 | Esquema versionado e índices. La interfaz lee una agenda en memoria con `useSyncExternalStore`, al día con el evento `storagemutated` (ADR-004) | SQLite WASM |
| Lista virtual | `@tanstack/react-virtual` | 3.14.24 | Catálogo de ≈196 600 filas | — |
| Búsqueda | Índice propio + `@leeoniya/ufuzzy` | — / 1.0.19 | p95 de 2,1 ms por pulsación en Edge con el núcleo real (8,7 ms con CPU ×4; ver §8.11); uFuzzy solo para «¿Quizás buscabas…?» (ver §8) | Fuse.js, FlexSearch, Orama, MiniSearch |
| Contratos | Zod | 4.6.7 | Steam, micro-API e importación | — |
| Ids | `uuid` (v7) | 14.0.3 | `manual:<uuidv7>` y `opId` ordenables por tiempo | UUID v4 |
| Hosting | Cloudflare Workers Static Assets, `wrangler`, `@cloudflare/workers-types` | — / 4.155.0 / 5.20261028.1 | *Assets* gratuitos e ilimitados (ver §5.4) | Vercel Hobby, Netlify Free |
| Micro-API (M4) | Hono + D1 en la UE | 4.13.14 / — | Mínima y hecha para Workers; se prueba con `app.request()` | Prisma, Drizzle |
| Login con Steam (Fase 2) | `steam-signin` | 1.0.5 | OpenID 2.0 verificado en el servidor (ver §10) | `passport-steam` |
| Lint y formato | Biome | 2.6.4 | Una sola herramienta, sin la API de TS | ESLint con tipos |
| Pruebas | Vitest, fast-check, `@playwright/test` | 5.0.5 / 4.10.2 / 1.64.1 | Nativo de Vite; propiedades de `merge()`; CPU ×4 y WebKit en Windows (ver §12) | `@cloudflare/vitest-pool-workers` |
| Apoyo a las pruebas | `@axe-core/playwright`, `fake-indexeddb` | 4.14.0 / 6.2.6 | axe-core en cada pantalla de los E2E (ver §12.3); Dexie en Vitest bajo Node: migraciones y exportar → borrar → importar (RNF-08, ver §3.2) | Lighthouse (ver §6.4) |
| Tipos | `@types/react`, `@types/react-dom`, `@types/node` | 19.3.0 / 19.3.0 / 24.19.2 | Para `tsc`; `@types/node` es de la rama 24, como Node, y solo entra en lo que corre en Node (`pipeline/`, `scripts/`, configuración y E2E), nunca en `packages/core` (ver §14.3) | — |
| Escritorio (M3) | `@tauri-apps/cli`; *crates* `tauri`, `tauri-build`, `tauri-plugin-global-shortcut`, `tauri-plugin-single-instance` y `tauri-plugin-autostart` | 2.12.4; 2.12.5 / 2.7.4 / 2.4.1 / 2.5.5 / 2.7.0 | Envuelve la misma web sin lógica propia; requisitos ya instalados (ver §17.3). *Crates* comprobados en crates.io el 29-10-2026 y fijados con `=` en `Cargo.toml`; la web no usa `@tauri-apps/api` | Núcleo nativo propio, Electron |

### 6.2 Presupuesto de JS

Medido el 28-10-2026 con Vite 8.3.5 (*build* de producción):

| Contenido | Sin comprimir | gzip | brotli |
|---|---|---|---|
| React 19.3.1 + React DOM | 219,6 KB | 67,7 KB | 58,5 KB |
| + Dexie 4.4.7, `dexie-react-hooks` y `@tanstack/react-virtual` | 353,4 KB | 108,6 KB | 94,5 KB |

`dexie-react-hooks` se retiró el 30-10-2026 sin llegar a usarse (DECISIONES §10.18). En M1, el JS inicial real pesa 114,8 KB brotli (`npm run size`).

| *Chunk* | Presupuesto (brotli) | Contenido |
|---|---|---|
| Inicial | ≤150 KB | Lo necesario para pintar Mi lista y abrir la paleta |
| Worker de búsqueda | ≤40 KB | Normalización, índice, *ranking* y códecs; sin React ni Dexie (ver §5.2) |
| Diferidos | — | Catálogo (con `@tanstack/react-virtual`), Ajustes, exportar/importar y uFuzzy (lo importa el Worker) |

- Quedan ≥55 KB brotli para el código propio y `workbox-window` (algo más, porque la lista virtual va en el *chunk* del Catálogo).
- El Worker se crea con `new Worker(new URL('./search-worker/index.ts', import.meta.url), { type: 'module' })` y `vite.config` fija `worker: { format: 'es' }`: el formato por defecto de Vite, `iife`, no admite *chunks* diferidos ([`worker.format`](https://vite.dev/config/worker-options)). Así uFuzzy se carga con `import()` dentro del Worker, en un *chunk* propio que queda fuera de sus 40 KB y entra en la precaché; la puerta mide el *chunk* de entrada del Worker (comprobado con Vite 8.3.5: 32,7 KB brotli, con uFuzzy en su propio *chunk* de la precaché).
- Un objetivo de ≤100 KB gzip es inalcanzable con React + Dexie: la base ya pesa 108,6 KB gzip.
- El CI falla si se supera un presupuesto (ver §12). Si Zod no cabe en el del Worker, se usa `zod/mini`, que exporta el mismo paquete. En M1 no ha hecho falta: el Worker, con Zod dentro, pesa 32,7 KB de 40.

### 6.3 Compatibilidades comprobadas

Rangos de `peerDependencies` y `engines` en npm (28-10-2026):

- `vite-plugin-pwa` 2.0.0 admite Vite 8 y exige `workbox-build` y `workbox-window` ^7.4.1: los dos se fijan en 7.4.1.
- `@vitejs/plugin-react` 6.1.2 exige Vite ^8.0.0; Vitest 5.0.5 admite Vite ^6.4, ^7 y ^8.
- Vite 8.3.5 pide Node ^20.19 o ≥22.12, y `wrangler` 4.155.0, Node ≥22 y `@cloudflare/workers-types` ≥5.20261023.1.
- `@tanstack/react-virtual` 3.14.23 admite React 19.
- `@axe-core/playwright` 4.14.0 pide `playwright-core` ≥1.0.0 y trae `axe-core` ~4.14.0; `@types/react-dom` 19.3.0 pide `@types/react` ^19.3.0; `fake-indexeddb` 6.2.6, Node ≥18.
- TypeScript 7.0 no tiene API de compilador hasta la 7.1. Biome, Vite y Vitest no la usan; si otra herramienta la pidiera, solo ella usaría 6.0.3. Hasta M1, ninguna la ha pedido.

### 6.4 Qué no se usa y por qué

| Pieza | Motivo |
|---|---|
| SvelteKit 3.1 | Exige TypeScript ^6, como `svelte-check` 4.7.7; Kit 3 (estable desde el 01-10-2026) cambió la configuración y los módulos del Service Worker y dejó obsoletos muchos tutoriales; cinco pantallas no necesitan meta-framework. Su *runtime* pesa menos, pero React cabe en el presupuesto (§6.2) |
| Next.js 16.4 | Sus funciones de servidor sobran: la app es estática y los datos viven en el cliente |
| SQLite WASM en el cliente | Solo el motor ocupa ≈397 KiB gzip, y un índice FTS5 *trigram* del catálogo, 19,2 MiB (11,5 MiB brotli), frente a los 2,25 MB brotli del núcleo (ver §7.6) |
| Fuse.js | ≈394 ms por pulsación en la prueba de uFuzzy con 162 000 frases |
| FlexSearch, Orama, MiniSearch | Retienen 316, 192 y 67 MB de *heap* en esa prueba; el índice propio, ≈40 MiB con todo el catálogo (ver §8.11) |
| Lighthouse | El LCP se mide con `PerformanceObserver` (`largest-contentful-paint`) en el proyecto `perf` de Playwright (ver §12.4): una herramienta menos que fijar y actualizar |
| Prisma, Drizzle | Sin ORM: Dexie en el cliente y SQL directo en D1. El `latest` de Prisma es una RC (8.0.0-rc.28) y Drizzle 1.0 sigue en RC |
| InstantDB | Cerró las altas y apaga su nube el 31-08-2027 |
| `passport-steam` | Sin publicar desde el 18-06-2023 |
| `@cloudflare/vitest-pool-workers` | La 0.23.0 exige Vitest ^4.1 y partiría el repositorio en dos versiones mayores |
| ESLint con reglas de tipos | `typescript-eslint` con tipos necesita la API que TS 7.0 no tiene |
| pnpm | No está instalado y npm basta; Node deja de incluir corepack desde la 25 |
| Librería de enrutado, Redux, Tailwind | Sobran: *router* propio sobre la History API, la agenda en memoria con `useSyncExternalStore` y CSS con *tokens* |
| Vercel Hobby, Netlify Free | Hobby es solo para uso no comercial; Netlify gasta 15 créditos por despliegue y el catálogo se despliega a diario |

Fuentes (consultadas el 28-10-2026): registro de npm; [uFuzzy](https://github.com/leeoniya/uFuzzy); [SQLite WASM](https://sqlite.org/wasm/doc/trunk/persistence.md); [InstantDB](https://www.instantdb.com/essays/instant_team_joins_openai); [TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/).

### 6.5 Política de versiones

- `.npmrc` con `save-exact=true`, `package-lock.json` versionado y `npm ci` en CI.
- Dependabot semanal (npm, *actions*, fijadas por SHA, y, desde M3, Cargo); una versión mayor por PR, con el CI en verde y una entrada en el CHANGELOG.
- Nada en RC ni en alfa: antes de añadir un paquete se revisa `npm view <paquete> dist-tags`. Tauri se queda en 2.x (en crates.io ya hay versiones 3.0 alfa): las versiones de la tabla se comprueban de nuevo en crates.io al empezar M3, y `Cargo.lock` se versiona.
- Node se fija en 24.21 (`engines` y `actions/setup-node`). Node 26, Active LTS desde el 28-10-2026, se adopta al cerrar M4 en una PR propia con el CI y `npm run perf` en verde; antes, solo si una dependencia lo exige, y siempre antes del fin de soporte de Node 24 ([calendario](https://nodejs.org/en/about/releases/)).
- Cuando TypeScript 7.1 publique su API, se revisa la reserva 6.0.3. Si una actualización cambia una decisión, se escribe un ADR (ver §5.6).
