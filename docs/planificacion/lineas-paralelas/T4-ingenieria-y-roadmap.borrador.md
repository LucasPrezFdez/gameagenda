# T4 · Calidad de ingeniería, requisitos no funcionales y plan de entrega

> **Ámbito:** requisitos no funcionales (RNF), pruebas, herramientas, CI/CD, observabilidad, seguridad, desarrollo local y hoja de ruta de **GameAgenda**. El documento no depende del stack: `<frontend>`, `<backend>`, `<db>` y `<hosting>` son marcadores que fijarán los ADR. La API de Steam, los ToS y lo legal, los competidores y las versiones de librerías de 2026 los estudia otro track en paralelo. Aquí solo aparecen como **supuestos** explícitos.

## 0. Resumen y supuestos

### 0.1 Resumen

- **Qué significa «rápida y ágil» en cifras:**
  - búsqueda local: p95 ≤ 50 ms en el móvil de referencia;
  - búsqueda remota: p95 ≤ 300 ms en banda ancha;
  - feedback al añadir un juego: ≤ 100 ms;
  - INP p75 ≤ 200 ms y LCP p75 ≤ 2,5 s;
  - JS inicial ≤ 100 KB gzip;
  - flujo «apuntar un juego» en < 3 s, comprobado con un test e2e.
- **Calidad *local-first*:** el alta se confirma en el dispositivo (UI optimista + IndexedDB) y se sincroniza después. Steam nunca está en el camino crítico de una petición de usuario.
- **Catálogo:** lo ingiere un job programado en GitHub Actions, que es lo único que tiene la clave de Steam. El CI de las PR no llama nunca a Steam: usa fixtures grabados y redactados.
- **Hito 1:** catálogo completo + búsqueda + alta rápida **sin cuentas** (lista local con exportación). Así baja el riesgo RGPD y se acorta el plazo.
- **Esfuerzo total estimado:** 54–81 días-persona ideales (M1: 15–22).

### 0.2 Supuestos (a confirmar por otros tracks o ADR)

| ID | Supuesto | Quién lo confirma | Si cambia… |
|---|---|---|---|
| S1 | Dimensionamiento: ~250.000 juegos (`type=game`), con margen hasta 500.000 entradas | Track API Steam | Se recalculan los presupuestos del índice y del sync |
| S2 | La enumeración completa solo se hace en servidor/job con clave secreta. El enriquecimiento usa `IStoreBrowseService/GetItems` por lotes (sin clave) | Hechos verificados + track API | — |
| S3 | Límites de Steam desconocidos. Se asume un ritmo prudente (≤ 1 petición/s por endpoint, lotes de 100–200 appids) y que habrá respuestas 429 | Track API / legal | Ajustar el ritmo y `timeout-minutes` del job |
| S4 | Producto principal: aplicación web instalable (PWA) pensada primero para móvil. Escritorio o nativa, más adelante | ADR-0002 | Los presupuestos web (LCP/INP) pasan a sus equivalentes nativos |
| S5 | Un solo desarrollador. 1 día ideal ≈ 6 h de trabajo enfocado | Usuario | Recalcular el calendario |
| S6 | Coste en prototipo ≤ 10 €/mes, idealmente con capas gratuitas | Usuario / ADR-0009 | Cambian el hosting y la observabilidad |
| S7 | Usuarios en España/UE: aplican RGPD, LOPDGDD y LSSI-CE | Track legal | — |
| S8 | Se puede enviar al cliente un índice compacto (appid + nombre) y mostrar imágenes del CDN de Steam | Track legal (ToS) | Búsqueda solo remota; imágenes vía proxy o sin imágenes |

### 0.3 Prueba de viabilidad medida hoy (datos sintéticos)

Benchmark ejecutado hoy en la máquina del desarrollador: AMD Ryzen 5 3600, 16 GB, Windows 11, Node 24.21.0, `node:sqlite` con SQLite 3.53.4.

Los datos son nombres sintéticos de 18,7 caracteres de media. Incluyen acentos, ™/®, números romanos y una popularidad de cola larga. Se añadieron 20 títulos reales para comprobar el ranking. El script se incorporará al repositorio como `scripts/bench-search.ts`.

| Medición | 250.000 títulos | 500.000 títulos |
|---|---|---|
| Búsqueda en memoria (JS): escaneo lineal por subcadena + ranking — p50 / p95 / p99 | 7,8 / 10,7 / 12,2 ms | 15,9 / 21,1 / 26,1 ms |
| Lo mismo con refinamiento incremental (pulsaciones tras la 2.ª letra) — p95 / p99 | 1,7 / 4,7 ms | 7,4 / 11,7 ms |
| Primera consulta de 2 caracteres (escaneo completo) — p95 | 14,5 ms | 35,7 ms |
| Memoria JS (nombres + normalizados) | ≈ 26 MB | ≈ 53 MB |
| SQLite FTS5 `trigram` (≥ 3 caracteres) — p50 / p95 / p99 | 0,6 / 3,5 / 5,9 ms | 0,9 / 8,3 / 13,4 ms |
| SQLite FTS5 `unicode61` + índices de prefijo (≥ 2 caracteres) — p50 / p95 / p99 | 0,2 / 3,6 / 6,8 ms | 0,3 / 7,4 / 13,6 ms |
| Construcción de índices FTS (trigram / prefijos) | 0,6 s / 0,6 s | 1,5 s / 1,2 s |
| Tamaño de la BD (tabla + 2 índices FTS, en memoria) | ≈ 42 MB | ≈ 82 MB |
| Índice compacto para el cliente (appid + nombre): bruto / gzip / brotli | 6,3 / 2,65 / 2,07 MB | 12,8 / 5,3 / 4,1 MB |

Conclusiones para los presupuestos:

1. **Búsqueda local en móvil:** un móvil de gama media es unas 4–6 veces más lento que este equipo. Con 250.000 títulos, el escaneo lineal rondaría 45–65 ms p95, **al límite** del presupuesto. Hace falta:
   - un Web Worker;
   - refinamiento incremental;
   - un nivel de «populares» para las 1–2 primeras letras, o un índice invertido.
2. **Búsqueda en servidor:** con 250.000 títulos, la consulta tarda ≤ 4 ms p95, así que **no es el cuello de botella**. La latencia remota depende sobre todo de la red. Por eso el presupuesto remoto se cumple con *debounce*, cancelación de peticiones y caché en CDN.
3. **Índice en el cliente:** el índice completo pesa ≈ 2 MB en brotli. Solo es aceptable como descarga diferida, cacheada y con deltas, nunca en la ruta crítica.
4. **SQLite sin instalar nada:** `node:sqlite` funciona en Node 24.21 sin flag ni aviso, con FTS5 y el tokenizer `trigram` con `remove_diacritics`.

Los datos son sintéticos. En M1 se repetirá con el catálogo real (`npm run bench:search`).

## 1. Requisitos no funcionales

Referencias de medida:

- **Móvil de referencia:** el perfil móvil por defecto de Lighthouse (Moto G Power emulado, CPU ×4, «Slow 4G»: RTT 150 ms, ~1,6 Mbps). Se calibrará con el móvil real del usuario.
- **Desktop de referencia:** el equipo del desarrollador (Ryzen 5 3600) con Chrome estable.
- **Latencia de búsqueda:** desde el evento `input` (marca `event.timeStamp`) hasta el primer frame con los resultados pintados. Se mide con `performance.measure('search:keystroke-to-results')`.
- **Percentiles:** p75 de campo (RUM) para Core Web Vitals; p95/p99 para las latencias propias.

### 1.1 Rendimiento («rápida y ágil»)

| ID | Requisito | Objetivo | Cómo se mide | Hito |
|---|---|---|---|---|
| REN-01 | Búsqueda local (índice en el cliente, en un Web Worker) | p95 ≤ 50 ms y p99 ≤ 100 ms en el móvil de ref.; p95 ≤ 16 ms en el desktop de ref. | Bench en CI + e2e con CPU ×4 + RUM (`search_mode=local`) | M1 si ADR-0005 elige local o híbrida; si no, M4 |
| REN-02 | Búsqueda remota (API) | p95 ≤ 300 ms en banda ancha (RTT ≤ 50 ms) y ≤ 500 ms en Slow 4G. Incluye el *debounce* (≤ 100 ms) | e2e con red emulada + RUM (`search_mode=remote`) | M1 |
| REN-03 | Tiempo de servidor de `/api/search` | p95 ≤ 25 ms (handler + consulta); consulta a la BD p95 ≤ 10 ms con 250.000 títulos | Métrica de servidor + bench de integración | M1 |
| REN-04 | Feedback de «Añadir a Quiero jugar» | Confirmación visible en ≤ 100 ms p95 (objetivo: 50 ms); persistencia local ≤ 50 ms; nunca espera a la red | `performance.measure('list:add-feedback')` + Event Timing (INP de esa interacción) | M1 |
| REN-05 | Flujo «apuntar un juego» | < 3 s de principio a fin tecleando a ritmo humano (~10 teclas/s, 5–6 caracteres). La espera atribuible al sistema, ≤ 500 ms | e2e con Playwright (mediana de 5 ejecuciones) + KPI `time_to_add_ms` | M1 |
| REN-06 | Arranque en frío (primera visita, móvil de ref.) | FCP ≤ 1,8 s; LCP ≤ 2,5 s; buscador usable en ≤ 3 s | Lighthouse CI (laboratorio) + RUM p75 | M1 |
| REN-07 | Arranque repetido / PWA instalada | Buscador con foco y usable en ≤ 1 s (en caliente) y ≤ 1,5 s (proceso en frío); lista visible en ≤ 1 s | e2e con service worker + RUM | M1 (básico) / M4 |
| REN-08 | INP | p75 ≤ 200 ms (umbral «bueno»); objetivo interno ≤ 100 ms al buscar y añadir; TBT de laboratorio ≤ 200 ms | RUM (`web-vitals`) + Lighthouse | M1 |
| REN-09 | CLS | p75 ≤ 0,1: imágenes con `width/height` y nada que aparezca encima del buscador | RUM + Lighthouse | M1 |
| REN-10 | Peso inicial | JS de la ruta principal ≤ 100 KB gzip; CSS ≤ 20 KB gzip; fuentes del sistema (o 1 woff2 ≤ 25 KB); primera carga total ≤ 300 KB, sin contar el índice ni las carátulas | Control de tamaño en cada PR + presupuestos de Lighthouse CI | M1 |
| REN-11 | Índice del catálogo en el cliente (si se adopta) | Completo ≤ 2,5 MB brotli para 250.000 juegos; nivel «populares» ≤ 150 KB; deltas diarios ≤ 100 KB; listo en el worker en ≤ 1 s desde caché; memoria del worker ≤ 40 MB; respeta `Save-Data` | Artefacto del job de sync + e2e (heap snapshot en Chromium) | M1/M4 |
| REN-12 | Hilo principal mientras se teclea | 0 *long tasks* > 50 ms durante la escritura en el buscador | Long Tasks API en el e2e de rendimiento | M1 |
| REN-13 | Carátulas | Nunca son el elemento LCP; `loading="lazy"`, `decoding="async"`, tamaño servido ≤ 2× el mostrado; *placeholder* sin red | Lighthouse + revisión | M1 |
| REN-14 | Listas largas | Con 5.000 entradas: filtrado local p95 ≤ 50 ms y *scroll* sin frames > 50 ms (virtualización) | e2e con un usuario «pesado» | M2 |
| REN-15 | Sincronización del catálogo | Incremental diaria ≤ 15 min; completa ≤ 3 h (límite duro de un job en runners alojados: 6 h) | Métrica `sync_run_duration_seconds` | M1 |

