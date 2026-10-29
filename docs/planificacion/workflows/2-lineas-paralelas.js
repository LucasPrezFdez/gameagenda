export const meta = {
  name: 'gameagenda-parallel-tracks',
  description: 'Research-independent tracks for GameAgenda (UX, domain model, live search benchmark, engineering plan), each draft adversarially reviewed',
  phases: [
    { title: 'Draft', detail: '4 independent tracks in parallel' },
    { title: 'Review', detail: 'one demanding critic per track: issues + revised section' },
  ],
}

const SCRATCH_BASH = '/c/Users/lucas/AppData/Local/Temp/claude/C--Users-lucas-Documents-Programacion-GameAgenda/56497ade-bd80-409d-8199-9f2b9ba10c3e/scratchpad'
const SCRATCH_WIN = 'C:\\Users\\lucas\\AppData\\Local\\Temp\\claude\\C--Users-lucas-Documents-Programacion-GameAgenda\\56497ade-bd80-409d-8199-9f2b9ba10c3e\\scratchpad'

const CONTEXT = `PROJECT CONTEXT
"GameAgenda" is a new app (empty folder, nothing built yet). The deliverable being prepared is a professional PROTOTYPE PLAN (prototipe.md, in Spanish). The app's MAIN function: let a user very quickly jot down games they WANT TO PLAY (a personal to-play list / backlog used like a notebook-agenda). Secondary: mark games as completed ("completado"), platinum / 100% achievements ("platinado"), bought/owned ("comprado"), etc. The user insists it must be FAST and AGILE ("rapida y agil"). First data requirement: list/search ALL games available on Steam ("para empezar"; other platforms may come later — "platinado" hints the user also plays PlayStation).
User: Spanish-speaking developer on Windows 11 Pro. Installed: Node.js v24.21.0, npm 11.19.0, git 2.56, Rust 1.99.0. NOT installed: Docker, Python, .NET, Java, Go, PostgreSQL, pnpm, bun.
Today is 2026-10-28.
Known facts (live-tested today): the keyless ISteamApps/GetAppList/v2 returns 404 (removed); IStoreService/GetAppList/v1 requires a Steam Web API key (403 without); store.steampowered.com/api/appdetails works keyless (one app per call, Spanish via l=spanish&cc=es); IStoreBrowseService/GetItems/v1 works keyless with batches of appids (name, short description, developers/publishers, hashed asset paths for header/capsules, library_600x900 cover, steam_release_date, platforms incl. Steam Deck compat). So the full catalog must be enumerated server-side (or in a scheduled job) with a secret key, then enriched with GetItems.
PARALLEL WORK: a separate workflow is researching Steam API details (limits, CORS), legal/ToS, competitor apps and 2026 library versions right now. Do NOT duplicate it. Where your track depends on those facts, state your assumptions explicitly and keep the design stack-agnostic or present options.
Write all markdown in Spanish (Spain); keep technical identifiers in English. Do NOT create or modify files in the project folder (C:\\Users\\lucas\\Documents\\Programacion\\GameAgenda).`

