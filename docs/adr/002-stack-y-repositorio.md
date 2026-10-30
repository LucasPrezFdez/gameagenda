# ADR-002 · Stack y repositorio: React + Vite como SPA, *router* propio, CSS nativo y versiones exactas

- **Estado:** aceptada
- **Fecha:** 29-10-2026. Se decidió el 28-10-2026, al planificar, y se confirmó al instalar las herramientas de M0.
- **Deciden:** el usuario y el asistente

## Contexto y problema

ADR-001 fija una PWA *local-first* con:

- un solo cliente para móvil y escritorio;
- un Worker de búsqueda;
- lógica compartida entre el navegador, Node y Cloudflare.

Falta elegir el framework, las herramientas y la forma del repositorio, con estas restricciones:

- trabaja una persona, en Windows 11, con Node 24.21 y npm 11.19, sin Docker ni Python;
- el JS inicial no puede pasar de 150 KB brotli (§6.2);
- TypeScript 7.0 no tiene API de compilador hasta la 7.1.

## Factores de la decisión

- Presupuesto de JS (RNF-06): inicial ≤150 KB brotli y Worker ≤40 KB.
- Cinco pantallas y ninguna función de servidor: la app es estática y los datos viven en el cliente.
- Una sola implementación de la lógica en `packages/core`, que usan Vite, Vitest y Node sin compilarla.
- Herramientas que funcionen con TypeScript 7.0 sin su API.
- Reproducibilidad: versiones exactas, sin RC ni alfa.
- Pocas herramientas que fijar y actualizar.

## Opciones consideradas

- React 19.3.1 + Vite 8.3.5 como SPA, con *router* propio y CSS nativo.
- SvelteKit 3.1 con Svelte 5 y TypeScript 6.0.3 (la propuesta original de la arquitectura A).
- Next.js 16.4.

Para las herramientas se compararon estas alternativas (§6.4):

- Biome o ESLint con tipos;
- npm *workspaces* o pnpm;
- *router* propio o una librería de enrutado;
- CSS con *tokens* o Tailwind;
- estado de React o Redux;
- TypeScript 7.0.2 o 6.0.3.

## Decisión

Opción elegida: **React 19.3.1 + Vite 8.3.5 como SPA**. Se elige porque:

- React cabe en el presupuesto: con React DOM pesa 58,5 KB brotli;
- admite TypeScript 7 y tiene un ecosistema maduro;
- cinco pantallas no necesitan un meta-framework.

- **Lenguaje:** TypeScript 7.0.2.
  - `tsconfig.base.json` activa `strict`, `noUncheckedIndexedAccess`, `erasableSyntaxOnly`, `verbatimModuleSyntax` y `allowImportingTsExtensions`.
  - `core` usa `module: nodenext`, y la `lib` ES2024 sin DOM ni `@types/node`.
  - La 6.0.3 queda de reserva.
- **Interfaz:**
  - *router* propio sobre la History API;
  - CSS nativo con *tokens* (`styles/tokens.css`) en hojas por pantalla; Vite admite CSS Modules sin configurar, pero M1 no los usa;
  - estado con React (`useSyncExternalStore` sobre la agenda; ver ADR-004);
  - sin librería de enrutado, Redux ni Tailwind.
- **PWA:**
  - `vite-plugin-pwa` en modo `injectManifest`, con un Service Worker propio que la app registra con `workbox-window`;
  - el Worker de búsqueda se construye con `worker: { format: 'es' }`, para que admita *chunks* diferidos.
- **Herramientas:**
  - Biome 2.6.4 (formato y lint);
  - Vitest 5.0.5 con fast-check;
  - Playwright 1.64.1 con axe-core;
  - `fake-indexeddb` para probar Dexie en Node.
- **Repositorio:** monorepo con npm *workspaces* (§14).
  - Paquetes: `apps/web`, `packages/core` y `pipeline/`.
  - Carpetas: `fixtures/`, `scripts/` y `docs/adr/`.
  - `packages/core` no se compila ni hace E/S.
  - Entre paquetes se importa por nombre (`@gameagenda/core/search`) y solo lo que declara `exports`.
- **Versiones:** exactas, las de la §6.
  - `.npmrc` con `save-exact=true` y `engine-strict=true`.
  - `package-lock.json` versionado.
  - `engines` `^24.21.0` y `.node-version`.

### Hallazgos al instalar (M0, 29-10-2026)

- **Versiones nuevas:** Biome 2.6.4 y `wrangler` 4.155.0, en lugar de 2.6.3 y 4.154.0, porque se publicaron el 28-10-2026. La §6 ya está al día.
  - `wrangler` 4.153–4.155 depende de `miniflare` 5.x *beta*. Es una dependencia interna suya, no una elección nuestra.
- **`allowScripts`:** npm 11.19 no ejecuta los *scripts* de instalación sin autorización. `esbuild` y `workerd` funcionan sin ellos, así que quedan denegados en el `package.json` raíz.
- **Markdown fuera de Biome:** Biome 2.6 formatea Markdown y cambiaría `*cursiva*` por `_cursiva_`. Por eso `biome.json` excluye `**/*.md`, `docs/planificacion` y `fixtures`.
- **`"preset": "recommended"`, a mano:** `biome migrate` convirtió `"recommended": true` en `"preset": "none"`, que apagaba todas las reglas. Se corrigió a mano y se comprobó que las reglas saltan.
- **`tsc` como guardián de `core`:** se comprobó que rechaza imports relativos sin `.ts`, `enum`, `document` y `process`.
- **git:** `core.longpaths true` y `core.autocrlf false` están en la configuración del repositorio y no en la global, para no cambiar otros proyectos (la §13.2 dice `--global`). `.gitattributes` fija `* text=auto eol=lf`.

