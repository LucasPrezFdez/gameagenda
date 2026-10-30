# Guía: medidas de M1 en el Android de referencia y pasada con NVDA

Para cerrar M1 faltan las comprobaciones que no puede hacer `npm run perf`:

- **En el Android de referencia** (§13.4 y §15.4 de `prototipe.md`): CA1.2, CA1.4, CA1.11 y RNF-02.
- **Con NVDA en el PC:** la pasada de CA1.10.

Todo lo automático ya pasa: ver `docs/medidas/perf-m1-20261030.md`, que trae las cifras del PC con las que comparar.

Haz los apartados en orden. Las medidas son las de la §12.4 (`performance.measure`) y se leen con un fragmento de JavaScript en las DevTools remotas (apartado 4).

## 1. Antes de empezar

Necesitas:

1. **El Android de referencia** (gama media; ver §18, PA-02), con Chrome actualizado. Anota su modelo.
2. **Un cable USB de datos:** algunos cables solo cargan.
3. **Las opciones de desarrollador y la depuración USB.** En el móvil, ve a Ajustes › Información del teléfono y toca 7 veces «Número de compilación». Luego, en Ajustes › Sistema › Opciones para desarrolladores, activa «Depuración por USB». Los nombres cambian según el fabricante.
4. **Chrome en el PC.** No hacen falta `adb` ni el Android SDK: `chrome://inspect` trae lo necesario. Algunos fabricantes exigen instalar su controlador USB en Windows.
5. **NVDA**, para el apartado 6: `winget install --id NVAccess.NVDA -e`, o desde https://www.nvaccess.org.
6. **El catálogo completo en `pipeline/out/`.** En PowerShell, desde la raíz del repositorio, `(Get-Content pipeline\out\manifest.json | ConvertFrom-Json).counts.core` debe dar `197031`. Si falta, `npm run catalog:frozen` lo regenera desde la copia congelada, pero con 196 665 juegos: usa ese número donde esta guía dice 197 031.

Para que las cifras valgan:

- **En el PC**, cierra los juegos y cualquier otro proceso pesado: compilaciones, `npm run perf`, vídeo o descargas grandes. Sesgan las cifras, sobre todo la primera descarga del catálogo y la pasada con NVDA.
- **No lances `npm run e2e` mientras sirves la app:** reutiliza el servidor del puerto 4173 (`reuseExistingServer`). `npm run perf` no lo reutiliza, pero compite por la CPU.
- **En el móvil:**
  - batería por encima del 50 % o cargando, y sin ahorro de batería;
  - sin otras apps abiertas y sin que esté caliente;
  - con la pantalla configurada para tardar en apagarse.

## 2. Servir la app desde el PC

1. En PowerShell:

   ```powershell
   cd C:\Users\lucas\Documents\Programacion\GameAgenda
   $env:CATALOG_DIR = 'pipeline/out'
   npm run preview
   ```

   `npm run preview` hace dos cosas:
   - construye en `apps/web/dist-e2e/` el *build* del modo `e2e`, que es el de producción con los ganchos de prueba (§12.3);
   - lo sirve con `vite preview` en `http://127.0.0.1:4173`. El puerto es fijo (`strictPort`).

   La variable manda sobre el `CATALOG_DIR=fixtures/catalog` de `.env.local`. Sin ella, medirías con el mini-catálogo.
2. Comprueba que la salida dice:

   ```text
     Catálogo de desarrollo: C:\Users\lucas\Documents\Programacion\GameAgenda\pipeline\out → /catalog-dev/
     ➜  Local:   http://127.0.0.1:4173/
   ```

   Si pone `fixtures\catalog`, la variable no está puesta en esa ventana. Si falla porque el puerto está ocupado, cierra el otro servidor (otro `npm run preview` o los E2E).
3. Deja la ventana abierta toda la sesión y no reconstruyas en medio. Un *build* nuevo cambia el Service Worker, y la siguiente apertura sería una actualización, no un reinicio con caché.

