> Revisión: Revisión de T4 (plan de ingeniería y hoja de ruta). En lo factual, el borrador es riguroso y casi todo es correcto. Lo comprobé hoy: la clave `timezone` de `schedule`, los límites de `schedule` (5 min, retrasos y descartes, solo la rama por defecto, desactivación a los 60 días en repos públicos y avisos al último que editó el cron), los minutos y precios de Actions (2.000/3.000; 0,006/0,010 USD), los entornos según el plan, Node 24.21 con type stripping sin avisos y `--env-file-if-exists`, `node:sqlite` 3.53.4 con FTS5/trigram sin avisos y el inventario de herramientas. También reproduje el bench sintético dentro del ruido.

Los problemas son de enfoque y de especificación:
1. Está dimensionado como un producto en producción, no como el prototipo de un solo desarrollador. Mete en M1 SLO, RPO/RTO, ASVS, RUM, release-please, staging, matriz nocturna y 12 ADR.
2. M1 no elige entre índice local y API, y arrastra un backend que no hace falta.
3. Los estados (completado, platinado, comprado), que el usuario pidió expresamente, no llegan hasta M2, y no se define el modelo de datos.
4. Faltan piezas que bloquean la implementación:
   - de dónde salen el año, la cápsula y la popularidad de los resultados. Las rutas de cápsula llevan hash y meterlas en el índice añade 4,1 MB br (medido);
   - dónde se guarda el estado de la tarea de catálogo entre ejecuciones, si el runner es efímero.
5. Hay contradicciones:
   - el e2e no usa la mediana de 5 que anuncia el texto;
   - DIS-04 choca con la importación de la biblioteca de Steam en M5;
   - el nivel de ASVS exigido no coincide entre secciones;
   - se da por hecha la protección de ramas, que no existe en un repo privado Free.
6. Hay criterios que no se pueden cumplir: CA1 exige que el 100 % de los juegos tenga nombre y la enumeración real trae 18 entradas sin nombre.

Con los nombres reales (196.595 juegos): el índice ocupa 1,80 MB br (1,47 MB con delta), el escaneo JS da p95 de 10,9 ms y FTS5 da p95 ≤ 2 ms.

Qué cambia en la versión revisada:
- **Arquitectura:** opción A por defecto (PWA estática con índice por niveles y sin backend hasta M3); la opción B es la salida si el dictamen legal impide distribuir el índice al cliente.
- **Alcance:** un nivel de calidad de prototipo, con lo diferido asignado a cada hito, y un esqueleto andante M0.
- **Producto:** estados incluidos en el modelo desde M0, captura rápida (pegar un enlace, accesos directos, compartir) y resultados etiquetados contra el Enter obsoleto.
- **Medición y CI:** definiciones exactas de cada medida, un único job de CI y observabilidad local sin telemetría.
- **Esfuerzo:** prototipo (M0–M2) 17–26 días ideales; hasta la beta, 49–74.

