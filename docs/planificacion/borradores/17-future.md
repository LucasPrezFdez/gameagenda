## 17. Más allá de Steam: multiplataforma (fase posterior)

«Platinado» hace pensar en PlayStation, y el usuario debe poder apuntar **cualquier** juego. El plan tiene tres niveles:

1. **Desde el MVP — juego manual:** se guarda con solo el título (y la plataforma, opcional), al instante y sin conexión. Queda como «sin vincular», y en segundo plano se buscará una coincidencia que el usuario confirma con un toque. **Nunca** se vincula automáticamente por similitud: «Hades» no es «Hades II».
2. **Catálogo maestro multiplataforma — IGDB (Twitch):**
   - **Por qué:** es la única fuente con PC, PlayStation, Xbox, Nintendo y retro a la vez; es gratis también para uso comercial, mediante una *partnership* gratuita con atribución visible («Datos de juegos: IGDB.com»); permite y prefiere que guardemos los datos; y tiene *webhooks*.
   - **Cruce con Steam:** `external_games` con `external_game_source = 1` y `uid = appid`. IGDB es la base de datos de Backloggd. Además, `game_time_to_beats` (*hastily* / *normally* / *completely*) da estimaciones legítimas para «Completado» y «Platinado».
   - **Límites:** 4 peticiones/s, 8 concurrentes, 500 ítems por petición, sin CORS. Va **siempre** detrás de nuestro backend, con espejo propio.
3. **Cruce de identificadores — Wikidata (CC0):** solo como trabajo por lotes, fuera del camino de búsqueda. Hay ≈129 000 ítems con Steam appid y el 91 % tiene también IGDB. Los ids de consola son escasos (unos 6 000 de PS Store o eShop) y los ids pueden ser *slugs* con varios valores, así que la identidad se modela **muchos a muchos** (tabla `game_external_ids`, §7).

| Fuente | Decisión | Motivo |
|---|---|---|
| IGDB | ✅ Fase 3 | Cobertura, licencia y *webhooks* |
| Wikidata | ✅ Lotes | CC0; enlaces salientes (HLTB, ITAD, PS Store) |
| IsThereAnyDeal | ⚠️ Opcional | Precios para «Quiero jugar / no comprado». Sus términos prohíben apps que «compitan» con sus proyectos (tiene Waitlist y Collection): **preguntar antes** |
| Trofeos PSN (`psn-api`, NPSSO) | ❌ en servidor · ⚠️ como mucho importación local | API no oficial; entra en conflicto con los ToS de PSN (5.1 y 10.7) → «Platinado» manual |
| Xbox (OpenXBL) / RetroAchievements | ⚠️ Opcional | Importación por usuario con su clave |
| HowLongToBeat | ❌ (solo enlace saliente) | Sin API; endpoints internos cambiantes y 429 desde septiembre de 2026 |
| Giant Bomb | ❌ | API fuera de servicio |
| RAWG | ❌ como espejo | Prohíbe redistribuir; *backlink* obligatorio en cada página |
| SteamGridDB | ❌ automatizado | Sus términos prohíben el uso automatizado |
| MobyGames | ❌ | De pago (≈ 99,99 $/mes para uso comercial) |
| PCGamingWiki | ❌ datos | Licencia CC BY-NC-SA |
