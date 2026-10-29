## T1 · UX e interacción orientada a la velocidad

> **Objetivo del track.** Que *apuntar un juego que quiero jugar* cueste menos de 3 segundos desde cualquier pantalla (`Ctrl + K` → 3–5 letras → `Intro`) y que todo lo demás (cambiar estado, revisar la lista, explorar Steam) responda al instante.
>
> **Convenciones.**
> - Lo marcado como **[Supuesto]** depende de los tracks paralelos (API de Steam, legal/ToS, arquitectura). El diseño no depende de la tecnología salvo donde se indica.
> - Las teclas se nombran como en el teclado español: `Intro`, `Mayús`, `Supr`, `Retroceso`, `Esc`, `Inicio`, `Fin`, `Av Pág`, `Re Pág`. En macOS, `Ctrl` → `⌘` y `Alt` → `⌥`.
> - Títulos, fechas y cifras de los ejemplos son ilustrativos; «(ej.)» marca los títulos inventados.

### 1. Principios y objetivos medibles

**Principios**
1. **Capturar primero.** «Apuntar» está siempre a un atajo o a un toque. No hay registro previo, pantallas intermedias ni formularios en el caso normal.
2. **Local primero.** Cada acción se aplica en el dispositivo en el mismo fotograma y se sincroniza después. La interfaz nunca espera a la red.
3. **Deshacer en vez de confirmar.** No hay diálogos «¿Seguro?». Todo se puede deshacer con `Deshacer` o `Ctrl + Z`.
4. **Predecible.** `Intro` hace siempre lo que indica la pista visible y los resultados no cambian bajo el cursor.
5. **Teclado completo en escritorio, pulgar en móvil.** Cada acción tiene un atajo y también un botón visible.
6. **Mínimo.** Una acción principal por pantalla. La portada es el único elemento visual protagonista.
7. **Nunca solo color.** Cada estado se muestra con color, icono y texto.

**Presupuestos (criterios de aceptación del prototipo)**

| Métrica | Objetivo |
|---|---|
| `Ctrl + K` → paleta abierta con el foco en el campo | < 50 ms |
| Resultados por pulsación (índice local) | < 50 ms (p95) |
| Resultados remotos (juegos poco populares del catálogo) | < 300 ms (p95), sin bloquear los locales |
| Respuesta visual de cualquier acción (añadir, estado, marca, reordenar) | < 100 ms; INP p75 ≤ 200 ms |
| Arranque en caliente (app instalada o en caché) → Mi lista usable | < 1 s |
| Primera visita en 4G con móvil de gama media | LCP ≤ 2,5 s · CLS ≤ 0,1 |
| Tiempo de captura (abrir paleta → juego añadido) | p50 ≤ 3 s · p90 ≤ 5 s |
| Acierto a la primera (el juego añadido era el primer resultado) | ≥ 80 % |
| Diálogos de confirmación en los flujos normales | 0 |

Se miden con telemetría local y anónima o en pruebas con usuarios **[Supuesto: política de privacidad del track legal]**.

Recorrido de referencia: 0 s `Ctrl + K` · 0,05 s paleta lista · 0,3–1,5 s escribir `hade` (resultados en cada tecla) · ~2 s `Intro` · aviso «Añadido» en el mismo fotograma.

### 2. Modelo de interacción: un estado y varias marcas

Lo excluyente va separado de lo que no lo es. Así no hay combinaciones absurdas y cada cambio cuesta un solo toque.

**Estado (exclusivo: siempre hay uno)**

| Estado | Icono | Significado | Acción rápida «siguiente» |
|---|---|---|---|
| Quiero jugar (por defecto al apuntar) | marcador | Está en la agenda y aún no lo he empezado | `Empezar` → Jugando |
| Jugando | play | En curso | `Completar` → Completado |
| En pausa | pausa | Empezado y aparcado | `Reanudar` → Jugando |
| Completado | círculo con check | Terminado | `Platinar` (activa la marca Platinado) |
| Abandonado | círculo tachado | No lo voy a terminar (se conserva el historial) | `Retomar` → Jugando |

**Marcas (independientes, funcionan como interruptores)**
- **Comprado** (icono de bolsa): lo tengo. «Quiero jugar» sin Comprado equivale a una *wishlist*, así que no hace falta un estado aparte.
- **Platinado / 100 %** (icono de trofeo): todos los logros o trofeos. **Implica Completado.** Si el juego no estaba completado, pasa a Completado y el aviso lo explica: *Platinado. También lo hemos marcado como Completado · Deshacer*.

**Campos de apoyo**
- Prioridad (orden manual).
- Nota libre.
- Plataforma: Steam por defecto; PlayStation, Xbox, Switch u Otra en los juegos añadidos a mano.
- Fechas automáticas de alta, inicio y fin, editables en la ficha.

**Reglas**
- Los juegos nuevos entran **al final** de Quiero jugar, como en una libreta. Se puede cambiar en *Ajustes › Captura* y existe la acción «Añadir al principio».
- La primera vez que pasa a Jugando se guarda la fecha de inicio; al pasar a Completado, la fecha de fin.
- «Quitar de mi lista» borra la entrada (con Deshacer). «Abandonado» la conserva.
- **Colapso diferido.** Si una acción saca un juego de la vista filtrada, la fila no desaparece de golpe. Queda atenuada unos 2 s con *Movido a Completado · Deshacer* (o hasta que el puntero sale) y después se cierra. Así nada se mueve bajo el cursor.

### 3. Flujos de usuario con recuento de pasos

**Resumen**