> Problemas detectados (25):
> - [high] Sobredimensionado para un prototipo de un solo desarrollador. M1 mezcla la función principal con un aparato de producción en 15–22 días: SLO de 99,5–99,9 %, RPO/RTO con simulacros trimestrales, ASVS L1, STRIDE por hito, RUM + analítica + 9 alertas + panel, release-please, staging y preview, matriz nocturna de 3 navegadores, job semanal en Windows, 12 ADR antes de M1, pseudolocalización y tests de propiedades para un enumerado de 5 valores. Es irrealista y contrario al encargo («prototipo profesional»). → Nivel de calidad del prototipo (§0.4): lo obligatorio desde M0–M1 frente a lo diferido, con el hito de cada cosa. Además: esqueleto andante M0, prototipo = M0–M2, un único job de CI, 5 ADR breves, observabilidad mínima y SLO, RPO/RTO, ASVS, RUM y release-please trasladados a M3/M6.
> - [high] M1 no decide la arquitectura de búsqueda («API con caché y limitación de tasa, y/o índice local»). Fija presupuestos y trabajo para las dos vías y arrastra un backend (API, limitación de tasa, uptime, DIS-02, CSRF) innecesario si la búsqueda es local y no hay cuentas. → Opción A por defecto: PWA estática + índice por niveles publicado por catalog-sync, sin backend ni BD hasta M3. Opción B documentada como salida si el track legal rechaza S8: API de solo lectura con SQLite FTS5 (+3–5 días). Los RNF de API pasan a REN-13 y §6.2.
> - [high] El requisito de estados (completado, platinado, comprado…) no entra en M1 y el modelo de datos no se especifica. El primer prototipo no demuestra un requisito explícito del usuario y obliga a migrar IndexedDB más adelante. → Modelo mínimo desde M0 (§0.5): enumerado `status`; `platinum` implica completado; `owned` independiente; alta como texto libre; copia de nombre y cápsula; una entrada por juego. Cambio de estado con un toque en M1 (CA10); filtros y contadores en M2.
> - [high] Los resultados se muestran «con nombre, año y cápsula», pero no hay plan de datos. El índice medido solo lleva appid + nombre; GetItems da rutas de cápsula con hash, no derivables del appid, e incluirlas en el índice sumaría ≈ 4,1 MB brotli (medido con nombres reales). Tampoco se dice de dónde sale la «popularidad» del ranking y del nivel «populares». → Supuestos S10/S11. Índice base solo con appid + nombre. Detalles bajo demanda: ficheros estáticos troceados por appid (o la API en la opción B), solo para los resultados visibles. Los nombres se pintan primero (REN-09) y la entrada de la lista guarda una copia.
> - [high] La tarea de catálogo no dice dónde persisten el estado, la instantánea anterior y el checkpoint entre ejecuciones de un runner efímero. «Reanudable por checkpoint» y «calcular diferencias» no se pueden implementar tal como están escritos. → Sin estado en el runner (§4.4): el estado es la instantánea publicada, con `lastModified` de la enumeración + `enrichedAt` por app. Enumeración completa en cada ejecución (~4 llamadas); cola de enriquecimiento por diferencias; publicación parcial coherente; `latest.json` como puntero atómico; ejecución completa automática si la última tiene > 7 días.
> - [medium] Las cifras de §0.3 son solo sintéticas. Con nombres reales (instantánea pública del 27-10-2026: 196.595 juegos), el índice pesa 4,95/2,44/1,80 MB y, al escalar a 250.000, el presupuesto «≤ 2,5 MB br» queda con ~9 % de margen. Además, el bench no aplica la normalización especificada: usa NFD y convierte el apóstrofo en espacio, en vez de NFKD y eliminarlo. → Tabla con columnas real y sintético (§0.6). REN-08 ≤ 2,0 MB br al tamaño actual, con appids en delta (1,47 MB). S1 actualizado. Normalización I18N-03 verificada aparte con los ejemplos.
> - [medium] «Apuntar un juego en < 3 s» y `time_to_add_ms` no definen inicio ni fin. El e2e da por hecho que se escribe «sin tocar nada», pero en iOS (y a menudo en Android) el teclado no se abre con el foco programático. Tampoco hay objetivo para «abrir la app → juego apuntado». → Definiciones exactas en §1.0. REN-03 incluye 1 toque en móvil. Nuevo REN-04: ≤ 4 s de abrir a apuntado. ACC-04: buscador arriba y grande.
> - [medium] El ejemplo de Playwright contradice su propio texto: anuncia la mediana de 5 pero comprueba una sola ejecución. Si se repite tal cual, añadiría duplicados. → Bucle con 5 juegos distintos y aserción sobre la mediana. `toHaveAccessibleName` sobre el primer resultado y latencia del sistema leída de `performance.measure`. Identificadores en inglés.
> - [medium] Condición de carrera no tratada en el flujo rápido: con búsqueda incremental, un Enter pulsado antes de que lleguen los resultados de la consulta final añade el de un prefijo anterior, es decir, un juego equivocado. → Resultados etiquetados con su consulta; Enter espera ≤ 150 ms o no actúa. e2e con `delay: 0`, CA5 y riesgo R11.
> - [medium] REN-02 (búsqueda remota ≤ 500 ms en Slow 4G) ignora el establecimiento de la conexión (DNS + TCP + TLS ≈ 3 RTT = 450 ms) y el arranque en frío de los hostings gratuitos que se suspenden, que se mide en segundos. → REN-13 exige la conexión ya abierta (`preconnect`) y un hosting sin suspensión o con arranque en frío ≤ 300 ms. Solo aplica a la opción B o desde M3.
> - [medium] Contradicción: DIS-04 y §4.4 dicen «0 llamadas a Steam en peticiones de usuario» y «la API nunca necesita la clave», pero en M5 importar la biblioteca de Steam exige clave y una llamada por usuario. → FIA-01 acota la regla a búsqueda, alta y lista. Las importaciones de M5 son tareas asíncronas, con la clave solo en el worker de importación.
> - [medium] La tabla de §4.8 está incompleta: en un repo privado Free no hay protección de ramas (requiere Pro, verificado en la documentación de planes), aunque §3.3 da por hecha la regla de `main`. Tampoco recoge el almacenamiento de artefactos incluido (500 MB / 1 GB). → Fila nueva en la tabla, alternativa para privado Free (CI en cada push y no fusionar en rojo) y nota de almacenamiento.
> - [medium] El esqueleto de `ci.yml` es incoherente. `checks` sube `web-dist`, pero `e2e` no lo descarga y `test:e2e` vuelve a compilar, con `npm ci` y build duplicados. Son dos jobs en serie de 15 min frente a MAN-02 (≤ 10 min). `nightly.yml` y el job semanal en Windows sobran en un prototipo cuyo único desarrollador ya trabaja en Windows. → Un único job que reutiliza el build, con el escáner de secretos al principio. La matriz nocturna pasa a M4.
> - [medium] Hay criterios de aceptación que no se pueden verificar. CA1 exige que el 100 % de los juegos tenga nombre, pero la enumeración real trae 18 entradas sin nombre. CA2 (7 ejecuciones diarias seguidas) consume una semana de calendario que el plan no contempla. → CA1 redefinido: las entradas sin nombre se completan o se excluyen, y el informe las cuenta. CA2, con nota de calendario.
> - [medium] Privacidad en M1: RUM con endpoint propio, analítica y un error tracker de terceros (que maneja IP, datos personales) antes del dictamen legal y sin aviso. Además, PRI-07 da por fija la edad mínima de 14 años, cuando hay un proyecto de ley que la eleva a 16. → Prototipo sin telemetría (PRI-01) y panel de diagnóstico local que no envía nada (§5.2). Error tracker solo con visto bueno legal. Aviso mínimo si la URL es pública. PRI-05, a confirmar con el track legal.
> - [medium] No hay plan para probar la PWA en el móvil real desde Windows, aunque REN-01/04 dependen de esa calibración. El service worker exige un contexto seguro (no funciona en http://192.168.x.x) y el Web Inspector de Safari requiere macOS. → §7.5: en Android, depuración remota de Chrome con redirección de puertos (el móvil abre localhost); en iPhone, preview HTTPS + panel de diagnóstico. Riesgo R10.
> - [medium] Huecos frente a la función principal (apuntar rápido): no hay captura fuera del buscador (pegar un enlace de la tienda, accesos directos del manifiesto, «Compartir» en Android) ni tratamiento de duplicados en el alta local. → «Ya está en tu lista» en M0, pegar un enlace de Steam en M1, y accesos directos y Web Share Target en M2. Cada cosa con su e2e.
> - [medium] Alcance no pedido que retrasa el prototipo: inglés en M4, ICU MessageFormat, regla de lint contra literales y pseudolocalización en CI. → I18N-01: cadenas en un único módulo es-ES desde M0. El inglés queda como opción posterior al prototipo.
> - [low] «Sincronización completa ≤ 3 h» no se deriva de los supuestos: con S3 son ~4 llamadas de enumeración + 1.000–2.000 lotes, ≈ 17–33 min. → REN-14: completa ≤ 60 min y `timeout-minutes: 90`, con el margen frente a la cuota de ~100.000 llamadas/día comprobado.
> - [low] Incoherencias menores: SEG-04 dice «ASVS L1 completo antes de M3» y M3 «sin pendientes críticos»; key_decisions cuenta 11 ADR para M1 cuando la tabla lista 12; el script figura como .mjs en una ruta temporal y como `scripts/bench-search.ts`; se mezclan «desktop» y «escritorio»; «Calidad local-first» no se entiende. → Unificado: ASVS L1 completo antes de abrir cuentas a terceros, 5 ADR con hito, `scripts/bench-search.ts` y terminología en español.
> - [low] La normalización no contempla el apóstrofo tipográfico (’), frecuente en los nombres de Steam. → I18N-03 con ' ’ ‘ y la comilla invertida, verificado (`Baldur’s` → `baldurs`).
> - [low] Faltan criterios para elegir el hosting. GitHub Pages, por ejemplo, no permite cabeceras personalizadas, así que SEG-02 (CSP por cabecera, nota A) sería inalcanzable. Tampoco se pide servir el catálogo desde el mismo origen, lo que afecta a CORS y a `connect-src`. → §4.3 con 6 criterios. CSP con `connect-src` que incluye el CDN, para que el service worker pueda cachear las carátulas.
> - [low] El aviso del firewall al lanzar `npm run dev` se puede evitar: basta con escuchar en 127.0.0.1 por defecto. → `dev` en 127.0.0.1 y `dev:lan` solo para probar en el móvil.
> - [low] No hay recomendación sobre qué cuenta como «todos los juegos», y los «próximamente» son especialmente útiles en una agenda de pendientes. → §0.7: incluir `type=game` con los «próximamente»; excluir DLC, demos, bandas sonoras y software; ocultar el contenido adulto por defecto.
> - [low] REN-14 del borrador (5.000 entradas con virtualización) llega en M2, pero ese volumen solo aparece con las importaciones de M5. DIS-01 (99,9 % de disponibilidad del CDN) no depende de nosotros. → REN-12: 500 entradas en M2 y 5.000 en M5. DIS-01 eliminado.

> Números corregidos: Re-medido el 28-10-2026 en la misma máquina (Ryzen 5 3600, Node 24.21.0, SQLite 3.53.4).

**1. Bench sintético de 250.000 (`bench-search.mjs` original)**

Reproduce el borrador dentro del ruido:

| Medición | Re-medido | Borrador |
|---|---|---|
| JS p50/p95/p99 | 8,1 / 10,5 / 11,9 ms | 7,8 / 10,7 / 12,2 ms |
| Incremental p95/p99 | 1,9 / 5,2 ms | 1,7 / 4,7 ms |
| 1.ª consulta de 2 caracteres, p95 | 15,5 ms | 14,5 ms |
| Heap | 27 MB | ≈ 26 MB |
| FTS5 trigram | 0,57 / 3,61 / 5,82 ms | — |
| FTS5 unicode61 + prefijos | 0,18 / 3,58 / 6,88 ms | — |
| BD | 42,4 MB | — |
| Índice (bruto/gzip/brotli) | 6,34 / 2,65 / 2,07 MB | idéntico |

Las filas de 500.000 no se repitieron.

**2. Con nombres reales**

Fuente: espejo público jsnli/SteamAppIDList de `IStoreService/GetAppList`, categoría juegos, datos del 27-10-2026. La popularidad es sintética.

- **Datos:** 196.595 juegos; 16,7 caracteres de media; 18 sin nombre; 12.583 en chino/japonés, coreano o cirílico; 985 con ™/®/©; appid máximo 5.503.430.
- **JS:** p50/p95/p99 7,8 / 10,9 / 12,7 ms; incremental p95/p99 1,0 / 2,4 ms; 1.ª consulta de 2 caracteres p95 13,6 ms; heap total ≈ 22,5 MB.
- **FTS5:** trigram 0,31 / 0,93 / 1,48 ms; unicode61 + prefijos 0,13 / 1,96 / 3,89 ms; BD 33,5 MB.
- **Índice appid + nombre:** 4,95 / 2,44 / 1,80 MB (bruto/gzip/brotli); con appids ordenados en delta base36, 3,90 / 1,97 / 1,47 MB.
- **Nivel «populares»** (muestra aleatoria, brotli): 10.000 → 97 KB; 15.000 → 142 KB; 20.000 → 186 KB.
- **Hash de cápsula** de 40 caracteres hexadecimales por título: +4,1 MB brotli.

**3. Correcciones que se derivan**

- S1: ~197.000 juegos hoy.
- Presupuesto del índice: ≤ 2,0 MB br (antes ≤ 2,5 MB br para 250.000).
- Sincronización completa: ≤ 60 min por cálculo (≈ 17–33 min de enriquecimiento a 1 petición/s), antes ≤ 3 h.
- CA1: ya no se exige que el 100 % tenga nombre.
- El bench no aplica I18N-03: usa NFD y convierte el apóstrofo en espacio. La normalización especificada se verificó aparte: Pokémon™ → pokemon, Baldur's Gate 3 → baldurs gate 3, DARK SOULS™ III → dark souls iii, Ⅲ → iii, ＡＢＣ → abc.

**Scripts y salidas**

Carpeta: C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Programacion-GameAgenda\56497ade-bd80-409d-8199-9f2b9ba10c3e\scratchpad\t4review\
- Scripts: bench-real.mjs, count.mjs, tiers.mjs y mem-real.mjs.
- Salidas: synth250k.json y real.json.

---

# T4 · Calidad de ingeniería, requisitos no funcionales y plan de entrega

> **Ámbito:** requisitos no funcionales (RNF), pruebas, herramientas, CI/CD, observabilidad, seguridad, desarrollo local y hoja de ruta del **prototipo** de GameAgenda.
>
> El plan está pensado para un solo desarrollador en Windows 11 (Node 24 y Rust instalados; sin Docker). El stack concreto lo fijan los ADR: `<frontend>`, `<hosting>` y `<schema-lib>` son marcadores.
>
> Otro track estudia en paralelo la API de Steam (límites, CORS), los ToS y lo legal, la competencia y las versiones de librerías de 2026. Aquí esos temas solo aparecen como **supuestos** explícitos (§0.3).

## 0. Resumen, alcance y supuestos

### 0.1 Resumen

- **Principio rector: prototipo profesional, no producto de producción.** Desde el primer día es obligatorio lo que protege la función principal (apuntar rápido), los datos del usuario y la clave de Steam. El resto (SLO, RUM, auditorías, automatización de *releases*, matriz nocturna de navegadores…) se aplaza a un hito concreto (§0.4).
- **«Rápida y ágil» en cifras** (definiciones exactas en §1.0):
  - del primer carácter tecleado al juego apuntado: mediana < 3 s, de los que ≤ 500 ms son atribuibles al sistema;
  - búsqueda local: p95 ≤ 50 ms en el móvil de referencia y ≤ 16 ms en el escritorio de referencia;
  - confirmación del alta en ≤ 100 ms, sin esperar nunca a la red;
  - PWA instalada: buscador listo en ≤ 1 s;
  - INP ≤ 200 ms, LCP ≤ 2,5 s y JS inicial ≤ 100 KB gzip.
- **Arquitectura por defecto del prototipo (opción A):**
  - una PWA estática que busca en un índice del catálogo dentro del propio navegador (en un Web Worker);
  - el índice lo genera y lo publica como ficheros estáticos una tarea programada de GitHub Actions;
  - **no hay backend ni base de datos hasta M3**.

  Si el track legal no permite distribuir el índice (S8), se pasa a la opción B: una API de búsqueda mínima de solo lectura (REN-13).
- **Catálogo:** la tarea `catalog-sync` es lo único que tiene la clave de Steam. El CI de las PR nunca llama a Steam: usa respuestas grabadas y redactadas (*fixtures*).
- **Estados desde el principio:** el modelo de datos incluye el progreso, «platinado» y «comprado» desde M0 (§0.5). El cambio de estado con un toque llega en M1.
- **Esfuerzo:** prototipo (M0–M2), 17–26 días ideales; hasta la beta pública (M6), 49–74 (§8).

### 0.2 Trazabilidad con los requisitos del usuario

| Requisito | Cómo se cubre | Hito |
|---|---|---|
| Apuntar muy rápido los juegos que quiere jugar | REN-01…04; e2e «apuntar en < 3 s»; alta como texto libre; pegar un enlace de Steam; accesos directos y «Compartir» en Android | M0–M2 |
| Estados: completado, platinado, comprado… | Modelo de §0.5, cambio de estado con un toque, filtros y contadores | M0 (modelo) · M1 (interfaz) · M2 (filtros) |
| «Rápida y ágil» | Presupuestos de §1.1, comprobados en CI y en el móvil real (panel de diagnóstico) | Desde M0 |
| Todos los juegos de Steam, para empezar | `catalog-sync` + índice por niveles + detalles bajo demanda | M1 |
| Prototipo profesional, un solo desarrollador, Windows, sin Docker | Nivel de calidad de §0.4; desarrollo local sin instalaciones (§7) | Todos |

### 0.3 Supuestos (a confirmar por otros tracks o en los ADR)

| ID | Supuesto | Lo confirma | Si cambia… |
|---|---|---|---|
| S1 | Tamaño: ~197.000 juegos hoy, según una instantánea pública de `IStoreService/GetAppList` (categoría juegos) del 27-10-2026. Se dimensiona para 250.000, con margen hasta 500.000 | Track API | Se recalculan los presupuestos del índice (REN-08) |
| S2 | La enumeración completa exige clave y solo se hace en la tarea programada. El enriquecimiento usa `IStoreBrowseService/GetItems` por lotes y sin clave | Hechos verificados + track API | — |
| S3 | Límites: ritmo prudente (≤ 1 petición/s por endpoint, lotes de 100–200 appids); puede haber respuestas 429, también por IP; cuota del orden de 100.000 llamadas/día por clave (Términos de uso de la Steam Web API) | Track API / legal | Se ajustan el ritmo y `timeout-minutes` |
| S4 | El producto es una PWA pensada primero para móvil. Escritorio o app nativa, más adelante | ADR-0001 | Los presupuestos web pasan a sus equivalentes nativos |
| S5 | Un solo desarrollador; 1 día ideal ≈ 6 h de trabajo enfocado | Usuario | Se recalcula el calendario |
| S6 | Coste del prototipo: 0 € (capas gratuitas); tope de 10 €/mes | Usuario | Cambian el hosting y la observabilidad |
| S7 | Usuarios en España/UE: aplican RGPD, LOPDGDD y LSSI-CE | Track legal | — |
| S8 | **Bloqueante para la opción A:** se puede enviar al cliente un índice con appid + nombre y mostrar imágenes enlazadas al CDN de Steam | Track legal (ToS) | Opción B (búsqueda en servidor); imágenes vía proxy o sin imágenes |
| S9 | El navegador nunca llama a las API de Steam (no se cuenta con CORS); solo carga imágenes de su CDN | Track API | Nada: el diseño no depende de ello |
| S10 | Las rutas de las cápsulas que devuelve `GetItems` llevan un *hash* y no se pueden deducir del appid | Hechos verificados + track API | Si existe una URL estable por appid, los detalles bajo demanda se simplifican |
| S11 | Existe una señal de popularidad para ordenar los resultados y elegir el nivel «populares» (p. ej. el número de reseñas en `GetItems`) | Track API | Se usa una popularidad aproximada |

### 0.4 Nivel de calidad del prototipo

| Obligatorio desde M0–M1 | Aplazado (y a qué hito) |
|---|---|
| Presupuestos del flujo principal comprobados con e2e, bench y Lighthouse CI | SLO de disponibilidad y alertas de la API → M3, cuando haya backend |
| Clave de Steam aislada, *fixtures* redactados y escáner de secretos | RPO/RTO y una restauración probada → M3; simulacros periódicos → M6 |
| CI de las PR en un único job (≤ 10 min) | RUM, analítica y error tracker de terceros → M6, tras el dictamen legal |
| Persistencia local, exportar/importar y `storage.persist()` | OWASP ASVS 5.0 nivel 1 completo → antes de abrir cuentas a terceros (M3) |
| Guardarraíles y *heartbeat* de `catalog-sync` | STRIDE, `security.txt`, nota A en Observatory y *runbooks* → M6 |
| Accesibilidad básica verificada (combobox, teclado, axe) | Matriz e2e automática con WebKit y Firefox → M4 (hasta entonces, una pasada manual por hito) |
| CSP sin `unsafe-inline` en los scripts; datos de Steam tratados como no confiables | *release-please*, CHANGELOG automático y entorno `staging` → M3/M6 |
| Panel de diagnóstico local que no envía datos | Inglés y pseudolocalización → opcional, después del prototipo |

### 0.5 Modelo mínimo de una entrada (propuesta para ADR-0004)

Si otro track define el modelo de datos, prevalece el suyo. Lo que este plan exige es que los estados existan desde M0, para no tener que migrar IndexedDB después.

```ts
type Status = 'want_to_play' | 'playing' | 'completed' | 'abandoned';

interface ListEntry {
  id: string;                                   // UUID generado en el dispositivo
  game:
    | { source: 'steam'; appid: number }
    | { source: 'text'; text: string };         // alta libre; se vincula a un appid más tarde
  snapshot: { name: string; capsule?: string; year?: number }; // copia: la lista no depende del índice
  status: Status;                               // por defecto 'want_to_play'
  platinum: boolean;                            // 100 % de logros/trofeos; al marcarlo, status = 'completed'
  owned: boolean;                               // «comprado»: independiente del progreso
  createdAt: string;                            // ISO 8601 en UTC
  updatedAt: string;
}
```

- **Etiquetas de la interfaz:** «Quiero jugar», «Jugando», «Completado», «Abandonado», «Platinado» y «Comprado».
- **Sin duplicados:** una sola entrada por juego (por `appid` o, si es libre, por texto normalizado). Si se intenta añadir otra vez, se muestra «Ya está en tu lista» con su estado.
- **Ampliable:** se pueden añadir estados (p. ej. «En pausa») sin romper datos, porque la interfaz trata los valores desconocidos como «Quiero jugar».
- **Más adelante:** prioridad y notas cortas en M2; plataforma de compra en M5.

### 0.6 Viabilidad medida (datos reales y sintéticos)

Medido el 28-10-2026 en el equipo del desarrollador: AMD Ryzen 5 3600, Windows 11, Node 24.21.0 y `node:sqlite` con SQLite 3.53.4.

- **Datos reales:** nombres de la instantánea de S1, tomados de un espejo público en GitHub que publica a diario la salida de `GetAppList` y que solo se usó para medir. Son 196.595 juegos, con 16,7 caracteres de media. La popularidad es sintética, porque la instantánea no la incluye.
- **Datos sintéticos:** generador determinista con semilla 42. Se volvió a ejecutar y reprodujo las cifras del borrador.
- **Consultas:** prefijos de 1 a 12 caracteres de 20 títulos conocidos y de 40 títulos al azar.

| Medición | Real (196.595) | Sintético 250.000 | Sintético 500.000* |
|---|---|---|---|
| Búsqueda en memoria (JS): escaneo lineal + ranking — p50 / p95 / p99 | 7,8 / 10,9 / 12,7 ms | 8,1 / 10,5 / 11,9 ms | 15,9 / 21,1 / 26,1 ms |
| Refinamiento incremental (pulsaciones tras la 2.ª letra) — p95 / p99 | 1,0 / 2,4 ms | 1,9 / 5,2 ms | 7,4 / 11,7 ms |
| Primera consulta de 2 caracteres (escaneo completo) — p95 | 13,6 ms | 15,5 ms | 35,7 ms |
| Memoria JS | ≈ 22 MB (heap total) | ≈ 27 MB | ≈ 53 MB |
| SQLite FTS5 `trigram` (≥ 3 caracteres) — p50 / p95 / p99 | 0,3 / 0,9 / 1,5 ms | 0,6 / 3,6 / 5,8 ms | 0,9 / 8,3 / 13,4 ms |
| SQLite FTS5 `unicode61` + prefijos (≥ 2 caracteres) — p50 / p95 / p99 | 0,1 / 2,0 / 3,9 ms | 0,2 / 3,6 / 6,9 ms | 0,3 / 7,4 / 13,6 ms |
| Índice appid + nombre: bruto / gzip / brotli | 4,95 / 2,44 / 1,80 MB | 6,3 / 2,65 / 2,07 MB | 12,8 / 5,3 / 4,1 MB |
| Ídem, con los appids ordenados y guardados como diferencias (base 36) | 3,90 / 1,97 / **1,47 MB** | — | — |

\* Cifras del borrador, no repetidas.

Otros datos reales que condicionan el diseño:

- **Nivel «populares»** (muestra de títulos reales, en brotli): 10.000 títulos → 97 KB; 15.000 → 142 KB; 20.000 → 186 KB.
- **Cápsulas:** añadir a cada título el *hash* de 40 caracteres hexadecimales de su cápsula sumaría ≈ 4,1 MB en brotli. **La cápsula no puede ir en el índice base.**
- **Calidad de los datos:** 18 entradas sin nombre; 12.583 (6,4 %) en chino/japonés, coreano o cirílico; 985 con ™/®/©.
- **Normalización de §1.6:** da lo esperado: `Pokémon™` → `pokemon`, `Baldur's Gate 3` → `baldurs gate 3`, `DARK SOULS™ III` → `dark souls iii`, `Ⅲ` → `iii`, `ＡＢＣ` → `abc`.

Conclusiones:

1. **Búsqueda local en el móvil.** Un móvil de gama media-baja, como el de referencia, es unas 4–6 veces más lento que este equipo. Con datos reales, el escaneo completo rondaría 44–65 ms p95, y la primera consulta de 2 letras, 54–82 ms: **fuera del presupuesto** sin trabajo adicional. Hacen falta un Web Worker, refinamiento incremental y un nivel «populares» para 1–2 letras (o un índice de prefijos de palabra). Se valida en el móvil real con el panel de diagnóstico.
2. **Búsqueda en servidor (opción B).** La consulta tarda ≤ 2 ms p95 con datos reales, así que no es el cuello de botella: lo que pesa es la red y el arranque en frío del hosting.
3. **Índice en el cliente.** Pesa 1,5–1,8 MB en brotli. Solo es viable como descarga diferida, cacheada y con actualizaciones por diferencias (deltas), nunca en la ruta crítica. Si el CDN comprime al vuelo, el tamaño puede salir algo mayor que con brotli a calidad 11.
4. **`node:sqlite`** funciona en Node 24.21 sin flags ni avisos, con FTS5 y el tokenizador `trigram` con `remove_diacritics`. Solo hace falta en la opción B o desde M3.

Los scripts del bench se incorporarán al repositorio como `scripts/bench-search.ts` (§7.3).

### 0.7 Decisiones que bloquean M1

1. **S8 (legal):** opción A (índice en el cliente) u opción B (búsqueda en servidor).
2. **Qué cuenta como «todos los juegos de Steam».** Recomendación:
   - incluir `type=game`, también los «próximamente», que son muy útiles en una agenda de pendientes;
   - excluir DLC, demos, bandas sonoras y software;
   - ocultar por defecto el contenido adulto.
3. **Repositorio público o privado**, y con qué plan de GitHub (§4.8).
4. **Hosting estático** que cumpla los criterios de §4.3.

## 1. Requisitos no funcionales

### 1.0 Referencias y definiciones de medida

- **Móvil de referencia:** el perfil móvil por defecto de Lighthouse (Moto G Power emulado, CPU ×4, red «Slow 4G» con RTT de 150 ms y ~1,6 Mbps). Se calibra con el móvil real del usuario en M1.
- **Escritorio de referencia:** el equipo del desarrollador, con Chrome estable.
- **Medidas** (todas con `performance.measure`):

| Medida | Desde | Hasta |
|---|---|---|
| `search:keystroke-to-results` | El `event.timeStamp` del `input` | El primer frame con los resultados **de esa consulta** pintados |
| `list:add-feedback` | El evento que añade (`keydown` de Enter o `pointerup`) | El frame con la confirmación visible |
| `time_to_add` | El primer `input` del buscador (en móvil, el toque que lo enfoca) | La confirmación visible |
| `open_to_ready` | El inicio de la navegación | El buscador enfocado e interactivo |

- **Percentiles:** p95/p99 para las latencias propias; p75 para las Web Vitals de campo, cuando haya RUM (desde M6).

### 1.1 Rendimiento («rápida y ágil»)

| ID | Requisito | Objetivo | Cómo se mide | Hito |
|---|---|---|---|---|
| REN-01 | Búsqueda local (en el worker) | p95 ≤ 50 ms y p99 ≤ 100 ms en el móvil de referencia; p95 ≤ 16 ms en el escritorio de referencia | Bench en CI + e2e `perf` (CPU ×4) + panel de diagnóstico en el móvil real | M1 |
| REN-02 | Confirmación del alta | ≤ 100 ms p95 (objetivo: 50 ms); persistencia local ≤ 50 ms; nunca espera a la red | `list:add-feedback` + Event Timing | M0 |
| REN-03 | Flujo «apuntar un juego» | `time_to_add`: mediana < 3 s, con 5 juegos distintos tecleados a ~10 teclas/s; ≤ 500 ms atribuibles al sistema. En móvil incluye un toque, porque el teclado no se abre sin él | e2e con Playwright (§2.5) | M0 (semilla) · M1 (catálogo completo) |
| REN-04 | De abrir la app a juego apuntado | PWA instalada, en caliente: mediana ≤ 4 s (`open_to_ready` ≤ 1 s + el flujo) | e2e con service worker + panel de diagnóstico | M1 |
| REN-05 | Primera visita (móvil de referencia) | FCP ≤ 1,8 s; LCP ≤ 2,5 s; buscador usable en ≤ 3 s; nivel «populares» buscable en ≤ 3,5 s. Nunca espera al índice completo | Lighthouse CI + e2e con red emulada | M1 |
| REN-06 | Visitas repetidas | `open_to_ready` ≤ 1 s en caliente y ≤ 1,5 s en frío; índice completo listo en el worker en ≤ 1 s desde la caché | e2e con service worker | M1 |
| REN-07 | Interactividad | INP ≤ 200 ms (≤ 100 ms al buscar y al añadir); TBT ≤ 200 ms; 0 tareas largas (> 50 ms) en el hilo principal mientras se teclea | Lighthouse + Long Tasks API en los e2e | M1 |
| REN-08 | Índice del catálogo en el cliente | Completo ≤ 2,0 MB brotli (hoy, 1,47 MB; revisar al pasar de 250.000 títulos); «populares» ≤ 150 KB (~15.000 títulos); delta diario ≤ 100 KB; memoria del worker ≤ 40 MB. Con `Save-Data` o red lenta, el índice completo solo se descarga si el usuario lo pide | Artefacto de `catalog-sync` + e2e | M1 |
| REN-09 | Detalles de los resultados (año, cápsula) | Nunca bloquean la lista: los nombres se pintan primero. Los detalles llegan bajo demanda en ≤ 300 ms p95 (banda ancha). Las cápsulas llevan `loading="lazy"`, `width`/`height` y una imagen provisional sin red; nunca son el elemento LCP | e2e + Lighthouse | M1 |
| REN-10 | CLS | ≤ 0,1; nada se desplaza por encima del buscador | Lighthouse | M1 |
| REN-11 | Peso inicial | JS de la ruta principal ≤ 100 KB gzip; CSS ≤ 20 KB; fuentes del sistema; primera carga ≤ 300 KB sin contar el índice ni las carátulas | Control de tamaño en cada PR + Lighthouse CI | M0 |
| REN-12 | Listas | Con 500 entradas: filtrar y ordenar en ≤ 50 ms p95 sin virtualizar. Con 5.000 entradas, cuando lleguen las importaciones | e2e con un usuario «pesado» | M2 · M5 |
| REN-13 | Búsqueda remota (solo en la opción B, o desde M3) | p95 ≤ 300 ms en banda ancha y ≤ 500 ms en Slow 4G, **con la conexión ya abierta** (`preconnect` al cargar) y contando un *debounce* ≤ 100 ms. Servidor: p95 ≤ 25 ms (consulta ≤ 5 ms). Hosting sin suspensión: arranque en frío ≤ 300 ms o instancia siempre activa | e2e con red emulada | B · M3 |
| REN-14 | Sincronización del catálogo | Incremental ≤ 15 min. Completa ≤ 60 min: 4 llamadas de enumeración + 1.000–2.000 lotes a ≤ 1 petición/s ≈ 17–33 min, más margen para los reintentos | `sync-report.json` | M1 |
| REN-15 | Frescura | Un juego nuevo llega al índice publicado en ≤ 24 h (p95). El cliente consulta `latest.json` al abrirse (como mucho, cada 6 h) y aplica el delta | `sync-report.json` + e2e | M1 |

Reglas de diseño que se derivan de estos objetivos:

- **Umbrales de búsqueda:** con 1 carácter, solo prefijos sobre «populares»; desde 2, el catálogo completo.
- **Resultados etiquetados:** cada lista de resultados lleva el identificador de la consulta a la que responde. `Enter` solo actúa sobre los resultados de la consulta actual: si están obsoletos, espera ≤ 150 ms a los nuevos o no hace nada. Así, nunca se añade un juego equivocado por teclear deprisa.
- **Trabajo obsoleto:** se descarta (identificador de mensaje en el worker; `AbortController` en la opción B). Cada consulta normalizada se guarda en una caché en memoria.
- **Normalización:** se hace en `catalog-sync`; el cliente solo lee el resultado.
- **Detalles bajo demanda:** año, cápsula y popularidad salen de ficheros estáticos troceados por appid (p. ej. 1.024 ficheros según `appid % 1024`, de ~6 KB comprimidos cada uno), o de la API en la opción B. Solo se piden para los resultados visibles y se cachean.

### 1.2 Fiabilidad y modo sin red

| ID | Requisito | Hito |
|---|---|---|
| FIA-01 | **Steam fuera del camino crítico:** 0 llamadas a la API de Steam desde el cliente o como respuesta a una acción del usuario; del CDN solo se cargan imágenes. Las importaciones de M5 son tareas asíncronas que inicia el usuario y que nunca bloquean la interfaz. | M0 |
| FIA-02 | **Núcleo sin red:** tras la primera visita, la app se abre y permite ver la lista, añadir, cambiar el estado y exportar sin conexión (esqueleto de la app en el service worker + IndexedDB). | M1 |
| FIA-03 | **Búsqueda sin red:** completa si el índice está en caché. Si no, busca en «populares» y en los juegos ya vistos, y permite el alta como texto libre. Cuando llega el índice, se propone vincular esas entradas a su juego. | M1 |
| FIA-04 | **Publicación segura del catálogo:** no se publica si el catálogo encoge más de un 5 %, si fallan más del 1 % de las apps o si más del 0,5 % no cumple el esquema. La publicación es atómica (§4.4). Si una versión nueva no se descarga o no valida, el cliente sigue con la anterior. | M1 |
| FIA-05 | **Fiabilidad de la tarea:** ≥ 95 % de ejecuciones correctas al mes; alerta si pasan más de 36 h sin una correcta; repetir una ejecución no duplica nada. | M1 |
| FIA-06 | **Persistencia local:** se pide `navigator.storage.persist()` tras la primera alta. Si se deniega, o si hay más de 20 entradas y no se ha exportado en 30 días, se recuerda exportar. En iOS, Safari puede borrar los datos de una web no instalada tras 7 días sin uso, así que se recomienda instalar la PWA. | M0 · M1 |
| FIA-07 | **Degradación:** si falla la descarga del índice o de los detalles, el buscador sigue con lo que haya en caché y muestra un aviso discreto (`aria-live="polite"`). Nunca una pantalla en blanco. | M1 |
| FIA-08 | **Migraciones locales:** el esquema de IndexedDB tiene versión y migraciones probadas. La exportación también tiene versión (`gameagenda-export.v1`) y se puede volver a importar. | M0 |
| FIA-09 | **Carátulas en caché:** con un límite (p. ej. 300, descartando las menos usadas). Se piden en modo CORS si el CDN lo permite, porque las respuestas opacas inflan la cuota de almacenamiento. | M1 |
| FIA-10 | **Sincronización entre dispositivos** (desde M3): <ul><li>cola persistente de operaciones (*outbox*), cada una con un identificador UUID;</li><li>en caso de conflicto, gana la última escritura en cada campo;</li><li>los dispositivos convergen en ≤ 10 s al recuperar la red, comprobado con secuencias aleatorias de operaciones;</li><li>RPO ≤ 24 h y RTO ≤ 8 h, con una restauración probada antes de abrir cuentas a terceros.</li></ul> | M3 |

### 1.3 Seguridad (resumen; detalle en §6)

| ID | Requisito | Hito |
|---|---|---|
| SEG-01 | Clave de Steam: 0 apariciones en el cliente, el repositorio, los *fixtures*, los artefactos o los logs | M0 |
| SEG-02 | HTTPS, HSTS, CSP sin `unsafe-inline` en los scripts, `nosniff`, `Referrer-Policy` y `frame-ancestors 'none'`. Exige un hosting que permita cabeceras personalizadas (§4.3). Nota A en Mozilla HTTP Observatory en M6 | M1 · M6 |
| SEG-03 | Los datos de Steam son entrada no confiable: se muestran como texto (nunca con `innerHTML`) y las descripciones se sanean al ingerirlas | M1 |
| SEG-04 | Dependencias: *lockfile*, `npm ci` y 0 vulnerabilidades altas o críticas sin mitigar en producción al cerrar cada hito | M0 |
| SEG-05 | Con backend o cuentas: OWASP ASVS 5.0 nivel 1 **completo** antes de abrir cuentas a terceros, y limitación de tasa en todos los endpoints públicos | M3 |

### 1.4 Privacidad (bases que debe validar el track legal)

| ID | Requisito | Hito |
|---|---|---|
| PRI-01 | **Prototipo (M0–M2):** la lista no sale del dispositivo. No hay cookies, analítica, RUM ni identificadores. El hosting registra direcciones IP, así que, si la URL es pública, hace falta un aviso legal y de privacidad mínimo (texto del track legal). | M1 |
| PRI-02 | IndexedDB y la caché del service worker solo guardan lo que pide el usuario, por lo que estarían exentos de consentimiento (art. 22.2 LSSI-CE; a confirmar). | M0 |
| PRI-03 | **Errores:** por defecto, un registro local en el panel de diagnóstico que el usuario puede copiar. Un error tracker de terceros, solo con el visto bueno legal, en región UE, sin datos personales, con las URL depuradas y sin grabación de sesiones. | M1 |
| PRI-04 | **Con cuentas (M3):** <ul><li>minimización: email o identificador del proveedor, la lista y las fechas;</li><li>bases jurídicas: art. 6.1.b RGPD (cuenta y lista) y art. 6.1.f (seguridad);</li><li>encargados del tratamiento con contrato del art. 28, preferiblemente en la UE/EEE;</li><li>exportación y borrado de la cuenta en autoservicio: el borrado se aplica en la BD en ≤ 24 h y en las copias en ≤ 35 días, y queda un registro de borrados para volver a aplicarlos tras una restauración;</li><li>solicitudes respondidas en ≤ 1 mes (art. 12.3) y brechas notificadas a la AEPD en ≤ 72 h (art. 33);</li><li>registro de actividades de tratamiento (art. 30) y política de privacidad por capas en español.</li></ul> | M3 |
| PRI-05 | **Edad mínima:** hoy es de 14 años (art. 7 LOPDGDD). Un proyecto de ley de protección de menores en entornos digitales propone elevarla a 16: hay que confirmar su estado con el track legal antes de M3. | M3 |
| PRI-06 | **Logs del backend:** sin emails ni texto de búsquedas; la IP, truncada o con *hash* y sal rotatoria. Retención: logs ≤ 30 días; errores ≤ 90. | M3 |
| PRI-07 | **Analítica:** solo tras el dictamen legal, sin cookies ni identificadores persistentes y respetando la señal GPC. | M6 |

### 1.5 Accesibilidad (WCAG 2.2 AA)

| ID | Requisito |
|---|---|
| ACC-01 | WCAG 2.2 nivel AA como objetivo de diseño en todos los flujos. |
| ACC-02 | El buscador sigue el patrón *combobox* de WAI-ARIA APG (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `listbox`/`option`). El número de resultados se anuncia agrupado, con `aria-live="polite"`. |
| ACC-03 | Todo se puede usar con teclado: `/` enfoca el buscador, `Enter` añade el resultado activo y `Esc` cierra. El foco siempre es visible (2.4.7) y nunca queda tapado (2.4.11). |
| ACC-04 | Objetivos táctiles ≥ 24×24 px CSS (2.5.8), y 44×44 en las acciones principales. En móvil, el buscador es el primer elemento, arriba y grande, porque hace falta un toque para abrir el teclado. |
| ACC-05 | Si se puede reordenar arrastrando, hay una alternativa sin arrastre (2.5.7): «subir», «bajar», «mover a…». |
| ACC-06 | Los estados llevan texto o icono además de color (1.4.1). Contraste de 4,5:1 en texto y de 3:1 en componentes (1.4.3 y 1.4.11), también en modo oscuro. |
| ACC-07 | *Reflow* a 320 px (1.4.10), zoom al 200 % (1.4.4), respeto de `prefers-reduced-motion` y `lang="es"`. |
| ACC-08 | Con cuentas (M3), autenticación accesible (3.3.8): sin pruebas cognitivas, y se puede pegar y usar gestores de contraseñas. |
| ACC-09 | **Verificación en el prototipo:** axe-core en los e2e (0 violaciones *serious* o *critical*), un e2e solo con teclado, Lighthouse Accesibilidad ≥ 95 y una pasada manual con NVDA al cerrar cada hito. TalkBack y VoiceOver, antes de la beta. |

### 1.6 Idioma, formatos y normalización

| ID | Requisito |
|---|---|
| I18N-01 | Interfaz en es-ES. Desde M0, todas las cadenas viven en un único módulo (`src/i18n/es.ts`), para poder traducir sin reescribir componentes. En el prototipo no hay ICU, pseudolocalización ni inglés; el inglés queda como opción posterior. |
| I18N-02 | Fechas, plurales y listas con `Intl`. Orden alfabético con `Intl.Collator('es', { sensitivity: 'base' })`. |
| I18N-03 | **Normalización de búsqueda** (verificada en §0.6), en este orden: <ol><li>quitar ™ ℠ ® © **antes** de NFKD, porque NFKD convierte ™ en «TM»;</li><li>aplicar NFKD y eliminar las marcas diacríticas;</li><li>pasar a minúsculas;</li><li>eliminar los apóstrofos `'`, `’`, `‘` y `` ` `` (`Baldur's` y `Baldur’s` → `baldurs`);</li><li>convertir el resto de signos en espacios y colapsar los espacios repetidos.</li></ol>En M2 se añaden sinónimos: III ↔ 3, `&` ↔ and/y y acrónimos como GTA. |
| I18N-04 | El contenido de Steam se pide en español cuando existe, con el inglés como alternativa. Se guarda el idioma de cada campo. |
| I18N-05 | Las fechas se guardan en UTC (ISO 8601) y se muestran en la zona horaria del usuario (por defecto, Europe/Madrid). |

### 1.7 Navegadores y dispositivos

| ID | Requisito |
|---|---|
| COM-01 | Lo que no tenga alternativa debe estar en Baseline «Widely available»; lo «Newly available», solo como mejora progresiva. |
| COM-02 | **Prioridad 1:** Chrome para Android y Safari para iOS (2 últimas versiones mayores), y Chrome y Edge de escritorio (2 últimas). **Mejor esfuerzo en el prototipo:** Firefox (última versión + ESR), Samsung Internet y Safari para macOS. |
| COM-03 | Anchos de 320 a 2560 px; táctil, ratón y teclado. |
| COM-04 | PWA instalable en Android y en Chrome/Edge de escritorio; «Añadir a pantalla de inicio» en iOS. |
| COM-05 | Steam Deck en modo escritorio: mejor esfuerzo, sin navegación con mando. |
| COM-06 | e2e en cada PR con Chromium de escritorio y móvil emulado. WebKit y Firefox: una pasada manual al cerrar cada hito; automática desde M4. |

### 1.8 Mantenibilidad, coste y escala

| ID | Requisito |
|---|---|
| MAN-01 | Cobertura ≥ 80 % (líneas y ramas) en `domain` (normalización, ranking y reglas del modelo) y en la lógica de diferencias y guardarraíles de `catalog-sync`. Sin objetivo global. |
| MAN-02 | CI de una PR en ≤ 10 min (p90); tests unitarios en local en ≤ 30 s. |
| MAN-03 | De clonar el repo a tener la app funcionando sin red con datos semilla: ≤ 10 min en Windows 11 con Node 24 (`npm run setup && npm run dev`). |
| MAN-04 | Coste del prototipo: 0 €. Tope de 10 €/mes, con alerta de gasto en cuanto haya un servicio de pago. |
| MAN-05 | Escala de diseño del prototipo: 1–100 usuarios (en la opción A, escala el CDN); 200.000–500.000 títulos; ≤ 2.000 entradas por usuario (5.000 con las importaciones de M5). |

## 2. Estrategia de pruebas

### 2.1 Niveles y herramientas

| Nivel | Qué cubre | Herramienta (marcador) | Dónde se ejecuta |
|---|---|---|---|
| Unitarias | Normalización, ranking, reglas de los estados, unicidad, aplicación de deltas y resultados etiquetados | `<unit-runner>` (p. ej. Vitest o `node:test`) | Local + cada PR |
| Contrato | Respuestas grabadas de Steam frente a sus esquemas; formato del índice y de la exportación | `<schema-lib>` + `<http-mock>` (p. ej. MSW) | Local + cada PR, sin red |
| Integración de `catalog-sync` | La tubería completa con *fixtures*: diferencias, guardarraíles, publicación atómica y caos | `<unit-runner>` + un almacén simulado en disco | Local + cada PR |
| E2E | Flujos reales: «apuntar en < 3 s», sin red, solo con teclado y accesibilidad | Playwright + `@axe-core/playwright` | Cada PR (Chromium de escritorio + móvil emulado) |
| Rendimiento | Bench de búsqueda, Lighthouse CI y tamaño del bundle | `scripts/bench-search.ts`, `@lhci/cli`, `<size-check>` | Cada PR (si aplica) |
| Manual | Móvil real (panel de diagnóstico), NVDA, WebKit y Firefox | Checklist por hito | Al cerrar cada hito |

Las pruebas de integración con base de datos (migraciones, IDOR, autorización) solo existen en la opción B o desde M3 (§2.3).

### 2.2 Unitarias (casos obligatorios)

- **Normalización:** los ejemplos de §0.6, además de `Baldur’s` (con apóstrofo tipográfico), emojis, escritura no latina (que se conserva) y cadenas vacías.
- **Ranking:** coincidencia exacta > prefijo > inicio de palabra > subcadena; desempate por popularidad (S11); orden estable.
- **Modelo:**
  - marcar «platinado» pone `status = 'completed'`;
  - «comprado» no cambia el progreso;
  - se puede pasar de cualquier estado a cualquier otro;
  - un valor desconocido se lee como `want_to_play`;
  - no se crean duplicados ni por `appid` ni por texto normalizado.
- **Deltas del índice:** aplicar un delta dos veces equivale a aplicarlo una. Si un delta no corresponde a la versión siguiente, se rechaza y se descarga el índice completo.
- **Resultados etiquetados:** pulsar `Enter` con resultados obsoletos no añade el juego anterior.

### 2.3 Integración de `catalog-sync` (y de la BD, cuando exista)

- **Idempotencia:** dos ejecuciones con las mismas respuestas producen la misma instantánea, byte a byte.
- **Reanudación:** si la ejecución se corta a mitad del enriquecimiento, se publica una versión coherente y la siguiente continúa con lo pendiente (§4.4).
- **Guardarraíles:** si la enumeración encoge un 6 %, no se publica nada y el informe explica por qué.
- **Nombres vacíos:** se completan con `GetItems` o se excluyen, y el informe los cuenta.
- **Juegos retirados:** las apps que desaparecen de la enumeración se marcan con `delisted_at`. Las listas no se rompen, porque guardan su propia copia.
- **Publicación atómica:** un fallo a mitad deja `latest.json` intacto.
- **Duración:** la suite tarda ≤ 2 min.
- **Opción B o M3:** cada *worker* de test usa una BD nueva con las migraciones aplicadas desde cero. Hay tests de la restricción única y de IDOR (A no puede leer ni modificar la lista de B).

### 2.4 Contrato contra *fixtures* grabados de Steam (sin llamadas reales en CI)

1. **Grabación** (manual, en local): `npm run fixtures:record -- --appids=…`, con la clave en `.env.local`. Se guarda una petición por fichero en `fixtures/steam/<endpoint>/<caso>.json`, con:
   - `request`, cuya URL lleva `key=REDACTED`;
   - `recordedAt`, `status` y las cabeceras relevantes;
   - `body`.
2. **Autocomprobación:** el grabador falla si algún fichero contiene el valor de la clave o un parámetro `key` sin redactar. El *pre-commit* local repite la comprobación con el valor exacto de la clave.
3. **Casos mínimos:**
   - páginas pequeñas de la enumeración;
   - lotes de `GetItems` con:
     - juegos gratuitos, «próximamente» y con contenido adulto;
     - nombres no latinos, con ™/® o vacíos;
     - DLC, demos y bandas sonoras, para probar los filtros;
     - distintos estados de compatibilidad con Steam Deck;
     - appids inexistentes;
   - respuestas sintéticas: 429 (con y sin `Retry-After`), 500, tiempo de espera agotado, JSON malformado y lista vacía.
4. **Esquemas tolerantes:** solo describen los campos que se usan. Los desconocidos se ignoran y los obligatorios se exigen sin excepciones. Los tests leen todos los *fixtures*.
5. **Triple barrera contra la red real en CI:**
   - `STEAM_MODE=fixtures`: el cliente rechaza las llamadas reales;
   - `onUnhandledRequest: 'error'` en el mock HTTP;
   - `ci.yml` no tiene ningún secreto.
6. **Cambios de formato en Steam:** se detectan en producción, no en CI. `catalog-sync` valida cada respuesta con los mismos esquemas, cuenta `schema_violations_total` y no publica si se supera el umbral (FIA-04).
7. **Pruebas de caos:** la tubería completa con fallos inyectados (ráfagas de 429, errores 5xx, cortes a mitad). Comprueban los reintentos con espera creciente, el cortacircuitos y la reanudación sin duplicados.

### 2.5 E2E con Playwright: «apuntar un juego en < 3 s»

**Entorno:**
- build de producción, servido con las mismas cabeceras que en producción (p. ej. el fichero de cabeceras del hosting);
- índice generado a partir del catálogo semilla;
- `STEAM_MODE=fixtures`;
- red externa bloqueada con `context.route` (solo se sirve `localhost`);
- el test falla si se dispara un evento `securitypolicyviolation`.

```ts
import { test, expect } from '@playwright/test';

// 5 juegos distintos del catálogo semilla: cada vuelta añade uno nuevo, sin duplicados.
const cases = [
  { query: 'hollow', name: /Hollow Knight/ },
  { query: 'elden', name: /ELDEN RING/ },
  { query: 'hades', name: /Hades/ },
  { query: 'celeste', name: /Celeste/ },
  { query: 'stardew', name: /Stardew Valley/ },
];

test('apuntar un juego en menos de 3 s (mediana de 5)', async ({ page }) => {
  const durations: number[] = [];
  for (const { query, name } of cases) {
    await page.goto('/');
    const searchBox = page.getByRole('combobox', { name: 'Buscar juego' });
    await expect(searchBox).toBeFocused();                      // escritorio: se escribe sin tocar nada
    const t0 = Date.now();
    await searchBox.pressSequentially(query, { delay: 100 });   // ritmo humano, ~10 teclas/s
    await expect(page.getByRole('option').first()).toHaveAccessibleName(name);
    await page.keyboard.press('Enter');                         // añade el resultado activo
    await expect(page.getByRole('status')).toContainText('Añadido a Quiero jugar');
    durations.push(Date.now() - t0);
    const feedbackMs = await page.evaluate(
      () => performance.getEntriesByName('list:add-feedback').at(-1)?.duration ?? Number.POSITIVE_INFINITY,
    );
    expect(feedbackMs).toBeLessThan(100);                       // latencia del sistema, de performance.measure
  }
  durations.sort((a, b) => a - b);
  expect(durations[2]).toBeLessThan(3000);                      // mediana de 5
});
```

- **Proyectos de Playwright:**
  - `chromium` (escritorio);
  - `mobile-chromium` (Pixel emulado): el flujo empieza con un `tap` en el buscador;
  - `perf`: Chromium con la CPU ralentizada ×4 (`Emulation.setCPUThrottlingRate`, vía CDP). Mide `search:keystroke-to-results` en 20 iteraciones, compara el p95 con REN-01 y no reintenta.
- **Contra los tests inestables:** la aserción de tiempo usa la mediana, y las latencias del sistema se leen de `performance.measure`, no de los relojes del test.
- **Otros e2e del prototipo:**
  - alta con un toque en móvil, y «Deshacer»;
  - añadir un juego que ya está → «Ya está en tu lista»;
  - teclear muy rápido (`delay: 0`) y pulsar `Enter` en el acto → se añade el juego de la consulta final;
  - pegar `https://store.steampowered.com/app/<appid>/…` → alta directa;
  - sin red (`context.setOffline(true)`): abrir, añadir y recargar sin perder datos;
  - cambiar el estado con un toque (M1);
  - el flujo completo solo con teclado;
  - axe en cada pantalla.

### 2.6 Rendimiento

- **Bench de búsqueda en CI**, en las PR que tocan `search/**` o `shared/**`.
  - Datos: la instantánea real más reciente publicada por `catalog-sync`, descargada del catálogo público. En M0, el sintético de 250.000 títulos con semilla 42.
  - Falla si en el runner se supera alguno de estos topes: escaneo completo p95 > 20 ms; pulsaciones incrementales p95 > 5 ms; en la opción B, consulta a la BD p95 > 5 ms.
  - La evolución queda en el resumen del job. La comparación automática con `main` llega en M4.
- **Conjunto de referencia de relevancia (*golden set*):** unas 50 consultas, cada una con su appid esperado (`elden` → ELDEN RING, `hollow kn` → Hollow Knight, `witcher 3`, `baldurs`; `dark souls 3` cuenta como sinónimo desde M2). Objetivo: el juego esperado está entre los 3 primeros en ≥ 95 % de las consultas y es el primero en ≥ 80 %.
- **Lighthouse CI** en cada PR, con el perfil móvil, 3 ejecuciones y la mediana:

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

- **Tamaño:** en cada PR se comprueban los bytes comprimidos de cada *chunk* (JS inicial ≤ 100 KB gzip) y el tamaño del índice semilla.
- **En el móvil real:** al cerrar M1 y M2, 3 sesiones de 20 búsquedas con el panel de diagnóstico (§5.2). El p95 se anota en la PR que cierra el hito.
- **Más adelante:**
  - RUM con `web-vitals` (M6, tras el dictamen legal);
  - prueba de carga de la API (opción B o M3): 50 peticiones/s durante 5 min, con una herramienta que se instale con npm (p. ej. autocannon).

### 2.7 Datos de prueba

| Conjunto | Contenido | ¿Se versiona? |
|---|---|---|
| `fixtures/steam/` | Respuestas reales grabadas y redactadas (≤ 300 apps, ≤ 2 MB) | Sí; si el repo es público, con el visto bueno del track legal |
| `fixtures/catalog/seed.jsonl` | ~300 juegos (populares + casos límite), generado por un script a partir de los *fixtures* | Sí |
| Instantánea real para el bench | La última publicada por `catalog-sync` | No (se descarga del catálogo publicado) |
| Sintético grande | 250.000–500.000 títulos deterministas | No (se genera y se guarda en la caché del CI) |
| Listas | Factorías; usuario demo (~30 entradas en todos los estados); usuario «pesado» (500 entradas; 5.000 en M5) | En el código |

### 2.8 Puertas de calidad

| Momento | Comprobaciones | ¿Bloquea? |
|---|---|---|
| *Pre-commit* (local, opcional) | Formato de los ficheros modificados; que el valor de la clave no aparezca en lo preparado para el commit | No: la autoridad es el CI |
| Cada PR (un único job) | Formato, lint y tipos; tests unitarios, de contrato y de integración de `catalog-sync`; build y tamaño; e2e en Chromium (escritorio + móvil) con axe; proyecto `perf`; Lighthouse CI; bench (si aplica); escáner de secretos; `npm audit --omit=dev`; título de la PR en Conventional Commits | Sí |
| Merge a `main` | El hosting despliega a producción y se pasa un *smoke test* | Bloquea el despliegue |
| Cierre de hito | Checklist manual (móvil real, NVDA, WebKit y Firefox), con todo en verde | Sí |
| Desde M4 | Matriz nocturna de navegadores y comparación del bench con `main` | No: abre una incidencia |

## 3. Herramientas y convenciones

### 3.1 Estructura del repositorio

**Recomendación para el prototipo:** una sola app con carpetas, sin *workspaces* ni Turborepo/Nx. Las fronteras entre carpetas las vigila el lint.

```
gameagenda/
├─ app/                    # <frontend> PWA
│  └─ src/{domain,search,storage,ui,i18n}/
├─ shared/                 # sin E/S: normalización, formato del índice, esquemas
├─ steam-client/           # cliente HTTP de Steam + esquemas + grabador de fixtures
├─ jobs/catalog-sync/      # CLI de la tarea programada (Node 24, TypeScript)
├─ fixtures/{steam,catalog}/
├─ docs/adr/
├─ scripts/                # setup, bench… en TypeScript (Node 24 los ejecuta directamente)
└─ .github/workflows/
```

Reglas de imports, vigiladas por el lint:
- `shared` y `app/src/domain` no importan nada que haga E/S;
- `app` no importa `steam-client`;
- solo `steam-client` y `jobs/catalog-sync` leen `STEAM_WEB_API_KEY`.

Alternativas:
- **npm workspaces:** cuando el código compartido empiece a dar problemas.
- **Backend o tarea en Rust:** no para el prototipo. Supone dos *toolchains* y compilaciones más lentas para un solo desarrollador. Se puede reconsiderar para la tarea si Node se queda corto, algo que hoy no se espera (§0.6).

### 3.2 Lint, formato y tipos

- **Una sola herramienta para lint y formato** (se decide en ADR-0001):
  - recomendación: Biome, que es rápido, se instala con npm como un único binario e incluye reglas de accesibilidad y de imports restringidos;
  - alternativa: ESLint (configuración *flat*) + typescript-eslint + Prettier, si hace falta algún plugin concreto.
- **TypeScript estricto:** `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax` y `erasableSyntaxOnly`. En CI se ejecuta `tsc --noEmit`.
- **Scripts `.ts` ejecutados directamente por Node 24.** Node elimina los tipos al vuelo (*type stripping*), verificado sin avisos. Condiciones:
  - los imports relativos llevan la extensión `.ts` (con `allowImportingTsExtensions` y `noEmit`, o con `rewriteRelativeImportExtensions` si se compila);
  - no se usan `enum`, `namespace` ni propiedades de parámetro: Node rechaza `enum` (verificado) y `erasableSyntaxOnly` lo detecta antes.
- **Validación en tiempo de ejecución en las fronteras**, con `<schema-lib>` y tipos inferidos del esquema. Se valida:
  - las respuestas de Steam;
  - los ficheros del índice al cargarlos;
  - el JSON que se importa;
  - las variables de entorno.
- **Ficheros de configuración:** `.editorconfig`, y `.gitattributes` con `* text=auto eol=lf`.

### 3.3 Commits, ramas y PRs

- **Conventional Commits 1.0** en el título de la PR, que se fusiona con *squash*. No hace falta `commitlint` local, porque el CI valida el título.
  - Formato: `tipo(ámbito): descripción`, con tipo y ámbito en inglés y la descripción en español. Ejemplo: `feat(search): añade refinamiento incremental en el worker`.
  - Tipos: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `ci`, `chore`, `revert`.
  - Ámbitos: `app`, `search`, `domain`, `storage`, `sync`, `steam`, `ui`, `a11y`, `ci`, `deps`.
- **Trunk-based:** `main` siempre se puede desplegar, las ramas son cortas (≤ 2 días) y lo incompleto se oculta tras un interruptor de configuración (*feature flag*).
- **Protección de `main`:** PR obligatoria con 0 aprobaciones, checks requeridos y sin *force-push*. Solo está disponible en repos públicos o con GitHub Pro (§4.8). En un repo privado Free, el CI se ejecuta también en cada `push` a `main` y la norma es no fusionar nunca en rojo.
- **Gestión del trabajo:** GitHub Issues con los milestones M0–M2. El tablero (Project) es opcional.

### 3.4 ADR (formato MADR ligero)

Cada ADR ocupa como mucho una página: contexto, opciones, decisión y consecuencias.

| ADR | Decisión | Necesaria para |
|---|---|---|
| 0001 | Plataforma y stack: PWA, framework, estructura del repo, lint y formato, hosting estático (§4.3), idioma del código y de los documentos | M0 |
| 0002 | Búsqueda y distribución del catálogo: opción A o B; niveles, formato y deltas del índice; detalles bajo demanda; imágenes enlazadas o con proxy | M1 |
| 0003 | Ingesta: qué entra en «todos los juegos», enumeración y diferencias, enriquecimiento, guardarraíles y publicación atómica | M1 |
| 0004 | Modelo de datos y persistencia local: la entrada y sus estados (§0.5), identidad del juego multiplataforma (`game.source`), IndexedDB, migraciones y exportación | M0 |
| 0005 | Seguridad y privacidad del prototipo: secretos, CSP, ausencia de telemetría y aviso legal | M1 |
| 0006 en adelante | Cuentas y sincronización (M3), backend/API (opción B o M3), otras plataformas (M5), observabilidad y analítica (M6) | Más adelante |

### 3.5 Definition of Done (prototipo)

- [ ] Criterios de aceptación cumplidos y demostrados en la preview.
- [ ] Tests unitarios para la lógica y e2e si se toca el flujo principal. CI en verde.
- [ ] Presupuestos respetados: tamaño, Lighthouse CI y bench.
- [ ] Accesibilidad: teclado, etiquetas y 0 violaciones axe *serious* o *critical*.
- [ ] Cadenas en `src/i18n/es.ts`; ningún `any` nuevo sin justificar.
- [ ] Sin secretos; dependencias nuevas revisadas (licencia, mantenimiento y *scripts* de instalación).
- [ ] README o ADR actualizados si cambia una decisión o un formato.

### 3.6 Versionado y releases

- **Una etiqueta por hito:** `v0.0.1` (M0), `v0.1.0` (M1) y `v0.2.0` (M2), cada una con una GitHub Release cuyas notas se generan automáticamente. *release-please* y el CHANGELOG automático en español llegan en M6.
- **Versión y SHA** visibles en «Acerca de» y en el panel de diagnóstico.
- **Formatos versionados:**
  - el índice del cliente (`catalog-index.v1`);
  - el esquema de IndexedDB, con tests de migración;
  - la exportación (`gameagenda-export.v1`).

### 3.7 Dependencias y cadena de suministro

- **Dependabot** para npm y GitHub Actions: semanal y agrupado, esperando 3–7 días antes de proponer versiones recién publicadas (*cooldown*).
- **Reproducibilidad:** `package-lock.json` versionado, `npm ci`, y `engines` + `.node-version` con 24.x. El paso a la siguiente LTS lo decide el track de versiones.
- **`ignore-scripts=true` en `.npmrc`:** viable en la opción A, que no usa módulos nativos.
- **Acciones de terceros** fijadas por SHA y con `permissions` mínimos.
- **Licencias permitidas:** MIT, Apache-2.0, BSD e ISC. Las GPL/AGPL se revisan una a una.

## 4. CI/CD en GitHub Actions

### 4.1 Workflows del prototipo

| Workflow | Disparador | Propósito | Secretos |
|---|---|---|---|
| `ci.yml` | `pull_request` y `push` a `main` | Puertas de calidad (§2.8) | Ninguno |
| `catalog-sync.yml` | `schedule` diario + `workflow_dispatch` | Sincronizar y publicar el catálogo | Los del entorno `catalog-sync` (en privado Free, del repositorio) |
| Despliegue de la web | Integración Git del hosting: `main` → producción; cada PR → preview | Publicar la PWA | Ninguno en GitHub. Sin integración Git, un token de despliegue con el alcance mínimo |

Más adelante: `nightly.yml` (M4), *release-please* (M6) y despliegue con `staging` (M3).

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
  STEAM_MODE: fixtures              # el cliente de Steam rechaza las llamadas reales
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@<sha>
        with: { fetch-depth: 0 }    # el escáner de secretos revisa el historial
      - run: <escáner de secretos, p. ej. gitleaks>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: .node-version, cache: npm }
      - run: npm ci
      - run: npm audit --omit=dev --audit-level=high
      - run: npm run check          # formato, lint, tipos, unitarias, contrato, integración, build y tamaño
      - uses: actions/cache@<sha>
        with:
          path: ~/.cache/ms-playwright
          key: pw-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - run: npx playwright install --with-deps chromium
      - run: npm run test:e2e -- --project=chromium --project=mobile-chromium --project=perf
      - run: npm run lhci           # reutiliza el build de `check`
      - run: npm run bench:search -- --ci