Reglas de diseño que salen de estos objetivos:

- buscar a partir de 2 caracteres (con 1 carácter, solo prefijos sobre «populares»);
- cancelar las peticiones obsoletas (`AbortController`);
- guardar en caché, en memoria, cada consulta normalizada;
- cachear en el CDN los resultados remotos, que no dependen del usuario;
- normalizar los nombres en el servidor al generar el índice, para que el cliente solo tenga que parsearlo.

### 1.2 Disponibilidad y fiabilidad

| ID | Requisito | Objetivo |
|---|---|---|
| DIS-01 | Frontend estático en CDN | ≥ 99,9 % mensual |
| DIS-02 | API | ≥ 99,5 % mensual en el prototipo (≈ 3,6 h de caída al mes), medido con un *uptime check* externo cada 5 min |
| DIS-03 | Núcleo usable sin API | Tras la primera carga, el 100 % de las operaciones de lista (ver, añadir, cambiar estado) funcionan sin red |
| DIS-04 | Steam fuera del camino crítico | 0 llamadas a Steam durante una petición de usuario. Si Steam cae, solo se resiente la frescura del catálogo |
| DIS-05 | Frescura del catálogo | Un juego nuevo aparece en ≤ 24 h (p95) desde que sale en la enumeración. Alerta si pasan > 36 h sin un sync correcto |
| DIS-06 | Fiabilidad del job | ≥ 95 % de ejecuciones programadas correctas al mes; se puede reanudar sin duplicados |
| DIS-07 | Datos de usuario (desde M3) | RPO ≤ 24 h (≤ 1 h si el proveedor ofrece PITR); RTO ≤ 8 h; simulacro de restauración cada trimestre |
| DIS-08 | Degradación | Ante un 429/5xx de la API: resultados locales, un aviso discreto y reintento con *backoff*. Nunca una pantalla en blanco |

### 1.3 Offline

| ID | Requisito |
|---|---|
| OFF-01 | El service worker precachea el *app shell*: tras la primera visita, la app abre sin red. |
| OFF-02 | La lista del usuario vive en IndexedDB y se puede leer y editar sin red. |
| OFF-03 | Las operaciones hechas sin red se guardan en una cola persistente (*outbox*) con un id de operación (UUID), así que reintentarlas no duplica nada. Desde M3, se sincronizan solas en ≤ 10 s al recuperar la red. |
| OFF-04 | Conflictos: gana la última escritura en cada campo (*last-writer-wins*), según su marca temporal. Las altas nunca se pierden (se unen). Se prueba con tests de propiedades aleatorias. |
| OFF-05 | Búsqueda sin red: completa si el índice local está descargado. Si no, busca en «populares» y en los juegos ya vistos, y permite el alta como **texto libre** (juego sin vincular), que se vincula a su appid más tarde. |
| OFF-06 | El estado de conexión y de sincronización se muestra con texto + icono (`aria-live="polite"`). |
| OFF-07 | Tras la primera alta se pide `navigator.storage.persist()`; si se deniega, se recuerda exportar la lista. Safari en iOS puede borrar el almacenamiento de una web no instalada tras 7 días sin interacción con ella: conviene instalar la PWA y dar prioridad a las cuentas (M3). |

### 1.4 Seguridad (resumen; detalle en §6)

| ID | Requisito | Objetivo |
|---|---|---|
| SEG-01 | Clave de Steam | 0 apariciones en el cliente, el repositorio, los logs o el error tracker (escaneo de secretos + regla específica + redacción) |
| SEG-02 | Transporte y cabeceras | HTTPS obligatorio + HSTS; CSP estricta; nota ≥ A en Mozilla HTTP Observatory |
| SEG-03 | Dependencias | Al publicar, 0 vulnerabilidades altas/críticas conocidas sin mitigar en las dependencias de producción; parches críticos en ≤ 7 días |
| SEG-04 | Verificación | OWASP ASVS 5.0 nivel 1 completo antes de abrir cuentas (M3) |
| SEG-05 | Abuso | Limitación de tasa en todos los endpoints públicos (valores en §6) |

### 1.5 Privacidad (RGPD / LOPDGDD) — bases que debe validar el track legal

| ID | Requisito |
|---|---|
| PRI-01 | **Minimización.** En M1 el servidor no guarda datos personales: la lista es local. Desde M3: email (o el identificador del proveedor de login) + lista + marcas temporales. Nada de fecha de nacimiento, ubicación ni contactos. |
| PRI-02 | **Base jurídica.** Ejecución del contrato (art. 6.1.b RGPD) para la cuenta y la lista; interés legítimo (art. 6.1.f) para seguridad y logs. Consentimiento solo si algún día hubiera cookies o analítica no esenciales; el objetivo es no necesitarlo. |
| PRI-03 | **Almacenamiento en el dispositivo.** IndexedDB y la caché del service worker se usan solo para la funcionalidad que pide el usuario, así que estarían exentos de consentimiento (art. 22.2 LSSI-CE, a confirmar). Sin cookies de terceros. |
| PRI-04 | **Derechos.** Exportación (JSON/CSV) y borrado de cuenta en autoservicio. El borrado se hace efectivo en la BD en ≤ 24 h y en las copias en ≤ 35 días (por rotación). Las solicitudes se responden en ≤ 1 mes (art. 12.3). Se guarda un registro de borrados para volver a aplicarlos tras una restauración. |
| PRI-05 | **Encargados del tratamiento** (hosting, BD, email, errores): contrato del art. 28 y, preferiblemente, en la UE/EEE. Si no, garantías adecuadas (cláusulas tipo o el marco de privacidad UE-EE. UU.). |
| PRI-06 | **Logs sin datos personales:** sin emails ni texto de búsquedas; IP truncada o con hash y sal rotatoria. Retención: logs ≤ 30 días; errores ≤ 90 días. |
| PRI-07 | **Edad mínima:** en España, 14 años para consentir (art. 7 LOPDGDD). Debe figurar en las condiciones. |
| PRI-08 | **Brechas:** procedimiento para notificar a la AEPD en ≤ 72 h (art. 33) y registro interno de incidentes. |
| PRI-09 | **Documentación:** un registro de actividades de tratamiento sencillo (art. 30) y una política de privacidad en español, por capas. |
| PRI-10 | **Privacidad desde el diseño** (art. 25): analítica sin cookies ni identificadores, sin *fingerprinting* y sin *session replay*. |

### 1.6 Accesibilidad (WCAG 2.2 AA)

| ID | Requisito |
|---|---|
| ACC-01 | WCAG 2.2 nivel AA en todos los flujos. |
| ACC-02 | El buscador sigue el patrón *combobox* de WAI-ARIA APG (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `listbox`/`option`). El número de resultados se anuncia con `aria-live="polite"`, agrupado para no saturar al lector de pantalla. |
| ACC-03 | Todo se puede usar con teclado. Un atajo global (p. ej. `/`) enfoca el buscador, `Enter` añade el resultado activo y `Esc` cierra. El foco siempre es visible (2.4.7) y nunca queda tapado (2.4.11). |
| ACC-04 | Objetivos táctiles ≥ 24×24 px CSS (2.5.8); 44×44 en las acciones principales. |
| ACC-05 | Si se puede reordenar arrastrando, hay alternativa sin arrastre (2.5.7): «subir / bajar / mover a…». |
| ACC-06 | Los estados (quiero jugar, jugando, completado, platinado, comprado) llevan texto o icono, además de color (1.4.1). Contraste 4,5:1 en texto y 3:1 en componentes (1.4.3, 1.4.11), también en modo oscuro. |
| ACC-07 | Autenticación accesible (3.3.8): sin pruebas cognitivas; se puede pegar y usar gestores de contraseñas; *magic link* o passkeys. |
| ACC-08 | *Reflow* a 320 px (1.4.10), zoom al 200 % (1.4.4), respeto de `prefers-reduced-motion` y `lang="es"`. Los nombres propios de juegos no necesitan marcado de idioma. |
| ACC-09 | **Medición:** axe-core en los e2e (0 violaciones *serious/critical*) y Lighthouse Accesibilidad ≥ 95. Revisión manual en cada hito con NVDA (Windows) y, antes de la beta, con TalkBack y VoiceOver. |

### 1.7 Internacionalización

| ID | Requisito |
|---|---|
| I18N-01 | es-ES por defecto desde M1; inglés en M4. Desde el primer día: 0 cadenas literales en los componentes (regla de lint) y mensajes ICU MessageFormat con claves estables. |
| I18N-02 | Formatos con `Intl` (fechas, plurales, listas). Ordenación con `Intl.Collator('es', { sensitivity: 'base' })`. |
| I18N-03 | **Normalización de búsqueda**, en este orden: (1) quitar ™ ℠ ® ©, **antes** de NFKD, porque NFKD convierte ™ en «TM»; (2) NFKD y eliminar diacríticos; (3) pasar a minúsculas; (4) eliminar apóstrofos (`Baldur's` → `baldurs`); (5) convertir el resto de signos en espacios. En M2 se añaden sinónimos: III ↔ 3, `&` ↔ and/y y acrónimos como GTA. |
| I18N-04 | El contenido de Steam se pide en español cuando existe (`l=spanish`), con el inglés como alternativa. Se guarda el idioma de cada campo. |
| I18N-05 | Pseudolocalización en CI (+35 % de longitud y acentos) para detectar textos cortados y cadenas sin externalizar. |
| I18N-06 | Las fechas se guardan en UTC (ISO 8601) y se muestran en la zona horaria del usuario (por defecto, Europe/Madrid). El idioma sale de la preferencia del usuario; si no la hay, de `navigator.languages`; y si no, español. |

### 1.8 Navegadores y dispositivos

| ID | Requisito |
|---|---|
| COM-01 | Lo que no tenga alternativa debe ser Baseline «Widely available». Lo «Newly available», solo como mejora progresiva. |
| COM-02 | Últimas 2 versiones estables de Chrome, Edge, Firefox (más la ESR vigente) y Safari en macOS. Safari en iOS/iPadOS: últimas 2 versiones mayores. Chrome Android y Samsung Internet: últimas 2. |
| COM-03 | Anchos de 320 a 2560 px; táctil, ratón y teclado; en vertical y en horizontal. |
| COM-04 | PWA instalable en Android y en Chrome/Edge de escritorio; «Añadir a pantalla de inicio» en iOS. |
| COM-05 | Steam Deck (navegador en modo escritorio): «mejor esfuerzo», sin navegación con mando en M1. |
| COM-06 | Matriz e2e: Chromium escritorio + móvil emulado en cada PR; WebKit y Firefox cada noche. |