**Por qué hace falta reenviar el puerto.** El servidor solo escucha en `127.0.0.1` (así no salta el cortafuegos; ver §13.3), así que el móvil no llega por la IP del PC. Aunque llegara, `http://192.168.x.x` no es un contexto seguro: no habría Service Worker, ni Cache Storage, ni `crypto.subtle`, con el que el Worker de búsqueda verifica el catálogo. Con el reenvío, el móvil abre `http://localhost:4173`, que sí es un contexto seguro.

## 3. Conectar el móvil

1. Conecta el móvil por cable y desbloquéalo. Acepta «¿Permitir la depuración por USB?» y marca «Permitir siempre desde este ordenador».
2. Abre Chrome en el móvil.
3. En Chrome del PC, abre `chrome://inspect/#devices` y marca *Discover USB devices*. Debe salir el móvil con su modelo y su versión de Chrome: anótalos para la tabla.
   - Si sale *Offline* o no sale, acepta el aviso del móvil.
   - Si sigue sin salir, prueba el modo USB «Transferencia de archivos», otro cable o el controlador del fabricante.
4. Pulsa *Port forwarding…* y configura el reenvío:
   - en *Port*, `4173`;
   - en *IP address and port*, `127.0.0.1:4173`;
   - marca *Enable port forwarding* y pulsa *Done*.

   Pon `127.0.0.1` y no `localhost`: el servidor no escucha en IPv6 (`::1`).
5. En el móvil, abre `http://localhost:4173`. Deja `chrome://inspect` abierto en el PC durante toda la sesión.
6. Para usar la consola: en `chrome://inspect`, debajo del móvil, pulsa *inspect* junto a `http://localhost:4173/`. Se abre una ventana de DevTools. En la pestaña *Console*, el contexto tiene que ser `top`, no el Worker `gameagenda-search`.

Si tienes las *platform-tools* de Android, `adb reverse tcp:4173 tcp:4173` hace lo mismo que el paso 4. En este PC no están instaladas, y no hacen falta.

## 4. El fragmento de medidas

La app guarda sus medidas en la página. Al recargar o cerrar la pestaña, se borran. Por eso cada apartado dice cuándo ejecutar el fragmento: siempre antes de recargar.

Te conviene guardarlo como fragmento de DevTools: *Sources › Snippets › New snippet* (en español, Fuentes › Fragmentos). Llámalo `ga-medidas` y ejecútalo con `Ctrl+Intro`. Se guarda en las DevTools del PC y vale para cada pestaña nueva. Si lo pegas en la consola, Chrome puede pedirte que escribas `allow pasting` (o `permitir pegar`) antes.

```js
// GameAgenda · medidas de M1 (§12.4): n, p50, p95 y máximo de cada `performance.measure`.
(() => {
  const quantile = (sorted, f) =>
    sorted.length === 0
      ? null
      : sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(f * sorted.length) - 1))];
  const round = (v) => (v === null ? null : Math.round(v * 10) / 10);
  const stats = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      n: sorted.length,
      p50: round(quantile(sorted, 0.5)),
      p95: round(quantile(sorted, 0.95)),
      max: round(quantile(sorted, 1)),
    };
  };
  const measures = (name) => performance.getEntriesByName(name, 'measure');
  const fullAt = measures('search:full')[0]?.duration ?? Number.POSITIVE_INFINITY;
  const rows = {};
  for (const name of [
    'app:list-visible',
    'search:ready',
    'search:full',
    'capture:palette-to-confirm',
    'ui:feedback',
    'search:keystroke-to-results',
  ]) {
    rows[name] = stats(measures(name).map((e) => e.duration));
  }
  rows['search:keystroke-to-results, en full'] = stats(
    measures('search:keystroke-to-results')
      .filter((e) => e.startTime >= fullAt)
      .map((e) => e.duration),
  );
  const workerMs = globalThis.__gaSearchTest?.workerMs;
  if (workerMs) rows['consulta dentro del Worker'] = stats(workerMs);
  console.table(rows);
})();
```

Los percentiles se calculan como `latencyStats` de `npm run perf` (rango más cercano), así que las cifras son comparables. Todas van en milisegundos.

