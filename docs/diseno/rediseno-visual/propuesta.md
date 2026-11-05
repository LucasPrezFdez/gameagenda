# Rediseño visual · auditoría y propuesta

**05-11-2026**, rama `rediseno-visual` (aparte de `main`). Son los pasos 1 y 2 del encargo (`docs/planificacion/prompts/rediseno-visual.md`). **No toca el código de la app:** las dos direcciones son hojas de estilo que se inyectan encima de la app de producción para fotografiarla. Si no convencen, la rama se queda sin integrar y `main` sigue como estaba.

El encargo pedía esperar a que la segunda parte del núcleo de arranque estuviera en `main`. El usuario pidió empezar ya, el 05-11-2026. La implementación (paso 3) chocará con esa rama en `palette.css` y en el Catálogo, y se resolverá al integrar.

## Cómo verlo

- **Comparación:** `.cache/rediseno/comparar.html`, en la raíz del repositorio principal (no se versiona). Tiene una fila por pantalla, tema y ancho, con las columnas «Ahora», «Dirección A» y «Dirección B», y filtros arriba.
- **Volver a sacarlas:**

  ```
  node scripts/rediseno-capturas.ts --variant=antes
  node scripts/rediseno-capturas.ts --variant=a --css=docs/diseno/rediseno-visual/base-limpia.css,docs/diseno/rediseno-visual/direccion-a.css
  node scripts/rediseno-capturas.ts --variant=b --css=docs/diseno/rediseno-visual/base-limpia.css,docs/diseno/rediseno-visual/direccion-b.css
  ```

  Abre `ga-web` de producción en un perfil propio (`.cache/rediseno/perfil`, nunca el del usuario), importa una agenda de prueba de 19 juegos y fotografía seis pantallas (Mi lista, la paleta con «hollow», el Catálogo, la ficha de Hollow Knight, Próximos y Ajustes) en claro y oscuro, a 390, 1 100 y 1 440 px.
- **Contraste:** `node scripts/rediseno-contraste.ts docs/diseno/rediseno-visual/direccion-a.css`. Mide los pares de `tokens-contrast.test.ts`, más el icono de cada estado sobre el fondo y sobre la fila resaltada (≥3:1).

En lugar de una maqueta HTML aparte, la propuesta se ve en la app real, con el catálogo y las portadas de verdad. Es más fiel y no obliga a mantener dos maquetas.

## 1 · Auditoría: qué mete ruido hoy

1. **Demasiadas cajas.** Cada fila es una tarjeta blanca sobre gris, con 2 px entre una y otra. Además llevan borde las 11 píldoras de vista y de compra, el filtro, el selector de orden y el campo de búsqueda. Se lee como una cuadrícula de bordes antes que como una lista de juegos.
2. **Las vistas no caben.** A 1 440 px, «Todos 19» salta a una segunda línea. A 390 px, vistas y compra ocupan cuatro líneas, y el rótulo de la primera sección empieza a 436 px de 844: media pantalla de controles.
3. **El color de estado tiñe bloques grandes.** El botón de estado es una píldora de color en cada fila. En Quiero jugar sale una columna de píldoras azules que compite con las portadas.
4. **Portadas pequeñas y sin filo:** 32 × 48 px, y en oscuro las portadas oscuras se funden con el fondo.
5. **Rótulos de sección pesados:** mayúsculas, negrita y la pista «Arrastra :: o usa Alt+↑/↓» al lado.
6. **El acento se reparte:** barra rosa en la barra lateral, en Ajustes y en la opción activa de la paleta, además del anillo de foco y del botón principal.
7. **Las marcas, en chips con fondo:** Comprado, Platinado y Próximo suman hasta tres fondos de color más por fila.
8. **Casi todo va en 600–700:** títulos de fila, marca, botones de estado y rótulos. Con todo en negrita, nada destaca.
9. **Fallo real, a 390 px en la paleta:** la lista de resultados es una rejilla con una columna implícita `auto`, que se ensancha hasta el título más largo: cada opción mide 395 px dentro de una lista de 358. El año y «Intro: Apuntar» quedan debajo del botón (i). Se arregla con `grid-template-columns: minmax(0, 1fr)` en la lista, sus grupos y la columna de (i) (en `base-limpia.css`), y conviene arreglarlo pase lo que pase con el rediseño.