```

Un único job evita repetir `npm ci` y el build, y los e2e y Lighthouse usan el mismo `dist/`. Objetivo: ≤ 10 min (MAN-02).

### 4.3 Despliegue y criterios del hosting estático

El hosting se elige en ADR-0001 y debe cumplir esto:

1. HTTPS, dominio propio opcional y una capa gratuita suficiente para el prototipo.
2. **Cabeceras HTTP personalizadas** (CSP, HSTS…); sin ellas no se puede cumplir SEG-02. GitHub Pages, por ejemplo, no las permite.
3. Previews por PR y *rollback* a un despliegue anterior.
4. Redirección de todas las rutas a la SPA y control de la caché:
   - los *assets* con *hash* en el nombre, con `immutable`;
   - `index.html`, el service worker y `latest.json`, sin caché larga.
5. Catálogo servido **desde el mismo origen** (p. ej. en la ruta `/catalog/`), o desde otro origen con CORS, lo que obliga a ampliar `connect-src`.
6. Proveedor en la UE o con garantías RGPD (lo valida el track legal).

*Rollback*:
- **web:** volver a desplegar el build anterior;
- **catálogo:** apuntar `latest.json` a la versión anterior (se conservan las 7 últimas).

En la opción B o desde M3, la API tiene sus propios criterios (REN-13): sin suspensión, cerca de los usuarios y con migraciones compatibles con la versión anterior (*expand/contract*).

### 4.4 `catalog-sync.yml` (tarea programada con secretos)

```yaml
name: catalog-sync
on:
  schedule:
    - cron: '17 5 * * *'            # 05:17, lejos del minuto 0 (menos retrasos)
      timezone: 'Europe/Madrid'     # zona IANA: GitHub Actions la admite (documentación consultada hoy)
  workflow_dispatch:
    inputs:
      mode: { type: choice, options: [incremental, full], default: incremental }
      dry_run: { type: boolean, default: false }
