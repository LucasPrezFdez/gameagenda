## 1. Resumen ejecutivo

**GameAgenda** es una agenda personal de videojuegos para quien juega sobre todo en PC, usa a diario el PC y el móvil y tiene más juegos pendientes que tiempo. Su función principal es **apuntar en segundos el juego que se quiere jugar**; después, seguirlo con cinco estados (Quiero jugar, Jugando, En pausa, Completado, Abandonado) y tres marcas de un toque (Platinado, Comprado, Próximo), con «Deshacer» en vez de confirmaciones (ver §2 y §3).

### 1.1 La apuesta

Se apuesta por una **PWA *local-first*** instalable, con un solo código para móvil y escritorio. El catálogo completo de Steam (≈196 600 juegos) se guarda en el dispositivo y se busca al instante en un Web Worker: **apuntar p50 ≤3 s sin red** y **tecla → resultados ≤50 ms p95** en un Android de gama media (ver §3). Con el catálogo real y CPU ×4, el índice responde en 8,7 ms p95 por pulsación; mientras se construye, un escaneo lineal ya busca en todo el catálogo (ver §8). Steam y el servidor nunca están en el camino crítico (ver §5).

### 1.2 Cómo se obtiene el catálogo

La lista sin clave de casi todos los tutoriales (`ISteamApps/GetAppList/v2`) se retiró el 13-11-2025, y las API de Steam no envían CORS. Un pipeline diario en GitHub Actions une `IStoreService/GetAppList` (con clave: la lista autorizada) con `IStoreQueryService/Query` e `IStoreBrowseService/GetItems` (sin clave y no documentados; aportan nombre en español, fechas, reseñas y portadas): ≈220 llamadas/día de las 100 000 permitidas. Si pasa las puertas de publicación, despliega ficheros estáticos con un *manifest* firmado; el núcleo pesa 2,25 MB en brotli. El catálogo de M1 se construye en el PC sin clave, con el mismo modo que sirve de plan B (ver §4 y §7).

### 1.3 Arquitectura y stack

| Pieza | Elección (ver §5 y §6) |
|---|---|
| Interfaz | React 19.3.1 + Vite 8.3.5 (SPA), TypeScript 7.0.2, Service Worker |
| Datos del usuario | Dexie 4.4.7 (IndexedDB); HLC por campo y `outbox` desde M1 |
| Búsqueda | Índice propio en un Web Worker; uFuzzy 1.0.19 para erratas |
| Catálogo y *hosting* | Pipeline en Node 24.21; Cloudflare Workers Static Assets |
| Sincronización (M4) | Micro-API Hono 4.13.14 + D1 en la UE; emparejar sin email |
| Calidad | Biome, Vitest, Playwright (CPU ×4) y CI en GitHub Actions |

### 1.4 Hitos

| Hito | Resultado | Días ideales |
|---|---|---|
| M0 Esqueleto | Construir, probar y desplegar desde el primer día | 2–3 |
| M1 Apuntar | Todo el catálogo de Steam buscable y listable sin red; apuntar en <3 s; estados, marcas, ficha básica y exportar | 9–12 |
| M2 Catálogo vivo | Catálogo diario automático, portadas, ficha completa y vista Próximos | 4–5 |
| M3 Rápida y ágil | Presupuestos cumplidos en móviles reales, más vías de captura y app de escritorio con atajo global | 4–6 |
| M4 Sincronización | Una sola agenda en el móvil y el PC, con copia fuera del dispositivo | 4–6 |

Total: **23–32 días ideales**, 9,2–12,8 semanas a 15 h/semana sin colchón (día ideal ≈6 h; ver §15). El orden por defecto es M3 → M4 (se supone que hasta M4 se apunta sobre todo en un dispositivo); M4 puede ir antes si la app se usa en dos dispositivos desde el principio o en un iPhone sin instalarla (ver §18, PA-01). La app de escritorio para Windows es un envoltorio Tauri de la misma web y llega en M3 (ver §17.3). Fase 2: cuenta de Steam (ver §10) y otras plataformas (ver §17).

### 1.5 Coste, riesgos y qué hace falta

- **Coste:** 0 €/mes, solo con planes gratuitos (Cloudflare, GitHub y healthchecks.io).
- **Riesgos** (ver §16): que `Query` o `GetItems` cambien (plan B, contratos y *kill switches*); que Safari borre los datos si la app no está instalada (instalarla, exportar y M4); lentitud en móviles modestos (Worker, medición en dispositivos reales e índice persistido en M3).
- **Del usuario** (ver §18): una cuenta de Steam con ≥5 US$ gastados y Steam Guard móvil, para pedir la clave el primer día; cuentas gratuitas de GitHub, Cloudflare y healthchecks.io; un Android de gama media y un iPhone (prestado si hace falta) para validar M3 y M4 (ver §15); y saber en qué dispositivos se apuntará al principio, porque decide si M4 va antes que M3.
