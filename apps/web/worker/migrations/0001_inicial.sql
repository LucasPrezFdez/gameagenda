-- Esquema de D1 de la micro-API (§7.7 de prototipe.md; ADR-011). D1 en la jurisdicción UE; cada
-- `*_hash` es el SHA-256 de un secreto aleatorio de ≥128 bits. D1 aplica las claves foráneas, así
-- que borrar una agenda se lleva todo lo suyo. Cambios respecto a la §7.7, con su porqué en el
-- ADR-011: `created_at`, `label` y `last_seen_at` para la lista de dispositivos; revocar y canjear
-- borran la fila (el *hash* se guarda hasta revocarlo, §11.2), así que no hay `revoked_at` ni
-- `used_at`; `recovery_hash` es único, para buscarlo por índice; índices para las cascadas; y
-- `write_id`, para la concurrencia optimista de `sync`.

CREATE TABLE agenda (
  id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  purged_seq INTEGER NOT NULL DEFAULT 0,
  -- Lo pone cada escritura de `sync` junto con la `seq` nueva; las filas solo se escriben si
  -- sigue siendo el suyo, es decir, si nadie escribió entre la lectura y la escritura.
  write_id TEXT NOT NULL DEFAULT '',
  recovery_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_sync_at TEXT NOT NULL  -- como mucho una vez al día; retención de 13 meses (§11.2)
) STRICT;

CREATE TABLE device (
  id TEXT PRIMARY KEY,
  agenda_id TEXT NOT NULL REFERENCES agenda (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('app', 'inbox')),  -- inbox: Atajo de iOS
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
) STRICT;
CREATE INDEX device_by_agenda ON device (agenda_id);

CREATE TABLE pairing_token (  -- un uso (canjearlo lo borra) y 10 min
  token_hash TEXT PRIMARY KEY,
  agenda_id TEXT NOT NULL REFERENCES agenda (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
) STRICT;
CREATE INDEX pairing_token_by_agenda ON pairing_token (agenda_id);

CREATE TABLE op (  -- operación ganadora por campo
  agenda_id TEXT NOT NULL REFERENCES agenda (id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL CHECK ((entry_id GLOB 'steam:[1-9]*' AND
    substr(entry_id, 7) NOT GLOB '*[^0-9]*') OR entry_id GLOB 'manual:?*'),
  field TEXT NOT NULL,
  value TEXT NOT NULL CHECK (json_valid(value)),
  hlc TEXT NOT NULL CHECK (length(hlc) = 27),
  seq INTEGER NOT NULL,
  PRIMARY KEY (agenda_id, entry_id, field)
) STRICT, WITHOUT ROWID;
CREATE INDEX op_by_seq ON op (agenda_id, seq);

CREATE TABLE inbox_item (  -- buzón del Atajo de iOS
  id TEXT PRIMARY KEY,
  agenda_id TEXT NOT NULL REFERENCES agenda (id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX inbox_item_by_agenda ON inbox_item (agenda_id);

CREATE TABLE resolve_cache (  -- nombres públicos del catálogo, ningún dato de usuarios
  appid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  fetched_at TEXT NOT NULL
) STRICT;
