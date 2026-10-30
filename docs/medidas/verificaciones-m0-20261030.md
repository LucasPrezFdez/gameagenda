# Comprobaciones «a verificar en M0» (30-10-2026)

Tres de las comprobaciones de M0 (§15.3 de `prototipe.md`): la importación de la clave Ed25519, el formato de la clave de Steam y los campos de Query sin `include_basic_info`. En el PC de desarrollo (Windows 11, Node 24.21.0, Playwright 1.64.1), sin llamadas a Steam. Los *scripts* no se versionan.

## 1. Importación de la clave pública Ed25519 en WebCrypto

**Pregunta.** «Importación de la clave Ed25519» (§15.3 y `DECISIONES.md` §4, M0). El cliente verifica la firma del *manifest* con WebCrypto (§7.6; §11.3, «a verificar en M2 en los navegadores objetivo»), y la comprobación real se hace en el Worker de búsqueda.

**Método.** Node genera el par con `generateKeyPairSync('ed25519')` y firma un JSON de 151 bytes con `crypto.sign(null, …)`. La clave pública se exporta en tres formatos: `raw` (32 bytes, la `x` del JWK), `spki` (44 bytes, DER) y `jwk`. La misma función se ejecuta en Node, en la página y en un Worker dedicado (`new Worker` desde una Blob URL). Para cada formato, hace `importKey(formato, datos, { name: 'Ed25519' }, true, ['verify'])` y después `verify('Ed25519', …)` y `verify({ name: 'Ed25519' }, …)` con:

- la firma buena;
- un bit cambiado en el mensaje;
- un bit cambiado en la firma;
- la firma con 63 bytes.

También intenta importar una clave `raw` de 31 bytes y una pública con el uso `sign`.

**Contexto seguro.** Con `page.setContent` sobre `about:blank`, `isSecureContext` es `false` y `crypto.subtle` no existe, en la página y en el Worker, en los dos navegadores. Por eso se repitió en un origen `https://m0.test/` servido con `page.route` y en `http://localhost` (un servidor de Node). Los dos son contextos seguros y dan el mismo resultado. El e2e usa `http://127.0.0.1`, que también lo es.

**Resultado.**

| Entorno | Versión | `raw` | `spki` | `jwk` | Página | Worker |
|---|---|---|---|---|---|---|
| Node | 24.21.0 | ✓ | ✓ | ✓ | ✓ | — |
| Chromium de Playwright (`chromium-1248`) | 156.0.8078.4 | ✓ | ✓ | ✓ | ✓ | ✓ |
| WebKit de Playwright en Windows (`webkit-2370`) | 27.2 | ✗ | ✗ | ✗ | ✗ | ✗ |

- **Node y Chromium**, en la página y en el Worker, con los tres formatos:
  - la firma buena da `true`, con el algoritmo como cadena y como objeto;
  - el mensaje cambiado, la firma cambiada y la de 63 bytes dan `false`, sin excepción;
  - la clave de 31 bytes da `DataError` («Ed25519 key data must be 256 bits» en Chromium);
  - `sign` sobre la pública da `SyntaxError`.