## 2 · Lo común a las dos direcciones (`base-limpia.css`)

- **Sin tarjetas por fila:** las filas van sobre el fondo, se resaltan al pasar el puntero o con el foco, y la fila arrastrada flota con sombra.
- **Vistas y compra en una sola línea** que se desliza en horizontal. A 390 px, el rótulo de la primera sección sube de 436 a ≈280 px.
- **Estado neutro:** el botón es una píldora con un filo fino y el texto en el color normal. El color, solo en el icono, porque el texto ya dice el estado (§9.7).
- **Marcas como texto secundario,** con el color solo en el icono de Platinado y de Próximo.
- **Portadas de 40 × 60 px** (en la paleta, 28 px) con un filo de 1 px. Caben en la fila de 72 px del Catálogo (68 px de alto más 4 de hueco): no cambia `ROW_HEIGHT` ni el límite de Firefox.
- **Tipografía con jerarquía:** el texto base pasa a 15 px con interlineado 1,5. Títulos de fila en 500, rótulos en 600 y el título de pantalla en 28 px y 600. Iconos con trazo de 1,75 px.
- **Botones sin borde,** con fondo `--surface-2`: el texto ya los identifica. **Los campos conservan su borde de ≥3:1** (WCAG 1.4.11).
- **El acento, solo en** la opción activa de la paleta (2 px), el icono de la página actual, el botón principal y el foco.
- **Una sola curva** (`--ease`) para todas las transiciones; ninguna con `prefers-reduced-motion`, como hoy.

Escalas, iguales en las dos:

| | Valores |
|---|---|
| Letra | 12 · 13 · 15 · 17 · 20 · 28 px (`--text-xs` … `--text-2xl`); el campo de la paleta sigue en 16 px por iOS |
| Pesos | 400 · 500 · 600 |
| Radios | 6 px (portadas, teclas y elementos de menú) · 10 px (controles y filas) · 14 px (superficies flotantes y grupos) |
| Sombras | `--shadow-sm` (un filo) · `--shadow` (lo que flota) |
| Fila de Mi lista | 76 px (`--row-h`, antes 64) |

## 3 · Dirección A · «Papel»

> Papel cálido y aire: filas planas sobre el fondo, sin tarjetas, y el rosa de siempre, más hondo y menos saturado, como único acento.

- Neutros templados, ligeramente cálidos. La vista elegida va en una píldora de tinta y la página actual, en un fondo suave.
- Es la más ligera: no hay ninguna superficie dentro del contenido. Las secciones se separan con espacio.
- Mantiene la identidad: el rosa del logotipo y del foco.

| Token | Claro | Oscuro |
|---|---|---|
| `--bg` | `#FAFAF9` | `#131315` |
| `--surface` | `#FFFFFF` | `#1A1A1D` |
| `--surface-2` | `#F2F2F0` | `#232326` |
| `--line` (nuevo) | `#E8E7E4` | `#2A2A2E` |
| `--control-border` | `#87877F` (3,62:1) | `#6F6F77` (3,49:1) |
| `--text` | `#1C1C1E` (17,01:1) | `#ECECEE` (14,72:1) |
| `--text-muted` | `#63636A` (5,96:1) | `#A1A1A9` (6,77:1) |
| `--accent` | `#B3255D` (6,29:1) | `#F27AA8` (6,72:1) |

Contraste sobre `--surface`. Los 48 pares cumplen en los dos temas. El más justo es `--control-border` sobre `--surface-2`: 3,23:1 en claro y 3,15:1 en oscuro, con un mínimo de 3. Los colores de estado no cambian.

## 4 · Dirección B · «Tinta»

> Monocromo nítido: neutros fríos, el acento es la propia tinta y el único color lo ponen las portadas y los iconos de estado.

- **Secciones agrupadas:** cada sección es una superficie con un filo y radio de 14 px. Dentro, las filas van separadas por una línea fina que empieza en el título, no en la portada.
- **Vistas como pestañas subrayadas;** el filtro de compra, en píldoras pequeñas.
- **El acento es negro en claro y casi blanco en oscuro.** El logotipo pasa a ser un cuadrado de tinta, y el foco y el botón principal van en tinta.
- Es la más ordenada y la que mejor aguanta listas largas, pero pierde el rosa de la identidad.