permissions:
  contents: read
concurrency:
  group: catalog-sync
  cancel-in-progress: false         # nunca dos sincronizaciones a la vez
jobs:
  sync:
    runs-on: ubuntu-latest
    environment: catalog-sync       # repo público o GitHub Pro; en privado Free, quitar esta línea
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with: { node-version-file: .node-version, cache: npm }
      - run: npm ci
      - name: Sincronizar y publicar el catálogo
        env:
          STEAM_MODE: live
          STEAM_WEB_API_KEY: ${{ secrets.STEAM_WEB_API_KEY }}
          CATALOG_PUBLISH_TOKEN: ${{ secrets.CATALOG_PUBLISH_TOKEN }}
          CATALOG_BASE_URL: ${{ vars.CATALOG_BASE_URL }}
          HEARTBEAT_URL: ${{ secrets.HEARTBEAT_URL }}
          MODE: ${{ inputs.mode || 'incremental' }}   # vía env: evita la inyección en el script
          DRY_RUN: ${{ inputs.dry_run || false }}
        run: npm run catalog:sync -- --mode="$MODE" --dry-run="$DRY_RUN"
      - if: always()
        uses: actions/upload-artifact@<sha>
        with: { name: sync-report, path: sync-report.json, retention-days: 14 }
```

Cómo funciona (verificado con las pruebas de §2.3 y §2.4):

- **Sin estado en el runner.** El runner es efímero, así que el estado es la propia instantánea publicada (`catalog/v{N}/snapshot.jsonl`). Por cada app guarda `lastModified` (que devuelve la enumeración) y `enrichedAt`. No hace falta un fichero de *checkpoint* aparte.
- **Etapas:**
  1. descargar `latest.json` y la instantánea anterior;
  2. enumerar **todo** con la clave: unas 4 llamadas de hasta 50.000 apps (a confirmar por el track API);
  3. calcular las diferencias: apps nuevas, cambiadas (`lastModified > enrichedAt`) y desaparecidas;
  4. enriquecer por lotes las apps de la cola. En modo `full` se enriquece todo; la tarea lo activa sola si la última ejecución completa tiene más de 7 días;
  5. validar los esquemas;
  6. generar la instantánea, el índice completo, el de «populares», el delta y los ficheros de detalles por appid;
  7. aplicar los guardarraíles (FIA-04);
  8. publicar de forma atómica: primero la carpeta `v{N+1}/` y después `latest.json`;
  9. añadir la ejecución al historial (`catalog/runs.json`), enviar el *heartbeat* y escribir el resumen en `$GITHUB_STEP_SUMMARY`.
- **El índice de nombres siempre está completo**, porque sale de la enumeración. Si el tiempo se acaba durante el enriquecimiento, se publica lo hecho y la siguiente ejecución sigue con el resto de la cola. Lo único que se retrasa es el año, la cápsula y la popularidad.
- **Ritmo y reintentos:**
  - ≤ 1 petición/s (S3), respetando `Retry-After`;
  - espera exponencial entre reintentos, con un componente aleatorio (de 1 a 60 s; como mucho 6 reintentos);
  - el ritmo baja al recibir respuestas 429;
  - un cortacircuitos detiene el enriquecimiento tras 20 fallos seguidos o más de un 10 % de respuestas 429, y publica lo hecho si pasa los guardarraíles.
- **Cuota:** una ejecución completa hace unas 1.000–2.000 llamadas, muy por debajo de las ~100.000 al día de S3.
- **Limitaciones de `schedule`** (documentación de GitHub, consultada hoy):
  - el intervalo mínimo es de 5 min;
  - con carga alta puede retrasarse, sobre todo al inicio de cada hora, y algún job puede descartarse;
  - solo se ejecuta en la rama por defecto;
  - en repos **públicos** se desactiva tras 60 días sin actividad;
  - los avisos de fallo se envían al último usuario que modificó el `cron` (hay que comprobar que tiene activadas las notificaciones de Actions).

  Mitigación: un *heartbeat* que alerta a las 36 h y la ejecución manual con `workflow_dispatch`.

### 4.5 Caché

- `actions/setup-node` con `cache: npm`.
- Navegadores de Playwright, por *hash* del *lockfile*.
- Dataset sintético, por *hash* del generador.
- Nunca se cachean secretos ni datos de usuarios. Cuota: 10 GB por repositorio.

### 4.6 Entornos

| Entorno | Datos | Secretos | Despliegue |
|---|---|---|---|
| `local` | Semilla (*fixtures*) | `.env.local` (no versionado) | `npm run dev` |
| CI (efímero) | Semilla + sintético + última instantánea | Ninguno | — |
| `preview` (por PR) | Semilla | Ninguno | Automático, desde el hosting |
| `production` | Catálogo real; las listas viven en los dispositivos | Ninguno en el cliente | Merge a `main` |
| `catalog-sync` | — | Clave de Steam, token de publicación y URL del *heartbeat* | Programado |
| `staging` (desde M3) | Catálogo real + usuarios sintéticos | Los suyos | Merge a `main` |

### 4.7 Gestión de secretos

| Secreto | Dónde vive | Quién lo usa | Rotación |
|---|---|---|---|
| `STEAM_WEB_API_KEY` | Entorno `catalog-sync` (secreto de repositorio en privado Free) + `.env.local` del desarrollador, solo para grabar *fixtures* | `catalog-sync` y el grabador | Anual, o inmediata ante cualquier sospecha |
| `CATALOG_PUBLISH_TOKEN` | Entorno `catalog-sync` | `catalog-sync` | Semestral; su alcance se limita al almacén del catálogo |
| `HEARTBEAT_URL` | Entorno `catalog-sync` | `catalog-sync` | Si se filtra |
| Token de despliegue (si no hay integración Git) | Entorno `production` (mejor con OIDC) | Despliegue | Según el proveedor |
| Desde M3: credenciales de la BD y claves de sesión con `kid` | Gestor de secretos del hosting | API | Semestral |

Reglas:

1. **El build del frontend no ve ningún secreto.** Solo expone variables `PUBLIC_*` incluidas en una lista blanca, y una regla de lint prohíbe leer `STEAM_*` fuera de `steam-client` y `jobs/catalog-sync`.
2. **Ficheros `.env*`:** ignorados en git, salvo `.env.example`.
3. **Redacción:** el cliente de Steam sustituye el valor de `key=` en logs, errores e informes.
4. **Workflows:**
   - ningún workflow de PR recibe secretos;
   - prohibido usar `pull_request_target` haciendo *checkout* del código de la PR;
   - las entradas de `workflow_dispatch` se pasan por `env`.
5. **Escaneo de secretos** en CI, y en *pre-commit* con el valor exacto de la clave. Si el repo es público, también la protección de GitHub contra el envío de secretos (*push protection*).
6. **Procedimiento ante una clave filtrada:**
   1. revocarla y generar otra en la página de claves de Steam;
   2. `gh secret set STEAM_WEB_API_KEY --env catalog-sync`;
   3. purgar el historial si llegó al repo;
   4. registrar el incidente.

### 4.8 Repositorio público o privado

Datos consultados hoy en la documentación de GitHub:

| Función | Público (Free) | Privado (Free) | Privado (Pro) |
|---|---|---|---|
| Minutos de Actions en runners estándar | Gratis | 2.000/mes | 3.000/mes |
| Precio por minuto adicional | — | Linux (2 núcleos): 0,006 USD; Windows: 0,010 USD | Igual |
| Entornos y secretos de entorno | Sí | **No** | Sí |
| Restringir un entorno a ciertas ramas | Sí | No | Sí |
| Revisores obligatorios / temporizador de espera | Sí | No | No |
| Protección de ramas | Sí | **No** | Sí |
| `schedule` desactivado tras 60 días sin actividad | Sí | No | No |

Almacenamiento incluido en privado: 500 MB de artefactos con Free y 1 GB con Pro; caché, 10 GB por repositorio.

Recomendación:
- **Público**, si el código puede ser abierto: entornos, protección de ramas, minutos, CodeQL y *push protection* gratis. Hay que validar con el track legal los *fixtures* con datos de Steam.
- **Privado con GitHub Pro**, si no puede serlo.
- **Privado Free:** la clave queda como secreto de repositorio, al alcance de cualquier workflow de cualquier rama, y `main` sin proteger. Es asumible para un solo desarrollador, pero es la peor opción.

## 5. Observabilidad (mínima viable)

### 5.1 Tarea `catalog-sync`

- `sync-report.json` como artefacto y un resumen en `$GITHUB_STEP_SUMMARY`.
- Historial de las 30 últimas ejecuciones en `catalog/runs.json`.
- *Heartbeat* a un servicio de supervisión de tareas programadas (`<heartbeat>`), con señal de éxito o de fallo.
- Los estados `failed` y `blocked` terminan el job con error, así que GitHub avisa por email; `partial` termina bien.

| Métrica (campo del informe) | Descripción |
|---|---|
| `sync_run_duration_seconds` | Duración total y por etapa |
| `sync_status` | `ok` / `partial` (enriquecimiento incompleto) / `failed` / `blocked` (lo pararon los guardarraíles) |
| `apps_listed_total`, `apps_new_total`, `apps_updated_total`, `apps_delisted_total` | Enumeración y diferencias |
| `apps_enriched_total`, `enrich_queue_remaining` | Progreso del enriquecimiento |
| `apps_failed_total{reason}`, `apps_without_name_total` | Fallos y calidad de los datos |
| `http_requests_total{endpoint,status}`, `http_429_total`, `retries_total` | Presión de los límites |
| `schema_violations_total{field}` | Cambios de formato en Steam |
| `catalog_size`, `index_bytes{tier}` | Tamaño publicado y variación respecto al anterior |
| `last_success_timestamp` | Base de la alerta de frescura |

### 5.2 Cliente: panel de diagnóstico local

Se abre con `?diag=1` o desde «Ajustes → Diagnóstico». No envía nada: el botón «Copiar informe» permite al usuario compartirlo si quiere. Muestra:

- los p50/p95 de `search:keystroke-to-results` (100 últimas búsquedas), `list:add-feedback`, `time_to_add` y `open_to_ready`;
- la versión y la antigüedad del índice, los niveles descargados y la memoria aproximada;
- si se concedió `storage.persist()` y el espacio usado;
- los 50 últimos errores.

Sirve para calibrar el móvil real (REN-01 y REN-04) sin RUM y sin implicaciones de privacidad.

### 5.3 Alertas del prototipo (pocas y accionables)

| Alerta | Condición | Canal |
|---|---|---|
| Sync ausente | Ningún *heartbeat* correcto en 36 h | Email y notificación push del servicio de *heartbeat* |
| Sync fallido o bloqueado | Job en `failure` o `sync_status` en `failed`/`blocked` | Email de GitHub + señal de fallo del *heartbeat* |
| Sync degradado | `apps_failed` > 1 %, `schema_violations` > 0,5 %, más de 50 respuestas 429, o `enrich_queue_remaining` > 0 durante tres días seguidos | Resumen del job, revisado cada semana |
| Dependencias | Alerta crítica de Dependabot | Email |

### 5.4 Más adelante (M3–M6)

- **Logs del backend:** JSON de una línea con `ts`, `level`, `service`, `env`, `version`, `request_id`, `msg` y `duration_ms`, sin datos personales (PRI-06).
- **API:** métricas RED (peticiones, errores, duración), comprobación de disponibilidad externa cada 5 min y alertas de errores 5xx y de latencia.
- **Error tracker** con región UE.
- **RUM** (`web-vitals` y medidas propias) y analítica sin cookies, tras el dictamen legal. Indicadores:
  - ≥ 90 % de las altas en < 3 s;
  - mediana de `time_to_add`;
  - ≤ 5 % de búsquedas sin resultados;
  - retención semanal.
- **Un único panel** de salud del producto.

## 6. Checklist de seguridad

### 6.1 Prototipo (M0–M2, opción A)

**Secretos y CI**
- [ ] La clave de Steam solo está en `catalog-sync` y en `.env.local`; el build del frontend no tiene secretos; hay una regla de lint para `STEAM_*`.
- [ ] *Fixtures* redactados y autocomprobados; escáner de secretos en CI; comprobación del valor exacto de la clave en el *pre-commit*.
- [ ] Workflows con `permissions` mínimos, acciones fijadas por SHA, sin `pull_request_target` y con las entradas pasadas por `env`.
- [ ] Procedimiento ante una clave filtrada, por escrito (§4.7).

**Web**
- [ ] CSP inicial, primero en modo `Report-Only` en la preview:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: <hosts-CDN-Steam>;
connect-src 'self' <hosts-CDN-Steam>; worker-src 'self'; manifest-src 'self'; font-src 'self';
object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests
```

  Notas sobre esta política:
  - `connect-src` incluye el CDN porque el service worker descarga las carátulas para guardarlas en caché.
  - El prototipo no tiene endpoint para recibir informes de violaciones; en su lugar, los e2e fallan ante cualquier `securitypolicyviolation`.
  - Si el framework inyecta scripts en línea, se usan *hashes* o *nonces*, nunca `unsafe-inline`.
