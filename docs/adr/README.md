# Registro de decisiones de arquitectura (ADR)

Este registro recoge las decisiones de arquitectura de GameAgenda, en español y con el formato [MADR 4.0](https://adr.github.io/madr/).

- Cada ADR se escribe al empezar su hito.
- Se numeran por orden de escritura (§5.6 y §15.1 de [`prototipe.md`](../../prototipe.md#56-adr-001-y-registro-de-decisiones)).
- Una decisión aceptada no se edita: se sustituye por otro ADR.

**Estados:**

- propuesta;
- aceptada;
- rechazada;
- obsoleta;
- sustituida por ADR-NNN;
- pendiente: el ADR aún no está escrito.

| ADR | Decisión | Hito | Estado | Fichero |
|---|---|---|---|---|
| 001 | Arquitectura: PWA *local-first* con catálogo estático | M0 | aceptada (28-10-2026) | [001-arquitectura-del-prototipo.md](001-arquitectura-del-prototipo.md) |
| 002 | Stack y repositorio: React + Vite como SPA, *router* propio, CSS nativo y versiones exactas | M0 | aceptada (29-10-2026) | [002-stack-y-repositorio.md](002-stack-y-repositorio.md) |
| 003 | *Hosting*, despliegue y CI: Workers Static Assets para `ga-web` y `ga-catalog`, y GitHub Actions | M0 | aceptada (30-10-2026) | [003-hosting-despliegue-y-ci.md](003-hosting-despliegue-y-ci.md) |
| 004 | Datos del usuario: Dexie, ids naturales, estados y marcas, HLC y `outbox` | M1 | aceptada (29-10-2026) | [004-datos-del-usuario.md](004-datos-del-usuario.md) |
| 005 | Búsqueda local en un Web Worker | M1 | aceptada (29-10-2026) | [005-busqueda-local-en-un-web-worker.md](005-busqueda-local-en-un-web-worker.md) |
| 006 | Alcance y formato del catálogo | M1 | propuesta | [006-alcance-y-formato-del-catalogo.md](006-alcance-y-formato-del-catalogo.md) |
| 007 | Pipeline diario, *manifest* firmado y plan B sin clave | M2 | pendiente | — |
| 008 | Portadas desde el CDN de Valve y aviso de privacidad | M2 | propuesta | [008-portadas.md](008-portadas.md) |
| 009 | Arranque rápido: índice persistido y núcleo de arranque | M3 | pendiente | — |
| 010 | App de escritorio: envoltorio Tauri de `ga-web` con atajo global | M3 | pendiente | — |
| 011 | Sincronización: micro-API, D1 en la UE y emparejamiento | M4 | pendiente | — |
| 012 | Cuenta de Steam con OpenID 2.0 | Fase 2 | pendiente | — |

Si M4 se adelanta a M3 (PA-01), la sincronización pasa a ser el ADR-009, y M3 se queda con los ADR-010 y 011 (§15.1).

## Plantilla

Los ficheros se llaman `NNN-titulo.md`, en minúsculas y sin tildes. Cada ADR sigue las secciones de MADR 4.0, en este orden:

1. **Título:** `ADR-NNN · Decisión`.
2. **Metadatos:** estado, fecha y quién decide.
3. **Contexto y problema**, que termina con la pregunta que se decide.
4. **Factores de la decisión.**
5. **Opciones consideradas.** Solo las que se evaluaron de verdad.
6. **Decisión.** Empieza por «Opción elegida: …, porque …». Dentro van:
   - las **Consecuencias**: «Bien, porque…», «Mal, porque…» y «Pendiente: …»;
   - la **Confirmación**: pruebas, E2E y puertas que la comprueban.
7. **Pros y contras de las opciones.**
8. **Más información:** enlaces a `prototipe.md`, a `docs/planificacion/DECISIONES.md` y a los ADR relacionados.
