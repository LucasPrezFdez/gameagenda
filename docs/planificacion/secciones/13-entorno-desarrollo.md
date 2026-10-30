## 13. Entorno de desarrollo en este PC

### 13.1 Qué hay y qué falta

Comprobado el 28-10-2026 en el equipo de desarrollo (Windows 11 Pro, AMD Ryzen 5 3600 con 12 hilos, 16 GiB de RAM):

| Herramienta | Estado | Uso o comando (PowerShell) |
|---|---|---|
| Node 24.21.0 y npm 11.19.0 | Instalados | Todo el repositorio. Node ejecuta `.ts` directamente ([*type stripping*](https://nodejs.org/api/typescript.html) estable) y carga `.env.local` con `--env-file-if-exists` |
| git 2.56.0, Chrome, Edge y winget 1.29 | Instalados | `chrome://inspect` para el Android (§13.4) |
| Rust 1.99, VS Build Tools 2022 y WebView2 | Instalados | Solo para la app de escritorio (`apps/desktop`, desde M3; ver §17.3) |
| GitHub CLI | Falta (M0) | `winget install --id GitHub.cli -e` y `gh auth login`: secretos, *releases*, *issues* y `gh workflow run` |
| Navegadores de Playwright | Falta (M0) | `npx playwright install chromium webkit` (lo hace `npm run setup`) |
| Cuenta gratuita de Cloudflare | Necesaria (M0) | `npx wrangler login` una vez para crear `ga-web` y `ga-catalog`; el CI usa un *token* (§12.5) |
| cloudflared | Cuando haga falta | `winget install --id Cloudflare.cloudflared -e`: túnel HTTPS para el iPhone (opcional desde M3), el Atajo de iOS (M4) y OpenID (Fase 2) |
| Docker, Python, PostgreSQL, pnpm, Android SDK, Mac | No hacen falta | Ninguna dependencia de npm compila código nativo (Rust solo compila `apps/desktop`); D1 se emula en local con `wrangler dev` (M4) |

La clave de la Web API de Steam se pide el primer día de M0 (requisitos: ver §4); en el PC solo vive en `.env.local`.

### 13.2 Ajustes de git y npm en Windows

- En el repositorio, no en la configuración global, para no cambiar otros proyectos: `git config core.longpaths true` (rutas largas de `node_modules`) y `git config core.autocrlf false` (Git para Windows trae `true` en la configuración del sistema). La configuración local no viaja con el repositorio: en un clon nuevo, `git clone -c core.longpaths=true -c core.autocrlf=false <url>`.
- `.gitattributes` con `* text=auto eol=lf`.
- `.npmrc` con `save-exact=true`; `package.json` con `"engines": { "node": "^24.21.0" }` y `.node-version` con `24.21.0`, que también lee el CI.
- npm ejecuta los scripts con `cmd.exe`: no sirven `VAR=valor comando` ni `rm -rf`, así que la lógica va en scripts `.ts`.
- `.gitignore`: `node_modules/`, `.env.local`, `dist*/`, `pipeline/out/`, `pipeline/state/`, `.wrangler/`, `apps/desktop/src-tauri/target/` y los informes de Playwright.

### 13.3 Scripts npm

| Script | Qué hace |
|---|---|
| `npm run setup` | Comprueba Node, ejecuta `npm ci`, instala Chromium y WebKit para Playwright y crea `.env.local` a partir de `.env.example`. Se puede repetir |
| `npm run dev` | Vite en `http://127.0.0.1:5173` con el mini-catálogo y sin red. Escuchar solo en la interfaz local evita el aviso del cortafuegos de Windows |
| `npm run preview` | *Build* local del modo `e2e` (el de producción, que además acepta la clave de desarrollo; ver §12.3) y `vite preview` en `127.0.0.1:4173`: lo que se abre en los móviles |
| `npm test` | Vitest (`core`, pipeline con *fixtures* y, en M4, la micro-API), sin red |
| `npm run check` | Biome, `tsc`, `npm test`, *build*, puertas de tamaño y búsqueda de la clave: el CI sin los E2E |
| `npm run e2e` / `npm run perf` | Playwright en Chromium y WebKit (§12.3) / proyecto `perf`, puerta dura en local (§12.4) |
| `npm run catalog:build` | `node --env-file-if-exists=.env.local pipeline/build.ts`. Con `STEAM_WEB_API_KEY`, columna vertebral con clave; sin ella, plan B (ver §4). Tarda ≈10–13 min (ver §4.7 y §4.8) y deja el catálogo en `pipeline/out/`. Con `-- --source=fixtures` regenera el mini-catálogo en segundos y sin red; con `-- --compare=<volcado>`, genera el informe de cobertura de CA1.1 frente al volcado público (ver §15; el volcado no se versiona) |
| `npm run catalog:publish` | `wrangler deploy -c pipeline/wrangler.jsonc`: publica `pipeline/out/` en `ga-catalog` (paso 6 de la §4.5). En M1, con el *manifest* sin firma, se lanza a mano desde el PC (ver §4.8); desde M2 solo lo ejecuta `catalog.yml`, después de firmar, y el PC nunca firma ni despliega `ga-catalog` |
| `npm run catalog:stage` | Desde M2, si el pipeline se ejecuta en el PC (falta de minutos o 429 en los *runners*): sube con `gh` el resultado de `catalog:build` (`pipeline/out/` y el estado nuevo) a la *Release* `catalog-staging`. Se publica con `gh workflow run catalog.yml -f source=staging`, que pasa las puertas, firma y despliega (ver §12.5) |
| `npm run fixtures:freeze` | Copia a `fixtures/catalog-frozen/` el núcleo de `pipeline/out/`, comprimido con gzip, y sus alias (ver §12.1 y §14.2); como mucho una vez por hito |
| `npm run fixtures:record -- --appids=…` | Graba respuestas reales en `fixtures/steam/` (§12.2) |
| `npm run desktop:dev` | Desde M3: `tauri dev` con `npm run dev` de fondo; la ventana carga `http://127.0.0.1:5173` |
| `npm run desktop:build` | Desde M3: `tauri build`; deja el instalador NSIS en `apps/desktop/src-tauri/target/release/bundle/nsis/` (la primera compilación de Rust tarda varios minutos; ver §12.5) |

```dotenv
# .env.example → copiar a .env.local (no se versiona)
STEAM_WEB_API_KEY=             # vacía: plan B sin clave
CATALOG_DIR=fixtures/catalog   # pipeline/out para el catálogo real
```

`dev` y `preview` sirven el catálogo de `CATALOG_DIR` en `/catalog-dev/`, en el mismo origen y, desde que el *manifest* se firma (M2), con la clave de desarrollo, que el *build* de producción no acepta.

### 13.4 Probar en el móvil real

**Android (dispositivo de referencia):**
1. Activar las opciones de desarrollador y la depuración USB y conectar el móvil por cable (algunos fabricantes exigen su controlador USB).
2. Ejecutar `npm run preview` (con `CATALOG_DIR=pipeline/out` para medir con el catálogo real); en Chrome del PC, abrir `chrome://inspect/#devices` y añadir en *Port forwarding* el puerto `4173` → `localhost:4173`.
3. En el móvil, abrir `http://localhost:4173`: `localhost` es un contexto seguro, así que funcionan el Service Worker y la instalación (con `http://192.168.x.x`, no). `chrome://inspect` da además las DevTools del móvil, también sobre `ga-web` desplegado.

**iPhone:** sin Mac no hay Web Inspector; se mide con el panel de rendimiento de la app sobre `ga-web` desplegado o sobre un *build* local con `cloudflared tunnel --url http://127.0.0.1:4173`. El túnel rápido no pide cuenta, da una URL `https://….trycloudflare.com` nueva cada vez y no garantiza disponibilidad. Hay que añadir `.trycloudflare.com` a `preview.allowedHosts` y cerrarlo al terminar: mientras está abierto, la URL es pública. Playwright WebKit en Windows detecta fallos del motor, pero no sustituye al iPhone.

Fuentes (consultadas el 28-10-2026): [Quick Tunnels de Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) y [`allowedHosts` de Vite](https://vite.dev/config/server-options); los identificadores de winget, comprobados con `winget show`.

### 13.5 Trabajar sin red

Tras un `npm run setup` con conexión, `dev`, `test`, `check`, `e2e` y `perf` funcionan sin Internet:
- `fixtures/steam/`: respuestas grabadas y redactadas de `GetAppList`, `Query` y `GetItems`.
- `fixtures/catalog/`: mini-catálogo de ≈300 juegos en el formato publicado (ver §7) con los casos difíciles: `appid` centinela, Hades y Hades II, romanos, CJK, ™ y ®, retirados, «próximamente», adultos, gratuitos, nombres vacíos y lista negra exacta. Lo genera `catalog:build -- --source=fixtures` y se versiona (§12.1).
- `fixtures/catalog-frozen/`: copia congelada del núcleo real y sus alias (≈3 MB gzip), para las puertas de calidad de búsqueda y `perf` (§12.1 y §12.4). Ya contiene `core.20261028.1.tsv.gz` y `aliases.20261028.1.tsv`, los ficheros con los que se midió la búsqueda (ver §8.11), copiados el 28-10-2026. Se versiona y `npm run fixtures:freeze` la renueva.
- `fixtures/keys/`: clave de firma de desarrollo (desde M2), que aceptan `dev` y el *build* `e2e`, y no el de producción.
- Portadas: sin red se pinta el *placeholder* generado (ver §9).
