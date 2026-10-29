export const meta = {
  name: 'gameagenda-architecture-panel',
  description: 'Judge panel: 3 independent architecture proposals for GameAgenda scored by 3 lens-specific judges',
  phases: [
    { title: 'Propose', detail: '3 independent architectures from different angles' },
    { title: 'Judge', detail: '3 judges (speed/UX, feasibility/cost, robustness/compliance) score all proposals' },
  ],
}

const REQUIREMENTS = `PRODUCT "GameAgenda" (new; empty repo). The user's own words: "una app que funcione a modo de agenda"; "la principal funcion de la app va a ser apuntar juego que quieras jugar. Tambien tendras las opciones de poner juegos que has completado, platinado, comprado, etc. Tiene que ser rapida y agil"; "tiene que poderse listar todos los juegos que haya en steam para empezar"; "decide tu" (the architect decides, professionally).
So: core = jot down games you want to play in seconds; statuses/flags completado, platinado, comprado (extensible); hard requirement = FAST and AGILE; data = ALL Steam games first, other platforms (PlayStation 'platinado') later.
Deliverable being prepared: prototipe.md - a professional plan for a PROTOTYPE built by a solo Spanish-speaking developer.
MACHINE: Windows 11 Pro; Node.js 24.21 + npm 11.19, git 2.56, Rust 1.99 (MSVC host), VS Build Tools 2022 and WebView2 155 present (Tauri 2 prerequisites met). NOT installed: Docker, Python, PostgreSQL, pnpm (corepack 0.36 is bundled with Node 24), bun, Java, Android Studio. No Mac.`

