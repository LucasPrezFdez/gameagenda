export const meta = {
  name: 'gameagenda-research',
  description: 'Research Steam data APIs, legal, UX benchmarks and 2026 stack for GameAgenda; adversarially verify critical claims',
  phases: [
    { title: 'Research', detail: '6 researchers in 3 pairs (web + polite keyless live probes)' },
    { title: 'Verify', detail: '1 skeptic per pair tries to refute critical claims' },
  ],
}

const SCRATCH = '/c/Users/lucas/AppData/Local/Temp/claude/C--Users-lucas-Documents-Programacion-GameAgenda/56497ade-bd80-409d-8199-9f2b9ba10c3e/scratchpad/research'

const CONTEXT = `PROJECT CONTEXT
"GameAgenda" is a new app (empty folder, nothing built yet, architecture NOT decided). Its MAIN function: let a user very quickly jot down games they WANT TO PLAY (a personal to-play list / backlog, used like a notebook-agenda). Secondary: mark games as completed ("completado"), platinum / 100% achievements ("platinado"), bought/owned ("comprado"), etc. The user insists it must be FAST and AGILE ("rapida y agil"): instant search, minimal-friction capture, snappy UI. First data requirement: list/search ALL games available on Steam ("para empezar" = to start with; other platforms may come later — "platinado" hints the user also plays on PlayStation).
User: Spanish-speaking developer on Windows 11 Pro. Installed: Node.js v24.21.0, npm 11.19.0, git 2.56, Rust 1.99.0. NOT installed: Docker, Python, .NET, Java, Go, PostgreSQL, pnpm, bun.
Today is 2026-10-28. Your training data may be stale: prefer fresh sources, note source dates, and live-test when possible.

GROUND TRUTH - live probes run today (2026-10-28):
- GET https://api.steampowered.com/ISteamApps/GetAppList/v2/ -> HTTP 404 "Method 'GetAppList' not found in interface 'ISteamApps'". The classic keyless full app list no longer exists.
- GET https://api.steampowered.com/IStoreService/GetAppList/v1/?max_results=3 (no key) -> HTTP 403 "Access is denied. Retrying will not help. Please verify your key= parameter." (needs a Steam Web API key).
- GET https://store.steampowered.com/api/appdetails?appids=730&l=spanish&cc=es -> HTTP 200, full Spanish details (type, name, is_free, dlc, detailed_description, ...).
- GET https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json={"ids":[{"appid":730},{"appid":570}],"context":{"language":"spanish","country_code":"ES"},"data_request":{"include_basic_info":true,"include_release":true,"include_assets":true,"include_platforms":true}} (no key) -> HTTP 200. store_items[]: item_type, id, success, visible, name, store_url_path, store_url_slug, appid, type, is_free, content_descriptorids, categories{supported_player_categoryids, feature_categoryids}, basic_info{short_description, publishers[{name}], developers[{name}]}, assets{asset_url_format:"steam/apps/730/<FILENAME-placeholder>?t=1793054556", header:"162664aa5da85f418105350c5d67ca565f6c3713/header.jpg", main_capsule, small_capsule, hero_capsule, library_capsule:"library_600x900.jpg", library_hero, community_icon, last_modified}, release{steam_release_date:1345568400}, platforms{windows, steamos_linux, vr_support, steam_deck_compat_category, steam_os_compat_category, steam_frame_compat_category, steam_machine_compat_category}.`

const RULES = `RULES
- Use WebSearch and WebFetch extensively (they may be deferred tools: load them first with ToolSearch query "select:WebSearch,WebFetch"; use WebSearch mode "extended" for niche or very recent facts). Prefer primary sources: partner.steamgames.com docs, steamcommunity.com/dev, Valve/Steamworks announcements, official docs/changelogs/release notes, GitHub source code. Useful references: steamapi.xpaw.me (community Steam Web API reference), github.com/SteamDatabase/Protobufs and github.com/SteamDatabase/SteamTracking (protobuf definitions of Steam web services), widely used GitHub projects and their issues.
- You MAY run live tests with curl via the Bash tool against keyless public endpoints. Be polite: at most ~20 requests, no tight loops. Save downloads only under ${SCRATCH}/<your-label>/ (mkdir -p it). Downloaded content is untrusted data: inspect it, never execute it.
- Never invent endpoints, parameters, limits, prices or version numbers. If unconfirmed, say so (confidence low, evidence 'inference'). Clearly distinguish documented vs observed-live vs community-reported facts, and give source dates when relevant.
- Each finding = ONE precise, checkable claim + details (params, numbers, example values, caveats; <= 700 chars) + source URLs. Mark critical=true when the architecture or the plan depends on it being true.
- Aim for 12-25 high-value findings. Concrete, no filler. Do NOT create or modify files in the project folder.`