- [ ] HSTS (1 año), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` mínima y `Cross-Origin-Opener-Policy: same-origin`.
- [ ] Los datos de Steam se muestran como texto; las descripciones se sanean con una lista blanca al ingerirlas; nunca `innerHTML`.
- [ ] El JSON que se importa se valida con su esquema, tiene un tamaño máximo (p. ej. 5 MB) y nunca se ejecuta nada de su contenido.

**Dependencias y código**
- [ ] Dependabot; `npm audit --omit=dev --audit-level=high` en CI; `ignore-scripts=true`.
- [ ] Análisis estático: CodeQL con la configuración por defecto si el repo es público; si no, Semgrep CE en CI, lanzado a mano al cerrar cada hito.

### 6.2 Al introducir backend o cuentas (opción B o M3)

**Autenticación**
- [ ] Mejor sin contraseñas propias: enlace mágico de un solo uso (token aleatorio de ≥ 128 bits, guardado con *hash*, caduca en 15 min) y/o passkeys. OAuth o Steam OpenID, según el ADR de cuentas.
- [ ] Respuestas genéricas, que no revelan si una cuenta existe.

**Sesión**
- [ ] Cookie `__Host-` con `Secure`, `HttpOnly`, `SameSite=Lax` y `Path=/`, con un identificador opaco de ≥ 128 bits guardado con *hash*.
- [ ] Se renueva al iniciar sesión, se invalida al cerrarla y caduca por inactividad y por tiempo absoluto.

**CSRF y CORS**
- [ ] Ningún cambio de estado por GET. Los métodos que cambian estado exigen `Content-Type: application/json` y un `Origin`/`Sec-Fetch-Site` del propio sitio.
- [ ] API en el mismo origen (`/api`), para no necesitar CORS.

**Limitación de tasa.** Cubeta de tokens; al superarla se responde 429 con `Retry-After` y el cliente pasa a los resultados locales.
- [ ] `GET /api/search`: 10 peticiones/s sostenidas y ráfagas de 30 por IP o sesión; respuestas cacheables en el CDN.
- [ ] Escrituras: 60 por minuto y 600 por hora por usuario.
- [ ] Autenticación: 5 intentos cada 15 min por email y 20 por hora por IP.
- [ ] Cuerpo JSON ≤ 16 KB.

**Validación**
- [ ] Esquema en todas las entradas, rechazando los campos desconocidos:
  - `q`: 1–100 caracteres, sin caracteres de control;
  - `appid`: entero positivo;
  - `status`: valor del enumerado;
  - notas: ≤ 2.000 caracteres de texto plano;
  - paginación: ≤ 50.
- [ ] Siempre consultas parametrizadas, con la sintaxis FTS escapada (cada término entre comillas).
- [ ] Autorización en cada consulta por el `user_id` de la sesión, con tests de IDOR.

**Copias de seguridad**
- [ ] Copias diarias (más recuperación a un instante concreto, si el proveedor la ofrece) y un volcado semanal cifrado en otra cuenta o proveedor. Se conservan 7 diarias y 4 semanales.
- [ ] Una restauración probada antes de abrir cuentas a terceros. Tras restaurar, se vuelve a aplicar el registro de borrados.

**Cierre**
- [ ] OWASP ASVS 5.0 nivel 1 **completo** antes de abrir cuentas a terceros.
- [ ] Antes de la beta: modelo de amenazas STRIDE de una página y `/.well-known/security.txt`.
- [ ] Mensajes de error sin trazas y variables de entorno validadas al arrancar.

## 7. Desarrollo local en esta máquina (sin Docker)

### 7.1 Estado verificado hoy

- **Node v24.21.0:**
  - elimina los tipos de TypeScript al vuelo (`process.features.typescript = "strip"`): ejecuta `.ts` sin avisos, exige la extensión `.ts` en los imports y rechaza `enum`;
  - admite `--env-file-if-exists`.
- **npm 11.19.0:** sus scripts se ejecutan en `cmd.exe` (`script-shell` sin configurar).
- **git 2.56.0.windows.2.**
- **`node:sqlite`:** SQLite 3.53.4 con FTS5 y `trigram remove_diacritics`, sin flags ni avisos.
- **Rust 1.99.0 (2026-09-28) y cargo 1.99.0:** no hacen falta para el prototipo.
- **Equipo:** Ryzen 5 3600 (6 núcleos/12 hilos) y 16 GB de RAM, con Chrome, Edge y `winget`.
- **No instalado:** Docker, PostgreSQL (`psql`), la CLI `sqlite3` y `gh`. El `python.exe` de `WindowsApps` es solo el acceso directo a la Microsoft Store, no un intérprete.
- **Carpeta del proyecto:** vacía.

### 7.2 Qué instalar

| Para | Instalación | Notas |
|---|---|---|
| Prototipo (opción A) | **Nada obligatorio**, salvo `npx playwright install chromium` | Lighthouse CI usa el Chrome ya instalado |
| Opción B (API) | Nada: `node:sqlite` ya incluye FTS5 | La BD la genera `catalog-sync` y la API la abre en solo lectura |
| Comodidad | `winget install GitHub.cli` (secretos y releases); `winget install SQLite.SQLite` (inspeccionar la BD) | Opcionales |
| No hacen falta | Docker, PostgreSQL, Meilisearch ni Typesense | Según lo medido, bastan FTS5 o el índice en el cliente (§0.6) |

### 7.3 Scripts (npm, implementados en TypeScript; nunca en bash ni PowerShell)

| Script | Qué hace |
|---|---|
| `npm run setup` | Comprueba que Node es ≥ 24, instala las dependencias, crea `.env.local` a partir de `.env.example` y genera el índice semilla con el mismo código de `catalog-sync` en modo `fixtures`. Con `--browsers`, instala Chromium para Playwright. Se puede repetir sin efectos secundarios. |
| `npm run dev` | Arranca la PWA en `127.0.0.1` con `STEAM_MODE=fixtures` y el índice semilla. Funciona sin Internet. |
| `npm run dev:lan` | Lo mismo, pero accesible desde la red local, para probar en el móvil (§7.5). |
| `npm test` | Tests unitarios, de contrato y de integración de `catalog-sync`, sin red. |
| `npm run check` | Formato, lint, tipos, `npm test`, build y control de tamaño (el paso principal del CI). |
| `npm run test:e2e` | Playwright contra el build, en Chromium. |
| `npm run ci` | Lo mismo que el CI, salvo el escáner de secretos. |
| `npm run bench:search` | Bench con la última instantánea real o, si no la hay, con el sintético de 250.000 títulos y semilla 42. |
| `npm run lhci` | Lighthouse CI contra el build local. |
| `npm run catalog:sync -- --source=fixtures\|live --mode=incremental\|full --dry-run` | Ejecuta la tarea en local; `live` exige la clave en `.env.local`. |
| `npm run fixtures:record -- --appids=…` | Graba respuestas reales de Steam y redacta la clave. |
| `npm run fixtures:generate -- --size=250000 --seed=42` | Genera el catálogo sintético para el bench. |

```dotenv
# .env.example → copiar a .env.local (no se versiona)
STEAM_MODE=fixtures              # fixtures | live (live solo para catalog:sync y fixtures:record)
STEAM_WEB_API_KEY=               # vacía, salvo para sincronizar o grabar en local
CATALOG_BASE_URL=/catalog        # en local, el índice semilla que sirve `npm run dev`
PUBLIC_APP_NAME=GameAgenda
```

Las variables se cargan con `node --env-file-if-exists=.env.local …`, que viene de serie en Node.

### 7.4 Datos semilla para trabajar sin red

- `fixtures/catalog/seed.jsonl`: unos 300 juegos reales (populares + casos límite), generado a partir de los *fixtures*. Con él, `setup` genera un índice con el mismo formato que el de producción.
- Carátulas: con red, del CDN de Steam; sin red, una imagen SVG local provisional (iniciales y un color derivado del appid).
- Usuario demo (unas 30 entradas en todos los estados) y usuario «pesado» (500 entradas; 5.000 en M5).
- Un e2e del CI arranca la app con la red externa bloqueada, para garantizar que `npm run dev` y la semilla bastan.

### 7.5 Particularidades de Windows y pruebas en el móvil real

- `.gitattributes` con `eol=lf`, más `git config core.autocrlf false` y `git config core.longpaths true`.
- npm ejecuta los scripts con `cmd.exe`, así que no funcionan `VAR=valor comando` ni `rm -rf`. Por eso la lógica va en scripts `.ts`.
- `npm run dev` solo escucha en `127.0.0.1` y no provoca el aviso del firewall. `dev:lan` sí lo provoca: hay que permitirlo solo para redes privadas.
- Opcional, para ganar velocidad: una Dev Drive (ReFS) para el repo y la caché de npm.
- **Android:** depuración remota desde Chrome (`chrome://inspect`) con redirección de puertos. El móvil abre `localhost:<puerto>`, que cuenta como contexto seguro, así que el service worker funciona; con `http://192.168.x.x` no funcionaría.
- **iPhone:** desde Windows no se puede usar el Web Inspector de Safari, que requiere macOS. Se prueba contra la preview HTTPS de cada PR y se mide con el panel de diagnóstico (§5.2).