const FACTS = `VERIFIED FACTS (research + adversarial verification, 2026-10-28). Treat as ground truth; do not contradict them.
STEAM CATALOG
- ISteamApps/GetAppList v1/v2 was removed on 2025-11-13 (HTTP 404 now).
- IStoreService/GetAppList/v1 (documented replacement) needs a Steam Web API key (a user key works on api.steampowered.com; never use partner.steam-api.com). Params: if_modified_since, have_description_language, include_games (default), include_dlc, include_software, include_videos, include_hardware, last_appid, max_results (default 10k, max 50k). Response {apps[{appid,name,last_modified,price_change_number}], have_more_results, last_appid}, ascending appid. ~196.6k games (~133.9k released + ~62.7k coming soon) = 4 calls; DLC ~63.9k (2 calls). Includes coming-soon, free and adult games; EXCLUDES delisted games. Names are base names (not localized). Deltas via if_modified_since (~3.3k changed games/day); deletions are never reported, so a periodic full reconcile is needed.
- Key requirements: non-limited Steam account (>= US$5 spent) + Steam Guard Mobile Authenticator; domain field ('localhost' accepted). ToU (2010): 100,000 calls/day, key confidential (never in any client), privacy policy, tell users which Steam data is stored and in which countries, retrieve a user's data only as that user requests, no implied Valve endorsement. Key can be sent in the x-webapi-key header.
- Keyless but UNDOCUMENTED (best-effort, may change without notice): IStoreQueryService/Query (1000 items/call, sort=2 = ascending appid, filters released_only / coming_soon_only / type_filters / content descriptors; with any data_request it returns full store items; ~197 calls cover all games; results depend on context.country_code, region-locked titles drop out) and IStoreBrowseService/GetItems (context.country_code is mandatory or the response is empty; batch bounded by URL length ~8 KB: ~200-250 ids per JSON GET, ~700 via input_protobuf_encoded). GetItems gives: type (EStoreAppType 0 game, 1 demo, 4 DLC, 11 music...), localized name (context.language; Spanish names differ from base names for ~0.5% of old and ~4% of new games), is_coming_soon, is_early_access, release {steam_release_date (unix s), coming_soon_display date_full|text_comingsoon|text_tba, custom_release_date_message}, unlisted:true for delisted games, content_descriptorids (3/4 = adult sexual content), reviews summary (review_count, percent_positive, review_score 0-9, localized label), assets (asset_url_format + filenames), platforms incl. steam_deck_compat_category; include_extra_details adds achievement_count/genreids/metacritic (heavy); include_best_purchase_option defaults to true (set false). success 15 + appid 0 = nonexistent; success 15 + unvailable_for_country_restriction = region-locked (not removed).
- Images: URL = 'https://shared.akamai.steamstatic.com/store_item_assets/' + asset_url_format with the FILENAME placeholder replaced by the asset filename. Vertical cover = assets.library_capsule (filename varies, hashed for new games, sometimes language-specific); fallback header; a few placeholder apps have no assets at all. Never guess legacy hash-less filenames (404 for new games, stale art for old ones). The image CDN sends Access-Control-Allow-Origin * and ~10-year max-age (hotlinking/caching OK).
- CORS: api.steampowered.com and store.steampowered.com send NO Access-Control-Allow-Origin, so a browser cannot read any Steam API; data must come from our own snapshot/proxy or native HTTP (Tauri plugin-http from Rust).
- Rate limits undocumented (community ~120 req/5 min per IP; appdetails ~200/5 min). Plan <= 1 req/s, one worker, exponential backoff, global pause on 429. Short cache headers, no ETags.
- appdetails: 1 appid/call, ~42 KB, localized date strings - on demand only. /appreviews unreliable (302 in our test) - use GetItems review summary. GetTagList (keyless, 446 Spanish tags, version_hash) and GetStoreCategories (72) exist; no genre-name endpoint.
- Remote store search (storesearch, SearchSuggestions): keyless but 250-380 ms per query, mixes DLC/soundtracks, no CORS.
- Measured snapshot sizes for all 196,595 games: [appid,name] JSON 5.98 MB raw / 2.64 MB gzip / 1.91 MB brotli (TSV 1.80 MiB brotli). Names: avg 17.6 B, max 542 B, 18 empty, ~1k with TM/R symbols, 8.1% non-ASCII, 6.3% CJK/Hangul. Hashed cover paths compress badly (40-hex).
- Measured search speed on THIS PC (Node 24): brute-force substring scan over 196.6k accent-folded names 7-14 ms median; simple word-prefix inverted index 0-0.3 ms/query (220-330 ms build, ~16 MiB retained); uFuzzy ~5 ms/keystroke 28 MB peak (162k benchmark); Fuse.js ~394 ms (unusable); FlexSearch/Orama/MiniSearch 67-316 MB heap; SQLite FTS5 trigram 0.14-0.45 ms but a 19.2 MiB DB (11.5 MiB brotli). Phones are several times slower (not measured).
- jsnli/steamappidlist publishes a daily unofficial GetAppList dump (no license): fine as a prototype seed/fixture, not as a production dependency.
STEAM ACCOUNT (optional feature)
- Third parties get only OpenID 2.0 'Sign in through Steam' (no OIDC/OAuth); must verify server-side with check_authentication (lib steam-signin 1.0.5, no key). Or no login: paste profile URL (/profiles/<id64> or /id/<vanity>/?xml=1, keyless).
- GetOwnedGames (key) -> owned games + playtime ('comprado'); needs the user's 'Game details' privacy = Public; family_shared != comprado. Wishlist keyless (IWishlistService/GetWishlist). Achievements keyless (IPlayerService/GetUserAchievements + GetGameAchievements) ~1 call per game -> auto 'platinado' possible but costly; Steam Achievement Sets beta (Oct 2026) changes 100% semantics.
- Never collect Steam passwords/tokens; never use PICS/Steam client protocol.
LEGAL (Spain/EU)
- SteamID64 + play data = personal data; GDPR Art. 6(1)(b); minimisation; export/delete; layered privacy notice; record of processing (AEPD Facilita RGPD); digital-consent age 14 in Spain (16 pending). Only strictly-necessary cookies/storage -> no consent banner; analytics need consent. Hotlinking the Steam CDN sends users' IPs to Valve -> disclose. Use Valve's official sign-in button images and trademark notice; keep 'Steam' out of the app name/icon.
OTHER SOURCES (later phases)
- IGDB = best multi-platform catalog later (free incl. commercial via free partnership + visible attribution; caching encouraged; 4 req/s, 8 concurrent; backend only (no CORS); external_games maps Steam appid (source 1); game_time_to_beats). PSN trophies only via unofficial NPSSO APIs (ToS risk) -> 'platinado' manual. ITAD for prices later (terms forbid competing apps; ask first). Avoid HLTB scraping, Giant Bomb (offline), RAWG mirroring, SteamGridDB automation, PCGamingWiki data (NC).
PRODUCT / UX
- Competitors (Backloggd - IGDB based, top requests are native mobile apps and Steam import; HLTB; Playnite; LaunchBox; GameTrack; Infinite Backlog...) converge on ~5 exclusive progress states + separate milestone and ownership axes.
- Recommended model: Estado (Quiero jugar default | Jugando | En pausa | Completado | Abandonado) + one-tap flags (Platinado => also Completado, Comprado, Proximo) + Nota; dates auto-stamped; undo toast instead of confirmations. Manual/custom games must be addable instantly (title only) for non-Steam/PS games. Paste a Steam link/appid to add.
- Budgets: keystroke->results <= 50 ms p95; tap->feedback <= 100 ms; INP p75 <= 200 ms; first-visit LCP <= 2.5 s; cached restart <= 2 s.
- PWA facts: Web Share Target only on Chromium (Android, desktop) when installed; Safari/iOS has none; iOS 26 opens Home Screen sites as web apps; Web Push on iOS 16.4+. Safari deletes storage of non-installed sites after 7 days without interaction -> navigator.storage.persist(), export/import, sync.
STACK (2026-10-28)
- Node 24 = maintenance LTS (until 2028-04-30); Node 26 Active LTS from today; no corepack from Node 25. TypeScript 7.0.2 (Go compiler) has no API until 7.1 (svelte-check and typed ESLint still need TS 6). Vite 8.3 (Rolldown), React 19.3, Next 16.4, SvelteKit 3.1, Hono 4.13, Fastify 5.12, NestJS 12.3, Drizzle 0.45 (1.0 RC), Prisma 7.10 (npm 'latest' points to an 8.0 RC - pin), PGlite 0.5.12, Dexie 4.4.7, sqlite-wasm 3.54.1 (FTS5 incl. trigram), node:sqlite in Node 24 (SQLite 3.53, FTS5), pnpm 12.15, Biome 2.6, ESLint 10 (flat config only), Vitest 5, Playwright 1.64, Tauri CLI 2.12.4, Capacitor 8.5, Expo SDK 58, PostgreSQL 18.6 (19 due 2026-11-19).
- Hosting: Cloudflare static assets free & unlimited (25 MiB/file), R2 no egress fees; Workers Free 10 ms CPU per request, 100k requests/day; D1 Free 5M rows read/day; Vercel Hobby non-commercial only; Netlify Free credits (15 per deploy); Render free spins down; Fly.io no free tier; Neon/Turso free tiers OK; Supabase Free pauses after 7 idle days. GitHub Actions cron: free on public repos but best-effort (late/dropped runs), disabled after 60 days without repo activity.
- Sync engines: Zero/Electric/PowerSync need Postgres logical replication + a sync service (overkill for personal lists); InstantDB cloud closed to signups and shutting down 2027-08-31 (not an option); Dexie Cloud free = 3 production users; Replicache in maintenance mode.`