const TRACKS = [
  { key: 'T1', label: 'UX & interaction design', kind: 'doc', prompt: `TRACK T1 - UX and interaction design for speed (Spanish markdown, ready to paste into the plan).
Core job-to-be-done: "apuntar un juego que quiero jugar" in under ~3 seconds from anywhere in the app (e.g. Ctrl/Cmd+K -> type 3-5 letters -> Enter).
Deliver:
1. User flows with step/keystroke/tap counts: (a) capturar: buscar en el catalogo completo de Steam y anadir a "Quiero jugar"; (b) cambiar estado/flags en 1 toque (Jugando, Completado, Platinado, Comprado, En pausa, Abandonado...); (c) revisar mi lista: filtrar, ordenar (prioridad, fecha anadida, lanzamiento), reordenar prioridad; (d) explorar el listado de TODOS los juegos de Steam (filtros, orden, scroll virtualizado, contador); (e) ficha de juego; (f) anadir juego manual si no esta en el catalogo; (g) opcional: importar biblioteca/wishlist de Steam; (h) proximos lanzamientos de juegos que quiero jugar.
2. Screen inventory + ASCII wireframes for desktop and mobile (at least: busqueda/paleta global, Mi lista as the MAIN screen with quick-add always visible, Catalogo, Ficha, Ajustes). Minimal UI.
3. Keyboard shortcut map (desktop) and mobile gestures (swipe actions), focus management, accessibility (WCAG 2.2 AA: contrast, visible focus, screen-reader labels, target sizes).
4. Interaction rules for perceived speed: optimistic updates + "Deshacer" toast instead of confirmation dialogs, local feedback < 100 ms, skeletons, prefetch on hover/focus, lazy images with placeholders, no blocking spinners; offline behaviour and sync indicator.
5. States: empty, no results (offer "Anadir manualmente"), offline, errors; Spanish microcopy.
6. Visual guidance: theme (dark/light), density, cover art usage (vertical capsule), status colors + icons + text labels (never color-only).
Return markdown + key decisions + open questions.` },
  { key: 'T2', label: 'domain model & schema', kind: 'doc', prompt: `TRACK T2 - Domain model, status taxonomy and data schema (Spanish markdown + SQL).
Deliver:
1. Status taxonomy for a "games I want to play" notebook with orthogonal dimensions: (a) progress state (exclusive, e.g. quiero_jugar, jugando, en_pausa, completado, abandonado); (b) ownership "comprado" (independent: platform/store, date, optional price, physical/digital); (c) achievement milestone "platinado"/100% (decide and justify whether platinado implies completado); (d) favorite / priority / rating / notes / custom tags / custom lists. Define allowed transitions, automatic side-effects (e.g. setting completado sets completed_at), and which actions are single-tap.
2. Entities and relations with a Mermaid ER diagram: catalog game with multi-source identity (source enum steam|igdb|manual|..., external_id; Steam appid first), user library entry (decide: one entry per game with a platforms list vs one entry per platform — consider "platinado en PS5, comprado en Steam"), activity/history log (timeline: anadido, empezado, completado...), custom lists, user settings.
3. SQL DDL draft that works in SQLite and maps cleanly to Postgres, with indexes for: list by status/priority, search by normalized name (case/accent-insensitive Spanish; FTS5 / pg_trgm options), upcoming releases. Sync-friendly conventions: UUIDv7 text ids for user data, created_at/updated_at (UTC), soft delete tombstones (deleted_at), a per-row version or HLC; explain a SIMPLE multi-device conflict policy suitable for a prototype.
4. Compact catalog snapshot format for client download (columns, encoding, size estimate for ~150k games) and incremental deltas.
5. Data-volume estimates (rows, bytes) and privacy notes (minimal personal data).
Return markdown + key decisions + open questions.` },
  { key: 'T3', label: 'live search benchmark', kind: 'bench', prompt: `TRACK T3 - EMPIRICAL benchmark on THIS machine (Node v24.21.0, Windows 11) to decide how to make full-catalog search feel instant.
Work ONLY inside the scratchpad: downloaded data in ${SCRATCH_BASH}/bench/data (untrusted: only parse as JSON/CSV, never execute), code in ${SCRATCH_BASH}/bench/app (Windows path ${SCRATCH_WIN}\\bench\\app). Run node from the app dir, passing data paths as arguments.
Steps:
1. Dataset: obtain a REAL, recent list of Steam app names (ideally games only, with appid). The keyless ISteamApps/GetAppList is gone, so look for public mirrors updated regularly (search GitHub/web for daily Steam app id list JSON repositories; check last commit date and record count). If you cannot get real data, generate a realistic synthetic set of ~160k names and say so loudly.
2. Snapshot sizes: build a compact snapshot of N games (JSON array of [appid, name]; plus an extended variant [appid, name, releaseYear, typeFlags, coverHash] with plausible placeholder values) and measure raw / gzip / brotli bytes (node:zlib). Also build a SQLite DB with Node's built-in node:sqlite (check availability, whether FTS5 works, and whether the trigram tokenizer and unicode61 remove_diacritics work) and measure file size.
3. Engines: npm install in the app dir and benchmark @leeoniya/ufuzzy, flexsearch, minisearch, @orama/orama, fuse.js and node:sqlite FTS5 (prefix queries; trigram if available). For each: index build time, heap delta (node --expose-gc, gc before measuring), serialized index size if supported (+gzip), query latency p50/p95/max over a realistic query set typed char by char (e.g. "e","el","eld","elde","elden"; "the w" -> "the witcher 3"; "zelda" which is not on Steam; typos "witchr", "cyberpnk"; accents "pokemon" vs "Pokemon" with accent; Spanish words with n-tilde; numbers "2077"; short "gta"), plus result quality (is the expected game top-1 / top-5: ELDEN RING, The Witcher 3: Wild Hunt, Cyberpunk 2077, Hollow Knight, Baldur's Gate 3, Counter-Strike 2, Grand Theft Auto V). Try a ranking tweak where supported (exact-prefix boost) and note that popularity tie-breaking (e.g. review count) is a data requirement.
4. Discuss expected slowdown in browsers and mid-range phones vs Node (cite if possible), Web Worker usage, memory on low-end phones, first-load cost (download + index build vs shipping a prebuilt index).
5. Recommendation for (a) a web/PWA client, (b) a Tauri client, (c) server-side search - with numbers.
Use -1 for any number you could not measure. Return the structured result with the numbers AND a Spanish markdown section (method, results table, recommendation).` },
  { key: 'T4', label: 'engineering plan & roadmap', kind: 'doc', prompt: `TRACK T4 - Engineering quality, NFRs and delivery plan (Spanish markdown), stack-agnostic where possible (placeholders like <frontend>, <backend> are fine).
Deliver:
1. Non-functional requirements with measurable targets: performance budgets for "rapida y agil" (search keystroke->results p95 local vs remote, add-to-list feedback < 100 ms, cold start, INP < 200 ms, LCP < 2.5 s, initial JS size), availability, offline, security, privacy (GDPR/LOPDGDD basics), accessibility (WCAG 2.2 AA), i18n (Spanish first, English later), browser/device support.
2. Testing strategy: unit, integration (DB), contract tests against recorded Steam fixtures (no live Steam calls in CI), e2e (Playwright) for the core flow "apuntar un juego en < 3 s", performance tests (search benchmark in CI, Lighthouse CI budgets), test data.
3. Tooling and conventions: monorepo layout options, lint/format, type-checking, Conventional Commits, trunk-based + PRs, ADRs (list the first ADRs to write), Definition of Done, versioning/releases, changelog.
4. CI/CD on GitHub Actions: PR checks, deploy, a scheduled catalog-sync job with secrets, caching, environments, secret management (the Steam Web API key never in client code or the repo).
5. Observability: structured logs, error tracking, catalog-sync metrics (apps ingested, failures, 429s, duration), alerting, privacy-friendly analytics.
6. Security checklist (OWASP ASVS L1 highlights): auth/session, CSRF, CSP, rate limiting our own API, input validation, dependency scanning, backups.
7. Local dev on this machine (no Docker): what must be installed per option, scripts (setup/dev/test), seed data (a small Steam catalog fixture) so the app runs offline.
8. Roadmap skeleton: phases/milestones with goal, deliverables, acceptance criteria and rough effort for a solo dev. Milestone 1 MUST be: catalog of ALL Steam games listable/searchable + quick-add to "Quiero jugar". Include a risk register skeleton (risk, likelihood, impact, mitigation).
Return markdown + key decisions + open questions.` },
]