### 1.9 Mantenibilidad, coste y escala

| ID | Requisito |
|---|---|
| MAN-01 | Cobertura ≥ 80 % (líneas y ramas) en `domain` y `steam-client`. Sin objetivo global, para no incentivar tests vacíos. |
| MAN-02 | CI de una PR ≤ 10 min (p90); tests unitarios en local ≤ 30 s. |
| MAN-03 | De clonar el repo a tener la app funcionando sin red con datos semilla: ≤ 10 min en Windows 11 con Node 24 (`npm run setup && npm run dev`). |
| MAN-04 | Coste ≤ 10 €/mes en el prototipo, con alerta de gasto. |
| MAN-05 | Escala de diseño: 1–1.000 usuarios; 250.000–500.000 títulos; hasta 5.000 entradas por usuario. |

## 2. Estrategia de pruebas

### 2.1 Niveles y herramientas

| Nivel | Qué cubre | Herramienta (marcador) | Dónde corre |
|---|---|---|---|
| Unitarias | Lógica pura: normalización, ranking, estados, fusión de sync, conversión de Steam al dominio | `<unit-runner>` (p. ej. Vitest o `node:test`; `cargo test` si el backend es Rust) | Local + cada PR |
| Integración (BD) | Migraciones, repositorios, consultas de búsqueda, *upserts* del catálogo, autorización por usuario | Motor real: SQLite en un fichero temporal, o PGlite en local / Postgres en contenedor de servicio en CI | Local + cada PR |
| Contrato | Respuestas grabadas de Steam validadas contra esquemas; contrato de nuestra API (OpenAPI) | `<schema-lib>` + `<http-mock>` (p. ej. MSW) | Local + cada PR (sin red) |
| E2E | Flujos reales en el navegador, incluidos «apuntar en < 3 s», sin red y solo con teclado | Playwright + `@axe-core/playwright` | PR (Chromium) / cada noche (matriz) |
| Rendimiento | Bench de búsqueda, Lighthouse CI, tamaño del bundle, carga de la API | `<bench-tool>`, `@lhci/cli`, `<size-check>`, `<load-tool>` | PR (si aplica) / cada noche / release |
| Manual | Lectores de pantalla, móvil real, pruebas exploratorias | Checklist por hito | Fin de hito |

### 2.2 Unitarias (casos obligatorios)

- **Normalización:**
  - `Pokémon™` → `pokemon`;
  - `Baldur's Gate 3` → `baldurs gate 3`;
  - `DARK SOULS™ III` → `dark souls iii` (el ™ se quita antes de NFKD);
  - caracteres de compatibilidad (`Ⅲ` → `iii`), caracteres de ancho completo y emojis.
- **Ranking:** coincidencia exacta > prefijo > inicio de palabra > subcadena; desempate por popularidad; orden estable.
- **Máquina de estados del juego (ADR-0010):** tests basados en propiedades que comprueban que ninguna secuencia de acciones deja un estado inválido. «Comprado» es independiente del progreso.
- **Fusión de sincronización:** las altas conmutan, gana la última escritura por campo y repetir una operación (mismo id) no cambia nada.
- **Escapado de consultas FTS** (comillas, `*`, `-`, `NEAR`, `AND`): lo que escriba el usuario no rompe ni manipula la consulta.

### 2.3 Integración con base de datos

- Cada *worker* de test usa una BD nueva (fichero temporal o esquema aleatorio), con las migraciones aplicadas desde cero en cada ejecución.
- Casos:
  - aplicar el sync dos veces deja el mismo estado (idempotencia);
  - un juego retirado de Steam se marca con `delisted_at` y **nunca** se borra si está en alguna lista;
  - búsqueda con acentos y signos;
  - restricción única (usuario, juego);
  - el usuario A no puede leer ni modificar la lista de B (IDOR);
  - reproducir la *outbox* no crea duplicados.
- Presupuesto: la suite de integración tarda ≤ 2 min en CI.

### 2.4 Contrato contra fixtures grabados de Steam (sin llamadas reales en CI)

1. **Grabación** (manual, en local): `npm run fixtures:record -- --appids=...`, con la clave en `.env.local`. Guarda una petición por fichero en `fixtures/steam/<endpoint>/<caso>.json` con:
   - `request`: la URL con `key=REDACTED`;
   - `recordedAt`, `status` y las cabeceras relevantes;
   - `body`.
2. **Autocomprobación:** el grabador falla si algún fichero contiene la clave o un parámetro `key` sin redactar. Además, el escáner de secretos tiene una regla para los fixtures.
3. **Casos mínimos:**
   - páginas pequeñas de la enumeración;
   - lotes de `GetItems` con:
     - juegos free-to-play, «próximamente» y con contenido adulto/verificación de edad;
     - nombres no latinos (japonés, chino) y nombres con ™/®;
     - DLC, demos y bandas sonoras (para probar los filtros);
     - distintos estados de Steam Deck;
     - appids inexistentes;
   - `appdetails` en español y en inglés;
   - respuestas sintéticas: 429 (con y sin `Retry-After`), 500, *timeout*, JSON malformado y lista vacía.
4. **Esquemas tolerantes:** solo los campos que consumimos. Los campos desconocidos se ignoran; los requeridos son estrictos. Los tests parsean todos los fixtures.
5. **Triple barrera contra la red real en CI:**
   - `STEAM_MODE=fixtures`: el cliente rechaza las llamadas reales;
   - `onUnhandledRequest: 'error'` en el mock HTTP;
   - `ci.yml` no tiene ningún secreto.
6. **Cambios de formato en Steam:** no se detectan en CI, sino en producción. El job de sync valida cada respuesta con los mismos esquemas, cuenta `schema_violations_total` y no publica si se supera el umbral (§5).
7. **Nuestra API:** la especificación OpenAPI es el contrato. Los tests de integración validan las respuestas contra ella, y el cliente del frontend se genera o se tipa a partir de ella.
8. **Pruebas de caos del job:** el pipeline completo con fixtures e inyección de fallos (ráfagas de 429, 5xx, cortes a mitad). Verifican el *backoff*, el checkpoint y la reanudación sin duplicados.

### 2.5 E2E con Playwright: «apuntar un juego en < 3 s»

**Entorno:** build de producción + servidor de preview + BD sembrada con el catálogo semilla. `STEAM_MODE=fixtures` y red externa bloqueada.

```ts
import { test, expect } from '@playwright/test';

test('apuntar un juego en menos de 3 s', async ({ page }) => {
  await page.goto('/');
  const buscador = page.getByRole('combobox', { name: 'Buscar juego' });
  await expect(buscador).toBeFocused();                          // se escribe sin tocar nada

  const t0 = Date.now();
  await buscador.pressSequentially('hollow', { delay: 100 });    // ritmo humano
  await expect(page.getByRole('option', { name: /Hollow Knight/ })).toBeVisible();
  await page.keyboard.press('Enter');                            // añade el resultado activo
  await expect(page.getByRole('status')).toContainText('Añadido a Quiero jugar');
  expect(Date.now() - t0).toBeLessThan(3000);

  const m = await page.evaluate(() =>
    Object.fromEntries(performance.getEntriesByType('measure').map(e => [e.name, e.duration])));
  expect(m['list:add-feedback']).toBeLessThan(100);
});
```

- **Proyectos de Playwright:**
  - `chromium` (escritorio);
  - `mobile-chromium` (Pixel emulado);
  - `perf`: Chromium con la CPU ralentizada ×4 (`Emulation.setCPUThrottlingRate`, vía CDP). Mide `search:keystroke-to-results` en 20 iteraciones y compara el p95 con REN-01/02.
- **Contra tests inestables:**
  - la aserción de tiempo usa la mediana de 5 ejecuciones;
  - las latencias del sistema se leen de `performance.measure`, no de los relojes del test;
  - el proyecto `perf` no reintenta.
- **Otros e2e de M1:**
  - alta con un toque en móvil;
  - «Deshacer»;
  - alta sin red (`context.setOffline(true)`) y persistencia tras recargar;
  - flujo completo solo con teclado;
  - escaneo con axe en cada pantalla.

### 2.6 Rendimiento

- **Bench de búsqueda en CI** (en las PR que tocan `search/**` y cada noche). Usa un dataset sintético determinista (250.000 títulos, semilla 42) y el catálogo semilla real. Falla si:
  - en el runner, se supera alguno de estos topes absolutos: escaneo completo p95 > 20 ms, pulsaciones incrementales p95 > 5 ms o consulta a la BD p95 > 10 ms;
  - o empeora > 20 % frente a la línea base de `main`, medida en el mismo job.
- **Golden set de relevancia:** unas 50 consultas, cada una con su appid esperado (p. ej. `elden` → ELDEN RING, `hollow kn` → Hollow Knight, `witcher 3`, `baldurs`). Objetivo: top-3 ≥ 95 % y top-1 ≥ 80 %.
- **Lighthouse CI** en cada PR (perfil móvil, 3 ejecuciones, mediana):

```json
{
  "ci": {
    "collect": { "staticDistDir": "<ruta-dist-web>", "numberOfRuns": 3 },
    "assert": {
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.9 }],
        "categories:accessibility": ["error", { "minScore": 0.95 }],
        "categories:best-practices": ["warn", { "minScore": 0.95 }],
        "first-contentful-paint": ["error", { "maxNumericValue": 1800 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 2500 }],
        "total-blocking-time": ["error", { "maxNumericValue": 200 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.1 }]
      }
    },
    "upload": { "target": "filesystem", "outputDir": ".lighthouseci" }
  }
}
```

- **Tamaño:** en cada PR se comprueban los bytes comprimidos por *chunk* (JS inicial ≤ 100 KB gzip) y se comenta la diferencia en la PR.
- **Carga de la API** (antes de la beta): 50 peticiones/s a `/api/search` durante 5 min. Objetivo: p95 de servidor ≤ 50 ms y 0 % de errores. Se usa una herramienta instalable con npm (p. ej. autocannon) para no depender de binarios.
- **RUM:** `web-vitals` (LCP, INP, CLS, TTFB) + medidas propias, enviadas a un endpoint propio anónimo. Paneles semanales de p75.

### 2.7 Datos de prueba

| Conjunto | Contenido | ¿Se versiona? |
|---|---|---|
| `fixtures/steam/` | Respuestas reales grabadas y redactadas (≤ 300 apps, ≤ 2 MB) | Sí (si el repo es público, revisarlo con el track legal) |
| `fixtures/catalog/seed.jsonl` | Catálogo semilla normalizado (~300 juegos: populares + casos límite), generado por script a partir de los fixtures | Sí |
| Sintético grande | 250.000–500.000 títulos deterministas (con semilla) para el bench | No: se genera y se cachea en CI |
| Usuarios y listas | Factorías; usuario demo (~30 entradas en varios estados); usuario «pesado» (5.000 entradas) | En el código |
| Producción | Nunca se copian datos de producción a otros entornos | — |