const ANGLES = [
  { key: 'A', title: 'PWA local-first + static catalog snapshot', angle: 'Maximise real and perceived speed with minimal operations: an installable PWA, all search and writes on the device, a catalog snapshot built by a scheduled job and served as static files, and only the smallest unavoidable server piece (e.g. an edge proxy for on-demand game details). Path to optional sync later.' },
  { key: 'B', title: 'Tauri 2 native-first', angle: 'Leverage the installed Rust toolchain: a Tauri 2 desktop app (Windows first) with local SQLite (FTS5) and native HTTP to keyless Steam endpoints (no CORS proxy), the keyed catalog backbone still built server-side/CI; explain how the phone capture use case is covered (Tauri mobile, a companion PWA, or later).' },
  { key: 'C', title: 'Accounts + server sync from day 1 (client-server)', angle: 'Professional SaaS foundation: web client + own API + server database from day one (multi-device out of the box), Steam sign-in, server-side or hybrid search; show how you still meet the speed budgets (caching, optimistic UI, local cache) and keep it feasible for a solo dev on this machine without Docker.' },
]

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    one_liner: { type: 'string' },
    components: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, responsibility: { type: 'string' }, tech: { type: 'string' } }, required: ['name', 'responsibility', 'tech'] } },
    diagram_mermaid: { type: 'string' },
    stack: { type: 'array', items: { type: 'object', properties: { layer: { type: 'string' }, choice: { type: 'string' }, version: { type: 'string' }, why: { type: 'string' } }, required: ['layer', 'choice', 'version', 'why'] } },
    catalog_pipeline: { type: 'string', description: 'Ingestion: sources, schedule, deltas, reconcile, enrichment, publication, failure handling, call budget' },
    search_design: { type: 'string' },
    capture_flow: { type: 'string', description: 'How "apuntar un juego" happens in < 3 s, incl. manual games and Steam links' },
    user_data_and_sync: { type: 'string' },
    steam_account_integration: { type: 'string' },
    hosting_and_costs: { type: 'string' },
    dev_setup_on_this_machine: { type: 'string' },
    compliance_and_security: { type: 'string' },
    performance_plan: { type: 'string', description: 'How each budget is met and measured' },
    milestones: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, scope: { type: 'string' }, acceptance: { type: 'string' }, effort_days: { type: 'number' } }, required: ['name', 'scope', 'acceptance', 'effort_days'] } },
    risks: { type: 'array', items: { type: 'object', properties: { risk: { type: 'string' }, mitigation: { type: 'string' } }, required: ['risk', 'mitigation'] } },
    why_this_wins: { type: 'string' },
    honest_weaknesses: { type: 'string' },
  },
  required: ['name', 'one_liner', 'components', 'diagram_mermaid', 'stack', 'catalog_pipeline', 'search_design', 'capture_flow', 'user_data_and_sync', 'steam_account_integration', 'hosting_and_costs', 'dev_setup_on_this_machine', 'compliance_and_security', 'performance_plan', 'milestones', 'risks', 'why_this_wins', 'honest_weaknesses'],
}