## 8. Hoja de ruta

El esfuerzo se expresa en **días-persona ideales** (≈ 6 h de trabajo enfocado) de un solo desarrollador. A unas 15 h por semana, 1 día ideal equivale a ≈ 0,4 semanas de calendario.

### M0 — Esqueleto andante (`v0.0.1`) · 3–5 días

- **Objetivo:** demostrar el flujo «apuntar un juego en < 3 s» con datos semilla, sin clave de Steam ni red.
- **Entregables:**
  1. Repo, herramientas y `ci.yml` (§4.2), con ADR-0001 y ADR-0004.
  2. Modelo de datos con estados (§0.5), IndexedDB con migraciones y exportar/importar en JSON.
  3. Interfaz:
     - buscador *combobox* sobre el índice semilla;
     - alta con `Enter` o con un toque, y «Deshacer»;
     - lista «Quiero jugar», con opción de quitar;
     - alta como texto libre y aviso de duplicados.
  4. Scripts `setup`, `dev`, `test` y `check`, y el e2e del flujo principal.
- **Criterios de aceptación:**
  - CA0.1: el e2e «apuntar en < 3 s» (mediana de 5) pasa en Chromium de escritorio y en móvil emulado, con `list:add-feedback` < 100 ms.
  - CA0.2: en un Windows 11 limpio con Node 24, `npm run setup && npm run dev` deja la app funcionando en ≤ 10 min, sin acceso a Steam.
  - CA0.3: añadir un juego que ya está no lo duplica, los datos persisten al recargar y una exportación se vuelve a importar sin pérdidas.