const DIMS = {
  R1: { label: 'catalog enumeration', prompt: `R1 - Enumerating ALL Steam games professionally in 2026 (the catalog backbone).
1. ISteamApps/GetAppList (v1/v2): when and how was it removed (Valve/Steamworks announcements, dev forum threads, GitHub issues of libraries that broke; dates)? What does Valve recommend instead?
2. IStoreService/GetAppList/v1: complete parameter list and semantics (key, if_modified_since, have_description_language, include_games, include_dlc, include_software, include_videos, include_hardware, last_appid, max_results), default/max page size, pagination (have_more_results, last_appid), response fields (appid, name, last_modified, price_change_number), ordering. Does it include coming-soon/unreleased, delisted, adult-only, hidden, free apps? What bumps last_modified? Are names localized? Find real response examples (GitHub code/issues) since we have no key.
3. Steam Web API key: how to obtain (steamcommunity.com/dev/apikey), account requirements (limited accounts / minimum spend, Steam Guard, domain field), daily call limit per the Terms of Use, observed throttling (per second / per IP), and whether using ONE server-side key for an app with many users is allowed.
4. Totals: how many apps of each type exist on Steam now (games, DLC, demos, software, soundtracks...)? Cite fresh stats (SteamDB, news 2025-2026).
5. Alternatives/complements and trade-offs: IStoreQueryService/Query (filters such as coming_soon_only, type filters; key or access token needed or keyless? live-test keyless), store search endpoints (store.steampowered.com/search/results/?json=1 or infinite=1), SteamSpy request=all (paging, rate limits, freshness), PICS via SteamKit2 / node-steam-user / ValvePython (anonymous login, PICSGetChangesSince, PICSGetProductInfo, appinfo common.type / releasestate; legal/ToS concerns), SteamDB (no public API; scraping terms).
6. Classification and edge cases: keeping only real games (vs demo/dlc/music/tool/video/hardware/beta/mod/series), junk/test/unnamed apps, delisted/removed games (users may own or want them), early access, adult content, coming-soon (users WANT to note upcoming games): which source exposes which signal and how reliably.
7. Propose a concrete ingestion algorithm: bootstrap full sync + incremental sync (cursor / if_modified_since), idempotent upserts, removed-app detection, 429/5xx backoff - with call-budget math (calls per run, duration, frequency).` },
  R2: { label: 'metadata & media', prompt: `R2 - Enriching each Steam game with what a fast backlog app needs (localized name, vertical cover / capsule image, release date incl. coming-soon, platforms, genres/tags, developer/publisher, short description, review score, achievements count) and fetching it efficiently.
1. IStoreBrowseService/GetItems/v1: exact input_json schema (ids[] with appid/packageid/bundleid/tagid..., context{language,country_code,steam_realm}, data_request flags - enumerate ALL flags from the protobuf, e.g. include_assets, include_release, include_platforms, include_all_purchase_options, include_screenshots, include_trailers, include_ratings, include_tag_count, include_reviews, include_basic_info, include_supported_languages, include_full_description, include_included_items, include_assets_without_overrides, apply_user_filters, include_links), what each returns, max ids per call (test e.g. 50/100/250 politely), keyless rate limiting, meaning of numeric fields (item type codes, success codes, steam_deck_compat_category values, review_score), release fields (steam_release_date, original_release_date, is_coming_soon, coming_soon_display, custom_release_date_message, is_early_access...) - also test a coming-soon game and a DLC and a delisted game.
2. Images: how to build final image URLs from assets.asset_url_format (it contains a FILENAME placeholder) + asset filename: which CDN host(s) are correct in 2026 (shared.akamai.steamstatic.com/store_item_assets/, shared.cloudflare.steamstatic.com, cdn.akamai.steamstatic.com ...)? Do legacy hash-less URLs like https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/header.jpg and .../library_600x900.jpg still resolve (curl -I)? Best asset for a vertical cover and fallbacks when missing.
3. store.steampowered.com/api/appdetails: fields, the one-appid-per-request limitation (multiple appids only with filters=price_overview?), observed rate limit (verify with fresh community reports), localization (l=, cc=), release_date string format problems, genres/categories with names, achievements.total. When is it still needed vs GetItems?
4. Tags and genres naming: mapping tag ids to localized names (IStoreService/GetTagList? GetLocalizedNameForTags? keyless?), category ids to names, genre availability in GetItems, content descriptors (adult content filtering).
5. Reviews: GetItems include_reviews vs store.steampowered.com/appreviews/<appid>?json=1 query_summary.
6. CORS: do api.steampowered.com and store.steampowered.com send Access-Control-Allow-Origin to browsers? (curl -sI -H 'Origin: https://example.com' ...). Consequences for a browser/PWA client vs a native (Tauri) client vs a server.
7. Caching headers (Cache-Control/ETag) on these endpoints and on CDN images.
8. Propose an enrichment strategy: endpoint per field, batch sizes, refresh cadence (coming-soon games more often), time/call budget to enrich ~100k+ games, and storage footprint estimate per game (bytes) for a compact catalog snapshot (e.g., appid+name+year+type+cover path) that a client could download and search locally.` },
  R3: { label: 'Steam account, auth, legal', prompt: `R3 - Optional Steam account integration (import owned games to auto-mark "comprado", playtime, wishlist, achievements to auto-detect "platinado"/100%), authentication, and legal/compliance.
1. "Sign in through Steam" (OpenID 2.0): endpoints, required params, verification (check_authentication), security pitfalls (validate claimed_id, return_to/realm, replay), maintained Node libraries in 2026 (node-steam-openid, passport-steam status, Auth.js / Better Auth providers), whether Steam offers OAuth2/OIDC to third parties in 2026. Can a desktop app (Tauri) or a PWA use it (redirect / deep-link / loopback flows)?
2. IPlayerService/GetOwnedGames (all params incl. include_appinfo, include_played_free_games, include_extended_appinfo, include_free_sub, skip_unvetted_apps, appids_filter, language), response fields, privacy requirements (game details must be public), behaviour when private; GetRecentlyPlayedGames; ISteamUser/GetPlayerSummaries; ResolveVanityURL (letting users paste a profile URL without login).
3. Wishlist: IWishlistService/GetWishlist (keyless? fields appid, priority, date_added - live-test with a public profile if you can find one, e.g. a Valve employee/public figure), GetWishlistItemCount; status of the old store.steampowered.com/wishlist/.../wishlistdata endpoint.
4. Achievements for "platinado" (100%): ISteamUserStats/GetPlayerAchievements, GetSchemaForGame, GetUserStatsForGame, IPlayerService/GetTopAchievementsForGames (does it exist? params? does it give total vs unlocked counts?), any efficient way to compute 100% completion across a whole library; call-budget implications.
5. Steam Web API Terms of Use (steamcommunity.com/dev/apiterms): exact daily call limit, key confidentiality, restrictions, attribution, whether caching/storing Steam data is allowed, commercial use. Steam Branding Guidelines (use of "Steam" name/logo, "Sign in through Steam" button assets), trademark issues with an app name; legality/practice of displaying and hotlinking Steam store images; Steam Subscriber Agreement implications of using the Steam client protocol (PICS) with anonymous accounts.
6. Privacy/GDPR (user is in Spain/EU): SteamID64 and play data as personal data, lawful basis, privacy policy contents, data minimization, deletion/export rights, cookies (strictly necessary vs consent), AEPD guidance relevant to small apps.` },
  R4: { label: 'third-party & multi-platform sources', prompt: `R4 - Complementary/alternative game-data sources for (a) enriching Steam games and (b) supporting other platforms later (PlayStation "platinado", Xbox, Nintendo, GOG, Epic) so a user can note ANY game they want to play.
For each source give: auth, rate limits/quotas, pricing, license/terms for commercial vs non-commercial use and attribution requirements (2025-2026, cite), data coverage/quality, Steam appid cross-reference ability, stability/risk.
Sources: IGDB API (Twitch client credentials; endpoints games, platforms, release_dates, covers, external_games with Steam uid, game_time_to_beats; rate limit; terms), RAWG API, SteamGridDB API, MobyGames API, Giant Bomb API, HowLongToBeat (official API or not? ToS), IsThereAnyDeal API (prices/deals for wishlist and "comprado"), SteamSpy, PlayStation trophies (psn-api npm, unofficial NPSSO token; ToS risk), Xbox (OpenXBL), RetroAchievements API, GOG / Epic catalog APIs (unofficial), Wikidata (game IDs, CC0).
Then recommend: which source(s) to use for a multi-platform master catalog in a later phase, how to model cross-source identity (one game with many external ids), whether a user should be able to add a custom/manual game not found in any catalog, and which sources to avoid for legal reasons.` },
  R5: { label: 'product & UX benchmark', prompt: `R5 - Product and UX benchmark for a fast "games I want to play" notebook (backlog tracker) with statuses such as completed / platinum (100%) / bought.
Use official sites, app-store listings, reviews and Reddit threads (2024-2026).
1. Comparable apps and how they model state: Backloggd, HowLongToBeat, Grouvee, Infinite Backlog, GG (ggapp.io), Playnite, GameTrack, Stash, Completionator, Steam's own wishlist/collections, and any newer 2025-2026 apps. Exactly which statuses/flags they use (e.g. Played/Playing/Backlog/Wishlist; Completed/Mastered/Shelved/Abandoned; ownership with platform/format/store), how they represent 100%/platinum, priorities, ratings, notes, custom lists.
2. Their quick-add flows and what users praise or complain about (speed, clutter, ads, slow search, missing games, import quality, sync).
3. Recommend a status taxonomy that is fast to use: which dimensions must be orthogonal (progress state vs ownership vs achievement milestone vs favorite/priority) and which actions should be a single tap. Propose Spanish labels (e.g. "Quiero jugar", "Jugando", "Completado", "Platinado", "Comprado", "Abandonado", "En pausa") and state transitions (e.g. marking Platinado implies Completado?).
4. UX patterns that make such an app feel instant: global search / command palette (Ctrl+K), typeahead with keyboard navigation, one-tap add, optimistic updates + undo toast instead of confirm dialogs, offline-first, virtualized lists, image lazy-loading, skeletons, mobile share target (share a Steam store link to the app to add it), browser extension or bookmarklet "add from Steam store page", deep links. Include measurable performance budgets (INP, LCP, keystroke-to-results, cold start) with sources (web.dev, RAIL model, Nielsen response-time limits).
5. MVP scope recommendation (must-have vs later) and differentiators vs competitors.` },
  R6: { label: '2026 tech stack', prompt: `R6 - Technology landscape as of Oct 2026 for a FAST app with instant full-catalog search (~100k-200k game names) plus personal lists, built by a solo developer on Windows 11 (Node 24.21, npm 11.19, Rust 1.99, git; no Docker/Python/Postgres). Evaluate BOTH local-first and classic client-server approaches neutrally.
Use official release notes/blogs, npm, GitHub releases.
1. Current stable/LTS versions and notable changes: Node.js (which lines are Active LTS now?), TypeScript (6.x? native TS 7?), React, Next.js, Vite (Rolldown), Tauri 2.x (mobile maturity), Svelte 5/SvelteKit, Fastify, Hono, NestJS, Drizzle ORM (1.0?), Prisma, PostgreSQL (18? 19?), SQLite, PGlite, TanStack Query/Router/Virtual, Dexie, SQLite WASM + OPFS, pnpm, Turborepo, Biome vs ESLint, Vitest, Playwright.
2. Client-side search over ~150k short strings: characteristics/benchmarks of FlexSearch, MiniSearch, Orama, uFuzzy, Fuse.js, SQLite FTS5 (native and WASM): memory, index build time, query latency, typo tolerance, accent-insensitive Spanish matching, index size/serialization.
3. Server-side search options: Postgres pg_trgm + unaccent + FTS, Meilisearch, Typesense (latency, ops cost, free tiers).
4. Local-first/sync options maturity in 2026: Zero (Rocicorp), ElectricSQL, PowerSync, Dexie Cloud, Triplit, LiveStore, Jazz, Replicache, InstantDB - production readiness, licensing, self-hosting, cost; vs simple REST + optimistic updates + IndexedDB cache.
5. Hosting for a tiny-budget prototype (free tiers 2026): Cloudflare Workers/Pages/D1/R2, Vercel, Netlify, Fly.io, Railway, Render, Neon, Supabase, Turso; GitHub Actions scheduled workflows (limits, cron reliability, secrets) for a daily catalog-ingestion job that publishes a static compressed snapshot.
6. Delivery: PWA capabilities in 2026 (install, offline, Web Push on iOS, share target), Tauri 2 desktop+mobile (Windows build requirements: WebView2, MSVC Build Tools), Capacitor, Expo/React Native - effort and fit for a solo dev who wants desktop AND phone.
7. Dev-environment friction on this exact machine for each option (Postgres needs Docker Desktop or a native install; SQLite/PGlite need nothing; Tauri needs MSVC Build Tools + WebView2; corepack/pnpm availability on Node 24).
Give concrete recommendations with trade-offs.` },
}