### 2.8 Puertas de calidad

| Momento | Comprobaciones | ¿Bloquea? |
|---|---|---|
| Pre-commit (local) | Formato + lint de los ficheros modificados; mensaje de commit | No (la autoridad es el CI) |
| Cada PR | Formato, lint, tipos, unitarias + cobertura, integración, contrato, build, tamaño, e2e en Chromium (escritorio + móvil) con axe, Lighthouse CI, bench (si aplica), escaneo de secretos, auditoría de dependencias de producción y título en Conventional Commits | Sí |
| Merge a `main` | Lo anterior + despliegue a preview/staging + *smoke test* | El despliegue |
| Cada noche | Matriz e2e (Chromium, WebKit, Firefox), bench con histórico, análisis estático de seguridad y, una vez por semana, `setup` + `check` en `windows-latest` | No: abre una incidencia |
| Release | Todo en verde + checklist manual (NVDA, móvil real) + backup verificado | Sí |

## 3. Herramientas y convenciones

### 3.1 Estructura del repositorio (opciones)

**Opción A — monorepo TypeScript con npm workspaces** (sin instalar pnpm):

```
gameagenda/
├─ apps/
│  ├─ web/            # <frontend> PWA
│  ├─ api/            # <backend> HTTP (si no es full-stack)
│  └─ catalog-sync/   # CLI del job de catálogo
├─ packages/
│  ├─ domain/         # tipos, estados, normalización y ranking (sin E/S)
│  ├─ steam-client/   # cliente HTTP + esquemas + grabador de fixtures
│  ├─ db/             # esquema, migraciones, repositorios, seed
│  └─ config/         # tsconfig/lint compartidos
├─ fixtures/{steam,catalog}/
├─ docs/adr/
├─ scripts/           # setup, dev, bench… en TypeScript (Node 24 ejecuta .ts)
└─ .github/workflows/
```

**Opción B — dos lenguajes:**
- workspace de Cargo (`crates/api`, `crates/catalog-sync`, `crates/domain`, `crates/steam-client`) + `apps/web` en npm;
- contrato por OpenAPI generado desde Rust, con el cliente TS generado a partir de él;
- scripts raíz de npm que invocan `cargo`.

A favor: un binario único y eficiente para el job. En contra: dos toolchains y compilaciones más lentas para un solo desarrollador.

**Opción C — una sola app full-stack** (`<meta-framework>` con rutas de servidor) + `jobs/catalog-sync` + la carpeta `src/domain`. Es la de menos ceremonia; se parte en paquetes (opción A) cuando empiece a costar.

**Recomendación:** empezar por C (o una A reducida), con dos reglas vigiladas por lint:
- `domain` no importa nada de E/S;
- solo `catalog-sync` y `steam-client` pueden leer `STEAM_WEB_API_KEY`.

Turborepo y Nx no hacen falta al principio.

### 3.2 Lint, formato y tipos

- **Lint + formato con una sola herramienta.** Dos opciones (se decide en ADR-0013):
  - Biome: rápido, un único binario instalable con npm;
  - ESLint (config *flat*) + typescript-eslint + Prettier, si hacen falta plugins de accesibilidad o i18n (p. ej. para prohibir literales en JSX).
- **Rust**, si se usa: `rustfmt` + `clippy -D warnings` + `cargo deny`.
- **TypeScript estricto:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax` y `erasableSyntaxOnly`. Esta última permite ejecutar scripts `.ts` directamente: Node 24.21 trae el *type stripping* activo (verificado). En CI, `tsc --noEmit`.
- **Validación en tiempo de ejecución en las fronteras** (respuestas de Steam, entradas de la API y variables de entorno al arrancar) con `<schema-lib>`. Los tipos se infieren del esquema.
- **Ficheros de configuración:** `.editorconfig`; `.gitattributes` con `* text=auto eol=lf`; formateador con `endOfLine: lf`.
- **Hooks de git ligeros** (`lefthook` o `simple-git-hooks`) para el formato y `commitlint`.

### 3.3 Commits, ramas y PRs

- **Conventional Commits 1.0:** `tipo(ámbito): descripción`.
  - Tipos: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `revert`.
  - Ámbitos: `web`, `api`, `sync`, `steam`, `search`, `domain`, `db`, `ui`, `i18n`, `a11y`, `ci`, `deps`.
  - Cambio incompatible: `!` o el pie `BREAKING CHANGE:`.
  - Propuesta: tipo y ámbito en inglés, descripción en español (`feat(search): añade refinamiento incremental en el worker`).
- **Trunk-based:** `main` siempre se puede desplegar. Ramas cortas (`feat/…`, `fix/…`, ≤ 2 días). El trabajo incompleto va detrás de *feature flags* sencillas (config + variable de entorno), que se retiran tras publicar.
- **Siempre PR**, aunque se trabaje solo: lanza los checks y deja rastro.
  - Plantilla con la Definition of Done.
  - *Squash merge*, con el título de la PR validado como Conventional Commit.
  - Regla de rama en `main`: PR obligatoria (0 aprobaciones), checks requeridos, historial lineal y sin *force-push*.
- **Gestión del trabajo:** GitHub Issues + un Project (kanban) con etiquetas de tipo, área y prioridad, y milestones M1–M6.

### 3.4 ADR (formato MADR en `docs/adr/NNNN-titulo.md`)

| ADR | Decisión | Necesaria para |
|---|---|---|
| 0001 | Registrar las decisiones con ADR (MADR) | M1 |
| 0002 | Plataforma: PWA pensada para móvil vs escritorio (Tauri) vs nativa | M1 |
| 0003 | Stack y lenguaje: TS full-stack vs backend Rust; estructura del repo | M1 |
| 0004 | Base de datos y motor de búsqueda: SQLite FTS5 vs Postgres (`pg_trgm`/FTS) vs motor dedicado | M1 |
| 0005 | Estrategia de búsqueda: índice local vs remota vs híbrida (con los datos de §0.3) | M1 |
| 0006 | Ingesta del catálogo: job programado, incremental/completo, idempotencia, 429, publicación atómica, snapshot vs escritura directa | M1 |
| 0007 | *Local-first* y sincronización: IndexedDB, *outbox*, LWW, migración de los datos locales a la cuenta | M1 (local) / M3 |
| 0008 | Autenticación y sesiones (magic link, passkeys, OAuth, Steam OpenID) | M3 |
| 0009 | Hosting, entornos y presupuesto | M1 |
| 0010 | Modelo de estados: quiero jugar / jugando / completado / platinado / abandonado, con «comprado» independiente | M2 |
| 0011 | Observabilidad y analítica respetuosas con la privacidad | M1 |
| 0012 | Imágenes: *hotlink* al CDN de Steam vs proxy/caché propio (legal + rendimiento + CSP) | M1 |
| 0013 | Convenciones: lint/formato, commits, versionado, idioma del código y de la documentación | M1 |
| 0014 | Identidad de juego multiplataforma: `game_id` interno + identificadores externos (hoy el appid de Steam; luego, otras plataformas) | M1 (modelo) / M5 |

### 3.5 Definition of Done

- [ ] Criterios de aceptación cumplidos y demostrados en el entorno de preview.
- [ ] Tests: unitarios para la lógica, de integración si toca la BD y e2e si toca el flujo principal. CI en verde.
- [ ] Lint, formato y tipos limpios; ningún `any`/`unsafe` nuevo sin justificar.
- [ ] Presupuestos respetados: tamaño, Lighthouse CI y bench (sin regresiones > 20 %).
- [ ] Accesibilidad: teclado, etiquetas, 0 violaciones axe *serious/critical* y contraste.
- [ ] i18n: sin cadenas literales; mensajes en español completos.
- [ ] Seguridad: entradas validadas, autorización comprobada, sin secretos y dependencias nuevas revisadas (licencia, mantenimiento, *scripts* de instalación).
- [ ] Observabilidad: logs y errores en los nuevos caminos de fallo; métricas, si es un job.
- [ ] Documentación: README y ADR al día; notas de migración si cambia el esquema.
- [ ] Desplegado (o detrás de un *flag*) y *smoke test* superado.

### 3.6 Versionado, releases y changelog

- **SemVer `0.x` durante el prototipo:** cada hito publica una versión menor (M1 = `0.1.0` … M5 = `0.5.0`). `1.0.0` llega con la beta pública y un formato de exportación estable.
- ***release-please* en GitHub Actions:**
  - mantiene una PR de release, sube la versión y etiqueta `vX.Y.Z`;
  - genera `CHANGELOG.md` a partir de los commits, con secciones en español: `feat` → «Novedades», `fix` → «Correcciones», `perf` → «Rendimiento»;
  - oculta `docs`, `chore` y `ci`.
- **Trazabilidad:** la versión + SHA se ven en `/api/health` y en «Acerca de». El error tracker usa el mismo identificador de release, con los *source maps*.
- **Versionado de datos:**
  - migraciones de BD numeradas y solo hacia delante (*expand/contract*);
  - versión del esquema de IndexedDB, con tests de migración;
  - formato del índice del cliente versionado (`catalog-index.v1`).

### 3.7 Dependencias y cadena de suministro

- **Dependabot** (npm, GitHub Actions y, si aplica, Cargo): semanal y agrupado, con un *cooldown* de 3–7 días para las versiones recién publicadas. *Auto-merge* de los parches de `devDependencies` si el CI está en verde.
- **Reproducibilidad:** `package-lock.json` versionado, `npm ci` en CI, `engines` + `.node-version` (24.x; valorar la siguiente LTS según el track de versiones).
- **Scripts de instalación:** valorar `ignore-scripts=true` en `.npmrc`. Es viable si no hay módulos nativos, y `node:sqlite` evita uno.
- **Acciones y licencias:** acciones de terceros fijadas por SHA. Licencias permitidas: MIT, Apache-2.0, BSD e ISC; revisar GPL/AGPL.

## 4. CI/CD en GitHub Actions

### 4.1 Workflows

| Workflow | Disparador | Propósito | Secretos |
|---|---|---|---|
| `ci.yml` | `pull_request`, `push` a `main` | Puertas de calidad (§2.8) | Ninguno |
| `nightly.yml` | `schedule` diario + `workflow_dispatch` | Matriz e2e, bench con histórico, análisis de seguridad, Windows semanal | Ninguno |
| `deploy.yml` | `push` a `main` → preview/staging; `release: published` → producción | Build, migraciones, despliegue, *smoke test* | Entornos `staging` / `production` |
| `catalog-sync.yml` | `schedule` diario + `workflow_dispatch` | Sincronizar el catálogo y publicar el índice | Entorno `catalog-sync` |
| `release-please.yml` | `push` a `main` | PR de release, tags y CHANGELOG | `GITHUB_TOKEN` con permisos mínimos |

### 4.2 `ci.yml` (esqueleto)

```yaml
name: ci
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
env:
  STEAM_MODE: fixtures            # el cliente de Steam rechaza llamadas reales