- **WebKit de Playwright en Windows** no tiene Ed25519:
  - `importKey` y `generateKey` dan `NotSupportedError` con cualquier formato, en la página y en el Worker;
  - X25519 tampoco va, y ECDSA P-256 y SHA-256 sí.

  Lo más probable es que sea el puerto de Windows de WebKit, que usa OpenSSL: Ed25519 sobre OpenSSL entró en WebKit el 22-10-2026 ([bug 248980](https://bugs.webkit.org/show_bug.cgi?id=248980), 324446@main), después de esta compilación. No dice nada de Safari, que lo tiene desde la 17 (§7.6). Ese navegador sigue sin probarse.

**Conclusión.** La importación queda verificada en Node 24 y Chromium 156, también dentro de un Worker. `raw` (32 bytes), `spki` y `jwk` funcionan igual, así que basta con `raw`. Safari real (iOS ≥17) queda para M2, en el dispositivo. El plan debe decir qué hace desde v0.2.0 el proyecto `webkit-movil` del e2e: con WebKit en Windows, la app descartará todos los *manifest*. Hay tres salidas:

- limitar a Chromium las pruebas que cargan el catálogo;
- usar `webkit-movil` para probar el camino «sin Ed25519» de RNF-12;
- esperar a un WebKit de Playwright que incluya 324446@main.

## 2. Formato de la clave de la Steam Web API

**Pregunta.** §12.5: `scripts/scan-secrets.ts` busca «una palabra de 32 caracteres alfanuméricos cuyo SHA-256 coincida con la variable `STEAM_KEY_SHA256` (formato a verificar en M0)».

**Método.** Se revisaron las fuentes el 30-10-2026, sin abrir `.env.local` ni ver ninguna clave real. Las expresiones regulares se probaron con una clave falsa aleatoria.

**Resultado.**

- **Valve no documenta el formato.** [steamcommunity.com/dev](https://steamcommunity.com/dev) solo muestra `?key=<api key>`. [Web API Overview › Authentication](https://partner.steamgames.com/doc/webapi_overview/auth) explica cómo se manda la clave (parámetro o cabecera `x-webapi-key`), pero no su longitud ni su alfabeto. La wiki de Valve Developer Community respondió 403.
- **Fuentes secundarias:** coinciden en 32 dígitos hexadecimales (128 bits).
  - [steam-condenser](https://github.com/koraktor/steam-condenser-php/blob/master/lib/SteamCondenser/Community/WebApi.php) (PHP y Ruby) exige `^[0-9A-F]{32}$`: «a valid 128bit hexadecimal string».
  - La [documentación de xPaw](https://github.com/xPaw/SteamWebAPIDocumentation/blob/master/src/App.ts) acepta `/^[0-9a-f]{32}$/i`.
  - La [guía de IONOS](https://www.ionos.com/digitalguide/websites/web-development/steam-api-key/) habla de 32 letras y números.

  Que Steam la muestre en mayúsculas sale de steam-condenser, no de Valve.
- **En el repositorio:**
  - `pipeline/src/fixtures.ts` busca su forma con `/\b[0-9A-F]{32}\b/`.
  - `scripts/scan-secrets.ts` (d0da35c) usa `/\b[0-9A-Za-z]{32}\b/g` y calcula el SHA-256 de cada candidata tal cual.

  En `fixtures/steam/` no hay ninguna palabra de 32 caracteres alfanuméricos.
- **Prueba con una clave falsa:** el escáner actual la encuentra entre comillas y en `?key=…&`, pero no pegada a un `_` (`a_CLAVE_b`, porque `\b` cuenta `_` como letra) ni en minúsculas. Con la expresión de abajo, la encuentra en los cuatro casos.

**Conclusión.** La clave son 32 dígitos hexadecimales (128 bits), en mayúsculas según las fuentes secundarias; Valve no lo publica. El escáner puede seguir buscando 32 caracteres alfanuméricos, que abarcan el formato, pero conviene que las candidatas sean `/(?<![0-9A-Za-z])[0-9A-Za-z]{32}(?![0-9A-Za-z])/g`. Además, debe comparar `sha256(candidata)` y `sha256(candidata.toUpperCase())` con `STEAM_KEY_SHA256`, que es el *hash* de la clave tal como la da Valve. Para la forma en los *fixtures* basta con `/(?<![0-9A-Za-z])[0-9A-Fa-f]{32}(?![0-9A-Za-z])/`. El plan puede decir: «32 dígitos hexadecimales (128 bits; Steam la muestra en mayúsculas)».

## 3. Campos de Query sin `include_basic_info`

**Pregunta.** §4.5: «`is_free`, `is_early_access`, `is_coming_soon` y `content_descriptorids` van fuera de `basic_info`, pero el 28-10-2026 se pidieron con él: que siguen llegando sin él queda **a verificar en M0**». Lo mismo dice `DECISIONES.md` §10.4.

**Método.** `pipeline/steam/endpoints.ts` manda `DATA_REQUEST` en Query y en `GetItems`: `include_release`, `include_assets`, `include_reviews` e `include_platforms` a `true`, e `include_best_purchase_option` a `false`. `derive.ts` lee `is_free`, `is_early_access` o `release.is_early_access`, `is_coming_soon` o `release.is_coming_soon` y `content_descriptorids` (3 o 4 = adulto). Se recorrieron las 230 páginas crudas de `pipeline/state/raw-2026-10-29/`, se contaron los juegos por `appid` y se comparó con la pasada del 28-10-2026, que sí pidió `include_basic_info` (`docs/planificacion/prototipo-busqueda/resultados/derive_stats.json`, sobre las filas derivadas).

**Resultado.** Ninguna de las 230 URL pide `include_basic_info` y ningún juego trae `basic_info`.

| Query (ES, `spanish`), juegos `type 0` | 29-10, sin `basic_info` | 28-10, con `basic_info` |
|---|---|---|
| Juegos | 197 052 (207 403 entradas; 1 de tipo 14) | 196 666 filas |
| `is_free: true` | 23 748 (12,05 %) | 23 718 (12,06 %) |
| `is_free: false` | 0 (falta en 173 304) | — |
| `is_early_access` | 19 334 | 19 311 |
| `is_coming_soon` | 62 712 | 62 625 |
| `content_descriptorids` | 45 621 (10 237 con 3 o 4) | 10 213 adultos |

- **Falsos:** Steam omite los booleanos falsos y las listas vacías. Ningún juego trae `false` ni `[]`, y no hay dos entradas del mismo `appid` que discrepen.
- **`GetItems`:** sus 22 páginas, con el mismo `data_request`, dan lo mismo. En inglés y ES, 319 de 3 450 juegos gratuitos; en español y US, 10 de los 39 con `success 1`.
- ***Fixtures* de `fixtures/steam/`:** ninguno pide `include_basic_info`. Traen `is_free` (6 en Query y 14 en `GetItems`), y `pipeline/test/contract.test.ts` lo comprueba con 730, 1609230, 4354570 y 644560.

**De qué opción sale cada campo.** Según `StoreItem` en el [`.proto` de SteamDatabase](https://github.com/SteamDatabase/Protobufs/blob/master/steam/steammessages_storebrowse.steamclient.proto), actualizado el 17-10-2026:

- `basic_info` (campo 24) solo lleva `short_description`, `publishers`, `developers`, `franchises` y `capsule_headline`;
- `is_free` (13), `is_early_access` (14), `content_descriptorids` (20) e `is_coming_soon` (34) son campos de primer nivel;
- `release`, `reviews`, `assets` y `platforms` llegan con su `include_*`;
- `categories` llega sin pedirla.

`is_coming_soon` e `is_early_access` coinciden con `release.*` en las 207 403 entradas. Todas las páginas grabadas piden `include_release`, así que con estos datos no se puede saber si las de primer nivel dependen de él. A `derive.ts` le da igual, porque lee las dos.

**Conclusión.** Queda verificado (lo recoge también el ADR-006): sin `include_basic_info` siguen llegando `is_free`, `is_early_access`, `is_coming_soon` y `content_descriptorids`, en la misma proporción que con él. La §4.5 y `DECISIONES.md` §10.4 pueden decir «verificado el 29-10-2026» con los recuentos de la tabla.