const FINDING = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Unique id such as R1-03' },
    topic: { type: 'string' },
    claim: { type: 'string', description: 'One precise, checkable statement' },
    details: { type: 'string', description: 'Params, numbers, examples, caveats (<= 700 chars)' },
    sources: { type: 'array', items: { type: 'string' } },
    evidence: { type: 'string', enum: ['live_test', 'official_doc', 'source_code', 'reputable_secondary', 'community_report', 'inference'] },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    critical: { type: 'boolean', description: 'true if the plan would be wrong or broken were this false' },
  },
  required: ['id', 'topic', 'claim', 'details', 'sources', 'evidence', 'confidence', 'critical'],
}

const RESEARCH_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Dense synthesis of what matters for the plan (<= 2500 chars)' },
    findings: { type: 'array', items: FINDING },
    recommendations: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'findings', 'recommendations', 'risks', 'open_questions'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'refuted', 'partially_correct', 'unverifiable'] },
          correction: { type: 'string', description: 'Corrected statement if refuted/partial; empty string if confirmed' },
          evidence: { type: 'string', description: 'What you checked and what you observed' },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'verdict', 'correction', 'evidence', 'sources'],
      },
    },
    additional_findings: { type: 'array', items: FINDING },
  },
  required: ['verdicts', 'additional_findings'],
}