| Fila | Desde → hasta | Para |
|---|---|---|
| `app:list-visible` | Inicio de la navegación → Mi lista pintada con sus datos | CA1.11 |
| `search:ready` | Inicio de la navegación → ya se busca en el catálogo (`scan` o `full`) | CA1.11 |
| `search:full` | Inicio de la navegación → índice completo | Informativa |
| `capture:palette-to-confirm` | Abrir la paleta → aviso «Apuntado en…» | CA1.4 |
| `ui:feedback` | Toque o Intro → cambio visible | RNF-03 (aquí, informativa) |
| `search:keystroke-to-results` | Pulsación → resultados pintados | RNF-02 |
| `…, en full` | Solo las pulsaciones posteriores a `search:full` | RNF-02 |
| Consulta dentro del Worker | Tiempo de cada consulta en el Worker (solo en el *build* `e2e`) | Diagnóstico |

`app:list-visible` y `search:ready` se miden una sola vez por carga. Solo valen para CA1.11 si la página se abrió con el catálogo ya en caché (apartado 5.5).

Para la tabla del apartado 7, este comando saca el modelo y la versión exacta de Chrome:

```js
navigator.userAgentData?.getHighEntropyValues(['model', 'platformVersion', 'fullVersionList']).then(console.log);
```

## 5. Android

Hasta el 5.4 todo va en la misma pestaña, sin recargar. Mientras mides, cierra la ventana de DevTools, pero no `chrome://inspect`: con las DevTools abiertas el móvil trabaja más. Ábrelas solo para leer: las medidas siguen ahí.

### 5.1 Primera visita (preparación)

1. Si el móvil ya había abierto `localhost:4173`, borra sus datos y recarga. En DevTools, es *Application › Storage › Clear site data*. Mi lista tiene que salir vacía.
2. Espera a que baje el catálogo: unos 7 MB por el cable. Primero desaparece «Preparando el catálogo de Steam…», y después se construye el índice.
3. Ejecuta el fragmento. Cuando `search:full` tenga `n` = 1, el catálogo ya está en caché. Si quieres comprobarlo, `caches.keys().then(console.log)` debe listar `gacat-20261029.1` y un `ga-shell-…`.
4. Cierra la ventana de DevTools.

### 5.2 CA1.4 · Apuntar en <3 s

**Presupuesto:** p50 de `capture:palette-to-confirm` ≤3 000 ms en 10 altas. En el PC, con CPU ×4, salió 1 265,6 ms.

1. En Mi lista, toca la barra «Apunta un juego…» de abajo. Se abre la hoja a pantalla completa, y en ese momento empieza la medida.
2. Teclea el nombre a tu ritmo normal, letra a letra, con el teclado en pantalla. No uses las sugerencias del teclado. Después, toca la fila del juego. Deja sin marcar «Seguir apuntando» y no toques el botón `(i)`.
3. Espera al aviso «Apuntado en Quiero jugar: …». La paleta se cierra.
4. Repite hasta tener 10 juegos distintos. Ninguno puede estar ya en tu lista: si la fila dice «En tu lista: …», elige otro. Por ejemplo: `hollow`, `elden`, `baldurs`, `celeste` y `stardew` (los del E2E de la §12.3), y además `hades`, `portal 2`, `terraria`, `witcher 3` y `cyberpunk`.
5. No abras aún las DevTools: sigue con el 5.3 en la misma pestaña.

**Pasa si** `capture:palette-to-confirm` da `n` = 10 y su p50 ≤3 000 ms. Si `n` sale menor, alguna alta no contó: haz más altas y anota la `n`. Anota también el máximo de `ui:feedback`, que debe ser ≤100 ms (RNF-03).

### 5.3 RNF-02 · Pulsación → resultados

**Presupuesto:** p95 de `search:keystroke-to-results, en full` ≤50 ms. En el PC, en la página de prueba con CPU ×4, salieron 8,6 ms con el índice completo.

1. En la misma pestaña, abre la paleta y teclea un nombre letra a letra. Ciérrala sin apuntar, con la flecha «Cerrar la paleta» o con el botón Atrás del móvil.
2. Repítelo con 10 nombres de longitud y popularidad variadas: `counter strike`, `dota`, `the binding of isaac`, `slay the spire`, `factorio`, `rimworld`, `subnautica`, `disco elysium`, `outer wilds` y `vampire survivors`.
3. Ahora abre las DevTools (*inspect*) y ejecuta el fragmento. Anota también las cifras del 5.2.

