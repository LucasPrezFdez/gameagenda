# Respuestas de la Steam Web API para la importación

*Fixtures* de las pruebas de `POST /api/v1/steam/redeem` (`apps/web/worker/test/steam-redeem.test.ts`; ADR-012) y de la app. El CI nunca llama a Steam.

- `get-owned-games.json`: `IPlayerService/GetOwnedGames/v1` con `include_appinfo`, `include_played_free_games` y `skip_unvetted_apps=false`, con los campos que manda Steam (las horas en minutos y `rtime_last_played` en segundos Unix; 0 si nunca se ha jugado). Juegos públicos del catálogo; ningún dato de una cuenta real.
- `get-owned-games-private.json`: con «Detalles de juegos» privado, Steam responde 200 sin `games` ni `game_count` (§10.1).
- `get-owned-games-empty.json`: una biblioteca sin juegos.
- `get-wishlist.json`: `IWishlistService/GetWishlist/v1` (sin clave).
- `get-wishlist-private.json`: una lista de deseados privada o vacía (a comprobar en la prueba a mano si Steam las distingue).

En la prueba a mano con Steam de verdad (paso 5 del encargo), se comparan con lo que devuelve Steam y se ajustan, sin copiar datos de la cuenta.