const researchPrompt = k => `${CONTEXT}\n\n${RULES}\n\nYOUR DIMENSION\n${DIMS[k].prompt}\n\nReturn the structured result. Use finding ids "${k}-01", "${k}-02", ...`

const verifyPrompt = (pair, claims) => `${CONTEXT}\n\n${RULES}\n\nYOUR ROLE: adversarial fact-checker for the "${pair.title}" research. Try hard to REFUTE each claim below using primary sources and, for keyless Steam endpoints, live curl tests (save under ${SCRATCH}/verify-${pair.key}/). Verdicts: 'confirmed' only with solid evidence; 'partially_correct' if any part (number, parameter name, version, date, URL) is wrong - put the corrected statement in 'correction'; 'refuted' if false - put the truth in 'correction'; 'unverifiable' if you cannot find evidence either way. Be strictest with endpoint names/params, rate limits, version numbers, dates and licensing terms. Return one verdict per claim id.\nAlso list in additional_findings (max 8) any CRITICAL fact the researchers missed that would change the architecture or the plan (ids "${pair.key}-X1", ...).\n\nCLAIMS TO CHECK (JSON):\n${JSON.stringify(claims.map(c => ({ id: c.id, claim: c.claim, details: c.details, sources: c.sources })), null, 1)}`

