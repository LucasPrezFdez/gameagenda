# Respuestas de la Steam Web API para la importación

*Fixtures* de las pruebas de `POST /api/v1/steam/redeem` (`apps/web/worker/test/steam-redeem.test.ts`; ADR-012) y de la app. El CI nunca llama a Steam.

- `get-owned-games.json`: `IPlayerService/GetOwnedGames/v1` con `include_appinfo`, `include_played_free_games` y `skip_unvetted_apps=false`, con los campos que manda Steam (las horas en minutos y `rtime_last_played` en segundos Unix; 0 si nunca se ha jugado). Juegos públicos del catálogo; ningún dato de una cuenta real.
- `get-owned-games-private.json`: con «Detalles de juegos» privado, Steam responde 200 sin `games` ni `game_count` (§10.1).
- `get-owned-games-empty.json`: una biblioteca sin juegos.
- `get-wishlist.json`: `IWishlistService/GetWishlist/v1` (sin clave).
- `get-wishlist-private.json`: una lista de deseados privada o vacía (a comprobar en la prueba a mano si Steam las distingue).

En la prueba a mano con Steam de verdad (paso 5 del encargo), se comparan con lo que devuelve Steam y se ajustan, sin copiar datos de la cuenta.

**Comprobado el 20-11-2026** con una cuenta de 105 juegos y 7 deseados (solo la forma: claves, tipos y recuentos, con `.cache/steam-probe/steam-shape.ts`). Todos los juegos y deseados pasan los esquemas de `core`.

- Cada juego trae siempre `appid`, `name`, `playtime_forever`, `img_icon_url`, las horas por sistema (`playtime_windows_forever`, `_mac_`, `_linux_`, `_deck_`), `rtime_last_played` y `playtime_disconnected`. Un juego sin jugar trae `playtime_forever` y `rtime_last_played` a 0.
- Solo a veces: `playtime_2weeks` (los jugados en las últimas dos semanas; va justo detrás de `name`), `has_community_visible_stats` (falta, no viene a `false`), `has_leaderboards` y `content_descriptorids`. `has_dlc` no sale en ninguno: la *fixture* lo cambia por `has_leaderboards`.
- Cada deseado trae siempre `appid`, `priority` y `date_added`.