**Pasa si** el p95 de `search:keystroke-to-results, en full` es ≤50 ms con `n` ≥100. Con las altas del 5.2 y estos 10 nombres se pasa de 100. Si no llegas, teclea más nombres y vuelve a ejecutarlo.

Anota también el p95 de «consulta dentro del Worker». Si la pulsación va alta pero el Worker va bajo, el coste está en el hilo principal o en el pintado.

### 5.4 CA1.2 · Última fila del Catálogo

**Presupuesto:** con +18 visible, el contador coincide con el *manifest* (197 031). Además, se llega a la última fila con Fin y con la barra.

Este fragmento comprueba dónde estás:

```js
(() => {
  const first = document.querySelector('.catalog-list > li[aria-posinset]');
  const total = first?.getAttribute('aria-setsize') ?? null;
  const last = document.querySelector(`.catalog-list > li[aria-posinset="${total}"]`);
  const box = last?.getBoundingClientRect();
  console.table({
    total,
    focused: document.activeElement?.closest('[aria-posinset]')?.getAttribute('aria-posinset') ?? null,
    lastRow: last?.querySelector('a')?.textContent ?? null,
    lastRowVisible: box ? box.bottom > 0 && box.top < innerHeight : false,
  });
})();
```

1. Ve a Ajustes › Contenido y activa «Mostrar juegos para adultos (+18) en el Catálogo y en la búsqueda».
2. Ve a Catálogo. El contador debe decir «197 031 juegos» y «Sin DLC · +18 visible».
3. **Prueba con Fin.** Hace falta un teclado. Puede ser uno Bluetooth emparejado con el móvil, o el de tu PC a través del *screencast* de DevTools: el botón *Toggle screencast*, arriba a la izquierda, manda las teclas del PC al móvil.
   1. Toca «Filtrar el catálogo…».
   2. Pulsa `↓`: el foco va a la primera fila.
   3. Pulsa `Fin`.
   4. Ejecuta el fragmento.

   **Pasa si** `focused` y `total` valen `197031` y `lastRow` trae un título, no `null`.
4. **Prueba con la barra.**
   1. Vuelve arriba con `Inicio`.
   2. Arrastra la barra de desplazamiento hasta abajo. En Chrome para Android suele ser solo un indicador que no se arrastra. Si es así, haz lo mismo que el E2E: en la consola, `window.scrollTo(0, document.documentElement.scrollHeight)`.
   3. Desliza rápido varias veces arriba y abajo por el medio: las filas deben rellenarse al momento, sin huecos que se queden.
   4. Ejecuta el fragmento.

   **Pasa si** `lastRow` trae un título y `lastRowVisible` vale `true`.
5. Si quieres, vuelve a ocultar el +18.

### 5.5 CA1.11 · Reinicio con caché

**Presupuesto:** en el peor de 3 reinicios, `search:ready` ≤2 000 ms y `app:list-visible` ≤1 000 ms. En el PC, con CPU ×4 y 500 entradas, salieron 599 ms y 502 ms.

Antes de empezar, comprueba tres cosas:
- el 5.1 está hecho, así que el catálogo está en caché;
- estás en Mi lista;
- la ventana de DevTools está cerrada.

Si la dejas abierta, desmarca *Network › Disable cache* y *Application › Service workers › Bypass for network*.

Haz este ciclo 3 veces:

1. **Cierra la pestaña** desde el selector de pestañas. Al menos una de las 3 veces, cierra Chrome del todo desde las apps recientes.
2. **Abre** Chrome y, en una pestaña nueva, `http://localhost:4173`. Si instalaste la app desde el menú de Chrome, también puedes abrirla desde su icono.
3. **Espera** unos 5 s sin tocar nada, hasta que se vean Mi lista y la barra de la paleta.
4. **Mide.** En `chrome://inspect`, pulsa *inspect* en la pestaña nueva y ejecuta el fragmento. Anota `app:list-visible` y `search:ready`: debe haber `n` = 1 en cada una. Si `app:list-visible` da `n` = 0, la página no se abrió en Mi lista.
5. **Opcional:** `navigator.serviceWorker.controller !== null` debe dar `true`, porque la página la sirve el Service Worker.
6. **Cierra** la ventana de DevTools antes del siguiente reinicio.

