-- Cuentas (ADR-014): el email y la contraseña de una agenda, el freno de las entradas con
-- contraseña y la cuenta de Steam vinculada. Solo añade (*expand-only*), así que vale con el código
-- de antes. Ni el email ni la contraseña se guardan: del email, su HMAC con `ACCOUNT_PEPPER`; de la
-- contraseña, que nunca sale del dispositivo, un HMAC de lo que sale de ella con PBKDF2.

CREATE TABLE account_login (
  agenda_id TEXT PRIMARY KEY REFERENCES agenda (id) ON DELETE CASCADE,
  email_hash TEXT NOT NULL UNIQUE,  -- HMAC-SHA256(ACCOUNT_PEPPER, "email\0" ‖ email), base64url
  pw_salt TEXT NOT NULL,  -- 16 bytes aleatorios, base64url
  pw_verifier TEXT NOT NULL,  -- HMAC-SHA256(ACCOUNT_PEPPER, "pw\0" ‖ sal ‖ "\0" ‖ authKey)
  kdf TEXT NOT NULL,  -- cómo sale `authKey` de la contraseña: `pbkdf2-sha256-600000`
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Fallos con la contraseña por email, también de los que no tienen cuenta (así el bloqueo no dice
-- cuáles sí). El *cron* de cada 5 min se lleva las ventanas acabadas.
CREATE TABLE login_throttle (
  email_hash TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  window_start TEXT NOT NULL
) STRICT;
CREATE INDEX login_throttle_by_window ON login_throttle (window_start);

-- La cuenta de Steam vinculada a la agenda, para traer su biblioteca sin volver a iniciar sesión
-- en Steam. Se borra al desvincularla o con la agenda.
CREATE TABLE steam_link (
  agenda_id TEXT PRIMARY KEY REFERENCES agenda (id) ON DELETE CASCADE,
  steam_id TEXT NOT NULL CHECK (length(steam_id) = 17),
  linked_at TEXT NOT NULL,
  refreshed_at TEXT
) STRICT;