### Consecuencias

- Bien, porque el JS inicial de M1 pesa 113 KiB brotli, con un límite de 150.
- Bien, porque no hay dependencias ajenas a la §6 y todas tienen versión exacta (comprobado en los cuatro `package.json`).
- Bien, porque `core` es el mismo código en el navegador, en Vitest y en Node, sin paso de compilación.
- Bien, porque una sola herramienta formatea y revisa el código, y no necesita la API de TypeScript.
- Mal, porque los `.md` (plan, ADR y CHANGELOG) no tienen formateador. El *lint* de `prototipe.md` lo hace `montar-prototipe.mjs`.
- Mal, porque sin ESLint con tipos no hay reglas que necesiten información de tipos, al menos hasta TypeScript 7.1.
- Resuelto: `pipeline/` ya tiene código y entra en `npm run typecheck`.
- Resuelto el 30-10-2026: Biome vigila las reglas de dependencia de la §14.3. `biome.json` configura `noUndeclaredDependencies` y un `noRestrictedImports` por carpeta (`packages/core/src`, `apps/web/src`, el Worker de búsqueda y `pipeline/`). Ojo: si dos *overrides* configuran la misma regla para un fichero, manda el último y sustituye las opciones del anterior. Por eso el del Worker repite los patrones de la web. Las pruebas, los E2E, `perf`, las configuraciones y `scripts/` quedan fuera de `noUndeclaredDependencies`, porque usan las dependencias de desarrollo de la raíz, que npm sube allí.
- Pendiente: faltan paquetes de la §6 que aún no hacen falta. `@cloudflare/workers-types` llega con los despliegues (ADR-003), Hono en M4 y `steam-signin` en Fase 2.
- Resuelto el 30-10-2026: `dexie-react-hooks`, declarado en `apps/web` sin importarse, se ha retirado (ADR-004 y `DECISIONES.md` §10.18).
- La puerta de tamaño (`scripts/size-gate.ts`) ya va en `npm run check`. El CI llega con los pasos aplazados de M0.

### Confirmación

- **`npm run check`:** Biome, Vitest, el *build* y `tsc` en cada `tsconfig`: `core` y sus pruebas, la web, el Service Worker, el Worker de búsqueda, la configuración de Node y `scripts/`.
- **Tamaño:** JS inicial ≤150 KB y Worker ≤40 KB brotli, medidos sobre el *build* (`.vite/manifest.json`). La puerta automática llega con el CI.
- **Dependencias:**
  - Antes de añadir o actualizar un paquete se revisan sus `dist-tags` y la §6.5.
  - Un cambio de versión mayor actualiza la §6.
  - Si una actualización cambia una decisión, se escribe un ADR.

## Pros y contras de las opciones

### React 19.3.1 + Vite 8.3.5 como SPA

- Bien, porque admite TypeScript 7.
- Bien, porque Vite trae Workers de módulo y CSS sin configurar, y Vitest es nativo de Vite.
- Mal, porque su *runtime* pesa más que el de Svelte, aunque cabe en el presupuesto.

### SvelteKit 3.1 + Svelte 5 + TypeScript 6.0.3

- Bien, porque su *runtime* pesa menos.
- Mal, porque exige TypeScript ^6, igual que `svelte-check` 4.7.7.
- Mal, porque Kit 3, estable desde el 01-10-2026, cambió la configuración y los módulos del Service Worker, y dejó obsoletos muchos tutoriales.
- Mal, porque añade un meta-framework para cinco pantallas.

### Next.js 16.4

- Mal, porque sus funciones de servidor sobran: la app es estática y los datos viven en el cliente.

### Herramientas descartadas

- **ESLint con reglas de tipos:** `typescript-eslint` necesita la API que TypeScript 7.0 no tiene.
- **pnpm:** no está instalado y npm basta. Además, Node deja de incluir corepack desde la 25.
- **Librería de enrutado, Redux y Tailwind:** sobran.
- **Lighthouse:** el LCP se mide con `PerformanceObserver` en el proyecto `perf`.
- **`@cloudflare/vitest-pool-workers`:** exige Vitest ^4.1 y partiría el repositorio en dos versiones mayores.

## Más información

- **En `prototipe.md`:**
  - [§6](../../prototipe.md#6-stack-con-versiones): versiones, presupuesto, compatibilidades, descartes y política de versiones;
  - [§12.6](../../prototipe.md#126-convenciones-y-definición-de-terminado): convenciones y definición de terminado;
  - [§13.2](../../prototipe.md#132-ajustes-de-git-y-npm-en-windows): ajustes de git y npm;
  - [§14](../../prototipe.md#14-estructura-del-repositorio): estructura del repositorio y reglas de dependencia.
- **Porqué:** [`DECISIONES.md`](../planificacion/DECISIONES.md), en D-02, D-17, D-18, la §6 y la §10.11.
- **Medición de React + Dexie con Vite 8.3.5:** `docs/planificacion/medicion-js/`.
- **Relacionados:** ADR-001 (arquitectura) y ADR-003 (*hosting*, despliegue y CI; pendiente).