jobs:
  checks:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: .node-version, cache: npm }
      - run: npm ci
      - run: npm run format:check && npm run lint && npm run typecheck
      - run: npm run test:unit -- --coverage
      - run: npm run test:integration && npm run test:contract
      - run: npm run build && npm run size
      - uses: actions/upload-artifact@<sha>
        with: { name: web-dist, path: <ruta-dist-web>, retention-days: 7 }
  e2e:
    needs: checks
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: .node-version, cache: npm }
      - run: npm ci
      - uses: actions/cache@<sha>
        with:
          path: ~/.cache/ms-playwright
          key: pw-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e -- --project=chromium --project=mobile-chromium
      - run: npm run lhci
  secret-scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
        with: { fetch-depth: 0 }
      - run: <escáner de secretos, p. ej. gitleaks, con regla propia para la clave de Steam>
```

### 4.3 Despliegue

- **Frontend:** *assets* con hash e `immutable` en el CDN; `index.html` y el service worker, sin caché larga.
- **API:** despliegue sin cortes gestionado por la plataforma. Las migraciones son un paso previo y deben ser compatibles con la versión anterior (*expand/contract*).
- **Preview por PR**, con datos semilla (nunca de producción), para revisarla a mano. Lighthouse y los e2e de las PR corren contra el build local, que es más determinista.
- **Producción:** se despliega al publicar una release. *Rollback* = volver a desplegar el artefacto anterior (retención ≥ 7 días). La BD solo va hacia delante y se protege con backups.
- **Credenciales de despliegue:** OIDC de GitHub hacia el proveedor cuando lo soporte; si no, tokens con alcance mínimo en el entorno que corresponda.

### 4.4 `catalog-sync.yml` (job programado con secretos)

```yaml
name: catalog-sync
on:
  schedule:
    - cron: '17 5 * * *'           # 05:17, lejos del minuto 0 (menos retrasos)
      timezone: 'Europe/Madrid'    # GitHub admite zonas IANA
  workflow_dispatch:
    inputs:
      mode: { type: choice, options: [incremental, full], default: incremental }
      dry_run: { type: boolean, default: false }
permissions:
  contents: read
  issues: write                    # abrir o actualizar una incidencia si falla
concurrency:
  group: catalog-sync
  cancel-in-progress: false        # nunca dos sincronizaciones a la vez
jobs:
  sync:
    runs-on: ubuntu-latest
    environment: catalog-sync      # solo este entorno ve la clave
    timeout-minutes: 180
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: .node-version, cache: npm }
      - run: npm ci
      - name: Sincronizar catálogo
        env:
          STEAM_MODE: live
          STEAM_WEB_API_KEY: ${{ secrets.STEAM_WEB_API_KEY }}
          CATALOG_TARGET_URL: ${{ secrets.CATALOG_TARGET_URL }}
          HEARTBEAT_URL: ${{ secrets.HEARTBEAT_URL }}
          MODE: ${{ inputs.mode || 'incremental' }}      # vía env: evita inyección en el script
          DRY_RUN: ${{ inputs.dry_run || false }}
        run: npm run catalog:sync -- --mode="$MODE" --dry-run="$DRY_RUN"
      - if: always()
        uses: actions/upload-artifact@<sha>
        with: { name: sync-report, path: sync-report.json, retention-days: 14 }
      - if: failure()
        env: { GH_TOKEN: '${{ github.token }}' }
        run: <crear o comentar la incidencia abierta con etiqueta catalog-sync>
```

Comportamiento del job (verificado con las pruebas de caos de §2.4):

- **Etapas:**
  1. enumerar (con la clave);
  2. calcular las diferencias;
  3. enriquecer por lotes;
  4. validar los esquemas;
  5. *upsert* idempotente por lotes;
  6. generar el snapshot y el índice;
  7. aplicar los guardarraíles;
  8. publicar de forma atómica (puntero `catalog_version`);
  9. enviar métricas, *heartbeat* y un resumen a `$GITHUB_STEP_SUMMARY`.
- **Ritmo y reintentos:**
  - ritmo prudente (S3) y respeto de `Retry-After`;
  - *backoff* exponencial con *jitter* (de 1 s a 60 s, máximo 6 reintentos);
  - el ritmo baja solo ante respuestas 429;
  - un cortacircuitos aborta, guardando el checkpoint, tras 20 fallos seguidos o > 10 % de 429.
- **Checkpoint por lote:** si se acaba el tiempo, la siguiente ejecución continúa donde se quedó. Así, la primera carga completa puede repartirse entre varias ejecuciones.
- **Guardarraíles.** No se publica si:
  - el catálogo encoge > 5 % respecto a la versión anterior;
  - `apps_failed` > 1 %;
  - o `schema_violations` > 0,5 %.
- **Desacoplamiento recomendado:** el job publica un **snapshot versionado** (y el índice del cliente) en un almacenamiento de objetos, y el backend lo importa. La alternativa es escribir directamente con un rol limitado a las tablas del catálogo y TLS. En los dos casos, la API nunca necesita la clave de Steam.
- **Limitaciones de `schedule`** (documentación de GitHub, consultada hoy):
  - el intervalo mínimo es de 5 min;
  - con carga alta puede retrasarse (sobre todo al inicio de cada hora) y algún job puede descartarse;
  - solo corre en la rama por defecto;
  - en repos **públicos** se desactiva tras 60 días sin actividad.

  Mitigación: *heartbeat* con alerta a las 36 h y ejecución manual con `workflow_dispatch`.

### 4.5 Caché

- `actions/setup-node` con `cache: npm` (la clave es el hash del lockfile).
- Navegadores de Playwright (`~/.cache/ms-playwright`), por versión del lockfile.
- Dataset sintético del bench, por hash del generador.
- Rust (si se usa): caché de `target` y del registro de Cargo.
- Nunca se cachean secretos ni artefactos con datos de usuarios. Cuota de caché: 10 GB por repositorio.

### 4.6 Entornos

| Entorno | Datos | Secretos | Despliegue |
|---|---|---|---|
| `local` | Semilla (fixtures) | `.env.local` (no versionado) | `npm run dev` |
| CI (efímero) | Semilla + sintético | Ninguno | — |
| `preview` (por PR, opcional) | Semilla | Token de despliegue de preview | Automático |
| `staging` (desde M3) | Catálogo real + usuarios sintéticos | Los suyos | Merge a `main` |
| `production` | Reales | Los suyos | Release publicada |
| `catalog-sync` | — | Clave de Steam, destino del snapshot, *heartbeat* | Programado |

### 4.7 Gestión de secretos

| Secreto | Dónde vive | Quién lo usa | Rotación |
|---|---|---|---|
| `STEAM_WEB_API_KEY` | Secreto del entorno `catalog-sync` + `.env.local` del desarrollador (solo para grabar fixtures) | Job de sync y grabador | Anual, o inmediata ante sospecha (revocar y regenerar en la página de claves de Steam) |
| `CATALOG_TARGET_URL` / token de subida | Entorno `catalog-sync` | Job de sync | Semestral |
| Credenciales de BD de la app | Gestor de secretos del hosting (no en GitHub) | API | Semestral |
| Claves de sesión / firma de enlaces (M3) | Gestor de secretos del hosting, con `kid` para rotar sin cortes | API | Semestral |
| Tokens de despliegue | Entornos `staging`/`production` (mejor OIDC) | `deploy.yml` | Según el proveedor |

Reglas:

1. **La clave de Steam nunca aparece en el cliente ni en el repositorio.**
   - El build del frontend no tiene acceso a ningún secreto y solo expone variables con prefijo público (`PUBLIC_*`) que estén en una lista blanca.
   - Una regla de lint prohíbe leer `STEAM_*` fuera de `steam-client` y `catalog-sync`.
2. **Ficheros `.env*`:** ignorados en git, salvo `.env.example`.
3. **Redacción:** el cliente de Steam redacta `key=` en los logs, en los errores y en los *breadcrumbs* HTTP del error tracker (`beforeSend`/`beforeBreadcrumb`).
4. **Workflows:**
   - ningún workflow de PR recibe secretos;
   - prohibido usar `pull_request_target` haciendo *checkout* del código de la PR;
   - las entradas de `workflow_dispatch` se pasan por `env`, nunca interpoladas en `run`.
5. **Escaneo de secretos** en *pre-commit* y en CI, con una regla propia para el formato de la clave de Steam. *Push protection* de GitHub si el repo es público.
6. **Procedimiento escrito para una clave filtrada:**
   1. revocarla;
   2. regenerarla;
   3. `gh secret set STEAM_WEB_API_KEY --env catalog-sync`;
   4. purgar el historial si llegó al repo;
   5. registrar el incidente.

### 4.8 Repositorio público o privado (afecta a CI/CD)

Datos consultados hoy en la documentación de GitHub:

| Función | Público (Free) | Privado (Free) | Privado (Pro) |
|---|---|---|---|
| Minutos de Actions en runners estándar | Gratis | 2.000/mes (Linux 0,006 USD/min; Windows 0,010 USD/min) | 3.000/mes |
| Secretos de entorno | Sí | **No** (solo secretos de repositorio) | Sí |
| Restringir un entorno a `main` (*deployment branches*) | Sí | No | Sí |
| Revisores obligatorios / temporizador de espera | Sí | No | No |
| Desactivación de `schedule` tras 60 días sin actividad | Sí | No | No |

**Recomendación:**
- **Público**, si el código puede ser abierto: los entornos, los minutos y los escaneos son gratis. Hay que revisar con el track legal los fixtures con datos de Steam.
- **Privado con GitHub Pro**, si no, para tener secretos por entorno.
- En **privado Free**, la clave quedaría como secreto de repositorio, al alcance de cualquier workflow de cualquier rama. Es un riesgo asumible para un solo desarrollador, pero peor.

## 5. Observabilidad

### 5.1 Logs estructurados

JSON de una línea, enviado a `stdout` con un `<logger>` estructurado.

- **Campos comunes:** `ts`, `level`, `service` (`web`/`api`/`catalog-sync`), `env`, `version`, `request_id` (o `traceparent` W3C), `msg`, `duration_ms`.
- **Nunca:** emails, tokens, la clave, el texto de las búsquedas ni la IP completa. La IP va truncada o con hash y sal rotatoria; el usuario, como `user_ref` seudonimizado.

```json
{"ts":"2026-10-28T05:21:42.120Z","level":"info","service":"catalog-sync","env":"production","version":"0.1.0+3f2c1ab","run_id":"r-20261028-0517","msg":"batch_enriched","batch":118,"apps":200,"duration_ms":842,"http_status":200,"retries":0}
```

Retención ≤ 30 días, con un proveedor en región UE cuando sea posible.

### 5.2 Errores

`<error-tracker>` en la web, la API y el job. Por ejemplo, Sentry con región UE, o GlitchTip, compatible con sus SDK. Configuración:

- release = versión + SHA, con los *source maps* subidos;
- `sendDefaultPii: false` y las URLs con `key=` depuradas;
- sin *session replay*;
- muestreo de rendimiento del 10 %.

### 5.3 Métricas

- **API (RED: peticiones, errores, duración):** por ruta; p50/p95/p99 de `/api/search`; ratio de aciertos de caché; respuestas 429 emitidas.
- **Cliente (RUM):** LCP, INP, CLS y TTFB; `search_latency_ms` (local/remota), `add_feedback_ms` y `time_to_add_ms`; tamaño y antigüedad de la *outbox*; uso sin red.
- **Job de catálogo:** fila en la tabla `sync_runs` + `sync-report.json` + resumen del job + ping de *heartbeat*:

| Métrica | Descripción |
|---|---|
| `sync_run_duration_seconds` | Duración total y por etapa |
| `sync_status` | `ok` / `partial` / `failed` / `aborted` |
| `apps_listed_total` | Appids devueltos por la enumeración |
| `apps_new_total` / `apps_updated_total` / `apps_delisted_total` | Diferencias aplicadas |
| `apps_enriched_total` | Apps enriquecidas por lotes |
| `apps_failed_total{reason}` | Por `schema_invalid`, `http_5xx`, `timeout` o `not_found` |
| `http_requests_total{endpoint,status}` | Peticiones a Steam |
| `http_429_total`, `retries_total`, `backoff_seconds_total` | Presión de los límites |
| `schema_violations_total{field}` | Cambios en el formato de Steam |
| `catalog_size{type}` | Tamaño publicado (y variación frente al anterior) |
| `index_bytes{tier}` | Tamaño del índice del cliente publicado |
| `last_success_timestamp` | Base de la alerta de frescura |

### 5.4 Alertas (pocas y accionables)

| Alerta | Condición | Severidad | Canal |
|---|---|---|---|
| Sync ausente | Sin *heartbeat* correcto en 36 h | Alta | Email + push |
| Sync fallido | Job en `failure` o `status=failed` | Media | Incidencia automática + email |
| Sync degradado | `apps_failed` > 1 %, `schema_violations` > 0,5 % o > 50 respuestas 429 por ejecución | Media | Email |
| Catálogo encoge | Tamaño < 95 % del anterior → no se publica | Alta | Email + incidencia |
| API caída | 2 fallos seguidos del *uptime check* (cada 5 min) | Alta | Push |
| Errores 5xx | > 2 % durante 10 min | Media | Email |
| Rendimiento | p95 de servidor de la búsqueda > 50 ms durante 15 min; INP p75 > 200 ms o LCP p75 > 2,5 s en 7 días | Baja | Resumen semanal |
| Errores nuevos | Incidencia nueva con ≥ 10 eventos/h | Media | Email |
| Seguridad / coste | Alerta crítica de dependencias; gasto > 80 % del presupuesto | Alta / Media | Email |

Un único panel de «salud del producto» reúne:
- disponibilidad y errores;
- p95 de la búsqueda y Web Vitals p75;
- último sync (estado, hora, cifras);
- evolución del tamaño del catálogo.

### 5.5 Analítica respetuosa con la privacidad

- **Sin cookies, sin identificadores persistentes y sin terceros de *tracking*.** Dos opciones: un endpoint propio de eventos agregados, o una herramienta sin cookies alojada en la UE o autoalojada (p. ej. Plausible, Umami, GoatCounter). Se respeta la señal GPC.
- **Eventos:**
  - `game_added`: `source` (search/free_text/import), `search_mode` y `time_to_add_ms` en tramos;
  - `game_status_changed`: `from`, `to`;
  - `search_no_results`: `q_len`. El texto de la consulta no se guarda salvo decisión explícita;
  - `web_vitals`.
- **KPI:**
  - ≥ 90 % de altas en < 3 s;
  - mediana de `time_to_add_ms`;
  - búsquedas sin resultados ≤ 5 %;
  - retención semanal.

## 6. Checklist de seguridad (OWASP ASVS 5.0, nivel 1 — selección)

**Autenticación (M3)**
- [ ] Sin contraseñas propias si es posible: *magic link* de un solo uso (token aleatorio ≥ 128 bits, guardado con hash, caduca en 15 min) y/o passkeys. OAuth o Steam OpenID, según ADR-0008.
- [ ] Si hubiera contraseñas: longitud mínima conforme a ASVS 5.0, comprobación contra contraseñas filtradas y hash con Argon2id o equivalente.
- [ ] Respuestas genéricas (sin revelar si una cuenta existe) y limitación de tasa por email e IP.

**Sesión**
- [ ] Cookie `__Host-` con `Secure`, `HttpOnly`, `SameSite=Lax` y `Path=/`. Identificador opaco ≥ 128 bits, guardado con hash en el servidor.
- [ ] Rotación al iniciar sesión; invalidación en el servidor al cerrarla; caducidad por inactividad y absoluta; opción «cerrar todas las sesiones».

**CSRF y CORS**
- [ ] Ningún cambio de estado por GET. Los métodos que cambian estado exigen `Content-Type: application/json` y un `Origin`/`Sec-Fetch-Site` del propio sitio (más un token, si algún día hay formularios clásicos).
- [ ] API en el mismo origen (`/api`) para no necesitar CORS. Si no puede ser, lista blanca explícita y nunca `*` con credenciales.

**Cabeceras y CSP**
- [ ] CSP inicial, primero en modo `Report-Only`: `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: <hosts-CDN-Steam>; connect-src 'self' <analítica> <error-tracker>; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests`, más `report-to`. Trusted Types, como mejora progresiva.
- [ ] HSTS (1 año, `includeSubDomains`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` mínima y `Cross-Origin-Opener-Policy: same-origin`.