| Token | Claro | Oscuro |
|---|---|---|
| `--bg` | `#F6F6F7` | `#0E0E10` |
| `--surface` | `#FFFFFF` | `#161618` |
| `--surface-2` | `#F0F0F2` | `#1F1F22` |
| `--line` (nuevo) | `#E4E4E8` | `#27272B` |
| `--control-border` | `#84848E` (3,70:1) | `#6E6E78` (3,58:1) |
| `--text` | `#18181B` (17,72:1) | `#F4F4F5` (16,44:1) |
| `--text-muted` | `#5E5E68` (6,41:1) | `#A1A1AA` (7,05:1) |
| `--accent` | `#18181B` (17,72:1) | `#F4F4F5` (16,44:1) |

Contraste sobre `--surface`. Los 48 pares cumplen en los dos temas. El más justo es `--control-border` sobre `--surface-2`: 3,25:1 en claro y 3,26:1 en oscuro.

## 5 · Elección e iconos (05-11-2026)

**El usuario elige la dirección B, «Tinta».** Pide además mejorar los iconos de estado («el marcapáginas, el play y tal son bastante feos») y un icono nuevo para la app, basándose en el trabajo de diseñadores profesionales.

### Iconos de estado y marcas: Phosphor, macizos

- **Comparadas:** cuatro colecciones profesionales con licencia MIT (Phosphor 2.1.1, Fluent UI System Icons 1.1.345, Tabler 3.50.0 y Heroicons 2.2.0), los de ahora (Lucide, de trazo) y unos propios macizos. Las colecciones se descargaron con `npm pack`, sin ejecutar nada, y sus SVG se leyeron como datos. Hoja: `node scripts/rediseno-iconos.ts <descargas>` → `.cache/rediseno/iconos.html`.
- **Elegidos: los macizos («fill») de Phosphor.**
  - Es la única colección con los ocho conceptos y el mismo lenguaje en todos.
  - Sus esquinas suaves casan con los iconos de trazo de Lucide de la interfaz.
  - A 18 px se leen mejor que un contorno, y en la dirección B son lo único con color.
  - Fluent queda muy de Windows, pero su «Abandonado» es casi de contorno y su bolsa se lee mal. A Tabler le falta la bolsa y a Heroicons la chincheta. Los propios estaban bien, pero quedaban por debajo en la bolsa y la chincheta.

| Estado o marca | Phosphor |
|---|---|
| Quiero jugar | `bookmark-simple` |
| Jugando | `play` |
| En pausa | `pause` |
| Completado | `check-circle` |
| Abandonado | `prohibit-inset`: el disco con la barra en hueco, a juego con Completado |
| Platinado | `trophy` |
| Comprado | `bag-simple`: la que mejor se lee como bolsa a 18 px |
| Próximo | `push-pin`: la inclinada (la recta parece una lámpara) |

- **Cambio del usuario en dos marcas:**
  - **Platinado,** basado en el trofeo de platino de PlayStation y en color platino. Es un trofeo propio con esa forma clásica (copa ancha, asas en bucle, tallo con collarín y peana de dos alturas), no el dibujo de Sony. Va a tres tintas: cuerpo acero-platino, sombra a la derecha y brillo a la izquierda. Tokens nuevos: `--platinum-metal`, `--platinum-shade` y `--platinum-shine`. El texto de la marca pasa del dorado al gris platino (`#56657A` / `#C9D4E2`).
  - **Próximo,** una chincheta roja: la «push-pin» de Phosphor partida en cabeza roja, aguja gris y un brillo. `--next` pasa del verde azulado al rojo (`#C4272F` / `#FF6B6B`).
  - **Los colores solo salen con la marca puesta:** en las insignias de la fila, en los botones de marca pulsados, en los chips de la ficha y en «Apuntar como…». Sin marcar van en el color del texto, para no parecer activos. Las reglas están en `base.css`.
  - **Contraste:** `tokens-contrast.test.ts` comprueba también el cuerpo del trofeo y la cabeza de la chincheta sobre las tres superficies (≥3:1). Pasan las 79 pruebas.
  - Prueba ampliada: `node docs/diseno/rediseno-visual/iconos-marcas.mjs <salida.html>`.