- **Esfuerzo:**
  - fundamentos: 1–1,5 días;
  - modelo y persistencia: 0,5–1;
  - interfaz: 1–1,5;
  - semilla y e2e: 0,5–1.

### M1 — Catálogo completo de Steam y prototipo usable (`v0.1.0`) · 10–15 días

- **Objetivo:** encontrar cualquier juego de Steam al teclear, apuntarlo en < 3 s y marcar su estado con un toque, sin cuenta.
- **Requisitos previos:** las decisiones de §0.7 (S8 y el alcance de «todos los juegos»). Si S8 falla, se pasa a la opción B, que añade 3–5 días (API de solo lectura y hosting sin suspensión).
- **Entregables:**
  1. `steam-client` con esquemas, grabador y *fixtures* redactados.
  2. `catalog-sync` programado a diario (§4.4): enumeración, diferencias, enriquecimiento, guardarraíles, publicación atómica, *heartbeat* e informe.
  3. Búsqueda:
     - índice por niveles («populares» + completo + deltas) en un Web Worker;
     - normalización y ranking;
     - resultados etiquetados con su consulta;
     - detalles bajo demanda;
     - conjunto de referencia y bench con datos reales.
  4. Estados con un toque («Quiero jugar», «Jugando», «Completado», «Abandonado», «Platinado») e interruptor «Comprado».
  5. Alta directa pegando un enlace de la tienda de Steam.
  6. PWA:
     - esqueleto de la app disponible sin red e instalable;
     - `storage.persist()` y recordatorio de exportación;
     - panel de diagnóstico.
  7. Despliegue estático con HTTPS y cabeceras (§4.3); aviso legal y de privacidad mínimo si la URL es pública; ADR-0002, 0003 y 0005.
