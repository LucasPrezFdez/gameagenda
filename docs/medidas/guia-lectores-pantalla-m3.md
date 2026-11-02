# Guía: pasada con lectores de pantalla de M3 (CA3.5)

**Qué se comprueba.** CA3.5 pide una pasada con NVDA, Narrador, TalkBack y VoiceOver del camino principal: **apuntar → cambiar estado → Deshacer**. El resto de CA3.5 ya lo comprueban las pruebas:
- axe sin violaciones graves ni críticas en cada pantalla y en los dos temas;
- el contraste de todos los colores (texto ≥4,5:1 y componentes ≥3:1);
- sin desplazamiento horizontal a 320 px, que equivale al zoom al 400 %;
- el foco, que siempre se ve y que no tapan las barras fijas;
- el recorrido solo con teclado.

Esta pasada mira lo que no ve una prueba: que lo que se oye tiene sentido.

**Cuánto lleva.** Unos 10 minutos por lector. No hace falta hacerlos todos el mismo día.

**Lo que cuenta** es lo que se anuncia, no las palabras exactas: cada lector, y cada versión, lo dice a su manera.

## 1. Antes de empezar

- **Dónde:** la app de producción, https://ga-web.gameagenda.workers.dev. En el PC, en una ventana privada, para que Mi lista empiece vacía. En el móvil, con la lista que tengas; si ya está Celeste, usa otro juego, como Terraria.
- **Espera a que cargue el catálogo** la primera vez: unos segundos, hasta que al teclear salgan resultados.
- **Los gestos de GameAgenda no estorban:** con TalkBack o VoiceOver encendidos, deslizar lo recoge el lector, no la página. Cada gesto tiene su botón, y es lo que se usa aquí.

| Lector | Dónde | Cómo se enciende |
|---|---|---|
| NVDA | PC, con Chrome o Edge | `Ctrl+Alt+N` (si no está: `winget install --id NVAccess.NVDA -e`) |
| Narrador | PC, con Edge | `Win+Ctrl+Intro` |
| TalkBack | Android, con Chrome | Ajustes › Accesibilidad › TalkBack. Mejor deja antes el acceso directo de las dos teclas de volumen |
| VoiceOver | iPhone, con Safari (o la app de la pantalla de inicio) | Ajustes › Accesibilidad › VoiceOver. Mejor deja antes el triple clic en el botón lateral |

## 2. NVDA

Es la pasada del apartado 6 de `guia-dispositivo-m1.md` (CA1.10), tal cual, pero sobre la app de producción. Una sola pasada cierra CA1.10 y la parte de NVDA de CA3.5.

## 3. Narrador (Windows)

La tecla de Narrador es `Bloq Mayús` o `Insert`. `Ctrl` lo calla. Hazlo solo con el teclado.

| # | Teclas | Qué debe anunciar |
|---|---|---|
| 1 | `Ctrl+K` | «Apunta un juego», cuadro combinado, editable |
| 2 | Teclea `celeste` | Al moverte con `↓` y `↑`, cada opción: nombre y año (p. ej., «Celeste, 2018») |
| 3 | `Intro` | «Apuntado en Quiero jugar: Celeste». La paleta se cierra |
| 4 | `Tab` hasta el botón de estado de Celeste | «Quiero jugar: cambiar estado de Celeste», botón de menú |
| 5 | `Intro` y `↓` | Las opciones de estado como elementos de menú de radio, con «Quiero jugar» marcado |
| 6 | `↓` hasta «Jugando» e `Intro` | «Celeste pasa a Jugando» |
| 7 | `Ctrl+Z` | «Hemos deshecho el último cambio.» Celeste vuelve a Quiero jugar |

**Pasa si** se oye todo lo de la tabla, el foco se ve siempre y nunca se pierde (con `Bloq Mayús+Tab`, Narrador dice dónde está).

## 4. TalkBack (Android)

Gestos de TalkBack: **deslizar a la derecha o a la izquierda** va al elemento siguiente o al anterior; **doble toque**, activarlo; **tocar** algo, que lo lea.

| # | Qué haces | Qué debe anunciar |
|---|---|---|
| 1 | Toca la barra de abajo «Apunta un juego…» y haz doble toque | «Apunta un juego», cuadro de edición. Se abre la hoja y sale el teclado |
| 2 | Teclea `celeste` | Al dejar de teclear, TalkBack puede leer los resultados. Desliza a la derecha hasta la primera opción: «Celeste, 2018» |
| 3 | Doble toque en la opción | «Apuntado en Quiero jugar: Celeste». La hoja se cierra |
| 4 | Desliza hasta la fila de Celeste y su botón de estado | El título, «Celeste, enlace», y luego «Quiero jugar: cambiar estado de Celeste», botón |
| 5 | Doble toque en el botón de estado | Se abre el menú; deslizando, cada estado, con «Quiero jugar» marcado |
| 6 | Desliza hasta «Jugando» y doble toque | «Celeste pasa a Jugando» |
| 7 | Deshacer: el botón «Deshacer» del aviso (dura 8 s y se para con el foco), o «Más opciones» › «Deshacer último cambio» | «Hemos deshecho el último cambio.» |

**Pasa si** se oye todo lo de la tabla y nada se activa por error al deslizar.

## 5. VoiceOver (iPhone)

Gestos de VoiceOver: los mismos que en TalkBack. Además, el **rotor** (girar dos dedos) cambia lo que recorre el deslizamiento: encabezados, enlaces…

| # | Qué haces | Qué debe anunciar |
|---|---|---|
| 1 | Toca la barra «Apunta un juego…» y haz doble toque | «Apunta un juego», campo de texto. Sale el teclado |
| 2 | Teclea `celeste` y desliza a la derecha hasta la primera opción | «Celeste, 2018» |
| 3 | Doble toque | «Apuntado en Quiero jugar: Celeste» |
| 4 | Desliza hasta el botón de estado de Celeste | «Quiero jugar: cambiar estado de Celeste», botón |
| 5 | Doble toque y desliza por el menú | Cada estado, con «Quiero jugar» seleccionado |
| 6 | Doble toque en «Jugando» | «Celeste pasa a Jugando» |
| 7 | «Deshacer» del aviso, o «Más opciones» › «Deshacer último cambio» | «Hemos deshecho el último cambio.» |

Hazlo también desde la app de la pantalla de inicio, si la tienes instalada: es como la usarás.

## 6. Resultados

Rellena una fila por lector. Pon la fecha como DD-MM-AAAA.

| Lector y versión | Navegador y versión | Dispositivo | Fecha | ¿Pasa? | Pasos que fallan |
|---|---|---|---|---|---|
| NVDA … | Chrome … | PC | | | |
| Narrador (Windows 11 …) | Edge … | PC | | | |
| TalkBack … | Chrome … | Android … | | | |
| VoiceOver (iOS …) | Safari | iPhone … | | | |

**Si algo falla:**
- apunta el número de paso y lo que se oyó (en NVDA, el visor de voz lo deja por escrito);
- di si el foco se perdió y dónde acabó.

**Dónde guardarla:** pega la tabla en el chat. El asistente la guardará en `docs/medidas/lectores-m3-AAAAMMDD.md`, propondrá el arreglo de lo que falle y, con las cuatro filas en verde, dará CA3.5 por cumplido.
