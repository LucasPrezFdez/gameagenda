-- Época de la agenda (ADR-011): 16 cifras hexadecimales aleatorias que cambian cuando D1 vuelve
-- atrás. El *runbook* del restore con Time Travel la cambia con
-- `UPDATE agenda SET epoch = lower(hex(randomblob(8)))`. Va en cada respuesta de `sync`: si la app
-- ve una distinta de la suya, su cursor ya no vale, así que lo vuelve a subir todo y baja desde 0
-- (sin esto, un dispositivo cuyo cursor siga por debajo de la `seq` nueva se saltaría filas y no
-- volvería a subir lo que el restore perdió). La crea `POST /api/v1/agenda`; las agendas que ya
-- había reciben una aquí. `ADD COLUMN` no admite un valor por defecto calculado: de ahí el UPDATE.

ALTER TABLE agenda ADD COLUMN epoch TEXT NOT NULL DEFAULT '';
UPDATE agenda SET epoch = lower(hex(randomblob(8))) WHERE epoch = '';