| Flujo | Escritorio · teclado | Escritorio · ratón | Móvil | Objetivo |
|---|---|---|---|---|
| (a) Apuntar desde el catálogo de Steam | `Ctrl+K` + 3–5 letras + `Intro` = 5–7 pulsaciones | 2 clics + letras | 2 toques + letras | ≤ 3 s |
| (a') Apuntar pegando un enlace de Steam | `Ctrl+K`, `Ctrl+V`, `Intro` = 3 | 2 clics + pegar | 2 toques + pegar | ≤ 2 s |
| (b) Avanzar estado (p. ej. Empezar) | 1 tecla con la fila enfocada | 1 clic | 1 deslizamiento | < 1 s |
| (b) Cualquier otro estado | 1 tecla (`1`–`5`) | 2 clics | 2 toques | < 2 s |
| (b) Marca Comprado / Platinado | 1 tecla (`C` / `P`) | 1 clic | deslizar + 1 toque (1 toque en la ficha) | < 1 s |
| (c) Filtrar por estado | 1 clic o paleta | 1 clic | 1 toque | — |
| (c) Ordenar | 2 clics | 2 clics | 2 toques | — |
| (c) Cambiar prioridad | `Alt+↑/↓` (1 combinación) | 1 arrastre | 1 arrastre o 2 toques | — |
| (d) Explorar el catálogo y añadir | `G` `C` + filtros + `A` | 1 clic + filtros + 1 clic | 1 toque + filtros + 1 toque | — |
| (e) Abrir ficha | `Intro` (lista) / `Mayús+Intro` (paleta) | 1 clic | 1 toque | < 300 ms percibidos |
| (f) Añadir a mano | `Ctrl+K` + título + `Intro` + `Intro` | 3 clics + título | 3 toques + título | ≤ 5 s |
| (g) Importar de Steam | ~5 pasos + inicio de sesión en Steam | igual | igual | una sola vez |
| (h) Ver próximos lanzamientos | `G` `P` | 1 clic | 1 toque | — |

#### (a) Capturar: buscar en todo Steam y añadir a Quiero jugar

*Escritorio con teclado (6 pulsaciones típicas)*
1. `Ctrl + K` (o `/` fuera de un campo de texto) desde cualquier pantalla. Se abre la paleta con el foco en el campo. Si está vacía, muestra «Recientes» y «Acciones» (W2b).
2. Escribir `hade`. Hay resultados en cada pulsación y el primero queda resaltado con la pista «Intro: Añadir».
3. `Intro`. El juego se añade a Quiero jugar, la paleta se cierra y el foco vuelve exactamente a donde estaba. Aparece el aviso *Añadido a Quiero jugar: Hades II · Deshacer*.

*Variantes dentro de la paleta*
- `Ctrl + Intro`: **añadir y seguir apuntando**. El campo se vacía; sirve para apuntar en ráfaga durante un directo de anuncios. Sobre la fila «Añadir manualmente», crea la entrada con los valores por defecto sin abrir el diálogo.
- `Mayús + Intro`: abrir la ficha sin añadir.
- `Alt + Intro`: menú de acciones del resultado: añadir como Jugando o Completado, añadir marcado como Comprado, añadir al principio, abrir en Steam. Dentro del menú, `1`–`5` eligen el estado.
- Pegar una URL de la tienda (`store.steampowered.com/app/<appid>/…`) o un appid da un único resultado exacto; basta con `Intro`.
- Soltar sobre la ventana un enlace de Steam arrastrado también lo añade, con Deshacer. Pegar es la alternativa sin arrastre.

*Escritorio con ratón*
- Clic en «Apunta un juego…» de la cabecera, escribir y clic en el resultado: 2 clics.
- Un clic en la fila añade, igual que `Intro`. El botón `(i)`, que aparece al pasar el ratón, abre la ficha.

*Móvil (2 toques + letras)*
1. Toque en la barra «Apunta un juego…», fija sobre la barra de pestañas. Se abre la hoja de captura con el teclado ya activo (M3). Para que iOS muestre el teclado, `focus()` se llama de forma síncrona dentro del gestor del toque.
2. Escribir 3–5 letras.
3. Toque en la fila o en `+`. El juego se añade, la hoja se cierra y aparece el aviso. Con «Seguir apuntando» activado (la app lo recuerda), la hoja se queda abierta. El botón `(i)` abre la ficha.

*Accesos desde fuera de la app* **[Supuesto: app web instalable/PWA; lo decide el track de arquitectura]**
- Acceso directo «Apuntar juego» en el icono de la app: Android y escritorio Chromium; en Windows aparece en la lista de saltos de la barra de tareas. Abre la paleta directamente (`?apuntar`).
- «Compartir → GameAgenda» desde la app o la web de Steam (Web Share Target): añade el juego del enlace sin escribir, en 2 toques. Funciona en Android con Chrome o Edge; no en iOS; en escritorio depende del navegador.
- Si el producto se empaqueta como app de escritorio (p. ej. Tauri), un atajo global del sistema podría abrir la captura aunque la app esté en segundo plano.

*Reglas de búsqueda para acertar a la primera (son parte de la UX, no solo del backend)*
- **Coincidencia flexible.**
  - Por prefijo de palabra en cualquier posición: `witcher` → The Witcher 3.
  - Sin distinguir mayúsculas, tildes ni signos: `pokemon` → Pokémon; se ignoran ™, ®, `:` y `-`.
  - Números y romanos equivalen (`final fantasy 7` ↔ VII), igual que `&` ↔ `and`/`y`. A partir de 5 letras se tolera una errata.
- **Alias y siglas.** `gta 5`, `bg3`, `rdr2`, `ff7`, `re4`, `kcd2`, `p5r`… Se mantiene una tabla de alias y las siglas se generan a partir de las iniciales.
- **Orden.** Coincidencia exacta > prefijo del título > prefijo de palabra > alias o siglas > coincidencia aproximada. Los empates se deciden por popularidad **[Supuesto: hay una señal de popularidad, p. ej. el número de reseñas]** y después por fecha.
- **Qué se muestra.** Por defecto solo **juegos** (sin DLC, bandas sonoras, demos, herramientas ni vídeos) y sin contenido para adultos; ambas cosas se cambian en Ajustes.
- **Sin duplicados.** Hay una sola lista ordenada por relevancia, sin grupos. Los juegos que ya están en mi lista aparecen marcados («En tu lista: Completado»); sobre ellos, `Intro` abre la ficha.
- **Alta manual siempre a mano.** La última fila es siempre «Añadir «…» manualmente». Si no hay resultados, pasa a ser la primera y queda resaltada.
- **La selección no salta.** Los resultados remotos se insertan debajo de los ya mostrados. Solo una coincidencia exacta remota puede ocupar el primer puesto, y solo mientras el usuario sigue escribiendo.
- **`Intro` nunca se pierde.** Si se pulsa antes de que lleguen los resultados del texto final, la app espera hasta 500 ms:
  - si llega una coincidencia exacta o un único prefijo claro, lo añade;
  - si no, muestra los resultados y no añade nada.

**[Supuesto de arquitectura]** El objetivo de 50 ms por tecla exige un índice local en el cliente, buscado en un *Web Worker*. Como mínimo debe tener nombre y appid de los juegos más populares; el resto se busca en remoto. Si se descarta el índice local, el objetivo pasa a ser «local para Mi lista y remoto en < 300 ms», y la regla de `Intro` anticipado pesa más.

#### (b) Cambiar estado y marcas en 1 toque

*Escritorio*
- Al pasar el ratón o enfocar una fila aparecen sus acciones rápidas: `[Siguiente estado]` (Empezar / Completar / Reanudar / Retomar), `[Comprado]`, `[Platinado]` y `[…]`. **1 clic.** Nunca dependen solo del *hover*: aparecen también con el foco del teclado y están en el menú `…`.
- Con la fila enfocada: `1`–`5` fijan el estado, `C` alterna Comprado y `P` alterna Platinado. **1 tecla.**
- Clic en el chip de estado → menú con los 5 estados, con el actual marcado. **2 clics.**
- Desde cualquier pantalla, sin ir a la lista: `Ctrl + K`, `hade`, `Alt + Intro`, `4` (Completado).

*Móvil*
- Deslizar a la derecha = **avanzar estado**. El fondo muestra qué va a pasar («Empezar», «Completar»…). **1 gesto.**
- Deslizar a la izquierda revela `[Comprado] [Platinado] [Más]`: deslizar + 1 toque. Un deslizamiento largo quita el juego (con Deshacer).
- Toque en el icono de estado de la fila → hoja con los 5 estados: 2 toques. En la ficha, todo cuesta 1 toque.
- Mantener pulsada la fila abre el menú contextual completo: estados, marcas, mover y quitar.

*En todos los casos*
- Respuesta optimista en < 100 ms y aviso con Deshacer.
- Anuncio para lector de pantalla (p. ej. «Hades II: Jugando»).
- Los efectos automáticos (fechas; Platinado ⇒ Completado) se deshacen en el mismo paso.

*Selección múltiple*
- `X` o `Mayús + clic`; en móvil, mantener pulsado → «Seleccionar».
- Barra de acciones: «Cambiar estado», «Marcar comprado», «Quitar».
- Un único aviso para todo el lote: *3 juegos movidos a Completado · Deshacer*.

#### (c) Revisar mi lista: filtrar, ordenar y priorizar

- **Vista por defecto «Pendientes».** Muestra Jugando arriba («Jugando ahora»), después Quiero jugar por prioridad y En pausa plegado al final. Chips con contador: Pendientes · Quiero jugar · Jugando · En pausa · Completado · Abandonado · Todos.
- **Filtros de marca y texto.** Comprado · Sin comprar · Platinado; filtro de plataforma cuando haya juegos que no son de Steam. «Filtrar lista…» filtra en vivo y en local.
- **Orden.** Prioridad (manual, por defecto) · Fecha de alta (recientes primero) · Lanzamiento (próximos primero o más antiguos) · Nombre (A–Z). Las fechas aproximadas («T1 2027») van al final de su periodo y «Sin fecha», al final de todo.
- **Secciones.** Solo con orden por Prioridad y cuando hay varias categorías visibles. Con cualquier otro orden, la lista es plana.
- **Reordenar la prioridad.** Solo con orden por Prioridad y dentro de Quiero jugar:
  - Asa `::` para arrastrar, en escritorio y en móvil.
  - `Alt + ↑/↓` mueve una posición; `Alt + Mayús + ↑/↓` lleva al principio o al final.
  - Menú: «Mover al principio» / «Mover al final».
  - Se anuncia la nueva posición: «Hades II, posición 1 de 28».
  - Si se intenta arrastrar con otro orden: *Cambia a Orden: Prioridad para reordenar*.
- **Memoria.** El filtro y el orden se guardan en la URL (funcionan el botón atrás y los marcadores) y se recuerdan entre sesiones.

#### (d) Explorar todo el catálogo de Steam

- **Entrada:** `G` luego `C`, clic en «Catálogo» o la pestaña en móvil.
- **Contador en la cabecera:** «123.456 juegos · 2.310 con estos filtros», con formato es-ES. Se anuncia con retardo en una región `aria-live` educada.
- **Exploración rápida (1 clic):** Populares · Próximamente · Recién salidos · Steam Deck verificado.
- **Filtros**
  - Tipo: Juegos por defecto; opción de incluir DLC y demos.
  - Lanzamiento: ya disponibles, próximamente o rango de años.
  - Steam Deck: Verificado / Jugable.
  - Sistema: Windows / macOS / Linux.
  - Géneros o etiquetas y «Disponible en español» **[Supuesto: si GetItems o appdetails incluyen esos datos]**.
  - «Ocultar los que ya están en mi lista».
  - El contenido para adultos está oculto por defecto (se cambia en Ajustes).
- **Orden:** relevancia (con texto) o popularidad (sin texto) · lanzamiento (recientes, antiguos, próximos) · nombre (A–Z) · valoración **[Supuesto]**.
- **Vista:** Lista (por defecto, más densa) o Cuadrícula de portadas 2:3. Cada fila o tarjeta tiene un botón `+` (1 clic o toque); si el juego ya está en la lista, muestra su estado.
- **Scroll virtualizado**
  - Altura de fila fija; la barra de desplazamiento refleja el total real.
  - Filas *skeleton* para los rangos todavía no cargados.
  - El bloque siguiente se precarga al llegar al 70 % de lo cargado.
  - Botón «Ir arriba».
  - Al volver de la ficha se restauran la posición y el foco.
  - **[Supuesto: el backend permite pedir por rango (offset/limit); si solo hay cursor, se usa scroll infinito sin saltos con la barra.]**
- **Móvil:** los filtros van en una hoja inferior con el botón «Ver 2.310 resultados», cuyo recuento se actualiza con cada filtro (M5).

#### (e) Ficha de juego

- **Presentación.** En escritorio es un **panel lateral**: la lista sigue visible, `[<]`/`[>]` o `J`/`K` pasan al juego anterior o siguiente, y `Esc` cierra y devuelve el foco a la fila. En móvil es una pantalla completa con «atrás».
- **Datos del juego (W4, M6)**
  - Portada 2:3, título, desarrollador y editor.
  - Fecha de lanzamiento, o «Próximamente» con cuenta atrás.
  - Sistemas y compatibilidad con Steam Deck.
- **Controles propios:** estado (control segmentado), Comprado, Platinado / 100 %, prioridad (Subir/Bajar), nota con autoguardado y fechas.
- **Enlaces:** «Ver en Steam» (web) y «Abrir en la app de Steam» (`steam://store/<appid>`).
- **Contenido diferido:** descripción breve en español (`l=spanish`) y capturas, ambas en carga diferida.
- **Al final:** «Quitar de mi lista».
- Si el juego no está en la lista, el botón principal es «Añadir a Quiero jugar (Intro)».
- **Apertura instantánea.** Se pinta al momento con lo que ya se sabe (nombre, portada, estado) y la descripción llega después con *skeleton*. Los datos se precargan al pasar el ratón por la fila o al enfocarla.

#### (f) Añadir un juego a mano (no está en Steam)

1. En la paleta, elegir «Añadir «…» manualmente» (`Intro` si no hay resultados).
2. Se abre un diálogo mínimo (W7) con el **título ya relleno**, para no escribirlo dos veces, y el foco en «Añadir». Campos opcionales:
   - Plataforma: chips; recuerda la última usada.
   - Estado: Quiero jugar por defecto.
   - Comprado.
   - Lanzamiento: una fecha o «Sin fecha».
   - Nota.
3. `Intro` y queda añadido.

- Si existe un título parecido, se avisa sin bloquear: *Parecido en tu lista: …*.
- Los juegos añadidos a mano llevan un distintivo de plataforma. Si más adelante aparecen en Steam (p. ej. al publicarse su página), la ficha sugiere «Vincular con Steam».

#### (g) Opcional: importar la biblioteca y la lista de deseos de Steam

1. *Ajustes › Steam › Conectar con Steam* (inicio de sesión con Steam/OpenID), o pegar la URL del perfil. **[Supuesto: el track de API confirma que es viable y qué endpoints usar. Requiere el perfil y los «Detalles del juego» en público.]**
2. Vista previa (W8):
   - Lista de deseos (57) → Quiero jugar.
   - Biblioteca (342) → la app recuerda esos juegos como Comprado; si se apuntan más tarde, ya salen marcados.
   - Qué entra en la lista: ninguno (solo se marcan los que ya están), los no jugados (0 min) a «Por clasificar», o todos a «Por clasificar».
3. «Importar 175 juegos» lanza un trabajo en segundo plano con progreso no bloqueante. Mientras tanto se puede seguir usando la app.
4. Aviso final: *Importación lista: 57 a Quiero jugar, 118 a Por clasificar y 342 reconocidos como comprados · Deshacer importación*.
5. Bandeja «Por clasificar» (W8b):
   - Escritorio, una tecla por juego: `1` Quiero jugar, `2` Jugando, `4` Completado, `5` Abandonado, `S` saltar, `Supr` no añadir.
   - Móvil: deslizar a la derecha = Quiero jugar, a la izquierda = No añadir, con botones equivalentes.

Reimportar fusiona: nunca duplica ni cambia los estados que puso el usuario; solo añade la marca Comprado.

#### (h) Próximos lanzamientos de los juegos que quiero jugar

- Pestaña «Próximos» con insignia: número de lanzamientos en los próximos 30 días.
- **Grupos (W5):**
  - Ya disponibles: últimos 14 días, con «¡Ya disponible!» y la acción «Empezar».
  - Esta semana.
  - Por meses: «Noviembre de 2026».
  - Fecha aproximada: el texto tal como lo da Steam, p. ej. «Primer trimestre de 2027».
  - Sin fecha.
- **Fechas en español:** cuenta atrás relativa («pasado mañana», «dentro de 22 días») y fechas cortas («jue, 19 nov»).
- **Mismas acciones de fila que en Mi lista**, p. ej. marcar Comprado al reservar.
- **Calendario.** «Suscribirse al calendario» da un enlace .ics personal para Google Calendar u Outlook; encaja con la idea de *agenda* **[Supuesto: el backend puede servir un feed .ics con token]**.
- **Avisos de lanzamiento opcionales.** Se piden **en contexto**, nunca al abrir la app. Por ejemplo, al apuntar un juego que aún no ha salido: *Sale el 19 nov. ¿Te avisamos ese día? [Avisarme]*.
- **Cambios de fecha.** Si Steam cambia la fecha, aparece el distintivo «Fecha cambiada» con la anterior **[Supuesto: el job programado guarda el historial de fechas]**.

### 4. Inventario de pantallas

| ID | Pantalla / componente | Ruta propuesta | Escritorio | Móvil | Wireframe |
|---|---|---|---|---|---|
| P1 | **Mi lista** (inicio) | `/` (`?estado=…&orden=…`) | Lista con secciones y captura en la cabecera | Lista con barra de captura fija | W1, M1, M2 |
| P2 | **Paleta / captura global** | superposición (`?apuntar`) | Diálogo modal centrado | Hoja inferior con teclado | W2, W2b, M3 |
| P3 | **Catálogo de Steam** | `/catalogo` | Lista o cuadrícula virtualizada con filtros | Cuadrícula de 3 columnas y hoja de filtros | W3, W3b, M4, M5 |
| P4 | **Ficha** | `/juego/<appid>` · `/juego/m/<id>` (manual) | Panel lateral | Pantalla completa | W4, M6 |
| P5 | Próximos | `/proximos` | Lista agrupada por fecha | Igual, en una columna | W5 |
| P6 | Añadir a mano | diálogo | Diálogo pequeño | Hoja inferior | W7 |
| P7 | Importar de Steam y «Por clasificar» | `/importar` | Diálogo y bandeja | Pantalla y bandeja | W8, W8b |
| P8 | **Ajustes** | `/ajustes/<sección>` | Dos columnas | Lista de secciones | W6, M7 |
| P9 | Ayuda de atajos | superposición (`?`) | Diálogo | — | — |
| C1 | Avisos (toasts) con Deshacer | — | Abajo a la izquierda | Encima de las barras inferiores | W1 |
| C2 | Indicador de sincronización | — | Cabecera, a la derecha | Cabecera | W1, M1 |
| C3 | Menú contextual / hoja de acciones | — | Menú | Hoja inferior | — |

**Navegación**
- Escritorio: barra lateral mínima (Mi lista · Próximos · Catálogo · Ajustes) y cabecera con «Apunta un juego… Ctrl+K» visible en todas las pantallas.
- Móvil: 4 pestañas abajo y, encima, la barra de captura en Mi lista y Próximos. En Catálogo esa misma barra busca en el catálogo. En Ficha y Ajustes se oculta.

**Secciones de Ajustes**

| Sección | Contenido |
|---|---|
| Apariencia | Tema, densidad, portadas o ahorro de datos, vista del catálogo |
| Captura | Qué hace `Intro`, estado por defecto, dónde entran los nuevos, plataforma por defecto en los juegos manuales |
| Teclado, gestos y accesibilidad | Atajos de una tecla activados o no, reasignar atajos, gestos activados o no y qué hace cada lado, reducir movimiento, duración de los avisos |
| Contenido | Ocultar contenido para adultos, incluir DLC y demos, idioma de las descripciones con respaldo en inglés |
| Steam | Conectar, importar, reimportar |
| Notificaciones | Lanzamientos, calendario .ics |
| Datos y sincronización | Estado, cuenta opcional, exportar o importar JSON/CSV, borrar datos |
| Acerca de | Versión, atribución y aviso de no afiliación con Valve **[Supuesto: el texto lo fija el track legal]** |

### 5. Wireframes (baja fidelidad: jerarquía y posición, no estilo)

**Leyenda**
- `[img]` portada vertical 2:3 · `(+)` añadir · `(i)` abrir ficha · `::` asa de arrastre · `[...]` menú de acciones.
- `(o)` sincronización · `~~~` *skeleton* · `###` acción que se revela al deslizar.
- Estados: `(*)` Quiero jugar · `(>)` Jugando · `(||)` En pausa · `(v)` Completado · `(x)` Abandonado.
- Marcas: `[$]` Comprado · `[T]` Platinado / 100 %.

#### W1 · Escritorio · Mi lista (pantalla principal)
```text
+--------------------------------------------------------------------------------------------------+
| GameAgenda    [ (+) Apunta un juego...                              Ctrl+K ]        (o) Guardado |
+---------------+----------------------------------------------------------------------------------+
| > Mi lista    | Mi lista                                 Orden: [Prioridad v]  [Densidad v]  [?] |
|   Próximos  3 | [Pendientes 33] [Quiero jugar 28] [Jugando 2] [En pausa 3] [Completado 8] [Más v]|
|   Catálogo    | Marcas: [ ] Comprado  [ ] Sin comprar  [ ] Platinado          [Filtrar lista...] |
|   Ajustes     | -------------------------------------------------------------------------------- |
|               | JUGANDO AHORA (2)                                                                |
|               |      [img] Hades II                        (>) Jugando v        [$]              |
|               |            2025 · Supergiant Games · Deck: Verificado                            |
|               | QUIERO JUGAR (28) · arrastra o usa Alt+flechas para priorizar                    |
|               | 1 :: [img] Hollow Knight: Silksong         (*) Quiero jugar v                    |
|               |            2025 · Team Cherry     [(>) Empezar] [$ Comprado] [T Platinado] [...] |
|               | 2 :: [img] Nebula Drift (ejemplo)          (*) Quiero jugar v                    |
|               |            Sale el jue, 19 nov 2026 · dentro de 22 días                          |
|               | 3 :: [img] Baldur's Gate 3                 (*) Quiero jugar v   [$]              |
|               |            2023 · Larian Studios                                                 |
|               | EN PAUSA (3)                                                           [Mostrar] |
|               |                                                                                  |
| [?] Atajos    | +-------------------------------------------------------------+                  |
|               | | (>) Hades II pasa a Jugando        [Deshacer]  Ctrl+Z       |                  |
|               | +-------------------------------------------------------------+                  |
+---------------+----------------------------------------------------------------------------------+
```
- La fila 1 tiene el foco: sus acciones rápidas son visibles. Las marcas solo aparecen en la fila cuando están activas.
- El aviso no tapa la fila enfocada.

#### W2 · Escritorio · Paleta global (Ctrl+K) con resultados
```text
+--------------------------------------------------------------------------------------------------+
|              +----------------------------------------------------------------------+            |
|              | (+) hade|                                                        Esc |            |
|              |----------------------------------------------------------------------|            |
|              | > [img] Hades II              2025 · Supergiant Games  Intro: Añadir |            |
|              |   [img] Hades                 2020 · En tu lista: (v) Completado     |            |
|              |   [img] Hadeon Tactics (ej.)  Próximamente · 2027                    |            |
|              |   [img] Hadal Run (ej.)       2024 · Estudio Indie (ej.)             |            |
|              |----------------------------------------------------------------------|            |
|              |   (+) Añadir «hade» manualmente                                      |            |
|              |   Ver los 14 resultados en el Catálogo                               |            |
|              |----------------------------------------------------------------------|            |
|              | Intro añadir · Ctrl+Intro añadir y seguir · Mayús+Intro ficha        |            |
|              | Alt+Intro más acciones · Flechas moverse · Esc cerrar                |            |
|              +----------------------------------------------------------------------+            |
| (la pantalla actual sigue visible y atenuada detrás; nada se recarga)                            |
+--------------------------------------------------------------------------------------------------+
```

#### W2b · Escritorio · Paleta vacía (estado inicial)
```text
+--------------------------------------------------------------------------------------------------+
|              +----------------------------------------------------------------------+            |
|              | (+) |                                                            Esc |            |
|              |     Apunta un juego, pega un enlace de Steam o escribe una acción    |            |
|              |----------------------------------------------------------------------|            |
|              | RECIENTES                                                            |            |
|              |   [img] Hollow Knight: Silksong                     (*) Quiero jugar |            |
|              |   [img] Hades II                                         (>) Jugando |            |
|              | ACCIONES                                                             |            |
|              |   Ir a Próximos                                                  G P |            |
|              |   Importar desde Steam                                               |            |
|              |   Cambiar a tema claro                                               |            |
|              |   Ver atajos de teclado                                            ? |            |
|              +----------------------------------------------------------------------+            |
+--------------------------------------------------------------------------------------------------+
```

#### W3 · Escritorio · Catálogo (vista lista, virtualizada)
```text
+--------------------------------------------------------------------------------------------------+
| GameAgenda    [ (+) Apunta un juego...                              Ctrl+K ]        (o) Guardado |
+---------------+----------------------------------------------------------------------------------+
|   Mi lista    | Catálogo de Steam                       123.456 juegos · 2.310 con estos filtros |
|   Próximos  3 | [ Buscar en el catálogo...   / ]   Orden: [Popularidad v]  Vista: [Lista|Cuadr.] |
| > Catálogo    | Explorar: [Populares] [Próximamente] [Recién salidos] [Deck verificado]          |
|   Ajustes     | [Tipo: Juegos v] [Lanzamiento v] [Steam Deck v] [Sistema v] [Géneros v] [Limpiar]|
|               | [ ] Ocultar los que ya están en mi lista                                         |
|               | -------------------------------------------------------------------------------- |
|               | [img] Baldur's Gate 3        2023 · Larian Studios · Deck: Verificado      (+)   |
|               | [img] Elden Ring             2022 · FromSoftware                  (v) Completado |
|               | [img] Cyberpunk 2077         2020 · CD PROJEKT RED                         (+)   |
|               | [img] ~~~~~~~~~~~~~~~~~~     ~~~~ · ~~~~~~~~~~~~~                          ~~~   |
|               | [img] ~~~~~~~~~~~~~~~~~~     ~~~~ · ~~~~~~~~~~~~~                          ~~~   |
|               |                                                                    [Ir arriba ^] |
+---------------+----------------------------------------------------------------------------------+
```

#### W3b · Escritorio · Catálogo (cuadrícula de portadas, solo la zona de contenido)
```text
+--------------------------------------------------------------------------------+
| +--------+  +--------+  +--------+  +--------+  +--------+  +--------+         |
| |        |  |        |  |        |  |        |  |        |  |  ~~~~  |         |
| |  2:3   |  |  2:3   |  |  2:3   |  |  2:3   |  |  2:3   |  |  ~~~~  |         |
| |     (+)|  |     (v)|  |     (+)|  |     (>)|  |     (*)|  |  ~~~~  |         |
| +--------+  +--------+  +--------+  +--------+  +--------+  +--------+         |
| Baldur's    Elden Ring  Cyberpunk   Hades II    Silksong    ~~~~~~~~           |
| Gate 3      2022        2077        2025        2025        ~~~~               |
| 2023                                                                           |
+--------------------------------------------------------------------------------+
```

#### W4 · Escritorio · Ficha como panel lateral (la lista sigue visible)
```text
+--------------------------------------------------------------------------------------------------+
| GameAgenda    [ (+) Apunta un juego...                              Ctrl+K ]        (o) Guardado |
+---------------+--------------------------------------+-------------------------------------------+
| > Mi lista    | Mi lista               [Prioridad v] | Ficha                   [<] [>]   [x] Esc |
|   Próximos  3 | [Pendientes] [Quiero] [Jugando]...   | +----------+  Hollow Knight: Silksong     |
|   Catálogo    | ------------------------------------ | |          |  Team Cherry                 |
|   Ajustes     | 1 :: [img] Hollow Knight: Sil...   < | |   2:3    |  Lanzado el 4 sept 2025      |
|               | 2 :: [img] Nebula Drift (ej.)        | |          |  Windows · macOS · Linux     |
|               | 3 :: [img] Baldur's Gate 3           | +----------+  Steam Deck: Verificado      |
|               | 4 :: [img] ...                       | Estado                                    |
|               |                                      | [(*) Quiero jugar] [(>) Jugando]          |
|               |                                      | [(||) En pausa] [(v) Completado]          |
|               |                                      | [(x) Abandonado]                          |
|               |                                      | [$ Comprado]  [T Platinado / 100 %]       |
|               |                                      | Prioridad: 1 de 28        [Subir] [Bajar] |
|               |                                      | Nota [ Jugar después de Hollow Knight ]   |
|               |                                      | Añadido 12 oct 2026 · Empezado - · Fin -  |
|               |                                      | [Ver en Steam] [Abrir en la app Steam]    |
|               |                                      | Descripción                               |
|               |                                      | ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~    |
|               |                                      | ~~~~~~~~~~~~~~~~~~~ (carga diferida)      |
|               |                                      | Capturas  [    ] [    ] [    ]            |
|               |                                      | [Quitar de mi lista]                      |
+---------------+--------------------------------------+-------------------------------------------+
```

#### W5 · Escritorio · Próximos lanzamientos
```text
+--------------------------------------------------------------------------------------------------+
| GameAgenda    [ (+) Apunta un juego...                              Ctrl+K ]        (o) Guardado |
+---------------+----------------------------------------------------------------------------------+
|   Mi lista    | Próximos lanzamientos de tu lista                    [Suscribirse al calendario] |
| > Próximos  3 | [Pendientes v]   [x] Incluir fechas aproximadas   [ ] Solo sin comprar           |
|   Catálogo    | -------------------------------------------------------------------------------- |
|   Ajustes     | YA DISPONIBLES (últimos 14 días)                                                 |
|               | lun, 26 oct   [img] Pixel Harbor (ej.)    ¡Ya disponible!    [(>) Empezar] [$]   |
|               | ESTA SEMANA                                                                      |
|               | vie, 30 oct   [img] Ember Protocol (ej.)  pasado mañana      (*) Quiero jugar    |
|               | NOVIEMBRE DE 2026                                                                |
|               | jue, 19 nov   [img] Nebula Drift (ej.)    dentro de 22 días  (*) Quiero jugar    |
|               | 2027 · FECHA APROXIMADA                                                          |
|               | T1 2027       [img] Ironwood Saga (ej.)   «Primer trimestre de 2027» (Steam)     |
|               | SIN FECHA                                                                        |
|               | Próximamente  [img] Hollow Depths (ej.)   (*) Quiero jugar                       |
+---------------+----------------------------------------------------------------------------------+
```

#### W6 · Escritorio · Ajustes
```text
+--------------------------------------------------------------------------------------------------+
| GameAgenda    [ (+) Apunta un juego...                              Ctrl+K ]        (o) Guardado |
+---------------+----------------------------------------------------------------------------------+
|   Mi lista    | Ajustes                                                                          |
|   Próximos  3 | > Apariencia          Tema       (o) Sistema   ( ) Claro   ( ) Oscuro            |
|   Catálogo    |   Captura             Densidad   (o) Cómoda    ( ) Compacta                      |
| > Ajustes     |   Teclado y acceso.   Portadas   [x] Mostrar   [ ] Ahorro de datos               |
|               |   Contenido           Catálogo   Vista por defecto [Lista v]                     |
|               |   Steam                                                                          |
|               |   Notificaciones                                                                 |
|               |   Datos y sincroniz.                                                             |
|               |   Acerca de                                                                      |
+---------------+----------------------------------------------------------------------------------+
```

#### W7 · Escritorio · Añadir a mano (diálogo pequeño con el título ya relleno)
```text
+--------------------------------------------------------------------+
| Añadir juego manualmente                                       [x] |
|                                                                    |
| Título *     [ Grand Theft Auto VI                       ]         |
| Plataforma   [PC] [PlayStation] [Xbox] [Switch] [Otra]             |
| Estado       [(*) Quiero jugar v]        [ ] Comprado              |
| Lanzamiento  [ dd/mm/aaaa ]  o  [x] Sin fecha   (opcional)         |
| Nota         [                               ] (opcional)          |
|                                                                    |
| (!) Parecido en tu lista: «Grand Theft Auto V»   [Ver]             |
|                                        [Cancelar]  [Añadir  Intro] |
+--------------------------------------------------------------------+
```

#### W8 · Importar desde Steam (vista previa antes de importar)
```text
+--------------------------------------------------------------------+
| Importar desde Steam                                           [x] |
| Perfil: jugador123 (ejemplo) · conectado con Steam       [Cambiar] |
|                                                                    |
| [x] Lista de deseos (57)  -> añadir a Quiero jugar                 |
| [x] Biblioteca (342)      -> se recuerda como Comprado             |
|     ¿Cuáles entran en tu lista?                                    |
|     ( ) Ninguno (solo marcar los que ya están)                     |
|     (o) Los no jugados (0 min) a «Por clasificar» (118)            |
|     ( ) Todos a «Por clasificar»                                   |
|                                                                    |
| No se cambia ningún estado que ya hayas puesto.                    |
|                                  [Cancelar]  [Importar 175 juegos] |
+--------------------------------------------------------------------+
```

#### W8b · Bandeja «Por clasificar» (una tecla o un toque por juego)
```text
+--------------------------------------------------------------------+
| Por clasificar · quedan 118                             [Terminar] |
| +--------+  Portal 2                                               |
| |  2:3   |  2011 · Valve                                           |
| |        |  Comprado · 0 min jugados                               |
| +--------+                                                         |
| [1 Quiero jugar] [2 Jugando] [4 Completado] [5 Abandonado]         |
| [S Saltar]  [Supr No añadir]                        Ctrl+Z deshace |
+--------------------------------------------------------------------+
```

#### M1 · Móvil · Mi lista (captura siempre visible encima de las pestañas)
```text
+--------------------------------------+
| Mi lista                (o)  [Orden] |
| [Pendientes 33] [Quiero 28] [Jug>    |
+--------------------------------------+
| JUGANDO AHORA                        |
| [img] Hades II                (>)    |
|       Jugando · Comprado             |
| ------------------------------------ |
| QUIERO JUGAR                         |
| [img] Hollow Knight: Silksong (*)    |
|  1    Quiero jugar                   |
| [img] Nebula Drift (ej.)      (*)    |
|  2    Sale dentro de 22 días         |
| [img] Baldur's Gate 3         (*)    |
|  3    Quiero jugar · Comprado        |
+--------------------------------------+
| [ (+) Apunta un juego...           ] |
+--------------------------------------+
| Mi lista  Próximos  Catálogo  Ajustes|
+--------------------------------------+
```
- Los chips se desplazan en horizontal. El icono de estado de cada fila es un botón de 44 × 44 px que abre la hoja de estados.

#### M2 · Móvil · Gestos de deslizamiento en una fila
```text
Deslizar a la derecha = avanzar estado (Quiero jugar -> Jugando)
+--------------------------------------+
| ##### (>) Empezar ##|[img] Hollow Kn |
+--------------------------------------+

Deslizar a la izquierda = acciones (deslizamiento largo = Quitar)
+--------------------------------------+
| ..Silksong|[$ Comprado][T Plat.][...]|
+--------------------------------------+
```

#### M3 · Móvil · Hoja de captura (se abre con el teclado ya activo)
```text
+--------------------------------------+
| [<]  [ hade|                   (x) ] |
+--------------------------------------+
| [img] Hades II              (+)  (i) |
|       2025 · Supergiant Games        |
| [img] Hades                 (v)  (i) |
|       2020 · En tu lista: Completado |
| [img] Hadeon Tactics (ej.)  (+)  (i) |
|       Próximamente · 2027            |
| (+) Añadir «hade» manualmente        |
| [ ] Seguir apuntando                 |
+--------------------------------------+
| q  w  e  r  t  y  u  i  o  p         |
|  a  s  d  f  g  h  j  k  l  ñ        |
|    z  x  c  v  b  n  m    [Ir]       |
+--------------------------------------+
```
- Tocar la fila o `(+)` añade; `(i)` abre la ficha; la tecla «Ir» equivale a `Intro`.

#### M4 · Móvil · Catálogo (cuadrícula de 3 columnas)
```text
+--------------------------------------+
| Catálogo              [Lista|Cuadr.] |
| 123.456 juegos         [Filtros (2)] |
| [Populares] [Próximamente] [Dec>     |
+--------------------------------------+
| +-------+  +-------+  +-------+      |
| |  2:3  |  |  2:3  |  |  2:3  |      |
| |    (+)|  |    (v)|  |    (+)|      |
| +-------+  +-------+  +-------+      |
| Baldur's   Elden      Cyberpunk      |
| Gate 3     Ring       2077           |
| +-------+  +-------+  +-------+      |
| |  ~~~  |  |  ~~~  |  |  ~~~  |      |
+--------------------------------------+
| [ Buscar en el catálogo...         ] |
+--------------------------------------+
| Mi lista  Próximos  Catálogo  Ajustes|
+--------------------------------------+
```

#### M5 · Móvil · Hoja de filtros del catálogo
```text
+--------------------------------------+
| Filtros                [Borrar todo] |
| Tipo         [Juegos v]              |
| Lanzamiento  [Cualquiera v]          |
| Steam Deck   [Verificado] [Jugable]  |
| Sistema      [Win] [macOS] [Linux]   |
| [ ] Ocultar los de mi lista          |
|                                      |
| [       Ver 2.310 resultados       ] |
+--------------------------------------+
```

#### M6 · Móvil · Ficha (pantalla completa)
```text
+--------------------------------------+
| [<] Mi lista                   [...] |
| +--------+  Hollow Knight: Silksong  |
| |  2:3   |  Team Cherry              |
| |        |  4 sept 2025              |
| +--------+  Deck: Verificado         |
| Estado                               |
| [(*) Quiero] [(>) Jugando]           |
| [(||) Pausa] [(v) Completado]        |
| [(x) Abandonado]                     |
| [$ Comprado]  [T Platinado / 100 %]  |
| Prioridad 1 de 28    [Subir] [Bajar] |
| Nota [                             ] |
| [Ver en Steam]                       |
| Descripción                          |
| ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   |
| [Quitar de mi lista]                 |
+--------------------------------------+
```

#### M7 · Móvil · Ajustes
```text
+--------------------------------------+
| Ajustes                              |
| Apariencia                         > |
| Captura                            > |
| Teclado, gestos y accesibilidad    > |
| Contenido                          > |
| Steam (conectar e importar)        > |
| Notificaciones                     > |
| Datos y sincronización    (o) Al día |
| Acerca de                          > |
+--------------------------------------+
| Mi lista  Próximos  Catálogo  Ajustes|
+--------------------------------------+
```

### 6. Teclado, gestos, foco y accesibilidad

#### 6.1 Mapa de atajos (escritorio)

**Globales**

| Atajo | Acción |
|---|---|
| `Ctrl + K` (`⌘K`) | Abrir la paleta: apuntar, buscar, ir a…, acciones. Funciona también dentro de campos de texto |
| `/` | Abrir la paleta (en Catálogo: buscar en el catálogo) |
| `?` | Ver los atajos |
| `G` luego `L` / `P` / `C` / `A` | Ir a Mi lista / Próximos / Catálogo / Ajustes |
| `Ctrl + ,` | Ajustes |
| `Ctrl + Z` · `Ctrl + Mayús + Z` (o `Ctrl + Y`) | Deshacer / rehacer la última acción, con varios niveles (fuera de campos de texto) |
| `Esc` | Cerrar paleta, menú, diálogo o panel y devolver el foco |

**En la paleta**

| Atajo | Acción |
|---|---|
| `↑` `↓` | Moverse por los resultados |
| `Intro` | Añadir a Quiero jugar (si ya está, abrir la ficha) |
| `Ctrl + Intro` | Añadir y seguir apuntando |
| `Mayús + Intro` | Abrir la ficha sin añadir |
| `Alt + Intro` | Más acciones: otro estado, Comprado, al principio, abrir en Steam |
| `Esc` | Cerrar (si hay un submenú abierto, primero el submenú) |

**Mi lista y Próximos (con una fila enfocada)**

| Atajo | Acción |
|---|---|
| `↑` `↓` (o `J` `K`) · `Inicio` `Fin` · `Av Pág` `Re Pág` | Moverse |
| `→` `←` | Recorrer los controles de la fila (estado, marcas, menú) |
| `Intro` | Abrir la ficha |
| `1` `2` `3` `4` `5` | Quiero jugar · Jugando · En pausa · Completado · Abandonado |
| `C` · `P` | Alternar Comprado · Platinado / 100 % |
| `Alt + ↑/↓` · `Alt + Mayús + ↑/↓` | Subir o bajar la prioridad · llevar al principio o al final |
| `X` · `Mayús + ↑/↓` | Seleccionar · ampliar la selección |
| `N` | Editar la nota |
| `Supr` | Quitar de la lista (con Deshacer) |
| `Mayús + F10` o tecla Menú | Menú contextual |

**Otras pantallas**
- **Ficha:** `1`–`5`, `C`, `P` y `N` funcionan igual con el foco dentro del panel; `J`/`K` pasan al juego anterior o siguiente; `S` abre «Ver en Steam»; `Esc` cierra.
- **Catálogo (con el foco en la lista):** `↑↓` o `J K` para moverse, `A` o `+` para añadir, `Intro` para la ficha y `F` para los filtros.

**Reglas del sistema de atajos**
- **Teclas sueltas.** `1`–`5`, `C`, `P`, `X`, `N`, `A` y `F` solo actúan con el foco en una fila, tarjeta o ficha (cumple WCAG 2.1.4 por la excepción «solo activo con foco»). Las globales de una tecla (`/`, `?`, `G …`) se pueden desactivar o reasignar en Ajustes.
- **Atajos del navegador.** `Ctrl + K` se intercepta con `preventDefault` solo mientras la app tiene el foco; en el navegador abre su propia búsqueda, y GitHub o Slack hacen lo mismo. No se interceptan `Ctrl + F`, `Ctrl + W`, `Ctrl + T`, `Ctrl + L` ni `Alt + ←`, ni `Ctrl + Z` dentro de un campo de texto.
- **Teclado español en Windows**
  - Evitar combinaciones `Ctrl + Alt + …`: equivalen a `AltGr` y escriben caracteres como `€`, `@` o `#`.
  - Evitar teclas que exigen `AltGr`: `@ # [ ] { } \ | ~`.
  - `/` es `Mayús + 7` y `?` es `Mayús + '`, así que se detectan por carácter (`event.key`) y no por posición.
  - Para los dígitos se acepta la fila superior y el teclado numérico (`event.code` `Digit1…`/`Numpad1…`); así también funciona en AZERTY.
- **Descubribilidad.** `aria-keyshortcuts` en los controles con atajo, pistas visibles en la interfaz («Intro Añadir», «Ctrl+K» en la cabecera) y la ayuda `?` siempre en el mismo sitio.

#### 6.2 Gestos en móvil

| Gesto | Dónde | Acción | Alternativa sin gesto |
|---|---|---|---|
| Deslizar → | Fila | Avanzar estado (etiqueta visible en el fondo) | Icono de estado de la fila o ficha |
| Deslizar ← (corto) | Fila | Revelar Comprado · Platinado · Más | Menú `…` o ficha |
| Deslizar ← (largo) | Fila | Quitar (con Deshacer) | Menú `…` › Quitar |
| Mantener pulsado | Fila | Menú contextual completo | Botón `…` |
| Arrastrar el asa `::` | Fila (orden por Prioridad) | Reordenar | Subir/Bajar en la ficha o en el menú |
| Deslizar ↓ | Hoja inferior | Cerrar | Botón cerrar o atrás |
| Deslizar → / ← | Bandeja Por clasificar | Quiero jugar / No añadir | Botones |

- La acción se activa hacia el 40 % del ancho, con una vibración breve donde exista (Android). Se cancela volviendo atrás antes de soltar (WCAG 2.5.2).
- Se ignoran los deslizamientos que empiezan a menos de 20 px del borde izquierdo, para no chocar con el gesto «atrás» de iOS y Android.
- Los gestos se activan, desactivan y configuran en Ajustes. Ninguno es la única forma de hacer algo (WCAG 2.5.1).

#### 6.3 Gestión del foco

- **Paleta, diálogos y hojas.** Al abrirlos se guarda el elemento activo y el foco pasa al campo o al encabezado. El foco queda atrapado dentro (`role="dialog"`, `aria-modal="true"`) y `Esc` cierra. **El foco vuelve al origen**; si el origen ya no existe, a la fila más cercana.
- **Después de añadir** desde la paleta, el foco vuelve a donde estaba. La fila nueva se resalta un momento si está visible, sin mover el scroll.
- **Al quitar una fila** o sacarla del filtro, el foco pasa a la siguiente (o a la anterior si era la última).
- **Listas con tabindex itinerante.** Una sola parada de `Tab` por lista y flechas dentro. Se usa el patrón *grid* de ARIA APG: filas = juegos; celdas = título, estado, marcas y menú.
- **Listas virtualizadas.** La fila enfocada nunca se desmonta. Se expone el total real con `aria-setsize`/`aria-posinset`, o con `aria-rowcount`/`aria-rowindex` en el *grid*.
- **Foco nunca tapado.** Ni la cabecera fija, ni la barra de captura, ni las pestañas, ni los avisos tapan el foco: `scroll-padding-top/bottom` igual a su altura (WCAG 2.4.11).
- **Enlaces de salto:** «Saltar a la lista» y «Apuntar un juego».
- **Avisos.** No roban el foco; su acción está disponible también con `Ctrl + Z`.

#### 6.4 Accesibilidad WCAG 2.2 AA: cómo se cumple

| Criterio | Aplicación en GameAgenda |
|---|---|
| 1.4.1 Uso del color | El estado se muestra con icono, texto y color; las marcas, con icono y nombre accesible |
| 1.4.3 Contraste (mínimo) | Texto ≥ 4,5:1 (texto grande ≥ 3:1). Valores verificados en §10 |
| 1.4.11 Contraste no textual | Foco, bordes de campos e iconos de estado ≥ 3:1 frente al fondo |
| 1.4.4 / 1.4.10 / 1.4.12 | Sin scroll horizontal a 320 px; usable con zoom del 200 al 400 % y con el espaciado de texto aumentado |
| 1.4.13 Contenido al pasar el ratón o con foco | Tooltips que se cierran con `Esc` y siguen visibles al pasar sobre ellos; las acciones del *hover* aparecen también con el foco |
| 2.1.1 / 2.1.2 Teclado | Todo se maneja con teclado; no hay trampas de foco salvo los diálogos modales, que se cierran con `Esc` |
| 2.1.4 Atajos de una tecla | Solo activos con foco en el componente; los globales se pueden desactivar o reasignar |
| 2.2.1 Tiempo ajustable | Avisos de 8 s que se pausan con *hover* o foco; duración configurable (8 s / 15 s / hasta cerrarlos); Deshacer siempre disponible con `Ctrl + Z` |
| 2.4.3 / 2.4.7 Orden y foco visible | Orden lógico; anillo de foco de 2 px con 2 px de separación y contraste ≥ 3:1 (`:focus-visible`) |
| 2.4.11 Foco no tapado (mínimo) | `scroll-padding` bajo las barras fijas; los avisos se colocan fuera de la fila enfocada |
| 2.5.1 Gestos de puntero | Cada deslizamiento tiene un botón equivalente |
| 2.5.2 Cancelación del puntero | Las acciones se disparan al soltar; un deslizamiento se cancela volviendo atrás |
| 2.5.3 Etiqueta en el nombre | El nombre accesible empieza por el texto visible («Comprado», «Añadir») |
| 2.5.7 Movimientos de arrastre | Reordenar también con Subir/Bajar, `Alt + flechas` y el menú |
| 2.5.8 Tamaño del objetivo (mínimo) | Nunca menos de 24 × 24 px; diseño a 44 × 44 px en táctil y ≥ 32 px en escritorio compacto |
| 3.2.6 Ayuda coherente | Ayuda y atajos siempre en el mismo sitio |
| 3.3.1 / 3.3.3 Errores | Mensajes en línea que dicen qué ha pasado y qué hacer |
| 3.3.7 Entrada redundante | El texto buscado rellena el título del alta manual; los filtros se recuerdan |
| 3.3.8 Autenticación accesible (mínimo) | Si hay cuenta: se permiten gestores de contraseñas y pegar; enlace mágico, passkeys o «Iniciar sesión con Steam»; sin CAPTCHA de rompecabezas |
| 4.1.2 Nombre, función y valor | Combobox según APG (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `listbox`/`option`); interruptores con `aria-pressed`; menú de estado con `menuitemradio` y `aria-checked` |
| 4.1.3 Mensajes de estado | Avisos, recuentos de resultados y estado de sincronización en `role="status"`; solo los errores críticos usan `role="alert"` |

**Etiquetas de ejemplo**
- Fila: «Hades II, Jugando, Comprado, posición 2 de 28».
- Interruptor: «Comprado — Hades II», con `aria-pressed`.
- Chip de estado: «Estado: Jugando. Cambiar estado de Hades II», con `aria-haspopup="menu"`.
- Asa de arrastre: «Reordenar Hades II».
- Portada junto al título: `alt=""` (decorativa; evita que el título se lea dos veces).
- Documento: `lang="es"`.

**Más allá de AA (recomendado)**
- `prefers-reduced-motion`.
- Modo de alto contraste de Windows (`forced-colors: active`): iconos con `currentColor`, y foco y chips siempre visibles.
- Apariencia de foco al nivel de 2.4.13.

**Pruebas**
- NVDA con Firefox o Chrome y Narrador con Edge (Windows); VoiceOver (iOS y macOS); TalkBack (Android).
- Uso solo con teclado y zoom al 400 %.
- axe-core y Lighthouse en CI; contraste comprobado en los dos temas.

### 7. Reglas de velocidad percibida

1. **Optimismo por defecto.** Cada cambio se aplica en memoria y en el almacenamiento local en el mismo fotograma. La red va por una cola (*outbox*) con reintentos y espera exponencial. Si el servidor rechaza un cambio, se revierte con un aviso que explica el motivo y ofrece «Reintentar».
2. **Deshacer, no confirmar.**
   - Aviso de 8 s, que se pausa y cuya duración se puede configurar, con una sola acción: «Deshacer».
   - Pila de deshacer de varios niveles con `Ctrl + Z`.
   - Solo se pide confirmación para lo irreversible y masivo («Borrar todos mis datos», «Eliminar cuenta»), escribiendo una palabra.
3. **Respuesta en menos de 100 ms.** El gestor de eventos solo cambia el estado y pinta. Lo pesado (búsqueda, ordenación, importación) va a un *Web Worker* o a tareas diferidas.
4. **Sin spinners bloqueantes.** Nunca hay una pantalla completa de carga ni botones deshabilitados «esperando». Solo hay indicadores locales; por ejemplo, un «Buscando en todo Steam…» discreto en la paleta si lo remoto tarda más de 300 ms.
5. **Skeletons con criterio.** Solo aparecen si la carga supera unos 200 ms (así no parpadean) y tienen la misma forma que el contenido final, para que no haya saltos de maquetación.
6. **Precarga por intención**
   - *Hover* de al menos 80 ms, foco de teclado o `pointerdown` en una fila → precargar los datos de la ficha y la portada grande.
   - En la paleta, se precarga la ficha del resultado resaltado tras 150 ms sin teclear.
   - En el catálogo, el bloque siguiente al llegar al 70 % del scroll.
   - Al arrancar, `preconnect` al CDN de imágenes y a la API.
   - Con «Ahorro de datos» activado (o la cabecera `Save-Data`) no se precarga nada.
7. **Imágenes perezosas con el hueco reservado**
   - `loading="lazy"`, `decoding="async"` y `aspect-ratio: 2 / 3` fijo.
   - Mientras carga se muestra un marcador: color derivado del appid más las iniciales del título.
   - Fundido de 150 ms como máximo (ninguno con movimiento reducido).
   - `fetchpriority="high"` solo para las primeras portadas visibles.
   - Si la imagen falla se queda el marcador; nunca el icono de imagen rota.
8. **Búsqueda sin esperas**
   - La local se lanza en cada pulsación, sin *debounce*.
   - La remota, con un *debounce* de 120–150 ms y cancelación de las peticiones obsoletas (`AbortController`).
   - Caché LRU por consulta y reutilización de los resultados de prefijos ya buscados.
9. **Arranque instantáneo.**
   - La estructura base de la app queda en caché mediante un *service worker*.
   - Mi lista se pinta desde el almacenamiento local antes de tocar la red, con el último filtro, el último orden y la misma posición de scroll.
   - La actualización con datos del servidor ocurre en segundo plano (*stale-while-revalidate*).
10. **Nada se mueve bajo el cursor:**
    - colapso diferido de filas (§2);
    - resultados estables en la paleta (§3a);
    - los cambios llegados de otros dispositivos se aplican sin desplazar lo visible, con un resaltado breve.
11. **Animaciones cortas:** 120–200 ms y solo con `transform` u `opacity`.

### 8. Sin conexión y sincronización

| Acción | Con conexión | Sin conexión |
|---|---|---|
| Ver, filtrar y ordenar Mi lista y Próximos | Datos locales; se actualizan en segundo plano | Igual, con los datos locales |
| Cambiar estado, marcas, prioridad o notas | Optimista y se sincroniza | Optimista; queda en cola |
| Buscar para apuntar | Índice local + búsqueda remota | Índice local (si existe), Mi lista y búsquedas recientes en caché |
| Apuntar un juego que no aparece | Normal | «Apuntar «…» como pendiente»: se guarda el texto y se vincula al volver la conexión. Si hay una coincidencia clara, solo; si no, distintivo «Por vincular · Elegir» |
| Catálogo | Completo | Mensaje explicativo y lo que ya esté en caché |
| Ficha | Completa | Datos guardados; la descripción solo si ya se visitó |
| Portadas | CDN + caché | Caché de las portadas de Mi lista (límite p. ej. de 50 MB, LRU) o marcador |
| Importar de Steam | Disponible | Deshabilitado, con explicación |

**Indicador de sincronización** (en la cabecera: icono, texto corto y detalle en el tooltip)

| Estado | Texto | Notas |
|---|---|---|
| Al día | Guardado | Detalle: «Todo guardado · hace 1 minuto» |
| Sincronizando | Guardando… | Solo si hay cambios pendientes durante más de 1 s, para que no parpadee |
| Sin conexión | Sin conexión · 3 cambios pendientes | Banda informativa una sola vez por episodio |
| Error | No se ha podido sincronizar · Reintentar | Además del botón, reintenta solo |
| Sin cuenta | Guardado en este dispositivo | Enlace a «Activar sincronización» **[Supuesto: la cuenta es opcional]** |

- **Conflictos entre dispositivos.** Gana el último cambio de cada campo, sin preguntar al usuario **[Supuesto de arquitectura]**. Si afecta a algo visible, aparece un aviso discreto: *Actualizado desde otro dispositivo*.
- **Anuncios.** El paso a «Sin conexión» o a «Error» se anuncia (`role="status"`); las sincronizaciones normales no.

### 9. Estados del sistema y microcopy

**Tono**
- Tuteo y frases cortas, en español de España («ordenador», «móvil», «pulsa»).
- Sin exclamaciones de relleno.
- Las teclas, con su nombre en el teclado español.
- En las tablas, los textos de interfaz van sin comillas exteriores.

**Estados vacíos**

| Contexto | Título | Texto | Acciones |
|---|---|---|---|
| Mi lista, primera vez (con el foco ya en «Apunta un juego…») | Tu agenda de juegos está vacía | Apunta el primer juego que quieras jugar: escribe su nombre y pulsa Intro. Consejo: Ctrl + K la abre desde cualquier pantalla. | Importar desde Steam · Explorar el catálogo |
| Filtro sin juegos | No tienes juegos en Completado | Cuando termines uno, aparecerá aquí. | Quitar filtros |
| Próximos vacío | Ninguno de tus juegos sale próximamente | Apunta juegos que aún no han salido y aquí verás sus fechas. | Ver Próximamente en el catálogo |
| Por clasificar terminado | Todo clasificado | Has revisado 118 juegos. | Volver a Mi lista |

**Sin resultados (paleta y catálogo)**
- No encontramos «mario kart» en Steam. → Acción principal, resaltada y con `Intro`: **Añadir «mario kart» manualmente** (quizá es de otra plataforma).
- Con una errata: ¿Querías decir «Hollow Knight»?
- Ayuda: Revisa la ortografía o prueba con menos palabras.
- Con filtros activos en el catálogo: No hay juegos con estos filtros. → **Quitar filtros**.

**Sin conexión**
- Banda: Sin conexión. Puedes seguir usando GameAgenda: guardamos los cambios y se sincronizarán al volver.
- Paleta: Sin conexión: solo buscamos en tu lista y en los juegos guardados. → **Apuntar «…» como pendiente**.
- Catálogo: El catálogo necesita conexión. Mientras tanto, puedes apuntar juegos y se vincularán después.

**Errores (en línea, nunca en un diálogo modal)**

| Situación | Mensaje | Acción |
|---|---|---|
| Fallo de sincronización | No se han podido guardar 3 cambios en la nube. Lo seguiremos intentando. | Reintentar ahora |
| Búsqueda remota caída | La búsqueda en Steam no responde ahora mismo. Te mostramos los resultados guardados. | Reintentar |
| Descripción de la ficha | No se ha podido cargar la descripción. | Reintentar |
| Perfil de Steam privado | Tu perfil de Steam es privado. Para importar, pon «Detalles del juego» en Público en la privacidad de Steam. | Abrir privacidad de Steam · Volver a intentarlo |
| Perfil no encontrado | No encontramos ese perfil. Pega la URL completa (steamcommunity.com/id/… o /profiles/…). | — |
| Demasiadas peticiones | Vamos demasiado rápido. Espera unos segundos y vuelve a intentarlo. | Reintento automático |
| Cambio rechazado por el servidor | No se ha podido guardar el cambio en Hades II y lo hemos deshecho. | Reintentar |
| Imagen que no carga | (sin mensaje: se queda el marcador con las iniciales) | — |

**Avisos (toasts)**
- Añadido a Quiero jugar: Hades II · [Deshacer]
- Hades II pasa a Jugando · [Deshacer]
- Marcado como comprado: Hades II · [Deshacer]
- Platinado. También lo hemos marcado como Completado. · [Deshacer]
- Quitado de tu lista: Hades II · [Deshacer]
- 3 juegos movidos a Completado · [Deshacer]
- Ya está en tu lista (Jugando) · [Abrir]
- Apuntado como pendiente: «nebula drif». Lo vincularemos al volver la conexión.
- Importación lista: 57 a Quiero jugar, 118 a Por clasificar y 342 reconocidos como comprados · [Deshacer importación]

**Formatos (comprobados con `Intl` y la configuración regional es-ES)**
- Números: `1234`, `12.345`, `123.456`. En es-ES los números de 4 cifras no llevan separador de miles.
- Fechas: `28 oct 2026`, `4 sept 2026` (la abreviatura es «sept»), `vie, 30 oct`, `28/10/2026`. Cabeceras de mes: «Noviembre de 2026».
- Fechas relativas: «mañana», «pasado mañana», «dentro de 3 días», «ayer», «hace 2 horas».
- Porcentaje: «100 %», con espacio irrompible. Moneda: «29,99 €».
- Teclas: `Ctrl + K`, `Intro`, `Mayús + Intro`, `Alt + Intro`, `Supr`, `Esc`.

### 10. Guía visual

#### 10.1 Tema y tokens
- **El tema sigue al sistema** (`prefers-color-scheme`), con selector Sistema / Claro / Oscuro. El oscuro es el tema de referencia del diseño: encaja con el contexto de jugador y luce más las portadas.
- **Neutros fríos y un único acento** (se propone rosa) para la marca, el foco y la acción principal. Los colores de estado se reservan para chips e iconos; nunca tiñen una fila entera.
- **Identidad propia.** No imitar la paleta, la tipografía ni el logotipo de Steam **[Supuesto: guías de marca y ToS del track legal]**. «Ver en Steam» es un enlace de texto con icono de enlace externo.
- **Tipografía del sistema**, sin descargar fuentes: Segoe UI Variable en Windows 11, SF en Apple, Roboto en Android. Cifras tabulares (`font-variant-numeric: tabular-nums`) en contadores, fechas y posiciones.
- **Retícula y forma:** retícula de 4/8 px, radios de 6–8 px e iconos SVG de un único set coherente (p. ej. Lucide o Phosphor).

| Token | Oscuro | Claro | Uso |
|---|---|---|---|
| `--bg` | `#0E1116` | `#F6F7F9` | Fondo |
| `--surface` | `#161B22` | `#FFFFFF` | Filas, tarjetas, paneles |
| `--surface-2` | `#1E252E` | `#EEF1F5` | *Hover*, *skeleton* |
| `--border` | `#2C3540` | `#D8DEE6` | Separadores decorativos |
| `--control-border` | `#6B7787` | `#7A8594` | Bordes de campos (≥ 3:1) |
| `--text` | `#E7EBF0` | `#161B22` | Texto principal |
| `--text-muted` | `#A3ADBA` | `#556170` | Metadatos |
| `--accent` / `--focus` | `#FF6AA8` | `#C2185B` | Acción principal y foco |

**Contrastes calculados con la fórmula WCAG (oscuro / claro)**

| Par de colores | Oscuro | Claro |
|---|---|---|
| `--text` sobre `--surface` | 14,45:1 | 17,30:1 |
| `--text-muted` sobre `--surface` | 7,61:1 | 6,31:1 |
| Foco (`--accent`) sobre `--bg` | 7,10:1 | 5,48:1 |
| `--control-border` sobre `--surface` | 3,80:1 | 3,74:1 |
| Botón principal | 7,10:1 (texto `#0E1116` sobre el acento) | 5,87:1 (texto blanco sobre el acento) |

#### 10.2 Densidad
- **Cómoda** (por defecto): filas de 72 px, portada de 48 × 72, dos líneas (título y metadatos) y acciones al pasar el ratón o enfocar.
- **Compacta**: filas de 44 px, portada de 28 × 42 (o sin portada), una línea, y el estado como icono y abreviatura con tooltip. Objetivos de al menos 32 px. Se cambia con el selector de densidad de la barra de la lista.
- **Cuadrícula** (en Catálogo; opcional en Mi lista): tarjetas 2:3 de 140–180 px en escritorio y 3 columnas en móvil.
- **En móvil**, los objetivos táctiles miden siempre al menos 44 × 44 px.

#### 10.3 Portadas (cápsula vertical)
- **Formato protagonista: 2:3** (`library_600x900` de GetItems), con `object-fit: cover`, radio de 6 px y un borde semitransparente de 1 px para que las portadas oscuras no se pierdan sobre el fondo oscuro.
- **Cadena de respaldo:**
  1. Cápsula vertical.
  2. Imagen de cabecera horizontal, centrada sobre una versión desenfocada de sí misma.
  3. Marcador generado (color derivado del appid más las iniciales).
  
  Muchos juegos antiguos o pequeños no tienen cápsula vertical.
- **URL.** Usar siempre las URL con hash que devuelve GetItems; no construirlas a mano.
- **Tamaño según el uso:** la miniatura de la lista no es la imagen de la ficha. **[Supuesto: si el track legal permite cachear y redimensionar las imágenes de Steam, un proxy de miniaturas WebP/AVIF de unos 100 × 150 px reduce unas diez veces los datos en móvil. Si no, la imagen original se carga solo cuando es visible.]**
- **Texto sobre portada** (solo en cuadrícula y ficha): degradado negro de al menos el 60 % bajo el texto. Texto blanco sobre negro al 60 % encima de una portada blanca da 5,74:1.
- **Lectores de pantalla:** portadas decorativas (`alt=""`) cuando el título está al lado.

#### 10.4 Estados: color, icono y texto

| Estado / marca | Icono | Oscuro: color · contraste sobre el chip | Claro: color · contraste sobre el chip |
|---|---|---|---|
| Quiero jugar | marcador | `#5AB0FF` · 5,60:1 | `#0B63C5` · 4,88:1 |
| Jugando | play | `#3FCF8E` · 6,32:1 | `#0D6E43` · 5,30:1 |
| En pausa | pausa | `#FF9F43` · 6,28:1 | `#A44F00` · 4,79:1 |
| Completado | check en círculo | `#B395FF` · 5,37:1 | `#6A3FC8` · 5,54:1 |
| Abandonado | círculo tachado | `#9AA5B4` · 5,26:1 | `#5E6977` · 4,76:1 |
| Platinado / 100 % (marca) | trofeo | `#E8C35A` · 7,16:1 | `#7A5A00` · 5,36:1 |
| Comprado (marca) | bolsa | neutro `#A3ADBA` · 5,67:1 | neutro `#556170` · 5,33:1 |

- **Chip:** fondo del color del estado al 16 % (oscuro) o al 12 % (claro) sobre `--surface`, con texto e icono en el color del estado. Todos superan 4,5:1 en los dos temas.
- **Borde del chip:** el chip se identifica por su texto, así que su fondo no necesita 3:1 frente a la superficie. El foco, en cambio, sí.
- **Marcas:** en la fila solo se muestran cuando están activas (menos ruido). En la ficha se ven siempre, como interruptores con `aria-pressed`.
- **Daltonismo:** azul, verde, naranja, violeta y gris se distinguen además por icono y texto. Ningún estado depende solo del color.

#### 10.5 Movimiento
- Duraciones de 120–200 ms con `ease-out`. Deslizamientos con una física sutil y sin rebotes largos.
- Con `prefers-reduced-motion`: el deslizamiento cambia directamente, sin animación; los *skeletons* no tienen brillo animado (*shimmer*) y las portadas no hacen fundido.

### 11. Supuestos y dependencias con otros tracks

| # | Supuesto | Track | Si no se cumple |
|---|---|---|---|
| S1 | Se puede descargar al cliente un índice compacto del catálogo (nombre y appid, al menos de los juegos más populares) | Arquitectura | Búsqueda remota con objetivo p95 < 300 ms; la regla de `Intro` anticipado gana peso |
| S2 | Existe una señal de popularidad para ordenar resultados y catálogo | API de Steam | Ordenar por coincidencia y fecha, con alias manuales para los títulos más buscados |
| S3 | GetItems da el tipo de app, los descriptores de contenido adulto, el texto de fecha «próximamente» y, si es posible, géneros e idiomas | API de Steam | Ocultar los filtros sin datos |
| S4 | Se pueden mostrar (y quizá cachear o redimensionar) las imágenes del CDN de Steam | Legal | Solo enlaces directos y carga perezosa estricta |
| S5 | Son viables el inicio de sesión con Steam y la importación de biblioteca y lista de deseos | API de Steam / Legal | El flujo (g) queda fuera del prototipo |
| S6 | App web instalable (PWA): accesos directos, Web Share Target, *service worker* y notificaciones | Arquitectura | La captura solo funciona dentro de la app |
| S7 | Cuenta opcional: la app funciona sin registro (local primero) | Arquitectura / Legal | Registro mínimo con enlace mágico o con Steam, nunca antes de la primera captura |
| S8 | El backend permite pedir el catálogo por rango para virtualizarlo | Arquitectura | Scroll infinito por cursor |

---
### Decisiones clave
- Mi lista es la pantalla de inicio y la captura está en todas partes: campo «Apunta un juego… Ctrl+K» en la cabecera de escritorio y barra fija sobre las pestañas en móvil, más accesos desde fuera de la app si es instalable (PWA).
- Una sola paleta para apuntar, buscar y lanzar acciones. Intro añade a «Quiero jugar» y cierra; Ctrl+Intro añade y sigue apuntando; Mayús+Intro abre la ficha; Alt+Intro muestra más acciones. Pegar un enlace o appid de Steam da un resultado exacto.
- Los resultados van en una única lista ordenada por relevancia, sin grupos. Los juegos ya apuntados aparecen marcados y nunca se duplican. La selección no salta al llegar resultados remotos, e Intro nunca se pierde: si se pulsa antes de que lleguen, la app espera hasta 500 ms.
- Modelo de interacción: un estado exclusivo (Quiero jugar, Jugando, En pausa, Completado, Abandonado) más marcas independientes (Comprado, Platinado / 100 %). Platinado implica Completado. No hay un estado «Wishlist» aparte: equivale a Quiero jugar sin Comprado.
- Sin diálogos de confirmación: cambios optimistas, aviso con Deshacer (8 s, se pausa y se puede configurar) y Ctrl+Z con varios niveles. Solo se confirma borrar todos los datos o la cuenta.
- Local primero: Mi lista se lee y se modifica sin red y los cambios esperan en cola. Lo que se apunta sin conexión queda como «pendiente de vincular» y se vincula al volver la conexión.
- Presupuestos medibles para el prototipo: paleta en < 50 ms, resultado local en < 50 ms por tecla, respuesta en < 100 ms (INP p75 ≤ 200 ms), tiempo de captura p50 ≤ 3 s y acierto a la primera ≥ 80 %. El de 50 ms por tecla exige un índice local en un Web Worker, pendiente de arquitectura.
- Vista por defecto «Pendientes»: Jugando ahora + Quiero jugar por prioridad + En pausa plegado. Los juegos nuevos entran al final. La prioridad es un orden manual que se cambia arrastrando, con Alt+flechas o desde el menú (WCAG 2.5.7).
- Cuando una acción saca un juego del filtro, su fila queda atenuada unos 2 s antes de desaparecer, para que nada se mueva bajo el cursor.
- Móvil: deslizar a la derecha avanza el estado; a la izquierda muestra Comprado, Platinado y Más (un deslizamiento largo lo quita). Cada gesto tiene un botón equivalente y se puede configurar.
- Atajos de una tecla solo con el foco en una fila o ficha (1–5 estados, C Comprado, P Platinado). Los globales de una tecla (/, ?, G+letra) se pueden desactivar. Nada de Ctrl+Alt ni teclas con AltGr por el teclado español, y no se interceptan atajos del navegador salvo Ctrl+K.
- Catálogo por defecto: solo juegos, sin contenido para adultos, ordenado por popularidad, en lista virtualizada con contador real. La cuadrícula de portadas es opcional y en móvil los filtros van en una hoja inferior.
- Ficha como panel lateral en escritorio (se mantiene la lista a la vista) y a pantalla completa en móvil. Se pinta al instante con lo que ya se sabe y la descripción en español llega después.
- Visual: el tema sigue al sistema (el oscuro es la referencia), con un único acento, densidad Cómoda o Compacta y portada vertical 2:3 con cadena de respaldo. Cada estado lleva color, icono y texto, y los tokens propuestos superan 4,5:1 en los dos temas (calculado).
- Microcopy en español de España, tuteando, con los nombres de teclas del teclado español (Intro, Mayús, Supr). Los formatos de fecha y número salen de Intl es-ES: «4 sept 2026», «1234 / 12.345», «100 %».

### Preguntas abiertas
- ¿Qué plataforma tendrá el prototipo: web instalable (PWA), escritorio (p. ej. Tauri) o ambas? De eso dependen el atajo global del sistema, «Compartir con GameAgenda» y las notificaciones.
- ¿El prototipo necesita cuenta y sincronización entre dispositivos, o bastan datos locales con exportación? ¿Se ofrece «Iniciar sesión con Steam»?
- ¿Se puede descargar al cliente un índice compacto del catálogo? ¿Con qué tamaño y cada cuánto se actualiza? Sin él no se cumplen los 50 ms por tecla con los juegos poco populares.
- ¿Qué señal de popularidad ofrece Steam (reseñas, jugadores, ventas) para ordenar resultados y catálogo?
- ¿Permite el ToS de Steam mostrar, cachear o redimensionar sus portadas, por ejemplo con un proxy de miniaturas?
- ¿Platinado debe implicar siempre Completado? ¿Hacen falta más marcas, como Favorito, «Jugando en: plataforma» o «Esperando oferta»?
- ¿Los juegos nuevos entran al final de «Quiero jugar» (propuesta) o al principio?
- ¿Entra en el prototipo la importación de biblioteca y lista de deseos? ¿Qué se hace por defecto con cientos de juegos comprados sin jugar? Se propone la bandeja «Por clasificar».
- ¿Se muestran en la ficha el precio y las ofertas de Steam en España (cc=es), dado el interés por la marca «Comprado»?
- ¿Los avisos de lanzamiento (push o correo) y el calendario .ics van en el prototipo o en una fase posterior?
- ¿Cuándo llegan otras plataformas (PlayStation, Xbox, Switch)? Afecta a «Platinado», al campo de plataforma y a los filtros.
- ¿El contenido para adultos va oculto por defecto con opción en Ajustes, o se excluye del todo?
- ¿Cuáles serán el color de acento (se propone rosa), la marca y el logotipo definitivos?
- ¿Se quiere mostrar la duración estimada de cada juego (tipo HowLongToBeat)? Steam no la ofrece y no hay API oficial.
