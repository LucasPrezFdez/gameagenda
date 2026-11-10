**English** · [Español](README.es.md)

# GameAgenda

A personal backlog for video games: jot down the games you want to play in seconds and track their status (Completed, Platinum, Bought…), starting from the full Steam catalog.

**[Try the app →](https://ga-web.gameagenda.workers.dev)**

![GameAgenda: My list with statuses and covers](https://lucasprezfdez.github.io/assets/img/proyecto-gameagenda.webp)

## Highlights

- **Local-first, offline search over ~190,000 games.** The whole Steam catalog lives on the device and is searched in a Web Worker with a custom index: 2.1 ms p95 per keystroke, and 8.7 ms with the CPU throttled ×4, in ≈40 MiB of memory ([ADR-005](docs/adr/005-busqueda-local-en-un-web-worker.md)). Neither Steam nor the server is ever on the critical path.
- **Fast first visit.** While the full catalog downloads, search already works on the 20,000 most popular games, served as a 269 KB signed boot file ([ADR-009](docs/adr/009-arranque-rapido.md)). In production, on a fiber connection, search is ready after 0.9 s and the full catalog arrives at 2.0 s.
- **Daily catalog pipeline.** GitHub Actions rebuilds the catalog from Steam every day, runs integrity gates and publishes it with a manifest signed by a key that only lives in a GitHub secret. A fallback path builds the catalog without a Steam key ([ADR-007](docs/adr/007-pipeline-del-catalogo.md)).
- **Performance budgets enforced in CI.** A size gate fails the build if the initial JS exceeds 150 KB or the Worker exceeds 40 KB (brotli). `npm run perf` measures the real app with Playwright:

  | Metric (`npm run perf`, full catalog, CPU ×4) | Budget | Measured |
  |---|---|---|
  | First visit: LCP | ≤2500 ms | 660 ms |
  | Cached restart: My list visible | ≤1000 ms | 502 ms |
  | Keystroke → results, p95 | ≤50 ms | 8.6 ms |
  | Long tasks (>50 ms) while typing | 0 | 0 |

  Full results in [`docs/medidas/`](docs/medidas/).
- **Desktop app.** A Tauri 2 wrapper around the web app with a global shortcut. Tauri treats the page as remote and grants it no capabilities, so there is no native API to call from the web side ([ADR-010](docs/adr/010-app-de-escritorio.md)).
- **Ready for sync.** User data is stored in IndexedDB (Dexie) with natural ids, hybrid logical clocks and an outbox ([ADR-004](docs/adr/004-datos-del-usuario.md)). Multi-device sync is the next milestone (M4).
- **Documented decisions.** Ten architecture decision records in [MADR 4.0](https://adr.github.io/madr/) format in [`docs/adr/`](docs/adr/), each with the options considered, consequences and how it is verified. The project plan is in [`prototipe.md`](prototipe.md). Both are in Spanish.

## Stack

| Area | Tools |
|---|---|
| App | React, Vite, TypeScript, custom router, native CSS, Dexie (IndexedDB), Web Workers, uFuzzy |
| Desktop | Tauri 2 (Rust), NSIS installer |
| Data pipeline | Node, Steam Web API, signed manifest |
| Hosting and CI/CD | Cloudflare Workers Static Assets, GitHub Actions |
| Quality | Biome, `tsc`, Vitest, Playwright (Chromium and mobile WebKit), size and performance gates |

## Getting started

Requirements: Windows 11 (or any OS with Node), Node 24.21 and npm 11.19.

```powershell
npm run setup   # npm ci, Playwright browsers and .env.local
npm run dev     # http://127.0.0.1:5173
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on `127.0.0.1:5173` |
| `npm run build` / `npm run preview` | Production build / serve it on `127.0.0.1:4173` |
| `npm test` | Unit tests with Vitest |
| `npm run check` | Biome, `tsc`, Vitest, build and size gate (`npm run size`) |
| `npm run e2e` | Playwright (Chromium and, locally, WebKit with an emulated phone) |
| `npm run perf` | Performance with CPU ×4 and the full catalog from `pipeline/out/` (see §12.4 of `prototipe.md`) |
| `npm run catalog:build -- --keyless` | M1 catalog without a Steam key, in `pipeline/out/` (see §4) |
| `npm run catalog:frozen` | Full catalog and mini-catalog in `fixtures/catalog/` from the frozen copy |
| `npm run desktop:dev` | Desktop app (Tauri) against `npm run dev`; requires Rust (see ADR-010) |
| `npm run desktop:build` | NSIS installer for the desktop app in `apps/desktop/src-tauri/target/release/bundle/nsis/` |
| `npm run format` | Format and sort imports with Biome |

## Deployment

On Cloudflare Workers Static Assets (see [ADR-003](docs/adr/003-hosting-despliegue-y-ci.md)):

| Worker | URL | How it is deployed |
|---|---|---|
| `ga-web` | https://ga-web.gameagenda.workers.dev | After every green `ci` run on a push to `main` (`.github/workflows/deploy-web.yml`) |
| `ga-catalog` | https://ga-catalog.gameagenda-cat.workers.dev (in its own Cloudflare account; until M2, the M0 mini-catalog at https://ga-catalog.gameagenda.workers.dev) | Daily, with `catalog.yml` (see ADR-007) |

Deployments need the `CLOUDFLARE_API_TOKEN` («Workers Scripts: Edit») and `CLOUDFLARE_ACCOUNT_ID` secrets in GitHub. To roll back: `npx wrangler rollback -c apps/web/wrangler.jsonc`.

## Structure

| Folder | Contents |
|---|---|
| `apps/web` | The app (React + Vite) |
| `apps/desktop` | The desktop app (Tauri) |
| `packages/core` | Shared pure logic |
| `pipeline/` | Steam catalog build |
| `fixtures/` | Test data, including the frozen copy of the real catalog |
| `scripts/` | Repository scripts |
| `docs/` | ADRs, measurements (`docs/medidas/`) and planning |

## Author

Lucas Pérez Fernández · [Portfolio](https://lucasprezfdez.github.io/) · [GitHub](https://github.com/LucasPrezFdez)
