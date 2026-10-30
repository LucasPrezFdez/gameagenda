# GameAgenda

Agenda personal de videojuegos: apuntar en segundos los juegos que quieres jugar y llevar su estado (Completado, Platinado, Comprado…), empezando por el catálogo completo de Steam. La prioridad es la captura rápida: la app tiene que ser «rápida y ágil».

## Estado

- Planificación terminada el 28-10-2026. **M1 cerrado con `v0.1.0`** (30-10-2026): las medidas en el dispositivo pasan a M3 ([issue #1](https://github.com/LucasPrezFdez/gameagenda/issues/1)). **M0 cerrado** el mismo día, sin etiqueta: CI en GitHub Actions y despliegue en Cloudflare (https://ga-web.gameagenda.workers.dev, https://ga-catalog.gameagenda.workers.dev; ADR-003). Lo siguiente es M2. Repositorio: https://github.com/LucasPrezFdez/gameagenda.
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
