# GameAgenda

Agenda personal de videojuegos: apuntar en segundos los juegos que quieres jugar y llevar su estado (Completado, Platinado, Comprado…), empezando por el catálogo completo de Steam. La prioridad es la captura rápida: la app tiene que ser «rápida y ágil».

## Estado

- Planificación terminada el 28-10-2026. **M0 y M1 cerrados** (30-10-2026; M1 con `v0.1.0`; las medidas en el dispositivo pasan a M3, [issue #1](https://github.com/LucasPrezFdez/gameagenda/issues/1)).
- **M2 en producción desde el 31-10-2026, a falta de CA2.1** (tres ejecuciones programadas de `catalog.yml` en verde, del 1 al 3 de noviembre) para la etiqueta `v0.2.0`. Catálogo firmado en https://ga-catalog.gameagenda-cat.workers.dev, en su propia cuenta de Cloudflare; app 0.2.0 en https://ga-web.gameagenda.workers.dev (ADR-003 y ADR-007). Hasta cerrar M2 no se toca el pipeline.
- **M3 empezado:** la app de escritorio para Windows (`apps/desktop`, Tauri; ADR-010) está cerrada, con CA3.7 y CA3.8 el 02-11-2026. Lo demás de M3 que puede hacer el asistente también está hecho; quedan las pruebas del usuario y el núcleo de arranque, que espera a cerrar M2.
- Repositorio: https://github.com/LucasPrezFdez/gameagenda.
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
