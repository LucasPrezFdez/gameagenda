## 17. Multiplataforma

Las plataformas de juego (consolas y otras tiendas) son de **Fase 2**; la app de escritorio para Windows, de **M3** (§17.3). «Platinado» evoca PlayStation, y el usuario debe poder apuntar **cualquier** juego.

### 17.1 Tres niveles

1. **Juego manual (desde M1):** solo el título y, si se quiere, «Juego en», al instante y sin red, con id `manual:<uuidv7>`. Vincularlo con el catálogo es fusionar sus campos (LWW por campo) en la entrada de destino y dejarlo como lápida con `mergedInto` (ver §7). Nunca se vincula por similitud: solo se propone con exactamente una coincidencia exacta tras normalizar («Hades» ≠ «Hades II»).
2. **IGDB, catálogo multiplataforma:** la única fuente con PC, PlayStation, Xbox, Nintendo y retro a la vez; gratis también para uso comercial (con una *partnership* gratuita) y prefiere que se guarden sus datos. Se muestra siempre la atribución «Datos de juegos: IGDB.com». Exige credenciales de Twitch y no admite llamadas del navegador (4 peticiones/s, 8 simultáneas, 500 ítems por petición), así que entra como **etapa del pipeline**: credenciales en un secreto de GitHub, barrido diario por `updated_at` y ficheros estáticos en `ga-catalog`. La búsqueda sigue siendo local. Un barrido completo son ≈860 peticiones (≈428 000 fichas en marzo de 2023; a medir en Fase 2), y el tamaño decidirá si va en un fichero aparte que solo se descarga al activar otras plataformas.
   - **Identidad:** gracias a `external_games` (`external_game_source = 1`, `uid` = `appid`), los juegos de Steam conservan `steam:<appid>` y solo los que no están en Steam reciben `igdb:<id>` (id numérico). Si uno llega luego a Steam, se propone vincularlo como un manual.
   - **Duración:** `game_time_to_beats` (*hastily*, *normally*, *completely*) da estimaciones con licencia para «Completado» y «Platinado»; se ocultan si hay pocas aportaciones.
3. **Wikidata (CC0), cruce de ids por lotes**, nunca en el camino de búsqueda: ≈129 000 ítems con `appid` de Steam, el 91 % también con IGDB. Los ids de consola escasean (≈6 000 de cada tienda: PS Store, eShop, Microsoft Store) y a veces son *slugs* con varios valores (Hades tiene tres ids de MobyGames), así que el cruce del pipeline es **muchos a muchos**, nunca 1:1.

Portadas: Steam para los juegos de Steam e IGDB (`t_cover_big`) para el resto (ver §11.3).

### 17.2 Otras fuentes

| Fuente | Decisión | Motivo |
|---|---|---|
| IGDB | Sí (Fase 2) | Cobertura, licencia y permiso para guardar datos |
| Wikidata | Sí, por lotes | CC0; enlaces salientes (HowLongToBeat, PS Store, eShop) |
| IsThereAnyDeal | Opcional; preguntar antes | Precios para lo que no está «Comprado»; sus términos prohíben apps que «compitan» con sus proyectos (Waitlist, Collection) |
| Trofeos de PSN (NPSSO) | No | API no oficial; el NPSSO equivale a la contraseña y choca con los términos de PSN (5.1 y 10.7). Platinado, manual |
| Xbox (OpenXBL), RetroAchievements | Opcional, más adelante | Importación con la clave del propio usuario |
| HowLongToBeat | Solo enlace | Sin API; *endpoints* internos cambiantes y 429 desde septiembre de 2026 |
| Giant Bomb | No | API fuera de servicio |
| RAWG | No como espejo | Prohíbe redistribuir y exige enlace en cada página |
| SteamGridDB | No | Sus términos prohíben el uso automatizado |
| MobyGames | No | De pago (≈99,99 US$/mes para uso comercial) |
| PCGamingWiki | Solo enlace | Licencia CC BY-NC-SA |
| SteamSpy | No | Datos desfasados (aún llama «Counter-Strike: Global Offensive» al 730) |
| GOG, Epic | No para funciones clave | Sin API oficial de catálogo; sus ids llegan por IGDB |

Verificado el 28-10-2026. Fuentes: <https://api-docs.igdb.com/> · <https://www.wikidata.org/wiki/Wikidata:Licensing> · <https://docs.isthereanydeal.com/> · <https://www.playstation.com/en-us/legal/terms-of-use-march-2025/>

### 17.3 App de escritorio (envoltorio Tauri, M3)

Decidida el 29-10-2026 (ADR-010; criterios CA3.7 y CA3.8 en la §15.6): Tauri 2 (versiones en la §6) envuelve la misma web y nunca es un segundo motor. Aporta el atajo global `Ctrl+Mayús+Espacio`, que abre la paleta desde cualquier aplicación de Windows; la PWA instalada en el PC sigue siendo válida, pero sin ese atajo.

- **Carga el origen de `ga-web`**, no ficheros empaquetados (`frontendDist` es la URL de producción y `devUrl`, `http://127.0.0.1:5173`), para que la cookie `__Host-`, `connect-src 'self'` y el Service Worker funcionen igual y cada despliegue de `ga-web` actualice también la app de escritorio. La primera apertura necesita red; después, el Service Worker de WebView2 la sirve sin red (a verificar en M3).
- **Parte nativa mínima** (`apps/desktop/src-tauri/src/main.rs`): registra el atajo; muestra la ventana, la pone delante y abre la paleta en `/apuntar` sin recargar la página (lanza en ella un evento fijo que atiende el *router*; a verificar en M3 que la CSP lo permite); con la ventana delante, el mismo atajo la oculta. Al cerrar la ventana, la app sigue en la bandeja, con «Abrir», «Iniciar con Windows» (desactivado por defecto) y «Salir»; una segunda instancia muestra la primera.
- **Permisos:** la página de `ga-web` no recibe ninguna orden de Tauri: ninguna *capability* declara `remote` y la web no usa `@tauri-apps/api`. El login de Steam de Fase 2 va por el navegador del sistema (ver §10.2).
- **Datos hasta M4:** WebView2 guarda los suyos aparte de Edge y de Chrome, así que la app de escritorio tiene su propia agenda. Hasta la sincronización, en el PC se apunta en ella o en el navegador, no en los dos; para cambiar, se exporta y se importa (ver §16, R-18). En M4 se empareja como un dispositivo más.
- **Instalador:** NSIS por usuario, sin derechos de administrador, generado en el PC (ver §12.5). Sin firma de código, SmartScreen avisa al instalar («Más información» → «Ejecutar de todas formas»); firmar tiene coste y se decide en Fase 2. Rust 1.99, VS Build Tools 2022 y WebView2 ya están instalados (ver §13).