**Limitación de tasa de nuestra API.** Cubeta de tokens que responde 429 + `Retry-After`; el cliente pasa a los resultados locales.
- [ ] `GET /api/search`: 10 peticiones/s sostenidas y ráfagas de 30 por IP/sesión; respuestas cacheables en el CDN.
- [ ] Escrituras en la lista: 60/min y 600/h por usuario.
- [ ] Autenticación: 5 cada 15 min por email y 20/h por IP.
- [ ] Límite global de 1.000 peticiones/min por IP; cuerpo JSON ≤ 16 KB.

**Validación de entrada y salida**
- [ ] Esquema en todas las entradas, rechazando campos desconocidos:
  - `q`: 1–100 caracteres, sin caracteres de control;
  - `appid`: entero positivo;
  - `status`: enumerado;
  - notas: ≤ 2.000 caracteres de texto plano;
  - paginación: ≤ 50.
- [ ] Siempre consultas parametrizadas, y la sintaxis FTS escapada (cada término entre comillas).
- [ ] Los datos de Steam son **entrada no confiable**. Sus descripciones contienen HTML: se sanean con lista blanca en la ingesta o se muestran como texto. Nunca `innerHTML`.
- [ ] Autorización en cada consulta, por el `user_id` de la sesión (con tests de IDOR).

**Dependencias y código**
- [ ] Alertas y actualizaciones de seguridad de Dependabot.
- [ ] Puertas: `npm audit --omit=dev --audit-level=high`; revisión de dependencias en las PR, si el plan lo permite; `cargo audit`/`cargo deny`, si hay Rust.
- [ ] Análisis estático: CodeQL si el repo es público; si no, Semgrep (edición comunitaria).
- [ ] Escaneo de secretos en *pre-commit* y en CI.

**Backups y recuperación (desde M3)**
- [ ] Backups automáticos diarios (+ PITR, si existe) y un volcado lógico semanal cifrado, guardado en otra cuenta o proveedor. Retención: 7 diarios + 4 semanales (≈ 35 días, coherente con PRI-04).
- [ ] Simulacro de restauración cada trimestre, midiendo el RTO. Tras restaurar, se vuelve a aplicar el registro de borrados RGPD.
- [ ] El catálogo se puede reconstruir desde Steam; se conservan las últimas 7 versiones publicadas para hacer *rollback*.

**Operación**
- [ ] Log de eventos de seguridad (inicios de sesión, enlaces solicitados, 429, informes CSP), sin datos sensibles.
- [ ] Modelo de amenazas STRIDE de una página por hito; `/.well-known/security.txt`.
- [ ] Mensajes de error sin trazas en producción; variables de entorno validadas al arrancar.

## 7. Desarrollo local en esta máquina (sin Docker)

### 7.1 Estado verificado hoy

- **Instalado:**
  - Node v24.21.0, con *type stripping* (`process.features.typescript = "strip"`); npm 11.19.0; git 2.56.0.windows.2;
  - `node:sqlite` incluido: SQLite 3.53.4 con FTS5 y el tokenizer `trigram` (`remove_diacritics`), sin flag ni avisos;
  - Rust 1.99.0 (`x86_64-pc-windows-msvc`) con Visual Studio 2022 Build Tools (C++), así que compila crates nativos;
  - `winget`, Chrome y Edge.
- **No instalado:** Docker, PostgreSQL (`psql`), la CLI `sqlite3`, `gh`, pnpm y bun. El `python.exe` de `WindowsApps` es solo el alias de Microsoft Store, no un intérprete.
- **Equipo:** CPU AMD Ryzen 5 3600 (6 núcleos/12 hilos), 16 GB de RAM.
- **Carpeta del proyecto:** vacía.

### 7.2 Qué instalar según la opción

| Opción | Instalación adicional | Notas |
|---|---|---|
| A. TS full-stack + SQLite (`node:sqlite`) | **Nada** obligatorio. Opcional: `winget install SQLite.SQLite` (CLI) | El arranque más rápido. En producción, SQLite en disco persistente o una variante gestionada (ADR-0009) |
| B. TS + PostgreSQL | Nada para dev/test si se usa PGlite (Postgres en WASM, paquete npm; comprobar extensiones como `pg_trgm`). Opcional: PostgreSQL nativo con `winget install PostgreSQL.PostgreSQL.<mayor>` (hoy, hasta la 18) | En CI, contenedor de servicio `postgres` en `ubuntu-latest`. Riesgo: diferencias entre PGlite y Postgres real (se cubren con integración en CI) |
| C. Backend Rust + web TS | Nada: Rust y MSVC ya están. Opcional: `cargo install cargo-watch` o `bacon`; `sqlx-cli` si se usa SQLx | Compilaciones más lentas en Windows; cachear `target` en CI |
| D. Motor de búsqueda dedicado | Meilisearch tiene binario nativo para Windows; Typesense requiere WSL o Docker | No recomendado en M1: FTS5, `pg_trgm` o el índice del cliente bastan (§0.3) |
| Común a todas | `npx playwright install chromium`; `winget install GitHub.cli` para gestionar secretos y releases | Lighthouse CI puede usar el Chrome ya instalado |