const DOC_SCHEMA = {
  type: 'object',
  properties: {
    markdown: { type: 'string' },
    key_decisions: { type: 'array', items: { type: 'string' } },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['markdown', 'key_decisions', 'open_questions'],
}

const BENCH_SCHEMA = {
  type: 'object',
  properties: {
    dataset: {
      type: 'object',
      properties: {
        source: { type: 'string' }, fetched_at: { type: 'string' }, records: { type: 'number' },
        games_only: { type: 'boolean' }, synthetic: { type: 'boolean' }, notes: { type: 'string' },
      },
      required: ['source', 'fetched_at', 'records', 'games_only', 'synthetic', 'notes'],
    },
    snapshot_sizes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          variant: { type: 'string' }, records: { type: 'number' }, raw_bytes: { type: 'number' },
          gzip_bytes: { type: 'number' }, brotli_bytes: { type: 'number' },
        },
        required: ['variant', 'records', 'raw_bytes', 'gzip_bytes', 'brotli_bytes'],
      },
    },
    engines: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          engine: { type: 'string' }, version: { type: 'string' }, build_ms: { type: 'number' }, heap_mb: { type: 'number' },
          index_bytes: { type: 'number' }, index_gzip_bytes: { type: 'number' }, p50_ms: { type: 'number' }, p95_ms: { type: 'number' },
          max_ms: { type: 'number' }, quality_top1: { type: 'string' }, quality_top5: { type: 'string' }, notes: { type: 'string' },
        },
        required: ['engine', 'version', 'build_ms', 'heap_mb', 'index_bytes', 'index_gzip_bytes', 'p50_ms', 'p95_ms', 'max_ms', 'quality_top1', 'quality_top5', 'notes'],
      },
    },
    sqlite: {
      type: 'object',
      properties: {
        available: { type: 'boolean' }, fts5: { type: 'boolean' }, trigram: { type: 'boolean' },
        remove_diacritics: { type: 'boolean' }, db_bytes: { type: 'number' }, notes: { type: 'string' },
      },
      required: ['available', 'fts5', 'trigram', 'remove_diacritics', 'db_bytes', 'notes'],
    },
    recommendation: { type: 'string' },
    markdown: { type: 'string' },
  },
  required: ['dataset', 'snapshot_sizes', 'engines', 'sqlite', 'recommendation', 'markdown'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'problem', 'fix'],
      },
    },
    corrected_numbers_note: { type: 'string', description: 'Benchmarks only: numbers you re-measured or corrected; empty otherwise' },
    revised_markdown: { type: 'string', description: 'Full improved version of the section in Spanish, fixing every issue raised' },
  },
  required: ['summary', 'issues', 'corrected_numbers_note', 'revised_markdown'],
}

