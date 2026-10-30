# GameAgenda

Agenda personal de videojuegos: apunta en segundos los juegos que quieres jugar y lleva su estado (Completado, Platinado, Comprado…), empezando por el catálogo completo de Steam.

El plan del prototipo está en [`prototipe.md`](prototipe.md); las decisiones de arquitectura, en [`docs/adr/`](docs/adr/).

## Empezar

Requisitos: Windows 11 (o cualquier sistema con Node), Node 24.21 y npm 11.19.

```powershell
npm run setup   # npm ci, navegadores de Playwright y .env.local
npm run dev     # http://127.0.0.1:5173
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo de Vite en `127.0.0.1:5173` |
| `npm run build` / `npm run preview` | *Build* de producción / servirlo en `127.0.0.1:4173` |
| `npm test` | Pruebas unitarias con Vitest |
| `npm run check` | Biome, `tsc`, Vitest, *build* y puerta de tamaño (`npm run size`) |
| `npm run e2e` | Playwright (Chromium y, en local, WebKit con móvil emulado) |
| `npm run perf` | Rendimiento con CPU ×4 y el catálogo completo de `pipeline/out/` (ver §12.4) |
| `npm run catalog:build -- --keyless` | Catálogo de M1 sin clave de Steam en `pipeline/out/` (ver §4) |
| `npm run catalog:frozen` | Catálogo completo y mini-catálogo de `fixtures/catalog/` desde la copia congelada |
| `npm run format` | Formatea y ordena los imports con Biome |

## Estructura

| Carpeta | Contenido |
|---|---|
| `apps/web` | La app (React + Vite) |
| `packages/core` | Lógica pura compartida |
| `pipeline/` | Construcción del catálogo de Steam |
| `fixtures/` | Datos de prueba, incluida la copia congelada del catálogo real |
| `scripts/` | *Scripts* del repositorio |
| `docs/` | ADR, mediciones (`docs/medidas/`) y planificación |