- **Cómo van:** en `icons.tsx`, como trazados con su rejilla de 256 reducida a 24 (`scale(.09375)`). El componente `Icon` y los nombres no cambian, y no hay dependencias nuevas. Los ocho suman ≈2,5 KB sin comprimir.
- **Licencias:** `apps/web/public/licencias.txt` lleva los avisos de Phosphor (MIT) y de Lucide (ISC), que la app no recogía.
- **El resto de la interfaz sigue en Lucide** (buscar, menús, cerrar…), con el trazo a 1,75 px. Solo cambian dos: «Mi lista» y «Catálogo», con los puntos más pequeños y las esquinas más redondas.

### Icono de la app: tres opciones

`node docs/diseno/rediseno-visual/icono-app.mjs <carpeta>` escribe los tres SVG y una página que los enseña a 160, 64, 32 y 16 px, sobre fondo claro y oscuro, en una pestaña y en una barra de tareas.

Siguen los principios de Apple y Fluent para iconos de app: un solo motivo, sin texto, legible a 16 px y sobre una base de esquinas redondeadas. El marcapáginas y el play son las formas de Phosphor.

1. **Tinta:** cuadrado negro y marcapáginas blanco con un play recortado. Es la dirección B pura. Necesita un filo claro sutil, porque en una barra de tareas oscura el cuadrado desaparece.
2. **Rosa:** el mismo motivo sobre el rosa de siempre, algo más hondo (`#B3255D`). Conserva la identidad fuera de la app y se ve igual sobre fondo claro y oscuro.
3. **Cinta:** cuadrado negro, play blanco y una cinta rosa que cuelga del borde, como el marcapáginas de un libro. A 16 px puede leerse como un reproductor de vídeo.

**Recomendación: la 2, Rosa.** Una interfaz monocroma con un icono de color es lo habitual. El icono es lo único que se ve fuera de la app (pantalla de inicio, barra de tareas, pestaña), y ahí el rosa la distingue.

Cuando se elija, `icono-app.mjs` saca de ese SVG el favicon (`icon.svg`), las PNG de la PWA (192, 512 y la *maskable* con margen de seguridad), la de iOS (180, sin esquinas, porque iOS pone las suyas) y las de la app de escritorio (`icon.ico` y las PNG de `src-tauri/icons`). El logotipo de la cabecera pasa a ser el mismo motivo.

### Logo: Grafito (segunda ronda)

El usuario descarta el rosa: el logo tiene que ir con los colores de la B. Hubo una segunda ronda de cuatro opciones en esa paleta (`logo.mjs`): Grafito, Jugando, Estados y Platino. Siguen las guías de Microsoft (iconos de app de Windows) y de Apple (HIG): una metáfora literal, sin texto, degradados de un paso con la luz arriba a la izquierda y contraste sobre fondo claro y oscuro.

**Elegido: Grafito.** Es el marcapáginas blanco de Phosphor con el play hueco, sobre un degradado de zinc (`#46464F` → `#18181B`, a 120°), con un filo claro sutil para que no desaparezca en una barra de tareas oscura.

- **Originales:** `apps/web/public/icons/icon.svg`, con esquinas, que es también el favicon, y `apps/web/icons/icon-sangre.svg`, a sangre.
- **Todos los tamaños:** `node scripts/generar-iconos.ts`. Saca las PNG de la PWA (192, 512 y la *maskable* de 512, con el motivo dentro de la zona segura) y la de iOS (180, a sangre y opaca). También saca, con `tauri icon`, las de la app de escritorio: el `.ico` de 16 a 256 px y las PNG de `tauri.conf.json`. La bandeja usa el mismo icono que la ventana.
- **Cabecera:** el mismo dibujo en `LogoMark` (`App.tsx`), con sus colores en `--brand-*` de `tokens.css`. No cambian con el tema, como el icono, y `tokens-contrast.test.ts` los deja fuera de la comprobación claro/oscuro.
- **Color de tema:** el *manifest* y la etiqueta `theme-color` dejan el rosa (`#C2185B`) por el fondo de la B: `#F6F6F7` en claro y `#0E0E10` en oscuro, según el sistema.
- **La app de escritorio** solo muestra el icono nuevo con un instalador nuevo (`npm run desktop:build`).