### 7.3 Scripts (npm; implementados en TypeScript/Node, nunca en bash ni PowerShell)

| Script | Qué hace |
|---|---|
| `npm run setup` | Comprueba Node ≥ 24, instala las dependencias, crea `.env.local` desde `.env.example`, crea y migra la BD local y carga la semilla. Con `--browsers`, instala el Chromium de Playwright. Se puede repetir sin efectos secundarios. |
| `npm run dev` | Arranca la web y la API con `STEAM_MODE=fixtures` y recarga en caliente. Funciona sin Internet. |
| `npm test` | Unitarias + integración + contrato (sin red). |
| `npm run test:e2e` | Build + preview + Playwright (Chromium). |
| `npm run bench:search` | Bench de búsqueda (sintético de 250.000, semilla 42, + semilla real). |
| `npm run lhci` | Lighthouse CI contra el build local. |
| `npm run check` | Exactamente lo que ejecuta el CI en una PR (rápido). |
| `npm run db:migrate` / `db:reset` / `db:seed` | Gestión de la BD local. |
| `npm run catalog:sync -- --source=fixtures\|live --mode=incremental\|full --dry-run` | Ejecuta el job en local; `live` exige la clave en `.env.local`. |
| `npm run fixtures:record -- --appids=…` | Graba respuestas reales de Steam y redacta la clave. |
| `npm run fixtures:generate -- --size=250000 --seed=42` | Catálogo sintético para las pruebas de rendimiento. |

```dotenv
# .env.example → copiar a .env.local (no se versiona)
STEAM_MODE=fixtures              # fixtures | live (live solo para catalog:sync y fixtures:record)
STEAM_WEB_API_KEY=               # vacío salvo para sincronizar o grabar en local
DATABASE_URL=file:./.data/gameagenda.db
PUBLIC_APP_NAME=GameAgenda
```

Las variables se cargan con `node --env-file-if-exists=.env.local …`, que Node trae de serie, sin dependencias extra.

### 7.4 Datos semilla para trabajar sin red

- `fixtures/catalog/seed.jsonl`: ~300 juegos reales (populares + casos límite), generado a partir de los fixtures grabados.
- Carátulas: con red, del CDN de Steam; sin red, un *placeholder* SVG local (iniciales + un color derivado del appid).
- Un usuario demo (~30 entradas en distintos estados, desde M2) y un usuario «pesado» de 5.000 entradas para las pruebas de rendimiento.
- El catálogo sintético grande se genera bajo demanda (no se versiona).
- Un e2e de CI arranca la app con la red externa bloqueada, para garantizar que `npm run dev` y la semilla bastan.

### 7.5 Particularidades de Windows

- `.gitattributes` con `eol=lf`, `git config core.autocrlf false` y `git config core.longpaths true`.
- npm ejecuta los scripts con `cmd.exe`: no sirve `VAR=valor comando` ni `rm -rf`. La lógica va en scripts `.ts`.
- Para ganar velocidad, valorar una Dev Drive (ReFS) para el repo y la caché de npm, o una exclusión de Defender para la carpeta (sopesando el riesgo).
- Un job semanal en `windows-latest` ejecuta `npm run setup && npm run check` para que el entorno Windows no se rompa.
- En la primera ejecución de `npm run dev`, permitir el aviso del firewall solo para redes privadas.

## 8. Hoja de ruta

El esfuerzo está en **días-persona ideales** (≈ 6 h enfocadas) para un solo desarrollador.
- A ~15 h/semana, 1 día ideal ≈ 0,4 semanas de calendario.
- Total: ≈ 11–16 semanas a tiempo completo, o ≈ 22–32 semanas a 15 h/semana.

### M1 — Catálogo completo de Steam + alta rápida a «Quiero jugar» (`v0.1.0`)

- **Objetivo:** encontrar cualquier juego de Steam al teclear y apuntarlo en < 3 s, sin necesidad de cuenta.
- **Entregables:**
  1. Repo, herramientas, CI de PR completo (§2.8) y ADR 0001–0007, 0009 y 0011–0014.
  2. `steam-client` con esquemas, grabador y fixtures redactados.
  3. Job `catalog-sync` programado a diario: completo + incremental, idempotente, reanudable, con guardarraíles, métricas y *heartbeat*.
  4. Búsqueda con normalización y ranking, según ADR-0005: API con caché y limitación de tasa, y/o índice local por niveles en un Web Worker.
  5. Interfaz:
     - buscador *combobox* con foco automático;
     - resultados con nombre, año y cápsula;
     - `Enter` o un toque para añadir, y «Deshacer»;
     - lista «Quiero jugar», con opción de quitar;
     - alta como texto libre si no hay coincidencia.
  6. Persistencia local (IndexedDB), `storage.persist()`, exportar/importar JSON y *app shell* básico sin red.
  7. Despliegue a producción + *uptime check* + error tracker; semilla offline y scripts `setup`/`dev`/`test`.
- **Criterios de aceptación:**
  - CA1: tras un sync completo, los juegos de la BD coinciden con los enumerados (diferencia ≤ 0,5 %, explicada en el informe del job) y el 100 % tiene nombre.
  - CA2: 7 ejecuciones diarias seguidas correctas; incremental ≤ 15 min; alerta probada con un fallo simulado.
  - CA3: golden set con top-3 ≥ 95 % y top-1 ≥ 80 %; búsqueda insensible a mayúsculas, acentos, ™/® y apóstrofos.
  - CA4: bench dentro del presupuesto; REN-01 o REN-02 (según ADR-0005) y REN-04 cumplidos en los e2e.
  - CA5: e2e «apuntar un juego en < 3 s» en verde (mediana de 5) en Chromium escritorio y en móvil emulado.
  - CA6: Lighthouse móvil con rendimiento ≥ 90, accesibilidad ≥ 95, LCP ≤ 2,5 s, TBT ≤ 200 ms y CLS ≤ 0,1; JS inicial ≤ 100 KB gzip.
  - CA7: 0 violaciones axe *serious/critical*; flujo completo verificado a mano con teclado y con NVDA.
  - CA8: clave de Steam solo en el entorno `catalog-sync`; escáner de secretos limpio; CSP activa sin `unsafe-inline` en los scripts; respuesta 429 + `Retry-After` comprobada en `/api/search`.
  - CA9: sin red tras la primera visita, la app abre, muestra la lista y deja apuntar (desde populares o como texto libre); los datos persisten al recargar.
  - CA10: en un Windows 11 limpio con Node 24, `npm run setup && npm run dev` deja la app funcionando con datos semilla en ≤ 10 min, sin acceso a Steam.
- **Esfuerzo:** 15–22 días:
  - fundamentos, 2–3;
  - ingesta, 5–7;
  - búsqueda, 4–6;
  - alta + lista + modo sin red básico, 2–3;
  - calidad, despliegue y observabilidad, 2–3.

### M2 — Estados y gestión de la agenda (`v0.2.0`)

- **Objetivo:** registrar el progreso y la compra en ≤ 2 interacciones.
- **Entregables:**
  - ADR-0010;
  - estados jugando / completado / platinado (100 %) / abandonado, con «comprado» independiente;
  - acciones rápidas: menú, gesto y atajos de teclado;
  - filtros, ordenación (prioridad, fecha y nombre con `Intl.Collator`), contadores y notas cortas;
  - reordenación accesible;
  - exportación a CSV;
  - sinónimos de búsqueda.
- **Criterios:**
  - cambio de estado con feedback ≤ 100 ms;
  - REN-14 cumplido con 5.000 entradas;
  - alternativa al arrastre (2.5.7);
  - máquina de estados cubierta con tests basados en propiedades.
- **Esfuerzo:** 6–9 días.

### M3 — Cuentas y sincronización entre dispositivos (`v0.3.0`)

- **Objetivo:** que la lista no se pierda y aparezca en todos los dispositivos.
- **Entregables:**
  - ADR-0008, autenticación sin contraseña y sesiones seguras;
  - API de lista con autorización;
  - *outbox* + sincronización (LWW, idempotencia);
  - fusión de la lista local al crear la cuenta;
  - RGPD: política, registro de actividades, exportación y borrado en autoservicio y contratos con los encargados;
  - backups con simulacro de restauración;
  - entorno `staging`.
- **Criterios:**
  - dos dispositivos convergen en ≤ 10 s tras reconectar;
  - 0 pérdidas en las pruebas de caos (sin red, duplicados, desorden);
  - tests de IDOR;
  - restauración probada (RTO ≤ 8 h);
  - borrado efectivo en ≤ 24 h;
  - ASVS L1 sin pendientes críticos.
- **Esfuerzo:** 10–15 días.

### M4 — PWA completa, rendimiento en móvil e inglés (`v0.4.0`)

- **Objetivo:** que se sienta como una app nativa: instalable, arranque en < 1 s y búsqueda completa sin red.
- **Entregables:**
  - service worker con estrategia de actualización;
  - índice local por niveles con deltas diarios (si no entró en M1);
  - Background Sync donde exista;
  - interfaz en inglés + pseudolocalización + selector de idioma;
  - calibración con el móvil real;
  - WebKit y Firefox en la matriz e2e.
- **Criterios:**
  - REN-07 cumplido (≤ 1 s en caliente);
  - INP p75 ≤ 200 ms en RUM, con ≥ 100 sesiones;
  - búsqueda completa sin red;
  - 100 % de las cadenas traducidas al inglés.
- **Esfuerzo:** 7–10 días.

### M5 — Otras plataformas y biblioteca de Steam (`v0.5.0`)

- **Objetivo:** apuntar juegos de PlayStation, Xbox, Nintendo y otras tiendas, y marcar «comprado» a partir de la biblioteca de Steam.
- **Entregables:**
  - ADR-0014 aplicado (identidad multiplataforma);
  - una fuente de catálogo multiplataforma, según el track legal/API;
  - importación opcional de la biblioteca de Steam, con consentimiento;
  - «platinado» manual donde no haya API oficial (supuesto);
  - deduplicación entre fuentes.
- **Criterios:**
  - un juego multiplataforma aparece una sola vez, con sus plataformas;
  - importar 1.000 juegos lleva ≤ 60 s;
  - no se guardan credenciales de terceros.
- **Esfuerzo:** 10–15 días (depende mucho de las APIs).

### M6 — Beta pública y endurecimiento (`v1.0.0`)

- **Objetivo:** abrir la app a usuarios reales con garantías.
- **Entregables:**
  - auditoría manual de accesibilidad;
  - revisión legal: aviso legal, privacidad y atribución/no afiliación con Valve, según el track legal;
  - prueba de carga;
  - *runbooks*: sync caído, clave filtrada, restauración y brecha RGPD;
  - SLO y alertas afinadas;
  - contrato de exportación v1.
- **Criterios:**
  - 50 peticiones/s en búsqueda con p95 de servidor ≤ 50 ms y 0 errores;
  - 0 vulnerabilidades altas/críticas;
  - RPO y RTO verificados;
  - nota ≥ A en Observatory;
  - ≥ 10 *beta testers*, con una mediana de alta ≤ 3 s.
