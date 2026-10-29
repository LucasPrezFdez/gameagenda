# GameAgenda

Agenda personal de videojuegos: apuntar en segundos los juegos que quieres jugar y llevar su estado (Completado, Platinado, Comprado…), empezando por el catálogo completo de Steam. La prioridad es la captura rápida: la app tiene que ser «rápida y ágil».

## Estado

- Planificación terminada el 28-10-2026. M0: pasos 1–3 hechos; CI y despliegues aplazados. **M1 casi terminado** (29-10-2026): falta lo que lista «Pendiente de M1» en `ESTADO-SESION.md`. Repositorio: https://github.com/LucasPrezFdez/gameagenda.
- Para retomar el trabajo, lee primero `docs/planificacion/ESTADO-SESION.md`.

## Documentos

- `prototipe.md`: el plan del prototipo y la fuente de verdad. Se edita en `docs/planificacion/secciones/` y se monta con `node docs/planificacion/montar-prototipe.mjs . --write`.
- `docs/planificacion/DECISIONES.md`: decisiones cerradas y su porqué (su §10 manda sobre lo anterior).

## Convenciones

- Español de España en la interfaz, la documentación, los ADR y el CHANGELOG; código e identificadores en inglés. Commits con Conventional Commits (tipo en inglés, descripción en español).
- Hitos M0–M4 y Fase 2 (no P0/P1/P2). ADR en `docs/adr/NNN-titulo.md`.
- Versiones exactas (§6 de `prototipe.md`) y `.npmrc` con `save-exact=true`.
- Entorno: Windows 11, Node 24.21 y npm 11.19 (workspaces); sin Docker, Python ni PostgreSQL.
- La clave de la Steam Web API nunca va en el chat, el repo ni el *bundle*: solo en `.env.local` y en secretos de GitHub.