## 6 · Lo que no cambia

Comportamiento, rutas, atajos, gestos, textos y nombres accesibles; la letra del sistema, sin fuentes web; y las reglas de la §9.5: huecos reservados, portada 2:3 fija, nada de `:has()` en la raíz y animaciones solo con `transform` y `opacity`. Las hojas de la propuesta solo cambian CSS. Las únicas reglas con `:has()` son las que ya existían.

### El estado en la fila: Punto

Al usuario no le gustaba el botón de estado de la fila, la píldora con el play o el marcapáginas a la derecha («feo»). Además, en «Pendientes» repetía lo que ya dice el título de cada sección.

- **Opciones comparadas** (inyectadas encima del *build* de la rama; página `estado.mjs`):
  1. «Etiqueta», como Notion o Jira: tintada y sin borde;
  2. «Punto», como GitHub Projects;
  3. «A la izquierda», como Linear o Things: el icono delante de la portada.

  Las tres conservaban el botón, su nombre accesible, su menú y los 44 px táctiles.
- **Elegida: Punto.** Un punto de 8 px en el color del estado y el texto en gris, sin caja. La caja suave (`--surface-3`) y la flecha salen con el puntero, el foco o el menú abierto. Se ve de 28 px y se toca en 44, gracias a un `::after`.
- **En el móvil estrecho**, el texto se queda, para que el estado no lo diga solo el color. Cuesta algo de sitio al título.
- El icono de estado sigue en el menú, en la paleta y en la ficha.

## 7 · Paso 3: la B en la app (05-11-2026)

Hecho en seis capas, con un *commit* y `check` en verde en cada una:

1. `38466a2`, tokens;
2. `69b0e8e`, base y estructura;
3. `d8decc0`, Mi lista;
4. `98ddd6c`, paleta, con el arreglo de 390 px;
5. `877e2d6`, Catálogo y ficha;
6. `046486d`, Ajustes.

Después, `a2898a6` arregla el hueco entre avisos y la última capa pone las casillas en tinta (`accent-color`). Las capturas del después (`--variant=despues`, el *build* de la rama sin hojas inyectadas) coinciden con «B con los iconos nuevos».

| Medida (05-11-2026, CPU al 5 %) | Antes (`main`) | Después |
|---|---|---|
| `check` | 879 pruebas | 945 pruebas (66 de contraste nuevas) |
| E2E Chromium + WebKit (axe, 320 px, foco) | 177 | 177 |
| JS inicial (brotli) | 130,4 KB | 131,2 KB |
| Pares de contraste | 79 | 133 |
| Tareas largas al teclear o apuntar | 0 | 0 en 2 de 3 pasadas; una de 52 ms en la otra, sin fotograma largo |
| INP (20 nombres, 10 altas) | — | 32–64 ms (≤200) |
| Reinicio con caché → `scan` | ≈2,1 s con el equipo cargado | 1 768 ms (≤2 000) |
| Restaurar el índice → primera consulta | 162–326 ms | 171 ms (≤400) |
| Todo, tras «Punto» (CPU al 10 %) | — | En verde a la primera: 945 · 177 E2E · `perf` entero (0 tareas largas, INP 40 ms, `scan` 1 898 ms) |

Criterios de aceptación del encargo:
- Seis tamaños de letra, tres pesos, tres radios, dos sombras y un acento: cumple.
- Ningún color fuera de `tokens.css`: cumple, salvo el `::backdrop` de la ayuda de atajos, que ya estaba así a propósito porque algunos navegadores no le pasan las variables.
- `check`, E2E, `perf` y `size` en verde, y +0,8 KB de JS: cumple.
- Mismas funciones, atajos y textos, y ningún selector de E2E cambiado: cumple.

**Queda:** el visto bueno del usuario sobre las capturas, el instalador de escritorio con el icono nuevo y la pasada con lectores de pantalla sobre la interfaz nueva.