- **Esfuerzo:** 6–10 días.

| Hito | Días ideales | Acumulado |
|---|---|---|
| M1 | 15–22 | 15–22 |
| M2 | 6–9 | 21–31 |
| M3 | 10–15 | 31–46 |
| M4 | 7–10 | 38–56 |
| M5 | 10–15 | 48–71 |
| M6 | 6–10 | 54–81 |

### 8.1 Registro de riesgos (esqueleto)

Probabilidad (P) e impacto (I): B = bajo, M = medio, A = alto.

| ID | Riesgo | P | I | Mitigación | Señal |
|---|---|---|---|---|---|
| R01 | Steam cambia o retira endpoints (ya pasó con `ISteamApps/GetAppList/v2`) | M | A | Capa `steam-client` + esquemas + medición de cambios en cada sync; catálogo servido desde nuestra BD; fuente alternativa evaluada | `schema_violations`, 404/410 |
| R02 | Respuestas 429 o bloqueo de las IP de los runners | M | M | Ritmo adaptativo, checkpoint, incremental; alternativa: el cron del hosting | `http_429_total` |
| R03 | Los ToS limitan cachear o redistribuir nombres o imágenes | M | A | Consulta al track legal antes de M1; ADR-0005/0012 con alternativa solo remota o con proxy | Dictamen legal |
| R04 | Filtración de la clave de Steam (fixtures, logs, error tracker) | B | A | Redacción, escáner con regla propia, secreto por entorno, procedimiento de rotación | Alerta del escáner |
| R05 | Búsqueda local lenta en móviles modestos | M | A | Medido hoy (§0.3); Worker + refinamiento incremental + niveles; alternativa remota | Bench/RUM p95 > 50 ms |
| R06 | Índice del cliente pesado (~2 MB br) o con mucha memoria | M | M | Descarga diferida, niveles, deltas, solo `type=game`, respeto de `Save-Data` | `index_bytes`, quejas por consumo de datos |
| R07 | Safari en iOS borra el almacenamiento local antes de M3 | M | A | `storage.persist()`, instalar la PWA, exportar; adelantar M3 si hay usuarios | Informes de pérdida |
| R08 | El alcance crece (social, recomendaciones, multiplataforma) | A | M | DoD, MoSCoW por hito, *timebox* | Hito retrasado > 30 % |
| R09 | `schedule` retrasado, descartado o desactivado (60 días sin actividad en repo público) | M | B | *Heartbeat* a 36 h, `workflow_dispatch`, actividad periódica | Alerta de sync ausente |
| R10 | Cumplimiento del RGPD al introducir cuentas | M | M | Minimización, encargados en la UE, revisión legal en M3 | Revisión pendiente |
| R11 | No hay API oficial para trofeos ni para otras plataformas | A | M | «Platinado» introducido a mano; evaluar catálogos multiplataforma | Track API |
| R12 | Dependencia comprometida (cadena de suministro) | B | A | Lockfile, *cooldown*, pocas dependencias, `ignore-scripts`, acciones fijadas por SHA | Avisos de seguridad |
| R13 | Tests de rendimiento inestables en runners compartidos | A | B | Medianas, comparación dentro del mismo job, umbrales con margen | Fallos intermitentes |
| R14 | Calidad de los datos de Steam (duplicados, apps de prueba, contenido adulto) | M | M | Filtros por tipo, descriptores de contenido, adulto oculto por defecto, informe de anomalías | Golden set, quejas |
| R15 | Disponibilidad limitada de un solo desarrollador (*bus factor*) | M | A | Hitos pequeños con valor visible, automatización, documentación y ADR | Ritmo semanal |
| R16 | Coste por encima de las capas gratuitas (descargas del índice, BD) | B | M | Caché en el CDN, alertas de gasto, proveedores con capa gratuita amplia | Factura > 80 % |


---
### Decisiones clave
- Objetivos medibles para «rápida y ágil»: búsqueda local p95 ≤ 50 ms en el móvil de referencia (≤ 16 ms en desktop); búsqueda remota p95 ≤ 300 ms en banda ancha y ≤ 500 ms en Slow 4G (servidor ≤ 25 ms); feedback al añadir ≤ 100 ms con UI optimista; flujo «apuntar un juego» < 3 s comprobado con e2e de Playwright (mediana de 5); INP p75 ≤ 200 ms (objetivo interno 100 ms); LCP p75 ≤ 2,5 s; CLS ≤ 0,1; JS inicial ≤ 100 KB gzip.
- Viabilidad medida hoy con datos sintéticos (Ryzen 5 3600, Node 24.21, SQLite 3.53.4). (1) El escaneo en memoria de 250.000 títulos da p95 de 10,7 ms, unos 45–65 ms en un móvil: la búsqueda local necesita un Web Worker, refinamiento incremental (p95 de 1,7 ms) y un nivel de «populares». (2) SQLite FTS5 da p95 de unos 3,5 ms: el servidor no es el cuello de botella. (3) El índice completo para el cliente ocupa unos 2,07 MB en brotli: solo admite descarga diferida. Script reproducible: C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Programacion-GameAgenda\56497ade-bd80-409d-8199-9f2b9ba10c3e\scratchpad\bench\bench-search.mjs
- Enfoque local-first: el alta se confirma en el dispositivo (IndexedDB + outbox idempotente con UUID). Steam nunca está en el camino crítico de una petición de usuario.
- M1 sin cuentas: lista local con exportar/importar JSON y storage.persist(). Las cuentas y la sincronización llegan en M3, así que en M1 el servidor no guarda datos personales.
- El CI nunca llama a Steam. Usa fixtures grabados y redactados con una triple barrera: STEAM_MODE=fixtures, mock HTTP con onUnhandledRequest=error y ningún secreto en ci.yml. Los cambios de formato de Steam se detectan en producción: el job de sync valida los esquemas y no publica si se supera el umbral.
- La clave de Steam solo vive en el secreto del entorno catalog-sync de GitHub y en .env.local, para grabar fixtures. El build del frontend no accede a ningún secreto, una regla de lint prohíbe leer STEAM_* fuera de steam-client/catalog-sync y key= se redacta en logs y breadcrumbs.
- Sync diario en GitHub Actions a las 05:17 Europe/Madrid (clave timezone del schedule, verificada hoy en la documentación de GitHub): una sola ejecución a la vez, timeout de 180 min, idempotente y reanudable por checkpoint, con publicación atómica, sin publicar si el catálogo encoge más de un 5 % y con heartbeat que alerta a las 36 h. Se recomienda publicar un snapshot versionado para que la API nunca necesite la clave.
- Trunk-based con PR obligatoria y squash, con el título en Conventional Commits (tipo en inglés, descripción en español). SemVer 0.x por hito con release-please y CHANGELOG con secciones en español.
- 14 ADR iniciales en formato MADR (0001–0014); 11 son necesarios para M1. Entre ellos, la estrategia de búsqueda (0005), la ingesta (0006), las imágenes (0012) y la identidad multiplataforma (0014).
- Desarrollo local sin instalaciones extra: npm workspaces y scripts en TypeScript ejecutados directamente por Node 24 (type stripping verificado). node:sqlite trae FTS5 y el tokenizer trigram con remove_diacritics (verificado). Postgres es opcional, con PGlite o winget (PostgreSQL.PostgreSQL.18). gh CLI no está instalado: winget install GitHub.cli.
- Base de seguridad OWASP ASVS 5.0 nivel 1, completa antes de M3: autenticación sin contraseña, cookie __Host- SameSite=Lax, API en el mismo origen (/api), CSP estricta en Report-Only primero y limitación de tasa (búsqueda 10 req/s con ráfaga de 30; autenticación 5 cada 15 min por email). Las descripciones de Steam se tratan como HTML no confiable.
- Observabilidad mínima viable: logs JSON sin datos personales, error tracker con depuración de URLs, tabla sync_runs + resumen del job + heartbeat, uptime check cada 5 min, RUM propio con web-vitals y analítica sin cookies con 9 alertas accionables.
- Se recomienda un repositorio público o uno privado con GitHub Pro. Verificado hoy en la documentación: en privado Free no hay secretos por entorno ni restricción de entornos a main; los minutos de Actions son gratis en público y 2.000/mes en privado Free.
- Hoja de ruta M1–M6 de 54–81 días-persona ideales. M1 (catálogo completo de Steam + alta rápida a Quiero jugar) lleva 15–22 días y tiene 10 criterios de aceptación medibles. Registro de riesgos con 16 entradas.

### Preguntas abiertas
- Estrategia de búsqueda (ADR-0005): ¿índice local, remota o híbrida? Depende del tamaño real del catálogo (track API), de si se permite enviar los nombres al cliente (track legal) y del móvil objetivo.
- ¿Qué entra en «todos los juegos de Steam»? ¿Solo type=game, o también DLC, demos, software, bandas sonoras, próximos lanzamientos, contenido adulto y juegos retirados (delisted)?
- ¿Repositorio público o privado, y con qué plan de GitHub? Afecta a los secretos por entorno, la protección de ramas, los minutos de Actions, CodeQL y a si se pueden versionar fixtures con datos de Steam.
- ¿Cuál será la plataforma final: PWA web, escritorio con Tauri (Rust ya está instalado) o nativa? ¿Y qué hosting, con qué presupuesto mensual máximo?
- Límites reales de Steam (track API): rate limit, cuota diaria, tamaño máximo de lote de GetItems y parámetros de sincronización incremental. Determinan cuánto tarda el sync completo y el timeout-minutes del job.
- ¿Permiten los ToS hotlinkear o cachear las imágenes del CDN de Steam y mostrar sus descripciones? (ADR-0012). ¿Qué hosts del CDN hay que poner en la CSP?
- Autenticación: ¿magic link, passkeys, Google o Steam OpenID? ¿Basta con introducir cuentas en M3 o hay que adelantarlas por el riesgo de que iOS borre los datos locales?
- Analítica: ¿se puede guardar el texto de las búsquedas sin resultados, sin vincularlo al usuario, para mejorar el buscador?
- ¿Qué móvil usa realmente el usuario (Android o iPhone, y modelo)? Sirve para calibrar el dispositivo de referencia de los presupuestos.
- ¿Cuántas horas por semana dedicará el desarrollador? Hace falta para pasar los días ideales a calendario.
- ¿En qué idioma irán el código, los commits, los ADR y el CHANGELOG? Propuesta: identificadores en inglés y textos en español.
- ¿Hace falta un entorno de staging en el prototipo, o bastan preview y producción hasta M3?
- ¿Son requisito la navegación con mando (Steam Deck) o atajos de teclado globales concretos?
- ¿Habrá monetización (afiliación, enlaces de compra)? Cambiaría el análisis legal (LSSI-CE, accesibilidad según la Ley 11/2023 / Acta Europea de Accesibilidad) y los requisitos de privacidad.