const reviewPrompt = (t, draft) => `${CONTEXT}

YOUR ROLE: demanding reviewer of the "${t.label}" section for the GameAgenda plan. What matters most: (1) main function = jot down games you want to play, FAST; (2) statuses completado / platinado / comprado etc.; (3) "rapida y agil"; (4) list ALL Steam games to start; (5) professional but PROTOTYPE-scoped for a solo dev on Windows (Node 24, Rust; no Docker).
Find: factual/technical errors, internal contradictions, gaps vs the requirements, over-engineering for a prototype, under-specification that would block implementation, unclear Spanish. Then write an improved FULL version of the section (Spanish) that fixes every issue you raised.
${t.kind === 'bench' ? `This is a benchmark: scrutinise methodology (warm-up, gc, JIT/cache effects, query-set realism, dataset freshness and size, apples-to-apples settings). If anything looks off, re-run a small subset yourself in ${SCRATCH_BASH}/bench/app (do not touch the project folder) and report corrected numbers in corrected_numbers_note.` : ''}

DRAFT TO REVIEW (JSON):
${JSON.stringify(draft)}`

const results = await pipeline(
  TRACKS,
  t => agent(`${CONTEXT}\n\n${t.prompt}`, { label: `draft:${t.key} ${t.label}`, phase: 'Draft', schema: t.kind === 'bench' ? BENCH_SCHEMA : DOC_SCHEMA }),
  async (draft, t) => {
    if (!draft) { log(`${t.key}: draft failed, skipping review`); return { key: t.key, label: t.label, draft: null, review: null } }
    const review = await agent(reviewPrompt(t, draft), { label: `review:${t.key} ${t.label}`, phase: 'Review', schema: REVIEW_SCHEMA })
    if (!review) log(`${t.key}: review failed; returning the unreviewed draft`)
    const keep = t.kind === 'bench'
      ? draft
      : { key_decisions: draft.key_decisions, open_questions: draft.open_questions, markdown: review ? undefined : draft.markdown }
    return { key: t.key, label: t.label, draft: keep, review }
  },
)
return results.filter(Boolean)