**Pasa si** el peor de los 3 cumple los dos presupuestos.

Anota cuántas entradas tiene Mi lista. Tras el 5.2 serán unas 10, mientras que `perf` mide con 500. El reinicio no depende de la red: el catálogo y la app salen de la caché.

## 6. NVDA · CA1.10

La pasada se hace en el PC y solo con el teclado: después de abrir la página, no toques el ratón.

### Preparación

1. Con el servidor del apartado 2 en marcha, abre en Chrome del PC una ventana de incógnito (`Ctrl+Mayús+N`) y entra en `http://127.0.0.1:4173`. Así Mi lista empieza vacía. Espera unos segundos a que cargue el catálogo.
2. Arranca NVDA con `Ctrl+Alt+N`. La tecla NVDA es `Insert`.
3. Abre el visor de voz: `NVDA+N` › Herramientas › Visor de voz (en inglés, *Speech Viewer*). Muestra por escrito todo lo que dice NVDA, y puedes copiarlo si algo falla.
4. Teclas útiles:
   - `NVDA+Tab` repite el elemento que tiene el foco;
   - `Ctrl` calla la voz;
   - `NVDA+Espacio` cambia entre los modos exploración y foco. NVDA debería pasar solo al modo foco al entrar en la paleta.

### Pasos

Atajos de la §9.4. NVDA puede variar algo las palabras según su versión: lo que cuenta es el contenido.

| # | Teclas | Qué debe pasar y anunciar NVDA |
|---|---|---|
| 1 | `Ctrl+K` | El foco va a la paleta. NVDA dice algo como «Apunta un juego, cuadro combinado, contraído, editable» y pasa al modo foco |
| 2 | Teclea `celeste` | Sale la lista de resultados («expandido»). Al cambiar la opción resaltada, NVDA lee su nombre, su año y su posición, p. ej. «Celeste 2018, 1 de 5» |
| 3 | `↓` y `↑` | Lee cada opción: nombre, año y, si ya está en tu lista, «En tu lista: …». El foco sigue en el campo |
| 4 | `Esc` | La paleta se cierra y el foco vuelve a donde estaba antes de `Ctrl+K` |
| 5 | `Ctrl+K`, `celeste` e `Intro` | La paleta se cierra y NVDA lee el aviso «Apuntado en Quiero jugar: Celeste», quizá seguido de «Deshacer» |
| 6 | `Tab` hasta «Saltar al contenido», `Intro` y `Tab` hasta el título del juego | «Celeste, enlace», en la sección «Quiero jugar (1)» |
| 7 | `Tab` por la fila | «Empezar: Celeste, botón»; «Comprado: Celeste», «Platinado: Celeste» y «Próximo: Celeste», cada uno como botón de alternar, no pulsado; después, «Quiero jugar: cambiar estado de Celeste», como botón de menú |
| 8 | `Intro` (o `↓`) | Se abre el menú en «Quiero jugar», marcado. Con `↓`, NVDA lee «Jugando», «En pausa», «Completado» y «Abandonado», cada uno como opción de menú de radio, no marcada |
| 9 | `↓` hasta «Jugando» e `Intro` | El menú se cierra y NVDA lee «Celeste pasa a Jugando», quizá seguido de «Deshacer». La fila pasa a «Jugando ahora» y el foco no se pierde: `NVDA+Tab` nombra otra fila o el contenido principal |
| 10 | `Ctrl+Z` | NVDA lee «Hemos deshecho el último cambio.» y Celeste vuelve a «Quiero jugar». `Ctrl+Z` no actúa dentro de un campo de texto: si estás en uno, sal antes con `Tab` |
| 11 | `Tab` hasta el botón de estado de Celeste | «Quiero jugar: cambiar estado de Celeste» |
| 12 | Repite el 8 y el 9; después, `Mayús+Tab` hasta «Más opciones», `Intro` (el menú se abre en «Deshacer último cambio») e `Intro` | «Más opciones, botón de menú»; luego, «Hemos deshecho el último cambio.» Celeste vuelve a «Quiero jugar» |

