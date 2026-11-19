-- Importar desde Steam (Fase 2, parte 2; §10.2 y §10.4 de prototipe.md; ADR-012). Solo aditiva
-- (DECISIONES §10.47): la versión anterior del código no mira estas tablas.
--
-- `steam_ticket`: el ticket del login con OpenID 2.0 y su canje tipo PKCE. `ticket_hash` es el
-- SHA-256 del ticket (256 bits aleatorios que solo tienen la app y la URL de vuelta de Steam);
-- `challenge`, el BASE64URL(SHA-256(verificador)) que manda la app al empezar; y `steam_id`, el
-- SteamID64, solo tras una aserción verificada por Steam. Caduca a los 10 min y es de un solo uso:
-- canjearlo lo borra, una aserción que Steam no da por buena lo borra, y un Cron Trigger cada 5 min
-- borra los caducados (un SteamID64 está aquí, como mucho, 15 min; §11.2).
CREATE TABLE steam_ticket (
  ticket_hash TEXT PRIMARY KEY,
  challenge TEXT NOT NULL CHECK (length(challenge) = 43),
  expires_at TEXT NOT NULL,
  steam_id TEXT CHECK (steam_id IS NULL OR (length(steam_id) = 17 AND steam_id NOT GLOB '*[^0-9]*'))
) STRICT, WITHOUT ROWID;
CREATE INDEX steam_ticket_by_expiry ON steam_ticket (expires_at);

-- Llamadas a Steam por día UTC (`YYYY-MM-DD`), para el tope de los ToU (§11.1): ningún dato de
-- usuarios. El mantenimiento diario borra los días de hace más de una semana.
CREATE TABLE steam_quota (
  day TEXT PRIMARY KEY CHECK (length(day) = 10),
  calls INTEGER NOT NULL CHECK (calls >= 0)
) STRICT, WITHOUT ROWID;
