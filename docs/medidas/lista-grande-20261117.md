# Mi lista con miles de juegos (16 y 17-11-2026)

Fase 2, parte 1 (DECISIONES §10.48): desde 300 filas a la vista, Mi lista pinta solo las cercanas a la pantalla (`SectionRows.tsx`). Todo en el PC de desarrollo (Windows 11, 60 Hz), con Chromium de Playwright y el *build* del modo `e2e`.

## Con 5 000 juegos

Una prueba temporal (`.cache/lista-grande/zz-lista-grande.spec.ts`, que no se sube) importa 5 000 juegos en Ajustes › Datos (60 % en Quiero jugar, 16 % Jugando, 8 % En pausa, 12 % Completado y 4 % Abandonado; un 30 % comprados) y mide con CPU ×1 y ×4. Se corre con `N=5000 npx playwright test e2e/zz-lista-grande.spec.ts --project=chromium --trace off`, copiándola antes a `apps/web/e2e/`.

| | Antes ×1 | Ahora ×1 | Antes ×4 | Ahora ×4 |
|---|---|---|---|---|
| Abrir Mi lista (`app:list-visible`) | 1 687 ms | 154 ms | 8 011 ms | 478 ms |
| «Empezar» en una fila (`ui:feedback`) | 962 ms | 35 ms | 2 425 ms | 131 ms |
| Filtrar «99» (dos teclas) | 779 ms | 179 ms | 3 095 ms | 428 ms |

En el DOM se pasa de 3 798 filas y unos 180 000 nodos a 22 filas y 1 217 nodos.

**Ojo al medir así:**

- `getByRole` recorre todo el árbol de accesibilidad: con miles de filas, Playwright se come el hilo principal. Hay que usar selectores CSS.
- La traza (`trace: retain-on-failure`) hace una instantánea del DOM entero en cada acción: `--trace off`.
- `capture:palette-to-confirm` cuenta desde que se abre la paleta, tecleo incluido; la respuesta a Intro es `ui:feedback`.

## `npm run perf` (500 entradas, CPU ×4)

Con 500 entradas en Quiero jugar, Mi lista ya va virtualizada. Cuatro pasadas el 17-11-2026, en este orden: rama, `main`, rama y `main`, con el equipo en reposo (en la tercera coincidieron unos segundos de `vitest`). Para las de `main` se pusieron sus ficheros en el árbol de la rama.

| Medida | Presupuesto | `main` 1 | `main` 2 | Rama 1 | Rama 2 |
|---|---|---|---|---|---|
| Primera visita: LCP | ≤2500 ms | 736 | 1076 | 808 | 732 |
| Primera visita: búsqueda lista (`search:ready`) | ≤1500 ms | 741 | 1072 | 809 | 735 |
| Reinicio con caché: Mi lista visible (`app:list-visible`) | ≤1000 ms | 701 | 640 | **297** | **258** |
| Reinicio con caché: búsqueda lista (`search:ready`) | ≤2000 ms | 818 | 760 | 368 | 334 |
| Reinicio con caché: LCP | ≤2500 ms | 824 | 764 | 372 | 340 |
| INP (20 nombres, 10 altas) | ≤200 ms | 64 | 64 | 40 | 40 |
| Toque → respuesta (`ui:feedback`), máx. | ≤100 ms | 71,5 | 58,9 | 58,3 | 53,4 |
| Apuntar: abrir paleta → confirmación, p50 | ≤3000 ms | 2224,5 | 2246,9 | 2153,7 | 2068,5 |
| Tareas largas (>50 ms) al teclear o apuntar | 0 | 1 ✗ | 2 ✗ | 3 ✗ | 3 ✗ |

Las tareas largas, por pasada:

- **Intro al apuntar el primer nombre**, en las cuatro: de 51 a 73 ms, con su fotograma largo (`onkeydown`) salvo en la primera de la rama;
- **una sin fotograma largo tecleando el segundo nombre**, a +0,3–0,4 s: en las dos de la rama y en la segunda de `main` (54–58 ms);
- **otra sin fotograma largo tecleando el quinto nombre**, a +0,6–0,7 s: solo en las de la rama (49 y 52 ms). Es la única de más, y va justo en el umbral.