const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    evaluations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          proposal: { type: 'string', description: 'A, B or C' },
          criteria: { type: 'array', items: { type: 'object', properties: { criterion: { type: 'string' }, score: { type: 'number', description: '1-10' }, rationale: { type: 'string' } }, required: ['criterion', 'score', 'rationale'] } },
          total: { type: 'number' },
          fatal_flaws: { type: 'array', items: { type: 'string' } },
          factual_errors: { type: 'array', items: { type: 'string' }, description: 'Statements contradicting the verified facts or otherwise wrong' },
        },
        required: ['proposal', 'criteria', 'total', 'fatal_flaws', 'factual_errors'],
      },
    },
    ranking: { type: 'array', items: { type: 'string' } },
    graft_ideas: { type: 'array', items: { type: 'object', properties: { from_proposal: { type: 'string' }, idea: { type: 'string' }, why: { type: 'string' } }, required: ['from_proposal', 'idea', 'why'] } },
    recommended_synthesis: { type: 'string', description: 'The architecture you would ship, combining the best parts, in a few dense paragraphs' },
  },
  required: ['lens', 'evaluations', 'ranking', 'graft_ideas', 'recommended_synthesis'],
}

const JUDGES = [
  { key: 'speed', lens: 'Core use case and speed: capture a game in < 3 s from desktop AND phone, instant full-catalog search, offline behaviour, status/flag UX, perceived performance budgets, quality of search results (normalization, ranking, games-only).' },
  { key: 'feasibility', lens: 'Feasibility for ONE developer on THIS machine (Windows, Node 24, Rust, no Docker/Postgres/Mac): time-to-first-useful-prototype, number of moving parts, learning curve, running cost (free tiers and their traps), maintainability, testing and CI simplicity.' },
  { key: 'robustness', lens: 'Robustness, compliance and future-proofing: dependence on undocumented Steam endpoints and fallbacks, key confidentiality and Steam ToU, GDPR/LOPDGDD, data durability (Safari eviction, backups, export), security, path to multi-device sync and to multi-platform catalogs (IGDB, manual games, PlayStation), vendor lock-in.' },
]

phase('Propose')
const proposals = (await parallel(ANGLES.map(a => () =>
  agent(`${REQUIREMENTS}\n\n${FACTS}\n\nYOUR TASK: design a complete, concrete architecture for GameAgenda's prototype from this angle -> "${a.title}": ${a.angle}\nBe specific (exact technologies and versions from the facts, data flows, call budgets, sizes, costs). Respect every verified fact. Milestone 1 must deliver: ALL Steam games listable/searchable + quick add to 'Quiero jugar'. You may use WebSearch/WebFetch (deferred tools: ToolSearch "select:WebSearch,WebFetch") only to fill gaps; do not create files.`,
    { label: `propose:${a.key} ${a.title}`, phase: 'Propose', schema: PROPOSAL_SCHEMA })
    .then(p => (p ? { key: a.key, title: a.title, ...p } : null))))).filter(Boolean)
log(`${proposals.length}/3 proposals ready`)

phase('Judge')
const judgements = (await parallel(JUDGES.map(j => () =>
  agent(`${REQUIREMENTS}\n\n${FACTS}\n\nYOU ARE A JUDGE with this lens: ${j.lens}\nScore EVERY proposal below on 4-6 criteria of your lens (1-10 each), list fatal flaws and factual errors (anything contradicting the verified facts), rank them, list ideas worth grafting from each, and write the architecture you would actually ship (a synthesis). Be critical and concrete; do not reward length.\n\nPROPOSALS (JSON):\n${JSON.stringify(proposals)}`,
    { label: `judge:${j.key}`, phase: 'Judge', schema: JUDGE_SCHEMA })))).filter(Boolean)

return { proposals, judgements }
