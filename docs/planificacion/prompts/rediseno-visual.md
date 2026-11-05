# Rediseño visual de GameAgenda: minimalista y limpio

> Prompt del encargo, del 05-11-2026. Se ejecuta en la rama `rediseno-visual`, aparte de `main`: si el resultado no convence, la rama se queda sin integrar y `main` sigue como estaba.

## Tu papel
Eres diseñador de producto y desarrollador front-end sénior, con ojo para la tipografía, el espacio y el detalle. Trabajas en el repositorio de GameAgenda (https://github.com/LucasPrezFdez/gameagenda), en Windows 11 con Node 24.21 y npm 11.19.

## Contexto
GameAgenda es una agenda personal de videojuegos. Sirve para apuntar en segundos un juego del catálogo completo de Steam (unos 198 000) y llevar su estado: Quiero jugar, Jugando, Completado, Platinado… Su promesa es ser «rápida y ágil». Es una PWA local-first (React 19, Vite 8 y CSS nativo, sin librería de componentes). La app de escritorio para Windows (Tauri) carga la misma web, así que el rediseño llega a las dos.

Antes de tocar nada, lee:
- `docs/planificacion/ESTADO-SESION.md`, §0 y §5 (reglas de trabajo);
- `prototipe.md` §9 entera: pantallas, wireframes, atajos y gestos, reglas de respuesta inmediata (§9.5), estados del sistema, accesibilidad (§9.7), tokens (§9.8) y microcopy (§9.9);
- `docs/planificacion/DECISIONES.md` §10, que manda sobre lo anterior, en especial §10.20, §10.22 y §10.28;
- las hojas de `apps/web/src/styles/` (`tokens.css`, `base.css`, `shell.css`, `list.css`, `palette.css`, `sheet.css`) y los CSS de `apps/web/src/screens/`.

Empieza cuando la segunda parte del núcleo de arranque (rama `m3-arranque`) ya esté en `main`: toca la paleta y el Catálogo, y así no chocáis.

## Objetivo
Dar a la app un aspecto minimalista, sereno y cuidado («clean») sin cambiar lo que hace ni lo rápido que va. Al abrirla tiene que sentirse ligera y ordenada: las portadas son las protagonistas y la interfaz se aparta.

## Dirección visual
Aquí, «clean» quiere decir:
1. **El contenido manda.** Las portadas y los nombres de los juegos ponen el color; la interfaz es casi monocroma.
2. **Menos cajas.** Menos bordes, fondos y sombras. Separa con espacio y, si hace falta, con líneas finas (1 px y poco contraste) en vez de tarjetas. Las sombras, solo para lo que flota: la paleta, los menús, los avisos y las hojas.
3. **La tipografía hace la jerarquía.** Pocos tamaños y pesos, bien escalonados (por ejemplo, 12 / 13 / 15 / 17 / 20 / 28 px y pesos 400, 500 y 600), con interlineado generoso y `tabular-nums` en cifras y fechas.
4. **Un solo acento,** reservado para la acción principal, la selección y el foco. El color de estado, solo en el icono o en un punto, nunca en bloques grandes.
5. **Ritmo y alineación:** escala de espaciado de 4 px (4, 8, 12, 16, 24, 32, 48), una rejilla clara y todo alineado a ella. Radios coherentes según el tamaño del elemento (por ejemplo, 6, 10 y 14 px).
6. **Iconos discretos:** un mismo trazo (1,5 px) y un mismo tamaño, nunca de adorno.
7. **Movimiento sutil y útil:** 120–200 ms, con `transform` y `opacity`, curvas suaves y nada que rebote.
8. **Los dos temas, igual de cuidados.** El oscuro no es el claro invertido: tiene sus propios neutros, sin negro ni blanco puros de fondo.

Referencias de tono, por el espíritu y no para copiarlas: Linear, Things 3, Raycast y Apple Music. **La identidad es propia: nada que recuerde a Steam** (§9.8 y §11). Puedes proponer afinar el acento rosa actual (`#C2185B` / `#FF6AA8`) o sustituirlo, siempre justificándolo.

## Alcance
- **Mi lista:** «Pendientes» con sus secciones, las vistas por estado, Próximos, filtros y orden. La fila, con su portada, estado, marcas, asa `::` y la bandeja que aparece al deslizar.
- **Paleta:** en escritorio y como hoja en el móvil, con los resultados, «En tu lista», «¿Quizás buscabas…?», «Apuntar a mano» y el chip «Pegar enlace».
- **Catálogo** (lista virtual) y **ficha**, básica y completa.
- **Ajustes:** todas las secciones, incluido el panel de Rendimiento.
- **Lo común:** cabecera, barra lateral, pestañas y barra de captura en el móvil, menús, selector de estado, avisos (Deshacer, portadas, catálogo, guardado fallido y copia), ayuda de atajos, esqueletos, portadas generadas, estados vacíos y de error.
- **Anchos:** 320, 390, 768, 1 100 (la ventana de escritorio), 1 280 y 1 440 px, en tema claro y oscuro.

## Restricciones (no negociables)
**Rendimiento**
- `npm run perf` en verde con CPU ×4: pulsación de ≤2 fotogramas, 0 tareas largas al teclear y al apuntar, e INP dentro de presupuesto.
- `npm run size` en verde: JS inicial ≤150 KB brotli (hoy, 130,4 KB) y Worker ≤40 KB. El rediseño no debería sumar más de 2 KB.
- Letra del sistema (`"Segoe UI Variable Text", system-ui, sans-serif`), sin fuentes web. Si propones una, mide antes su coste (KB, LCP y primer pintado sin red) y pide permiso.
- Reglas de la §9.5:
  - nada se mueve bajo el cursor: los huecos van reservados y la portada es 2:3 fija;
  - esqueletos con su tamaño final;
  - nada de `:has()` en la raíz ni en contenedores grandes;
  - animaciones solo con `transform` y `opacity`;
  - sin `backdrop-filter` en lo que se repite, como las filas.
- Si cambias la altura de las filas del Catálogo (hoy, 72 px), recalcula su altura total: unos 198 700 juegos por la altura de fila tienen que quedar por debajo del límite de Firefox (≈17,9 Mpx). Eso deja como mucho unos 88 px.

**Accesibilidad (WCAG 2.2 AA, §9.7)**
- Contraste en los dos temas: ≥4,5:1 en el texto y ≥3:1 en los componentes y en los iconos que significan algo. `scripts/tokens-contrast.test.ts` tiene que pasar. Pon al día sus pares si cambian los tokens, nunca para relajarlos.
- Anillo de foco visible de 2 px.
- Objetivos de ≥24 px, y de ≥44 px con el dedo.
- Sin desplazamiento horizontal a 320 px.
- Respeta `prefers-reduced-motion`.
- Un estado nunca se distingue solo por el color: siempre icono y texto.
- No cambies nombres accesibles, roles ni textos visibles: los E2E y los lectores de pantalla dependen de ellos.

**Técnica**
- Solo CSS nativo: sin Tailwind, CSS-in-JS ni CSS Modules. Sin dependencias nuevas.
- Todo valor de diseño sale de `tokens.css`. Añade ahí tokens de tipografía, espaciado, radios, elevación y movimiento; ningún color suelto en las demás hojas.
- El tema claro va por defecto, y el oscuro con el sistema o desde Ajustes. Los dos bloques oscuros de `tokens.css` tienen que seguir siendo idénticos.
- No cambies comportamiento, rutas, atajos, gestos ni microcopy (§9.9). Si crees que algo debería cambiar, propónlo aparte. El JSX solo se toca para añadir las clases o los envoltorios que pida el estilo.
- No toques el pipeline del catálogo (`pipeline/`, `scripts/catalog-*`, `catalog.yml`).

## Proceso
1. **Auditoría.** Haz capturas con Playwright de cada pantalla y estado, en los dos temas, a 390, 1 100 y 1 440 px. Guárdalas fuera del repositorio versionado, en `.cache/rediseno/antes/`. Haz una lista de lo que mete ruido: bordes, fondos, tamaños de letra, colores, alineaciones e incoherencias, con capturas de ejemplo.
2. **Propuesta, y espera mi visto bueno.** Como mucho dos direcciones. Cada una lleva:
   - una frase que la resuma;
   - los tokens nuevos: color en los dos temas con su contraste medido, tipografía, espaciado, radios, elevación y movimiento;
   - Mi lista y la paleta maquetadas en una página HTML estática, en claro y oscuro, a 390 y 1 100 px.

   No toques el código de la app hasta que yo elija.
3. **Implementación por capas,** en la rama `rediseno-visual`:
   1. tokens;
   2. base y estructura (cabecera, barra lateral, pestañas y barra de captura);
   3. Mi lista y la fila;
   4. paleta y hoja;
   5. Catálogo y ficha;
   6. Ajustes, menús, avisos, diálogos y estados vacíos.

   Un commit por capa, con Conventional Commits (el tipo en inglés y la descripción en español) y `npm run check` en verde en cada uno.
4. **Verificación,** antes de pedir que se integre:
   - `npm run check`;
   - los E2E en Chromium y WebKit, axe incluido;
   - `npm run catalog:frozen` y luego `npm run perf`, con el equipo en reposo (sin juegos ni Discord abiertos);
   - `tokens-contrast`;
   - capturas «después» de las mismas pantallas y anchos, en `.cache/rediseno/despues/`, con una tabla antes/después y tu valoración.
5. **Documentación:**
   - la §9.8 en `docs/planificacion/secciones/`, y después `node docs/planificacion/montar-prototipe.mjs . --write`;
   - una entrada nueva en la §10 de `DECISIONES.md` con el porqué;
   - el CHANGELOG, en «Sin publicar».
6. **Tras integrar en `main` y desplegar:** `npm run smoke:web` y un vistazo a la app de escritorio a 1 100 px.

## Criterios de aceptación
- Como mucho 6 tamaños de letra, 3 pesos, 3 radios, 2 sombras y 1 acento.
- Ningún color fuera de `tokens.css`: buscar `#`, `rgb(` y `hsl(` en las demás hojas no da nada.
- `check`, E2E, `perf` y `size` en verde, y el JS inicial sube ≤2 KB brotli.
- Contraste AA en los dos temas, comprobado por `tokens-contrast`.
- Las mismas funciones, atajos y textos. Los selectores de los E2E no cambian, salvo con una justificación.
- Mi visto bueno sobre las capturas «después».

## Qué no hacer
- Rediseñar la arquitectura de la información o los flujos: eso es otro encargo.
- Ilustraciones, degradados llamativos, glassmorphism o animaciones de adorno.
- Usar la paleta o las imágenes de Steam para la identidad.
- Borrar ramas, worktrees o borradores.

## Entregables
1. La auditoría y la propuesta (pasos 1 y 2).
2. Cuando elija, la rama con un commit por capa.
3. Las capturas antes/después y la tabla de medidas: `perf`, `size` y contraste.
4. La documentación al día.
