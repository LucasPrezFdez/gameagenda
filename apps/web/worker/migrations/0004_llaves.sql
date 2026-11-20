-- Llaves de acceso (ADR-013): otra forma de abrir la agenda en un dispositivo nuevo, como el código
-- de recuperación. Solo añade (*expand-only*), así que vale con el código de antes. Sin datos
-- personales: de cada llave, su id, su clave pública, el nombre del dispositivo donde se creó y
-- las fechas. La huella o la cara nunca salen del dispositivo.

-- El `user.id` de las llaves de la agenda: 32 bytes aleatorios en base64url, no el id de la agenda.
-- Se crea al pedir las primeras opciones.
ALTER TABLE agenda ADD COLUMN passkey_user_id TEXT;

CREATE TABLE passkey (
  id TEXT PRIMARY KEY,  -- el de la credencial, en base64url
  agenda_id TEXT NOT NULL REFERENCES agenda (id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,  -- SPKI (DER) en base64url
  alg INTEGER NOT NULL CHECK (alg IN (-8, -7, -257)),
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL CHECK (json_valid(transports)),
  label TEXT NOT NULL,  -- el nombre del dispositivo donde se creó
  created_at TEXT NOT NULL,
  last_used_at TEXT
) STRICT;
CREATE INDEX passkey_by_agenda ON passkey (agenda_id);

-- Retos de un solo uso (gastarlo lo borra) y 5 min. Los de crear son de una agenda; los de entrar,
-- de nadie todavía. El *cron* de cada 5 min se lleva los caducados.
CREATE TABLE webauthn_challenge (
  challenge_hash TEXT PRIMARY KEY,
  agenda_id TEXT REFERENCES agenda (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('create', 'get')),
  expires_at TEXT NOT NULL,
  CHECK ((kind = 'create') = (agenda_id IS NOT NULL))
) STRICT;
CREATE INDEX webauthn_challenge_by_agenda ON webauthn_challenge (agenda_id);
CREATE INDEX webauthn_challenge_by_expiry ON webauthn_challenge (expires_at);