- **Criterios de aceptación:**
  - CA1: tras una ejecución completa, el índice contiene todas las apps de la enumeración que entran en el alcance de ADR-0003. Las que no tienen nombre (hoy, 18) se completan o se excluyen, y el informe las cuenta.
  - CA2: 7 ejecuciones programadas seguidas correctas (lo que exige al menos una semana de calendario con la tarea activa); la incremental tarda ≤ 15 min; la alerta del *heartbeat* se prueba con un fallo simulado.
  - CA3: en el conjunto de referencia, el juego esperado está entre los 3 primeros en ≥ 95 % de las consultas y es el primero en ≥ 80 %. La búsqueda no distingue mayúsculas, acentos, ™/® ni apóstrofos.
  - CA4: REN-01 se cumple en el bench y en el proyecto `perf`, y en el móvil real del usuario el p95 es ≤ 50 ms (según el panel de diagnóstico).
  - CA5: REN-03 y REN-04 en verde; pulsar `Enter` tras teclear deprisa nunca añade un resultado obsoleto.
  - CA6: Lighthouse móvil con rendimiento ≥ 90, accesibilidad ≥ 95, LCP ≤ 2,5 s, TBT ≤ 200 ms y CLS ≤ 0,1; JS inicial ≤ 100 KB gzip; índice completo ≤ 2,0 MB brotli.
  - CA7: 0 violaciones axe *serious* o *critical*; el flujo completo se verifica a mano con teclado y con NVDA.
  - CA8: la clave de Steam solo está en `catalog-sync`; el escáner no encuentra nada; la CSP está activa sin `unsafe-inline` en los scripts y sin violaciones en los e2e.
  - CA9: sin red, tras la primera visita, la app se abre, muestra la lista, deja apuntar juegos (de «populares» o como texto libre) y cambiar estados, y los datos persisten al recargar.
  - CA10: el cambio de estado da respuesta visible en ≤ 100 ms, y marcar «Platinado» pone también «Completado».
- **Esfuerzo:**
  - `steam-client` y *fixtures*: 1–2 días;
  - `catalog-sync`: 3–4,5;
  - búsqueda: 3–4;
  - estados y alta pegando un enlace: 1–1,5;
  - PWA, despliegue y panel de diagnóstico: 2–3.

### M2 — Agenda y captura rápida (`v0.2.0`) · 4–6 días

- **Objetivo:** gestionar la lista como una agenda y poder apuntar desde cualquier sitio. Con este hito se cierra el prototipo.
- **Entregables:**
  - filtros por estado y por «comprado», contadores y orden (por prioridad, fecha y nombre con `Intl.Collator`);
  - prioridad y notas cortas;
  - reordenación accesible (2.5.7);
  - exportación a CSV;
  - atajos de teclado y accesos directos del manifiesto («Apuntar juego»);
  - Web Share Target en Android, para compartir un enlace de Steam con GameAgenda;
  - sinónimos de búsqueda (I18N-03);
  - actualización controlada del service worker.
- **Criterios:**
  - cualquier cambio de estado o de filtro en ≤ 2 interacciones, con respuesta visible en ≤ 100 ms;
  - REN-12 cumplido con 500 entradas;
  - compartir un enlace de Steam desde Android crea la entrada en ≤ 2 toques;
  - con los sinónimos, el juego esperado sigue entre los 3 primeros en ≥ 95 % de las consultas del conjunto de referencia.
- **Esfuerzo:**
  - filtros, orden, prioridad y notas: 1,5–2 días;
  - captura rápida: 1–1,5;
  - sinónimos: 0,5–1;
  - CSV y reordenación: 1–1,5.

### Después del prototipo (horizonte; se detallará al cerrar M2)

| Hito | Contenido | Días ideales |
|---|---|---|
| M3 — Cuentas y sincronización (`v0.3.0`) | <ul><li>backend mínimo y autenticación sin contraseña;</li><li>sincronización con *outbox* y última escritura por campo;</li><li>fusión de la lista local al crear la cuenta;</li><li>RGPD completo (PRI-04 y PRI-05);</li><li>copias de seguridad y una restauración probada;</li><li>ASVS nivel 1 completo y entorno `staging`.</li></ul> | 10–15 |
| M4 — Rendimiento móvil y PWA completa (`v0.4.0`) | <ul><li>calibración con varios móviles;</li><li>Background Sync donde exista;</li><li>matriz e2e nocturna (WebKit y Firefox);</li><li>bench comparado con `main`;</li><li>inglés, opcional.</li></ul> | 4–6 |
| M5 — Otras plataformas e importaciones (`v0.5.0`) | <ul><li>identidad de juego multiplataforma;</li><li>catálogo multiplataforma, según el track API/legal;</li><li>importar de Steam la lista de deseos, la biblioteca («comprado») y los logros («platinado» = 100 %), como tareas asíncronas (FIA-01) con la clave solo en el *worker* de importación;</li><li>«platinado» a mano para PlayStation;</li><li>REN-12 con 5.000 entradas.</li></ul> | 10–15 |
| M6 — Beta pública (`v1.0.0`) | Todo lo aplazado en §0.4: <ul><li>RUM y analítica con dictamen legal, error tracker, SLO y alertas;</li><li>prueba de carga y nota A en Observatory;</li><li>*runbooks* y auditoría manual de accesibilidad;</li><li>textos legales y aviso de atribución/no afiliación con Valve;</li><li>*release-please* y contrato de exportación v1.</li></ul> | 8–12 |

| Tramo | Días ideales | Acumulado | Acumulado a 15 h/semana | Acumulado a tiempo completo |
|---|---|---|---|---|
| M0 | 3–5 | 3–5 | 1,2–2 semanas | 0,6–1 semanas |
| M1 | 10–15 | 13–20 | 5,2–8 semanas | 2,6–4 semanas |
| M2 (fin del prototipo) | 4–6 | 17–26 | 6,8–10,4 semanas | 3,4–5,2 semanas |
| M3–M6 | 32–48 | 49–74 | 19,6–29,6 semanas | 9,8–14,8 semanas |

Cálculo del calendario: a 15 h/semana, 0,4 semanas por día ideal; a tiempo completo, 5 días ideales por semana. Además, CA2 exige al menos una semana de calendario con la tarea activa.

### 8.1 Registro de riesgos

Probabilidad (P) e impacto (I): B = bajo, M = medio, A = alto.

| ID | Riesgo | P | I | Mitigación | Señal |
|---|---|---|---|---|---|
| R01 | Steam cambia o retira endpoints (ya pasó con `ISteamApps/GetAppList/v2`) | M | A | `steam-client`, esquemas y guardarraíles. El catálogo se sirve desde nuestra instantánea, así que una caída de Steam solo afecta a la frescura | `schema_violations`, respuestas 404/410 |
| R02 | Respuestas 429 o bloqueo de las IP de los runners | M | M | Ritmo adaptativo, cortacircuitos y enriquecimiento reanudable. Alternativa: el cron del hosting | `http_429_total` |
| R03 | Lo legal impide la opción A (distribuir el índice) o enlazar las imágenes | M | A | Dictamen antes de M1; opción B preparada; imágenes vía proxy o sin imágenes | Dictamen legal |
| R04 | Filtración de la clave de Steam | B | A | §4.7: redacción, escáneres, secreto por entorno y procedimiento de respuesta | Alerta del escáner |
| R05 | Búsqueda local lenta en móviles modestos | M | A | Medida en §0.6; worker, niveles y refinamiento incremental; medición en el móvil real en M1; alternativa: opción B | p95 > 50 ms en el panel |
| R06 | Índice demasiado pesado o con mucha memoria | M | M | Hoy pesa 1,5–1,8 MB en brotli; niveles, deltas, respeto de `Save-Data` y cápsulas fuera del índice | `index_bytes` |
| R07 | Safari en iOS borra los datos locales antes de que haya cuentas | M | A | `storage.persist()`, instalar la PWA y recordatorios de exportación; adelantar M3 si hay usuarios | Avisos de pérdida de datos |
| R08 | El alcance crece (social, recomendaciones, multiplataforma) | A | M | Nivel de calidad de §0.4, DoD y tiempo acotado por hito | Hito retrasado > 30 % |
| R09 | `schedule` retrasado, descartado o desactivado (60 días sin actividad en un repo público) | M | B | *Heartbeat* a las 36 h, `workflow_dispatch` y actividad periódica en el repo | Alerta de sync ausente |
| R10 | Probar en iPhone desde Windows es limitado (sin Web Inspector) | M | M | Preview HTTPS y panel de diagnóstico; pedir prestado un Mac si hace falta depurar | Fallos que solo aparecen en iOS |
| R11 | Un `Enter` rápido añade un juego equivocado (resultados obsoletos) | M | M | Resultados etiquetados, test e2e y «Deshacer» | Uso frecuente de «Deshacer» |
| R12 | No hay API oficial para trofeos ni para otras plataformas | A | M | «Platinado» a mano; evaluar catálogos multiplataforma en M5 | Track API |
| R13 | Una dependencia comprometida | B | A | *Lockfile*, espera antes de actualizar, pocas dependencias, `ignore-scripts` y acciones fijadas por SHA | Avisos de seguridad |
| R14 | Tests de rendimiento inestables en runners compartidos | A | B | Medianas, topes con margen y latencias leídas de `performance.measure` | Fallos intermitentes |
| R15 | Mala calidad de los datos de Steam (nombres vacíos, apps de prueba, contenido adulto) | M | M | Filtros por tipo, descriptores de contenido, adulto oculto por defecto e informe de anomalías | Conjunto de referencia, informe del sync |
| R16 | Disponibilidad limitada de un solo desarrollador | M | A | Hitos pequeños con valor visible (M0 en ≤ 1 semana), automatización y ADR breves | Ritmo semanal |
