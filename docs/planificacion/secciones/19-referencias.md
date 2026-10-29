## 19. Referencias

Fuentes externas del plan, consultadas el 28-10-2026.

### 19.1 Steam y Valve

- Steam Web API, condiciones de uso: https://steamcommunity.com/dev/apiterms
- Steam Web API, desarrolladores: https://steamcommunity.com/dev
- Steamworks:
  - Web API Overview: https://partner.steamgames.com/doc/webapi_overview
  - `IStoreService`: https://partner.steamgames.com/doc/webapi/IStoreService
  - `ISteamApps` (`GetAppList` v2): https://partner.steamgames.com/doc/webapi/isteamapps
  - `IPlayerService`: https://partner.steamgames.com/doc/webapi/IPlayerService
  - Autenticación y OpenID: https://partner.steamgames.com/doc/features/auth
  - Guía de logros: https://partner.steamgames.com/doc/features/achievements/ach_guide
  - Recursos de biblioteca: https://partner.steamgames.com/doc/store/assets/libraryassets
  - Uso de las marcas: https://partner.steamgames.com/doc/marketing/branding
- Soporte de Steam, cuentas limitadas: https://help.steampowered.com/en/faqs/view/71D3-35C2-AD96-AA3A
- OpenID Authentication 2.0: https://openid.net/specs/openid-authentication-2_0.html
- CVE-2026-82183 (OpenID de Steam): https://www.sentinelone.com/vulnerability-database/cve-2026-82183/
- SteamTracking, retirada de `GetAppList` v2: https://github.com/SteamTracking/SteamTracking/commit/1978dcc003ebf42cfffbbbe7e0ce30e43fd94c52
- SteamDatabase, `service_storequery.proto`: https://github.com/SteamDatabase/Protobufs/blob/master/webui/service_storequery.proto
- SteamDatabase, `common.proto`: https://github.com/SteamDatabase/Protobufs/blob/master/webui/common.proto

### 19.2 Normativa, privacidad y seguridad

- LOPDGDD, texto consolidado: https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673
- Proyecto de ley de menores en entornos digitales: https://www.congreso.es/public_oficiales/L15/CONG/BOCG/A/BOCG-15-A-52-1.PDF
- AEPD, guía sobre el uso de las cookies: https://www.aepd.es/guias/guia-cookies.pdf
- Renckhoff (TJUE, C-161/17), comentario: https://legalblogs.wolterskluwer.com/copyright-blog/the-renckhoff-judgment-the-cjeu-swivels-the-faces-of-the-copyright-rubiks-cube-part-i/
- OWASP, CSV Injection: https://owasp.org/www-community/attacks/CSV_Injection

### 19.3 Plataformas y hosting

- Cloudflare Workers:
  - Límites: https://developers.cloudflare.com/workers/platform/limits/
  - Static Assets, facturación y límites: https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
  - Static Assets, `run_worker_first`: https://developers.cloudflare.com/workers/static-assets/binding/
  - Static Assets, `_headers`: https://developers.cloudflare.com/workers/static-assets/headers/
  - Cache API: https://developers.cloudflare.com/workers/runtime-apis/cache/
  - Rate Limiting: https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
  - *Rollbacks*: https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/
- Cloudflare, compresión de respuestas: https://developers.cloudflare.com/speed/optimization/content/compression/
- Cloudflare D1:
  - Límites: https://developers.cloudflare.com/d1/platform/limits/
  - Jurisdicción: https://developers.cloudflare.com/d1/configuration/data-location/
  - Time Travel: https://developers.cloudflare.com/d1/reference/time-travel/
  - API de Workers: https://developers.cloudflare.com/d1/worker-api/
  - `batch()`: https://developers.cloudflare.com/d1/worker-api/d1-database/
  - JSON en SQL: https://developers.cloudflare.com/d1/sql-api/query-json/
- Cloudflare Quick Tunnels: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- GitHub Actions, `schedule`: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
- WebKit, límite de 7 días: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- WebKit, Async Clipboard API: https://webkit.org/blog/10855/async-clipboard-api/
- MDN, `share_target`: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target
- web.dev, INP: https://web.dev/articles/inp
- web.dev, LCP: https://web.dev/articles/lcp
- web.dev, Baseline: https://web.dev/baseline
- W3C, Indexed Database API: https://www.w3.org/TR/IndexedDB/
- W3C, WCAG 2.2: https://www.w3.org/TR/WCAG22/
- W3C, patrón *combobox* (APG): https://www.w3.org/WAI/ARIA/apg/patterns/combobox/
- Ed25519 en los navegadores: https://blog.ipfs.tech/2025-08-ed25519/

### 19.4 Librerías, herramientas y técnicas

- Registro de npm: https://registry.npmjs.org/
- Node.js, calendario de versiones: https://nodejs.org/en/about/releases/
- Node.js, *type stripping*: https://nodejs.org/api/typescript.html
- TypeScript 7.0: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- Vite, `server.allowedHosts`: https://vite.dev/config/server-options
- Vite, `worker.format`: https://vite.dev/config/worker-options
- Dexie 4.0.1-beta.9, notas de la versión: https://github.com/dexie/Dexie.js/releases/tag/v4.0.1-beta.9
- uFuzzy y su comparativa: https://github.com/leeoniya/uFuzzy
- SQLite WASM, persistencia: https://sqlite.org/wasm/doc/trunk/persistence.md
- InstantDB, cierre de su nube: https://www.instantdb.com/essays/instant_team_joins_openai
- `steam-signin`: https://github.com/DoctorMcKay/node-steam-signin
- MADR 4.0: https://adr.github.io/madr/
- RFC 8785, JSON canónico: https://www.rfc-editor.org/rfc/rfc8785
- Relojes lógicos híbridos (HLC): https://cse.buffalo.edu/tech-reports/2014-04.pdf
- Claves fraccionarias: https://observablehq.com/@dgreensp/implementing-fractional-indexing

### 19.5 Otras fuentes de datos de juegos

- IGDB API v4: https://api-docs.igdb.com/
- Wikidata, licencias (CC0): https://www.wikidata.org/wiki/Wikidata:Licensing
- IsThereAnyDeal API: https://docs.isthereanydeal.com/
- PlayStation Network, condiciones de uso: https://www.playstation.com/en-us/legal/terms-of-use-march-2025/
- SteamSpy API: https://steamspy.com/api.php
- SteamDB, FAQ: https://steamdb.info/faq
- `jsnli/steamappidlist`: https://github.com/jsnli/steamappidlist
- `mparmol/Removed_Steam_Games`: https://github.com/mparmol/Removed_Steam_Games
- `node-steam-user` (PICS): https://github.com/DoctorMcKay/node-steam-user

Las decisiones de arquitectura se registran como ADR en `docs/adr/` (ver §5.6); el prototipo de búsqueda medido el 28-10-2026 está en `docs/planificacion/prototipo-busqueda/`.