**Pasa si** se cumplen las cuatro condiciones:
- todo se hace con el teclado;
- NVDA anuncia lo de la tabla: la paleta como cuadro combinado llamado «Apunta un juego», la opción resaltada al moverte, los tres avisos (apuntado, cambio de estado y deshecho), el botón de estado con el estado y el juego, y las opciones del menú, indicando cuál está marcada;
- el anillo de foco se ve siempre;
- el foco nunca se pierde: tras la paleta vuelve a su origen, y tras cambiar de estado pasa a otra fila o al contenido principal.

Si algo falla, anota el número de paso y copia del visor de voz lo que dijo NVDA. Apunta también la versión de NVDA (`NVDA+N` › Ayuda › Acerca de) y la de Chrome (`chrome://version`).

## 7. Resultados

Rellena esta tabla. Pon la fecha como DD-MM-AAAA y, en «Valor medido», incluye la `n`.

| Criterio | Presupuesto | Valor medido | Dispositivo y Chrome | Fecha | ¿Pasa? |
|---|---|---|---|---|---|
| CA1.2 · contador con +18 visible | = *manifest* (197 031) | | | | |
| CA1.2 · última fila con Fin (`focused`) | 197 031 | | | | |
| CA1.2 · última fila con la barra (`lastRowVisible`) | `true` | | | | |
| CA1.4 · `capture:palette-to-confirm`, p50 de 10 | ≤3 000 ms | | | | |
| RNF-03 · `ui:feedback`, máximo (informativa) | ≤100 ms | | | | |
| RNF-02 · `search:keystroke-to-results, en full`, p95 | ≤50 ms | | | | |
| RNF-02 · consulta dentro del Worker, p95 (diagnóstico) | — | | | | |
| CA1.11 · `search:ready`, peor de 3 | ≤2 000 ms | | | | |
| CA1.11 · `app:list-visible`, peor de 3 | ≤1 000 ms | | | | |
| CA1.10 · NVDA: apuntar → cambiar estado → Deshacer | Todo anunciado y con teclado | | NVDA … · Chrome … | | |

Añade debajo unas notas:
- cuántas entradas tenía Mi lista;
- las 3 cifras de cada reinicio;
- si el PC o el móvil estaban cargados;
- cualquier rareza;
- y, si algo de NVDA falló, el texto del visor de voz.

**Dónde guardarla:** pega la tabla y las notas en el chat. El asistente las guardará en `docs/medidas/dispositivo-m1-AAAAMMDD.md`, junto a `perf-m1-20261030.md`, y cerrará los criterios en `ESTADO-SESION.md`. Si algo no pasa, propondrá el arreglo. No repitas una medida hasta que salga bien: anota la que falla tal cual.

## 8. Si no hay Android

Lo prevén la §15.4 y la PA-02 (§18). M1 se cierra con `npm run perf`, que salió en verde el 30-10-2026 (`docs/medidas/perf-m1-20261030.md`). Las medidas del apartado 5 pasan a M3 con un *issue* de GitHub.

La pasada con NVDA (apartado 6) no depende del móvil: hazla igualmente.

Para abrir el *issue*, díselo al asistente. Para abrirlo él necesita `gh`, que aún no está instalado: `winget install --id GitHub.cli -e` y luego `gh auth login`. También puedes abrirlo tú en https://github.com/LucasPrezFdez/gameagenda/issues/new. Título sugerido: «M3: medir CA1.2, CA1.4, CA1.11 y RNF-02 en el Android de referencia», con un enlace a esta guía.

## 9. Al terminar

1. En la ventana del servidor, pulsa `Ctrl+C`. Si pregunta «¿Desea terminar el trabajo por lotes (S/N)?», responde `S`.
2. Quita la variable con `Remove-Item Env:CATALOG_DIR`.
3. En `chrome://inspect`, desmarca *Enable port forwarding*. Si quieres, desactiva también la depuración USB en el móvil.
4. Cierra NVDA con `NVDA+Q`.