Este número ya variaba de una pasada a otra el 10-11-2026 (2 en `main` frente a 4 en `pulido-visual`, §10.44).

## Importar 5 000 juegos, de una vez y por lotes

Ajustes › Datos con una copia JSON de 5 000 juegos, en Chromium (`.cache/lista-grande/zz-import-5000.spec.ts`). Desde que Playwright entrega el fichero hasta el «Hemos importado», con las tareas largas (`longtask`):

| | De una vez ×1 | Por lotes ×1 | De una vez ×4 | Por lotes ×4 |
|---|---|---|---|---|
| Total | 4 202 ms | 4 999 ms | 12 353 ms | 16 990 ms |
| Tareas largas | 5 | 24 | 9 | 59 |
| Las mayores | 1 192, 404, 295, 122 | 418, 79, 68, 66 | 5 112, 2 236, 1 345, 554 | 2 300, 400, 363, 299 |

**Una tarea de ≈400 ms (×1) es de Playwright, no de la app:** es un fotograma largo sin ningún *script*, y sale igual con un fichero no válido del mismo tamaño, que la app rechaza en cuanto lo lee (400 ms, y ninguna tarea más). Descontada esa, la importación por lotes no tiene ninguna tarea de más de ≈80 ms con ×1 ni de ≈400 ms con ×4.

Por fases, con lotes y ×1: leer y validar la copia (`parseExport`), 75 ms; fusionar y aplicar los 20 lotes, 304 ms; y guardarlos en IndexedDB, 3,7 s, que no bloquean la página. El total sube porque cada lote es una transacción y una emisión de la agenda.

## Las tareas largas de `perf`, en una traza

Con `PERF_TRACE=1` (y otra vez con el perfilador de V8 y un *build* sin minificar, cambios temporales que no se suben), las tareas de 45 a 60 ms de la sesión son casi todas de la **paleta**:

- al llegar los resultados de cada tecla, React borra las opciones anteriores, y `removeChild` se lleva del 55 al 70 % de la tarea;
- las dos tareas «sin fotograma largo» son un `Layout` suelto de unos 1 220 objetos, ensuciados por textos nuevos de la paleta (`palette__name`, `palette__meta`, `cover__initials`);
- el Intro que apunta (unos 85 ms con traza) lleva un 30 % de `getBoundingClientRect` en efectos de *layout*. No se miró de quién: pueden ser las medidas de `WindowRows` o el deslizado de la fila nueva (`list-motion.ts`). Esa tarea también sale en `main` (`onkeydown`, de 56 a 71 ms sin traza).

Según la traza, las dos sin fotograma largo no salen de pintar Mi lista, sino de maquetar la paleta; la del segundo nombre sale también en `main`. Por qué la del quinto queda por debajo de 50 ms en `main` no se ha averiguado. Abaratar la paleta y mirar el Intro quedan como mejora aparte.

## La importación en WebKit para Windows

Al escribir el E2E de 600 juegos, la importación no acababa en WebKit. Cuánto tarda importar N juegos en Ajustes › Datos (`.cache/lista-grande/zz-import-probe.spec.ts`):

| Juegos | Chromium | WebKit (iPhone 15 emulado) |
|---|---|---|
| 100 | 222 ms | 26 311 ms |
| 300 | 381 ms | 77 982 ms |
| 600 | 677 ms | 155 547 ms |

Con `main`, lo mismo: 100 juegos en 26 275 ms. El JavaScript de la importación cuesta 30 ms en WebKit. El resto es la transacción de Dexie, a ≈15 ms por petición: con 100 juegos, `bulkGet` tarda 1,5 s, `bulkPut` otros 1,5 s y `bulkAdd` de las 1 500 operaciones de la `outbox`, 22,8 s. Es el WebKit de Playwright para Windows (`e2e/storage.ts` ya lo decía), no Safari en el iPhone ni la app de escritorio (WebView2). Por eso `list-large.spec.ts` guarda los juegos directamente en IndexedDB.

Cada juego importado deja 15 operaciones en la `outbox`, una por campo. Para la importación de Steam, ver DECISIONES §10.48.