const PAIRS = [
  { key: 'steamdata', title: 'Steam catalog & metadata', dims: ['R1', 'R2'] },
  { key: 'userlegal', title: 'Steam account integration, legal & third-party sources', dims: ['R3', 'R4'] },
  { key: 'productstack', title: 'Product/UX benchmark & 2026 tech stack', dims: ['R5', 'R6'] },
]
const MAX_CLAIMS = 40

const out = await pipeline(
  PAIRS,
  pair => parallel(pair.dims.map(k => () =>
    agent(researchPrompt(k), { label: `research:${k} ${DIMS[k].label}`, phase: 'Research', schema: RESEARCH_SCHEMA })
      .then(r => (r ? { key: k, label: DIMS[k].label, ...r } : null)))),
  async (researches, pair) => {
    const rs = researches.filter(Boolean)
    if (rs.length < pair.dims.length) log(`${pair.key}: ${pair.dims.length - rs.length} researcher(s) returned nothing`)
    const claims = rs.flatMap(r => r.findings)
      .filter(f => f.critical || f.confidence !== 'high')
      .sort((a, b) => Number(b.critical) - Number(a.critical))
    if (claims.length > MAX_CLAIMS) log(`${pair.key}: ${claims.length} claims flagged; verifying the first ${MAX_CLAIMS} (critical first), ${claims.length - MAX_CLAIMS} left unverified`)
    const toCheck = claims.slice(0, MAX_CLAIMS)
    const verification = toCheck.length
      ? await agent(verifyPrompt(pair, toCheck), { label: `verify:${pair.key}`, phase: 'Verify', schema: VERIFY_SCHEMA })
      : null
    return { pair: pair.key, title: pair.title, researches: rs, verification, unverified_ids: claims.slice(MAX_CLAIMS).map(f => f.id) }
  },
)
return out.filter(Boolean)
