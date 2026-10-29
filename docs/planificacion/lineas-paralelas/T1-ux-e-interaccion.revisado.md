> Revisión: El borrador es sólido en accesibilidad, microcopy y tokens: recalculé todos sus contrastes y cuadran. Pero especifica un producto completo sin recorte de prototipo y deja sin resolver lo crítico de la función principal. Primero, de dónde salen los resultados para cumplir los 50 ms con todo Steam: solo indexa en local los juegos populares, y la búsqueda remota de respaldo es poco realista (p95 < 300 ms) y no funciona sin conexión. Segundo, cómo se ordenan para acertar a la primera: sus propias reglas contradicen sus ejemplos y la métrica de acierto se mide a sí misma. Tercero, cómo se deshace y se protegen los datos en móvil: no hay Ctrl + Z en táctil y Safari borra el almacenamiento tras 7 días sin uso. Los wireframes contradicen sus propias reglas (Hades II ofrecido para añadir estando ya en la lista, BG3 con (+) estando apuntado). Además faltan detalles que bloquean la implementación: atributos del campo de captura en móvil, la regla inversa de Platinado, el appid frente a títulos numéricos y las acciones mezcladas en la paleta.

La versión revisada añade una §0 de alcance P0/P1/P2 con etiquetas en todo el texto, y un índice local de todo el catálogo con estimación de tamaño y una prueba de velocidad hecha hoy. Cierra las reglas de búsqueda con un conjunto de consultas de referencia y cierra el modelo de estados (Platinado, «Juego en» para cualquier entrada, «Por clasificar»). Unifica los datos de ejemplo, regenera los wireframes con ancho validado por script, corrige el contraste de los chips en hover con fondos opacos y reescribe el microcopy en español de España.

> Problemas detectados (27):
> - [high] Sin recorte de prototipo: el borrador especifica un producto completo (sincronización con cola y último cambio gana por campo, importación con OpenID y bandeja, gestos en dos sentidos, .ics, push, Web Share Target, Tauri, selección múltiple, reasignación de atajos, densidades, caché de portadas de 50 MB, proxy de miniaturas, historial de fechas…) sin decir qué entra en el prototipo de un desarrollador en solitario. Choca con el requisito 5 y no deja estimar el trabajo. → Nueva §0 con una tabla P0/P1/P2 por área y etiqueta [P0]/[P1]/[P2] en cada función, flujo, pantalla y wireframe. P0 = captura, estados y marcas, Mi lista, catálogo completo con filtros básicos, ficha, guardado local con exportación JSON y accesibilidad base.
> - [high] El objetivo de 50 ms por tecla depende de un índice local que solo tiene los juegos más populares; el resto va a una búsqueda remota con p95 < 300 ms, poco realista desde España por 4G contra un hosting de prototipo e incompatible con buscar sin conexión. No se dan tamaño ni tiempo de carga, ni qué pasa si se abre la paleta antes de que el índice esté listo, y el catálogo depende de paginar en el servidor (S8). → §3a.5: opción A recomendada, índice de todos los juegos en un Web Worker (appid, nombre, año, tipo, adulto; la popularidad va implícita en el orden). Estimado en 4–7 MB sin comprimir y ~1–2 MB comprimido, lo genera el job como fichero versionado. Prueba de velocidad de hoy: 140.000 títulos sintéticos, p95 ≈ 11 ms y < 2 ms reutilizando prefijos. Se definen la primera descarga, el Ahorro de datos y los huecos reservados; la opción B queda como respaldo. El catálogo filtra y ordena desde el índice, sin paginar en el servidor.
> - [high] Las reglas de orden contradicen sus propios ejemplos. Con prefijo del título > prefijo de palabra y la popularidad solo como desempate, «witcher» no daría The Witcher 3 (cualquier título que empiece por Witcher iría antes) y «hade» daría Hades antes que Hades II. Además, la métrica «acierto a la primera = el juego añadido era el primer resultado» se mide a sí misma: si el usuario siempre pulsa Intro, sale el 100 %. → Los artículos iniciales no cuentan para el prefijo. Puntuación = peso del rango + log(popularidad), con los pesos ajustados contra el conjunto de referencia. Lo ya apuntado va al final de su rango. Conjunto de referencia de ~50 consultas con su appid esperado, en un test de Node (≥ 90 % en primera posición, 100 % entre los tres primeros), más una prueba guiada sin flechas ni Deshacer.
> - [high] En móvil no se puede deshacer una vez pasados los 8 s del aviso. El principio «todo se puede deshacer» y la conformidad con WCAG 2.2.1 se apoyan en Ctrl + Z, que no existe en táctil, y encima un deslizamiento largo borra la entrada. → Pila de 20 acciones, con «Deshacer último cambio» en el menú [...] de la cabecera en móvil y Ctrl + Z en escritorio. Fila de 2.2.1 reescrita. Se elimina el deslizamiento largo para quitar.
> - [high] Local primero y cuenta opcional, pero sin salvaguardas: Safari (iOS y macOS) borra IndexedDB y el resto del almacenamiento de un sitio tras 7 días de uso sin visitarlo, salvo si la app está en la pantalla de inicio. No se pide navigator.storage.persist(), la exportación no es P0 y no hay estado de error para un guardado local fallido. → Nuevo apartado «Que no se pierdan los datos» en §8: persist() tras la primera captura, una única sugerencia de instalar la app en iOS, exportar e importar JSON en P0 y un error en línea con «Exportar JSON». El riesgo se refleja también en S7 y en las preguntas abiertas.
> - [medium] Los wireframes contradicen las reglas. W2 ofrece «Intro: Añadir» para Hades II, que W1, W2b y W3b ya muestran en la lista como Jugando. Baldur's Gate 3 aparece con (+) en W3, W3b y M4, pero está en Quiero jugar en W1 y M1. «Hadal Run» sale al buscar «hade» sin ser un prefijo y con menos de 5 letras. El ejemplo «Hades II, posición 1 de 28» es de un juego en Jugando, que no tiene prioridad. → Un único conjunto de datos de ejemplo coherente en todo el texto (Jugando: Clair Obscur y Stardew Valley; Quiero jugar: Silksong, Nebula Drift y BG3; Completado: Hades y Elden Ring), con títulos y metadatos reales. Wireframes regenerados con un script que valida el ancho de cada línea.
> - [medium] Pegar o escribir un appid da un resultado exacto, pero eso choca con los títulos numéricos (1942, 2077…): escribir «2077» devolvería un appid en vez de Cyberpunk 2077. Rompe el principio de previsibilidad. → Un número escrito busca títulos; solo se trata como appid si se pega solo o lleva # delante. Se añade una lista explícita de los formatos de enlace reconocidos.
> - [medium] La paleta mezcla juegos y acciones (W2b invita a «escribir una acción»), mientras que §3a exige una sola lista de juegos sin grupos. No se define qué hace Intro si el texto coincide a la vez con una acción y con un juego. → En P0 las acciones solo aparecen con el campo vacío. Al escribir solo hay juegos y la fila de alta manual.
> - [medium] El campo de captura en móvil está infraespecificado. Sin desactivar autocorrect, autocapitalize y spellcheck, el teclado «corrige» los nombres de juegos (hade → hace). Con letra de menos de 16 px, iOS hace zoom al enfocar. Un focus() síncrono solo abre el teclado si el campo ya está montado y visible. Y falta enterkeyhint para la tecla «Ir» que aparece en M3. → Bloque «Requisitos del campo de captura» en §3a.2: hoja premontada fuera de la pantalla con transform, focus() síncrono, type=search, enterkeyhint=go, autocomplete/autocorrect/autocapitalize off, spellcheck=false y letra ≥ 16 px.
> - [medium] Contraste de los chips: la frase «todos superan 4,5:1 en los dos temas» solo es cierta sobre --surface. Con fondo translúcido y la fila en hover (--surface-2), en el tema claro bajan a 4,35:1 (Quiero jugar), 4,27:1 (En pausa) y 4,25:1 (Abandonado); sobre --bg, a 4,48:1 y 4,46:1. → Fondos de chip opacos, precalculados como tokens (p. ej. #E2ECF8, #F4EAE0 y #ECEDEF en claro), con los contrastes recalculados. La tabla de contrastes incluye ahora --surface-2 y el foco sobre --surface.
> - [medium] Platinado implica Completado, pero no se dice qué pasa si después cambia el estado (rejugar → Jugando, o Abandonado): o se rompe la regla o se pierde la marca sin avisar. → Activar Platinado fuerza Completado una vez, y un solo Deshacer revierte ambas cosas. Después el estado es libre y la marca se conserva como logro; desactivarla no cambia el estado.
> - [medium] La plataforma solo existe en los juegos manuales: un juego del catálogo de Steam que se juega y se platina en PlayStation (lo que sugiere «platinado») no se puede registrar. Además, W7 ofrece «PC», que no está en la lista del modelo. → Campo opcional «Juego en» en cualquier entrada (PC · PlayStation · Xbox · Switch · Otra), con PC por defecto en los juegos de Steam. La misma lista en W7, en la ficha y en los filtros.
> - [medium] El plegado diferido es ambiguo («unos 2 s o hasta que el puntero sale») y choca con §6.3, donde el foco pasa a la siguiente fila en el acto. Tampoco cubre el cambio de sección en la vista Pendientes (Quiero jugar → Jugando mueve la fila a la sección de arriba) y frena el triaje rápido. → P0: plegado inmediato de 150 ms, foco a la siguiente fila de la misma sección, aviso que dice adónde ha ido el juego y resaltado en su nueva posición. El plegado diferido queda en P1, solo si las pruebas muestran clics erróneos.
> - [medium] Gestos: la zona muerta solo protege el borde izquierdo, pero Android tiene el gesto «atrás» en los dos bordes y Safari usa el derecho para «adelante». El deslizamiento largo para quitar es fácil de disparar sin querer, y todo el sistema de gestos es caro para un P0. → Zonas muertas de ≥ 24 px en los dos bordes y ningún deslizamiento destructivo; los gestos pasan a P1. En P0, en móvil: icono de estado → hoja (2 toques).
> - [medium] ARIA: el patrón grid de APG para Mi lista es caro para un prototipo y los lectores de pantalla lo soportan de forma irregular. Los resultados de la paleta como listbox/option no pueden contener el botón (i), porque una option no admite descendientes interactivos. Y el ejemplo de 2.5.3 («Estado: Jugando. Cambiar…») no empieza por el texto visible, como exige la propia tabla. → P0: ul/li nativos con tabindex itinerante por fila y botones nativos; el grid queda en P1, solo si se justifica. El botón (i) va como hermano fuera de la option, con Mayús + Intro como vía de teclado. Etiqueta «Jugando: cambiar estado de…» y control segmentado de la ficha como radiogroup.
> - [medium] Los presupuestos no dicen cómo se miden: p95 y p75 sobre una «telemetría anónima» que un prototipo no tendrá, sin dispositivo ni condiciones de referencia. Tampoco se mide cuándo está listo el índice. → Columna «Cómo se mide» (performance.mark, CPU ralentizada 4×, web-vitals en la consola, Lighthouse en perfil móvil, prueba guiada de 5 personas × 10 juegos cronometrada) y nueva métrica «índice listo» (≤ 1 s en escritorio, ≤ 3 s en móvil).
> - [medium] La precarga y la caché de imágenes tienen riesgos ocultos. Precargar fichas al pasar el ratón contra appdetails (una app por llamada) multiplica las peticiones a Steam desde la IP del backend. Una caché de portadas de 50 MB en el service worker se llena con unas 7 imágenes si las respuestas son opacas (CDN sin CORS), porque Chrome cuenta cada respuesta opaca como unos 7 MB de cuota. → Precarga solo desde caché o backend propios (P1) y metadatos por lotes (S8). En P0 solo la caché HTTP del navegador; la caché propia queda en P2, condicionada a verificar las cabeceras CORS del CDN.
> - [medium] Atajos: las secuencias G + letra chocan con los atajos de fila (G C frente a C = Comprado, G P frente a P = Platinado) sin regla de prioridad ni plazo. Reasignar atajos y configurar qué hace Intro añaden complejidad y contradicen el principio «Predecible»; para 2.1.4 basta con poder desactivarlos. Alt + Mayús + flechas usa el atajo de Windows para cambiar el idioma de entrada. Y no se ignora la composición IME. → La secuencia G tiene prioridad durante 1 s. Un único interruptor desactiva los atajos de una tecla, Intro no se configura, y mover al principio o al final se hace solo desde el menú (ni Alt + Mayús ni Alt + Inicio). Las teclas sueltas se ignoran con modificadores, dentro de campos de texto o con isComposing.
> - [low] El objetivo dice «desde cualquier pantalla», pero en móvil la barra de captura se oculta en Ficha y Ajustes. → Botón (+) en la cabecera de Ficha y Ajustes que abre la misma hoja de captura (M6).
> - [low] «Por clasificar» introduce un sexto pseudoestado sin definirlo, en contra de «siempre hay un estado», y la bandeja W8b omite la tecla 3 (En pausa). → Bandeja fuera de Mi lista, sin estado hasta que se clasifica cada juego; teclas 1–5 completas.
> - [low] En Catálogo conviven «Apunta un juego…» y «Buscar en el catálogo…»: dos buscadores con el mismo verbo y un comportamiento distinto de Intro. → El segundo pasa a llamarse «Filtrar el catálogo…» y nunca añade con Intro; para añadir están el botón (+) y la paleta.
> - [low] Filtros y fechas incoherentes. W1 permite marcar a la vez «Comprado» y «Sin comprar» (lista vacía), en contra de «sin combinaciones absurdas». Las fechas aproximadas van al final de su periodo en §3c, pero en un grupo aparte en §3h y W5, sin un criterio común. → Control segmentado Todos / Comprados / Sin comprar. Un solo criterio de orden (el final del periodo) en todas partes; el grupo propio solo existe en Próximos.
> - [low] El recuento del flujo (f) supone que no hay resultados. Con resultados, la fila de alta manual queda debajo de «Ver los N resultados» y no hay forma rápida de llegar a ella. → La alta manual es siempre la última fila y ↑ desde el primer resultado salta a ella; recuento corregido en la tabla.
> - [low] Ejemplos de normalización engañosos o arriesgados. «pokemon → Pokémon» no existe en Steam. Convertir números romanos sin restricción afecta a I Am Bread o a Mega Man X. Y «no construir a mano las URL de portada» es impreciso, porque hay que componerlas con la plantilla y el nombre de archivo que devuelve GetItems. → Ejemplos reales del catálogo (ŌKAMI HD, Brütal Legend, NieR:Automata™). Se indexan las dos formas y solo se convierten los romanos de II a XX, salvo X. Pokémon pasa a ser el ejemplo de alta manual (Switch). La URL se compone con la plantilla y el nombre de archivo de GetItems [Supuesto: lo confirma el track de API].
> - [low] Faltan puntos de corte (qué pasa con el panel lateral entre tableta y portátil). Tampoco se tiene en cuenta el límite de altura de un elemento en Firefox (~17,9 M px) para la barra de desplazamiento con el total real si se incluyen DLC. → Puntos de corte < 768 / 768–1279 / ≥ 1280 px, y escalado de la barra cuando total × altura de fila supere ~15 M px (1,3 × 10⁵ filas × 72 px ≈ 9,4 M px sí cabe).
> - [low] Formatos Intl incompletos. En es-ES, month long con year numeric da «noviembre de 2026» en minúscula, dateStyle short da «28/10/26» y no existe formato de trimestre. El resto de los ejemplos es correcto (verificado con Node 24.21, ICU 78.3 y CLDR 48). → Opciones explícitas, mayúscula inicial añadida en código y trimestres escritos a mano, todo documentado en §9.
> - [low] Español y leyenda poco claros. «No encontramos» y «No encontramos ese perfil» (en España se dice «No hemos encontrado»). «Vamos demasiado rápido» no explica nada. «Marcador» se usa tanto para el icono como para la imagen provisional. «Región aria-live educada» es un calco. «Colapso» suena a fallo. «¡Ya disponible!» contradice «sin exclamaciones». En los wireframes, (o) es a la vez sincronización y radio elegido, y [x] es casilla marcada y botón de cerrar. → Microcopy reescrito en pretérito perfecto; «marcapáginas» para el icono y «portada provisional» para la imagen; aria-live=polite; «plegado»; sin exclamaciones. La leyenda usa (s) para el guardado, [Cerrar] para cerrar y [[…]] para la opción elegida.

> Números corregidos: Recalculé con la fórmula WCAG todos los contrastes del borrador y coinciden: 14,45/17,30; 7,61/6,31; 7,10/5,48; 3,80/3,74; botón 7,10/5,87; texto blanco sobre negro al 60 % encima de blanco 5,74; chips sobre --surface de 5,26 a 7,16 (oscuro) y de 4,76 a 5,54 (claro). Cifras nuevas que no estaban en el borrador: chips del tema claro con fondo translúcido sobre --surface-2 → 4,35 (Quiero jugar), 4,27 (En pausa) y 4,25 (Abandonado), que no llegan a 4,5:1; sobre --bg → 4,48 y 4,46. Con fondo opaco se mantienen los valores verificados; los tokens propuestos son #213345/#E2ECF8, #1D3833/#E2EEE8, #3B3027/#F4EAE0, #2F2F45/#EDE8F8, #2B3139/#ECEDEF, #38362B/#EFEBE0 y #2D323A/#EBECEE. Foco sobre --surface: 6,49/5,87. --text-muted sobre --surface-2: 6,80/5,57. --control-border sobre --surface-2: 3,39/3,30. Colores de estado sin chip: ≥ 6,19 en oscuro y ≥ 4,93 en claro, también sobre --surface-2. Intl es-ES (Node 24.21.0, ICU 78.3, CLDR 48): «1234», «12.345», «123.456», «100 %», «29,99 €», «28 oct 2026», «4 sept 2026», «vie, 30 oct», «jue, 19 nov 2026», «pasado mañana», «dentro de 22 días» y «hace 2 horas» salen correctos; month long da «noviembre de 2026» en minúscula y dateStyle short da «28/10/26». Calendario: el 28 oct 2026 es miércoles, el 26 oct lunes, el 30 oct viernes y el 19 nov jueves, a 22 días; todo cuadra. Prueba de velocidad nueva, hecha hoy en el PC de desarrollo con Node 24 en un solo hilo: escaneo lineal por prefijos de palabra sobre 140.000 títulos sintéticos → p50 7,7 ms, p95 10,7 ms, máximo 12,4 ms; construcción del índice normalizado 95 ms; consultas que reutilizan los candidatos del prefijo anterior, de 0,4 a 1,2 ms. El tamaño del índice (4–7 MB sin comprimir, ~1–2 MB comprimido) es una estimación aritmética, no una medida. Altura del desplazamiento: 130.000 × 72 px = 9,36 M px; 300.000 × 72 px = 21,6 M px.

---

## T1 · UX e interacción orientada a la velocidad

> **Objetivo del track.** Que *apuntar un juego que quiero jugar* cueste **≤ 3 s en la mediana** desde cualquier pantalla (en escritorio, `Ctrl + K` → 3–5 letras → `Intro`; en móvil, 1 toque → 3–5 letras → 1 toque) y que cambiar estado, revisar la lista y explorar **todo** el catálogo de juegos de Steam respondan en menos de 100 ms.
>
> **Convenciones**
> - **[P0]** entra en el prototipo · **[P1]** siguiente iteración, cuando P0 esté cerrado y medido · **[P2]** fuera del prototipo. Lo que no lleva etiqueta es P0.
> - **[Supuesto]** depende de los tracks paralelos (API de Steam, legal/ToS, arquitectura); §11 dice qué pasa si no se cumple. El diseño no depende de la tecnología salvo donde se indica.
> - Teclas con su nombre en el teclado español: `Intro`, `Mayús`, `Supr`, `Retroceso`, `Esc`, `Inicio`, `Fin`, `Re Pág`, `Av Pág`. En macOS, `Ctrl` → `⌘` y `Alt` → `⌥`.
> - Ejemplos: fecha de referencia **miércoles 28 oct 2026**; títulos reales con datos ilustrativos; «(ej.)» marca los títulos inventados; los recuentos («123.456 juegos») son de ejemplo.

### 0. Alcance del prototipo

Un único desarrollador, en Windows, con Node 24 y Rust y sin Docker. El P0 cubre los cuatro requisitos del usuario (apuntar rápido, estados, rapidez y todo el catálogo de Steam) y nada más.

| Área | P0 · prototipo | P1 · siguiente iteración | P2 · después |
|---|---|---|---|
| Captura | Paleta `Ctrl + K` / `/`; barra y hoja en móvil; `Intro` añade; `Ctrl + Intro` en ráfaga; `Mayús + Intro` abre la ficha; pegar un enlace de Steam; alta manual | `Alt + Intro` (más acciones); soltar un enlace arrastrado; acceso directo en el icono (PWA) | «Compartir → GameAgenda» (Web Share Target); atajo global del sistema (si hay app de escritorio) |
| Búsqueda | Índice local de todos los juegos (§3a.5); normalización; alias manuales; orden por rango + popularidad; conjunto de referencia | Erratas; siglas automáticas | Búsqueda remota (solo si se descarta el índice completo) |
| Estados | 5 estados + Comprado + Platinado / 100 %; teclas `1`–`5`, `C`, `P`; menú y hoja de estado; Deshacer | Gestos de deslizamiento; pulsación larga; selección múltiple | — |
| Mi lista | Vista Pendientes; chips con contador; 4 órdenes; prioridad (asa, `Alt + ↑/↓`, menú); filtro de texto | Densidad Compacta; rehacer | — |
| Catálogo | Lista virtualizada con contador; filtro de texto; Tipo; Lanzamiento; Ocultar los de mi lista; 4 órdenes | Cuadrícula de portadas; filtros Steam Deck y Sistema | Géneros, idiomas, valoración |
| Ficha | Datos básicos, estado, marcas, plataforma, prioridad, nota, «Ver en Steam» | Capturas; `J`/`K` entre fichas; precarga por intención | — |
| Fechas | Fecha de lanzamiento en las filas; orden «Lanzamiento» | Pestaña Próximos | Calendario .ics; avisos de lanzamiento; historial de fechas |
| Datos | Guardado local; exportar e importar JSON; `navigator.storage.persist()` | Cuenta y sincronización; importar de Steam | Caché propia de portadas; proxy de miniaturas |
| Base | Tema según el sistema; foco y contraste AA; `prefers-reduced-motion`; *service worker* básico si es web | Duración de los avisos configurable | Telemetría más allá del registro local |

### 1. Principios y objetivos medibles

**Principios**
1. **Capturar primero.** Apuntar siempre está a un atajo o a un toque de distancia, en todas las pantallas. Sin registro previo, sin pantallas intermedias y sin formularios en el caso normal.
2. **Local primero.** Cada acción se pinta en el mismo fotograma desde memoria y se guarda en el dispositivo justo después (en segundo plano, < 100 ms). La interfaz nunca espera a la red.
3. **Deshacer en vez de confirmar.** Sin diálogos «¿Seguro?». Todo se deshace desde el aviso; después, con `Ctrl + Z` en escritorio o con «Deshacer último cambio» del menú `[...]` en móvil.
4. **Predecible.** `Intro` hace siempre lo que dice la pista visible y su comportamiento no se configura. Los resultados no se reordenan bajo el cursor. Un número escrito busca títulos; solo un enlace o un número pegado se tratan como appid.
5. **Teclado en escritorio, pulgar en móvil.** Toda acción tiene un control visible; las frecuentes, además, un atajo.
6. **Mínimo.** Una acción principal por pantalla. La portada es el único elemento visual protagonista.
7. **Nunca solo color.** Cada estado se muestra con color, icono y texto.

**Presupuestos (criterios de aceptación del prototipo)**

| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| `Ctrl + K` → paleta abierta con el foco en el campo | < 50 ms | `performance.mark` del `keydown` al primer fotograma; el código de la paleta se carga tras el primer render, nunca al pulsar |
| Resultados por pulsación | < 50 ms p95 | Conjunto de referencia (§3a.4) ejecutado en el worker; Chrome con la CPU ralentizada 4× como aproximación a un móvil de gama media |
| Índice listo tras un arranque en caliente (desde el almacenamiento local) | ≤ 1 s en escritorio · ≤ 3 s en móvil | Marca «índice listo» en el worker; mientras tanto, la paleta busca en Mi lista |
| Respuesta visual de cualquier acción (añadir, estado, marca, reordenar) | < 100 ms; INP ≤ 200 ms | Librería `web-vitals` registrando en la consola durante las pruebas |
| Arranque en caliente → Mi lista usable | < 1 s | Marca «lista pintada» |
| Primera visita, 4G, móvil de gama media | LCP ≤ 2,5 s · CLS ≤ 0,1, con la descarga del índice en curso | Lighthouse, perfil móvil |
| Tiempo de captura (abrir la paleta → juego añadido) | Mediana ≤ 3 s · ninguna > 5 s | Prueba guiada: 5 personas × 10 juegos dictados, cronometrada |
| Acierto a la primera | Conjunto de referencia: ≥ 90 % en 1.ª posición y 100 % entre las 3 primeras · Prueba guiada: ≥ 80 % sin flechas ni Deshacer | Test de Node en cada cambio del índice o del orden, más la prueba guiada |
| Diálogos de confirmación en los flujos normales | 0 | Revisión |

Recorrido de referencia (escritorio): 0 s `Ctrl + K` · 0,05 s paleta lista · 0,3–1,5 s escribir `hade` (resultados en cada tecla) · ~2 s `Intro` · aviso «Añadido» en el mismo fotograma.

### 2. Modelo de interacción: un estado y dos marcas

Lo excluyente va separado de lo que no lo es. Así no hay combinaciones absurdas y cada cambio cuesta un solo toque.

**Estado (exclusivo: toda entrada de Mi lista tiene uno)**

| Estado | Icono | Significado | Acción rápida «siguiente» |
|---|---|---|---|
| Quiero jugar (por defecto al apuntar) | marcapáginas | Está en la agenda y aún no lo he empezado | `Empezar` → Jugando |
| Jugando | *play* | En curso | `Completar` → Completado |
| En pausa | pausa | Empezado y aparcado | `Reanudar` → Jugando |
| Completado | círculo con *check* | Terminado | `Platinar` (activa la marca Platinado) |
| Abandonado | círculo tachado | No lo voy a terminar; se conserva el historial | `Retomar` → Jugando |

**Marcas (independientes; funcionan como interruptores)**
- **Comprado** (icono de bolsa): lo tengo, ya sea comprado, regalado o gratuito. «Quiero jugar» sin Comprado equivale a una lista de deseos, así que no hace falta un estado aparte.
- **Platinado / 100 %** (icono de trofeo): todos los trofeos o logros.
  - Al activarla, si el estado no es Completado, pasa a Completado. El aviso lo explica (*Platinado. También lo hemos marcado como Completado · Deshacer*) y un solo Deshacer revierte las dos cosas.
  - Después, el estado se puede cambiar con libertad (p. ej. rejugar → Jugando) y la marca se conserva: es un logro ya conseguido.
  - Desactivarla no cambia el estado.

**Campos de apoyo**
- **Prioridad:** orden manual, solo dentro de Quiero jugar.
- **Nota** libre (hasta 500 caracteres).
- **Juego en** (opcional, en cualquier entrada): PC · PlayStation · Xbox · Switch · Otra. Por defecto, PC en los juegos del catálogo de Steam y la última usada en los manuales. Así un juego del catálogo se puede apuntar para jugarlo (y platinarlo) en PlayStation.
- **Fechas** automáticas de alta, inicio y fin, editables en la ficha.

**Qué guarda cada entrada para pintarse sin red** **[Supuesto: el esquema lo fija arquitectura]**: `appid` (o un id local si es manual); una copia del nombre, de la fecha de lanzamiento y del nombre de archivo de la portada; y además estado, marcas, prioridad, plataforma, nota y fechas. La copia se refresca cuando hay conexión.

**Reglas**
- Los juegos nuevos entran **al final** de Quiero jugar, como en una libreta. «Mover al principio» está en el menú `[...]` de la fila y en la ficha.
- La primera vez que pasa a Jugando se guarda la fecha de inicio; al pasar a Completado, la de fin (si se vuelve a completar, se actualiza).
- «Quitar de mi lista» borra la entrada (con Deshacer). «Abandonado» la conserva.
- **Si una acción saca el juego de la vista o lo cambia de sección** (p. ej. Quiero jugar → Jugando en la vista Pendientes): la fila se pliega en 150 ms (sin animación con movimiento reducido), el foco pasa a la fila siguiente de la misma sección (o a la anterior si era la última) y el aviso dice adónde ha ido: *Hollow Knight: Silksong pasa a Jugando · Deshacer*. Si la nueva posición está a la vista, la fila se resalta allí un momento. **[P1]** Plegado diferido, solo si las pruebas muestran clics erróneos.
- **[P1] «Por clasificar»** (importación, §3g) es una bandeja **fuera** de Mi lista: sus juegos no tienen estado hasta que se clasifican.

### 3. Flujos de usuario con recuento de pasos

**Resumen**

| Flujo | Escritorio · teclado | Escritorio · ratón | Móvil | Objetivo | Prioridad |
|---|---|---|---|---|---|
| (a) Apuntar desde el catálogo de Steam | `Ctrl+K` + 3–5 letras + `Intro` = 5–7 pulsaciones | 2 clics + letras | 2 toques + letras | Mediana ≤ 3 s | P0 |
| (a') Apuntar pegando un enlace de Steam | `Ctrl+K`, `Ctrl+V`, `Intro` = 3 | 2 clics + pegar | 2 toques + pegar | ≤ 2 s | P0 |
| (b) Avanzar al estado siguiente | 1 tecla con la fila enfocada | 1 clic (acción rápida) | 2 toques (icono → estado) · P1: 1 deslizamiento | < 1 s | P0 |
| (b) Cualquier otro estado | 1 tecla (`1`–`5`) | 2 clics (chip → estado) | 2 toques | < 2 s | P0 |
| (b) Marca Comprado / Platinado | 1 tecla (`C` / `P`) | 1 clic | 2 toques (icono → marca) · 1 toque en la ficha | < 1 s | P0 |
| (c) Filtrar por estado | 1 clic en un chip | 1 clic | 1 toque | — | P0 |
| (c) Ordenar | 2 clics | 2 clics | 2 toques | — | P0 |
| (c) Cambiar la prioridad | `Alt + ↑/↓` | 1 arrastre | 1 arrastre o Subir/Bajar en la ficha | — | P0 |
| (d) Explorar el catálogo y añadir | `G` `C` + `/` o filtros + `A` | 1 clic + filtros + 1 clic | 1 toque + filtros + 1 toque | — | P0 |
| (e) Abrir la ficha | `Intro` (lista) · `Mayús+Intro` (paleta) | 1 clic | 1 toque | < 300 ms percibidos | P0 |
| (f) Añadir a mano | `Ctrl+K` + título + `Intro` (sin resultados) o `↑` + `Intro` (con resultados) + `Intro` en el diálogo | 3 clics + título | 3 toques + título | ≤ 5 s | P0 |
| (g) Importar de Steam | ~5 pasos + inicio de sesión con Steam | Igual | Igual | Una sola vez | P1 |
| (h) Ver próximos lanzamientos | `G` `P` | 1 clic | 1 toque | — | P1 |

#### (a) Capturar: buscar en todo Steam y añadir a Quiero jugar

**(a.1) Escritorio con teclado (6 pulsaciones típicas)**
1. `Ctrl + K` (o `/` fuera de un campo de texto) desde cualquier pantalla. La paleta se abre con el foco en el campo. Si está vacía, muestra «Recientes» (últimos juegos apuntados o abiertos) y unas pocas acciones (W2b).
2. Escribir `hade`. Hay resultados en cada pulsación y el primero queda resaltado con la pista «Intro: Añadir».
3. `Intro`. El juego entra al final de Quiero jugar, la paleta se cierra, el foco vuelve exactamente a donde estaba y aparece *Añadido a Quiero jugar: Hades II · Deshacer*.

*Variantes dentro de la paleta*
- `Ctrl + Intro`: **añadir y seguir apuntando**. El campo se vacía; sirve para apuntar en ráfaga durante un directo de anuncios. Sobre la fila «Añadir «…» manualmente», crea la entrada con los valores por defecto sin abrir el diálogo.
- `Mayús + Intro`: abrir la ficha sin añadir.
- `↑` desde el primer resultado salta a la última fila, «Añadir «…» manualmente».
- **[P1]** `Alt + Intro`: menú de acciones del resultado (añadir como Jugando o Completado, añadir con Comprado, añadir al principio, abrir en Steam). Si el juego ya está en la lista, el mismo menú cambia su estado. Dentro, `1`–`5` eligen el estado.
- **Enlaces.** Pegar un enlace de Steam da un único resultado exacto y basta con `Intro`. Se reconocen `store.steampowered.com/app/<appid>`, `steamcommunity.com/app/<appid>`, `steam://store/<appid>` y `steamdb.info/app/<appid>`; también el enlace corto que comparte la app móvil de Steam **[Supuesto: formato exacto, track de API]**.
- **Números.** Un número **escrito** busca títulos («1942», «2077»). Solo se interpreta como appid si se **pega** solo o si lleva `#` delante (`#1145360`). Así «2077» encuentra Cyberpunk 2077 y no el juego cuyo appid sea 2077.
- **[P1]** Soltar sobre la ventana un enlace de Steam arrastrado también lo añade, con Deshacer.

*Escritorio con ratón*
- Clic en «Apunta un juego…» de la cabecera, escribir y clic en el resultado: 2 clics.
- Clic en la fila = `Intro`. El botón `(i)`, visible al pasar el ratón, abre la ficha.

**(a.2) Móvil (2 toques + letras)**
1. Toque en la barra «Apunta un juego…», fija sobre las pestañas en Mi lista y Próximos. En Catálogo, esa barra filtra el catálogo y cada fila tiene `(+)`. En Ficha y Ajustes, el botón `(+)` de la cabecera abre la misma hoja. Se abre la hoja de captura con el teclado activo (M3).
2. Escribir 3–5 letras.
3. Toque en la fila o en `(+)`: el juego se añade, la hoja se cierra y aparece el aviso. Con «Seguir apuntando» activado (se recuerda), la hoja sigue abierta. `(i)` abre la ficha.

*Requisitos del campo de captura (sin ellos falla el flujo principal)*
- **Teclado en iOS.** La hoja y su campo están siempre montados (fuera de la pantalla con `transform`, nunca con `display: none`) y `focus()` se llama de forma síncrona en el gestor del toque. Si el campo se crea después (render diferido), iOS no abre el teclado.
- **Atributos:** `type="search"`, `enterkeyhint="go"` (tecla «Ir»), `autocomplete="off"`, `autocorrect="off"`, `autocapitalize="off"` y `spellcheck="false"`. Sin ellos, el teclado móvil «corrige» nombres de juegos («hade» → «hace») y cambia los resultados justo antes del toque.
- **Sin zoom automático en iOS:** tamaño de letra del campo ≥ 16 px.

**(a.3) Accesos desde fuera de la app** **[Supuesto S6: app web instalable (PWA); lo decide arquitectura]**
- **[P1]** Acceso directo «Apuntar juego» en el icono de la app (`shortcuts` del manifiesto): Android y Chromium de escritorio; en Windows aparece en la lista de saltos de la barra de tareas. Abre `?apuntar`.
- **[P2]** «Compartir → GameAgenda» (Web Share Target) desde la app o la web de Steam: Android con Chrome o Edge y la app instalada; no en iOS; en escritorio depende del navegador.
- **[P2]** Si el producto se empaqueta como app de escritorio (p. ej. Tauri), un atajo global del sistema puede abrir la captura con la app en segundo plano.

**(a.4) Reglas de búsqueda para acertar a la primera** (son parte de la UX, no solo del backend)
- **Normalización** (igual en el índice y en la consulta):
  - Minúsculas, sin tildes ni diacríticos: `okami` → ŌKAMI HD; `brutal legend` → Brütal Legend.
  - Se ignoran ™, ®, `:`, `-`, `'` y `.`: `nier automata` → NieR:Automata™.
  - Los artículos iniciales (The, A, An, El, La, Los, Las) no cuentan para el prefijo del título: `witcher` es prefijo de «The Witcher 3: Wild Hunt».
  - `&` equivale a `and` y a `y`.
- **Números y romanos.** Se indexan **las dos formas**, sin sustituir una por otra: `final fantasy 7` y `final fantasy vii` encuentran FINAL FANTASY VII. Se convierten los romanos de II a XX cuando forman una palabra completa, salvo «X» (Mega Man X no es «Mega Man 10»); «I» tampoco se convierte (I Am Bread). Esos casos se cubren con alias (`ff10`).
- **Alias.** Tabla manual de ~100 títulos populares (`gta 5`, `bg3`, `rdr2`, `ff7`, `re4`, `kcd2`, `p5r`…). **[P1]** Siglas generadas a partir de las iniciales, siempre en el rango más bajo.
- **[P1] Erratas.** A partir de 5 letras se tolera una (distancia de edición 1), solo si no hay coincidencias de un rango superior.
- **Orden.** Puntuación = peso del rango de coincidencia (exacta > prefijo del título > prefijo de palabra > alias o siglas > errata) + log(popularidad) **[Supuesto S2: hay una señal de popularidad, p. ej. el número de reseñas]**. Los pesos se ajustan con el conjunto de referencia: un título muy popular puede adelantar a uno minoritario del rango inmediatamente superior, nunca a una coincidencia exacta. En caso de empate, el más reciente.
- **Lo ya apuntado va detrás.** Dentro de su rango, los juegos que ya están en Mi lista van después de los que no (la paleta sirve sobre todo para apuntar). Aparecen marcados («En tu lista: Completado») y sobre ellos `Intro` abre la ficha. Así `hade` da primero Hades II, aunque Hades sea más popular y ya esté completado.
- **Qué se muestra.** Por defecto, solo **juegos** (sin DLC, bandas sonoras, demos, herramientas ni vídeos) y sin contenido solo para adultos; las dos cosas se cambian en Ajustes **[Supuesto S3]**. Los juegos aún no publicados sí aparecen.
- **Sin duplicados ni acciones mezcladas.** Una sola lista ordenada, sin grupos. Las acciones solo aparecen con el campo vacío (W2b), para que `Intro` nunca ejecute una acción por error. Repetir `Ctrl + Intro` sobre un juego ya apuntado muestra *Ya está en tu lista (Quiero jugar) · Abrir*.
- **Alta manual siempre a mano.** Se muestran como máximo 8 resultados. Debajo, «Ver los N resultados en el Catálogo» y, en la última fila, siempre «Añadir «…» manualmente»; si no hay resultados, es la única fila y queda resaltada.
- **Conjunto de referencia.** ~50 consultas reales con su appid esperado (títulos populares, siglas, con tildes, con artículo, con números, juegos aún no publicados), en un test de Node que se ejecuta con cada cambio del índice o del orden. Mide el acierto a la primera de §1.

**(a.5) Índice local del catálogo** **[Supuesto S1: lo decide arquitectura]**
- **Opción A (recomendada para el prototipo): índice de todos los juegos en el cliente**, buscado en un Web Worker.
  - Campos: appid, nombre, año o «próximamente», tipo, contenido para adultos sí/no y popularidad (implícita en el orden del fichero). **[P1]** Un byte más con sistemas y Steam Deck, para los filtros.
  - Tamaño estimado: N ≈ 1,2–1,5 × 10⁵ juegos **[Supuesto: la cifra real la da el track de API]** × 35–45 bytes por registro ≈ 4–7 MB sin comprimir, del orden de 1–2 MB con Brotli o gzip. Hay que medirlo con el catálogo real.
  - Lo genera el job programado como fichero estático versionado. El cliente lo guarda en IndexedDB o Cache Storage y solo lo vuelve a descargar si cambia la versión (**[P1]** por diferencias).
  - Ventajas: búsqueda y catálogo sin red, sin backend de búsqueda y sin gastar cuota de la API de Steam en cada pulsación.
- **Comprobación hecha hoy (28 oct 2026).** Escaneo lineal de 140.000 títulos sintéticos con Node 24, en un hilo y en el PC de desarrollo: p50 ≈ 8 ms y p95 ≈ 11 ms por consulta; reutilizando los candidatos del prefijo anterior (`ha` → `had` → `hade`), menos de 2 ms. En un móvil de gama media cabe esperar entre 4 y 6 veces más (≈ 45–65 ms en la primera consulta), así que bastan el escaneo lineal y la reutilización. Un índice por prefijos de palabra solo hace falta si la medida en un móvil real supera los 50 ms.
- **Primera visita.** La descarga empieza tras el primer render y no bloquea nada. Si se abre la paleta antes de que termine, busca en Mi lista y muestra «Preparando el catálogo de Steam… 40 %»; los resultados del catálogo aparecen solos al terminar, debajo de los de Mi lista. Con Ahorro de datos (`navigator.connection.saveData`, solo Chromium) se pregunta antes: *Catálogo para buscar sin conexión: 1,6 MB (ej.) · Descargar*.
- **Lo que no está en el índice** (portada, desarrollador) se pide por lotes y solo para los resultados visibles **[Supuesto S8]**. Su hueco está reservado (portada provisional y línea de metadatos de altura fija), así que nada se mueve cuando llega.
- **Opción B (respaldo).** Índice local de los ~10.000 juegos más populares y búsqueda remota del resto: p95 < 300 ms, *debounce* de 120–150 ms, cancelación con `AbortController` y caché LRU por consulta. Los resultados remotos se añaden siempre **debajo** de los ya mostrados y nunca cambian la fila resaltada. Sin conexión, solo se encuentran los populares.

**(a.6) Estabilidad e `Intro` anticipado**
- Con la opción A, los resultados de cada pulsación están completos: no hay llegadas tardías que reordenen la lista.
- Si `Intro` llega antes que los resultados del texto final (worker ocupado, índice cargando u opción B), la app espera hasta 500 ms:
  - si hay una coincidencia exacta o un único prefijo claro, lo añade;
  - si no, muestra los resultados, no añade nada y la pista cambia a «Elige un resultado».

#### (b) Cambiar estado y marcas

*Escritorio*
- Al pasar el ratón o enfocar una fila aparecen sus acciones rápidas: `[Siguiente estado]` (Empezar / Completar / Reanudar / Retomar / Platinar), `[Comprado]`, `[Platinado]` y `[...]`: **1 clic**. No dependen del *hover*: aparecen también con el foco del teclado y están en el menú `[...]`.
- Con la fila enfocada: `1`–`5` fijan el estado, `C` alterna Comprado y `P` alterna Platinado: **1 tecla**.
- Clic en el chip de estado → menú con los 5 estados y el actual marcado: **2 clics**.
- Desde cualquier pantalla, sin ir a la lista: `Ctrl + K`, escribir, `Intro` (si el juego ya está en la lista, abre la ficha) y `4` (Completado). **[P1]** `Alt + Intro` y `4`.

*Móvil*
- Toque en el icono de estado de la fila (botón de 44 × 44 px) → hoja con los 5 estados y las 2 marcas: **2 toques**. En la ficha, todo cuesta 1 toque.
- **«Deshacer último cambio»** en el menú `[...]` de la cabecera, porque en táctil no hay `Ctrl + Z`.
- **[P1]** Deslizar a la derecha = avanzar estado (el fondo muestra qué va a pasar: «Empezar», «Completar»…); a la izquierda revela `[Comprado] [Platinado] [Más]`. No hay «deslizamiento largo para quitar»: es fácil de disparar sin querer y quitar ya está en `[...]`.
- **[P1]** Mantener pulsada la fila abre el menú contextual completo: estados, marcas, mover y quitar.

*En todos los casos*
- Respuesta optimista en < 100 ms y aviso con Deshacer.
- Anuncio para el lector de pantalla (p. ej. «Hollow Knight: Silksong: Jugando»).
- Los efectos automáticos (fechas; Platinado ⇒ Completado) se deshacen en el mismo paso.

**[P1] Selección múltiple:** `X` o `Mayús + clic`; en móvil, mantener pulsado → «Seleccionar». Barra de acciones: «Cambiar estado», «Marcar comprado», «Quitar». Un único aviso para el lote: *3 juegos movidos a Completado · Deshacer*.

#### (c) Revisar mi lista: filtrar, ordenar y priorizar

- **Vista por defecto «Pendientes».** Jugando arriba («Jugando ahora»), después Quiero jugar por prioridad y En pausa plegado al final. Chips con contador: Pendientes · Quiero jugar · Jugando · En pausa · Completado · Abandonado · Todos (los que no caben, en «Más»).
- **Filtros**
  - Compra: Todos · Comprados · Sin comprar, en un control segmentado (no se pueden elegir a la vez dos opciones contradictorias).
  - Platinado.
  - Plataforma, solo si hay más de una en uso.
  - «Filtrar lista…» filtra por texto, en vivo y en local.
- **Orden.** Prioridad (manual, por defecto) · Fecha de alta (recientes primero) · Lanzamiento (próximos primero) · Nombre (A–Z). En Lanzamiento, una fecha aproximada («T1 2027») cuenta como el último día de su periodo y «Sin fecha» va al final; Próximos usa el mismo criterio (§3h).
- **Secciones.** Solo con orden por Prioridad. Con cualquier otro orden, la lista es plana.
- **Reordenar la prioridad** (solo con orden por Prioridad y dentro de Quiero jugar):
  - Asa `::` para arrastrar, en escritorio y en móvil.
  - `Alt + ↑/↓` mueve una posición.
  - Menú `[...]` y ficha: «Mover al principio», «Mover al final», Subir y Bajar. Principio y final no tienen atajo propio: `Alt + Inicio` abre la página de inicio del navegador y `Alt + Mayús` es el atajo de Windows para cambiar el idioma de entrada cuando hay varios instalados.
  - Se anuncia la nueva posición: «Hollow Knight: Silksong, posición 1 de 28».
  - Si se intenta arrastrar con otro orden: *Cambia a Orden: Prioridad para reordenar*.
  - **[Supuesto de arquitectura]** La prioridad se guarda como clave fraccionaria, para no renumerar toda la lista (útil al sincronizar).
- **Memoria.** El filtro y el orden van en la URL (`?estado=…&orden=…`; funcionan el botón atrás y los marcadores del navegador) y se recuerdan entre sesiones.

#### (d) Explorar todo el catálogo de Steam

- **Entrada:** `G` y luego `C`, clic en «Catálogo» o la pestaña en móvil.
- **Contador** en la cabecera: «123.456 juegos» y, con filtros, «· 2.310 con estos filtros», con formato es-ES. Cuenta lo que se puede mostrar con los ajustes actuales (por defecto, sin DLC ni contenido para adultos); un *tooltip* explica qué se excluye. Se anuncia con `aria-live="polite"` y unos 500 ms de retardo.
- **«Filtrar el catálogo…»** (`/` en esta pantalla) filtra la lista con los filtros activos. No añade con `Intro`; para eso están la paleta y el botón `(+)`. Así los dos campos tienen nombres y funciones distintos.
- **Exploración rápida (1 clic):** Populares · Próximamente · Recién salidos · **[P1]** Steam Deck verificado.
- **Filtros**
  - P0: Tipo (Juegos por defecto; opción de incluir DLC y demos) · Lanzamiento (ya disponibles, próximamente o rango de años) · Ocultar los que ya están en mi lista.
  - **[P1]** Steam Deck (Verificado / Jugable) · Sistema (Windows / macOS / Linux).
  - **[P2]** Géneros o etiquetas, «Disponible en español» y valoración **[Supuesto S3]**.
- **Orden:** popularidad (por defecto, sin texto) · relevancia (con texto) · lanzamiento (recientes o próximos) · nombre (A–Z).
- **Vista:** lista (P0, la más densa) · **[P1]** cuadrícula de portadas 2:3 (W3b). Cada fila o tarjeta tiene `(+)` (1 clic o toque); si el juego ya está en la lista, muestra su estado.
- **Desplazamiento virtualizado**
  - Altura de fila fija y barra de desplazamiento con el total real. Con la opción A, el total, el filtro y el orden salen del índice local: no hace falta paginar en el servidor.
  - Las filas se pintan al instante con nombre y año (del índice). Portada y desarrollador llegan por lotes de ~50 appids de las filas visibles, en huecos reservados (`~~~`).
  - Límite del navegador: 1,3 × 10⁵ filas de 72 px son ~9,4 millones de px, por debajo del máximo de Firefox (~17,9 M px). Si al incluir DLC y demos se supera, se escala la barra.
  - Al volver de la ficha se restauran la posición y el foco. Botón «Ir arriba».
- **Móvil:** filtros en una hoja inferior con el botón «Ver 2.310 resultados», que se actualiza con cada filtro (M5).

#### (e) Ficha de juego

- **Presentación** (puntos de corte en §4): panel lateral con la lista visible desde 1280 px; panel superpuesto entre 768 y 1279 px; pantalla completa con «atrás» por debajo de 768 px. `Esc` cierra y devuelve el foco a la fila. **[P1]** `[<]`/`[>]` o `J`/`K` pasan al juego anterior o siguiente.
- **Datos (W4, M6):** portada 2:3, título, desarrollador y editor, fecha de lanzamiento (o «Próximamente» con cuenta atrás), sistemas y compatibilidad con Steam Deck.
- **Controles:** estado (control segmentado), Comprado, Platinado / 100 %, Juego en, prioridad (Subir, Bajar, Mover al principio), nota con autoguardado y fechas.
- **Enlaces:** «Ver en Steam» (https; en el móvil abre la app de Steam si está instalada) y, en escritorio, «Abrir en la app de Steam» (`steam://store/<appid>`; el navegador pide permiso la primera vez).
- **Contenido diferido:** descripción breve en español y **[P1]** capturas **[Supuesto S8: se obtienen por lotes y en español; `appdetails`, que es de una app por llamada, solo como respaldo]**.
- **Al final:** «Quitar de mi lista». Si el juego no está en la lista, el botón principal es «Añadir a Quiero jugar (Intro)».
- **Apertura instantánea.** Se pinta al momento con lo que guarda la entrada (nombre, portada, estado, fecha); el resto llega con *skeleton*. **[P1]** Precarga por intención (§7), solo desde nuestra caché.

#### (f) Añadir un juego a mano (no está en Steam)

1. En la paleta, elegir «Añadir «…» manualmente»: `Intro` si no hay resultados; `↑` + `Intro` si los hay.
2. Se abre un diálogo mínimo (W7) con el **título ya relleno** y el foco en «Añadir». Campos opcionales:
   - Plataforma: PC · PlayStation · Xbox · Switch · Otra (chips; recuerda la última usada).
   - Estado: Quiero jugar por defecto.
   - Comprado.
   - Lanzamiento: una fecha o «Sin fecha».
   - Nota.
3. `Intro` y queda añadido.

- Si existe un título parecido en tu lista, se avisa sin bloquear: *Parecido en tu lista: …*.
- Los juegos añadidos a mano llevan un distintivo de plataforma. **[P2]** Si más adelante aparecen en Steam, la ficha sugiere «Vincular con Steam».

#### (g) [P1] Importar la biblioteca y la lista de deseos de Steam

**[Supuesto S5: «Iniciar sesión con Steam» (OpenID) solo da el SteamID; la biblioteca y la lista de deseos exigen el perfil y los «Detalles del juego» en público. Los endpoints y sus límites los confirma el track de API.]**

1. *Ajustes › Steam › Conectar con Steam*, o pegar la URL del perfil.
2. Vista previa (W8):
   - Lista de deseos (57) → se añaden a Quiero jugar.
   - Biblioteca (342) → se marcan como Comprado; los que se apunten más tarde ya salen marcados.
   - Qué entra además en la lista: ninguno (solo se marcan los que ya están), los no jugados (0 min) a «Por clasificar» o todos a «Por clasificar».
3. «Importar 175 juegos» lanza un trabajo en segundo plano con progreso no bloqueante. Mientras tanto se puede seguir usando la app.
4. Aviso final: *Importación lista: 57 a Quiero jugar, 118 a Por clasificar y 342 marcados como comprados · Deshacer importación*.
5. Bandeja «Por clasificar» (W8b), fuera de Mi lista y sin estado:
   - Escritorio, una tecla por juego: `1`–`5` asignan el estado, `S` lo salta y `Supr` lo descarta.
   - Móvil: botones equivalentes; deslizar a la derecha = Quiero jugar y a la izquierda = No añadir.

Reimportar fusiona: nunca duplica ni cambia los estados que puso el usuario; solo añade la marca Comprado.

#### (h) [P1] Próximos lanzamientos de los juegos que quiero jugar

- Pestaña «Próximos» con insignia: número de lanzamientos en los próximos 30 días.
- **Grupos (W5):**
  - Ya disponibles: últimos 14 días, con «Ya disponible» y la acción «Empezar».
  - Esta semana.
  - Por meses: «Noviembre de 2026».
  - Fecha aproximada: trimestre, año o el texto que dé Steam, ordenadas por el final de su periodo (el mismo criterio que §3c).
  - Sin fecha.
- **Fechas en español:** relativas («pasado mañana», «dentro de 22 días») y cortas («jue, 19 nov»).
- **Mismas acciones de fila que en Mi lista**, p. ej. marcar Comprado al reservar.
- **[P2]** «Suscribirse al calendario»: enlace .ics personal para Google Calendar u Outlook **[Supuesto: el backend puede servir un feed .ics con token]**.
- **[P2]** Avisos de lanzamiento, pedidos **en contexto** y nunca al abrir la app. Por ejemplo, al apuntar un juego que aún no ha salido: *Sale el 19 nov. ¿Te avisamos ese día? · Avisarme*.
- **[P2]** Distintivo «Fecha cambiada» con la fecha anterior **[Supuesto: el job programado guarda el historial de fechas]**.

### 4. Inventario de pantallas

| ID | Pantalla / componente | Ruta propuesta | Escritorio | Móvil | Wireframe | Prioridad |
|---|---|---|---|---|---|---|
| P1 | **Mi lista** (inicio) | `/` (`?estado=…&orden=…`) | Lista con secciones y captura en la cabecera | Lista con barra de captura fija | W1, M1 | P0 |
| P2 | **Paleta / captura global** | Superposición (`?apuntar`) | Diálogo modal centrado sobre la pantalla actual | Hoja inferior con teclado | W2, W2b, M3 | P0 |
| P3 | **Catálogo de Steam** | `/catalogo` | Lista virtualizada con filtros | Lista y hoja de filtros | W3, M4, M5 | P0 (cuadrícula W3b: P1) |
| P4 | **Ficha** | `/juego/<appid>` · `/juego/m/<id>` (manual) | Panel lateral o superpuesto | Pantalla completa | W4, M6 | P0 |
| P5 | Añadir a mano | Diálogo | Diálogo pequeño | Hoja inferior | W7 | P0 |
| P6 | **Ajustes** | `/ajustes/<sección>` | Dos columnas | Lista de secciones | W6 | P0 (mínimos) |
| P7 | Ayuda de atajos | Superposición (`?`) | Diálogo | — | — | P0 |
| P8 | Próximos | `/proximos` | Lista agrupada por fecha | Igual, en una columna | W5 | P1 |
| P9 | Importar de Steam y «Por clasificar» | `/importar` | Diálogo y bandeja | Pantalla y bandeja | W8, W8b | P1 |
| C1 | Avisos (*toasts*) con Deshacer | — | Abajo a la izquierda | Encima de las barras inferiores | W1 | P0 |
| C2 | Indicador de guardado / sincronización | — | Cabecera, a la derecha | Cabecera | W1, M1 | P0 (sincronización: P1) |
| C3 | Menú contextual / hoja de acciones | — | Menú | Hoja inferior | — | P0 |

**Puntos de corte**
- **< 768 px:** móvil: pestañas abajo, hojas inferiores y ficha a pantalla completa.
- **768–1279 px:** barra lateral reducida a iconos y ficha superpuesta a la lista.
- **≥ 1280 px:** barra lateral, lista y ficha como panel lateral.
- En todos los casos, sin scroll horizontal de la página a 320 px.

**Navegación**
- **Escritorio:** barra lateral mínima (Mi lista · Próximos [P1] · Catálogo · Ajustes) y, en todas las pantallas, la cabecera con «Apunta un juego… Ctrl+K».
- **Móvil:** pestañas abajo (en P0 son tres; Próximos llega en P1). La barra de captura va fija encima en Mi lista y Próximos. En Catálogo, esa barra filtra el catálogo y cada fila tiene `(+)`. En Ficha y Ajustes, el botón `(+)` de la cabecera abre la hoja de captura.

**Secciones de Ajustes**

| Sección | P0 | P1 o posterior |
|---|---|---|
| Apariencia | Tema (Sistema / Claro / Oscuro); movimiento (según el sistema / reducido) | Densidad; ahorro de datos; vista del catálogo |
| Teclado y accesibilidad | Atajos de una tecla activados o no (un solo interruptor) | Duración de los avisos; gestos activados o no |
| Contenido | Incluir DLC y demos; mostrar contenido para adultos | Idioma de las descripciones, con respaldo en inglés |
| Datos | Exportar e importar JSON; borrar mis datos; tamaño del catálogo descargado | Cuenta y sincronización; exportar CSV |
| Steam | — | Conectar, importar y reimportar (P1) |
| Notificaciones | — | Lanzamientos y calendario .ics (P2) |
| Acerca de | Versión, atribución y aviso de no afiliación con Valve **[Supuesto: el texto lo fija el track legal]** | — |

### 5. Wireframes (baja fidelidad: jerarquía y posición, no estilo)

**Leyenda**
- `[img]` portada vertical 2:3 · `(+)` añadir · `(i)` abrir ficha · `::` asa de arrastre · `[...]` menú de acciones · `[[…]]` opción seleccionada · `[Cerrar]` cerrar.
- `(s)` indicador de guardado · `~~~` *skeleton* · `###` acción que se revela al deslizar · `( )` / `(o)` radio sin elegir / elegido · `[ ]` / `[x]` casilla.
- Estados: `(*)` Quiero jugar · `(>)` Jugando · `(||)` En pausa · `(v)` Completado · `(x)` Abandonado.
- Marcas: `[$]` Comprado · `[T]` Platinado / 100 %.
- Datos de ejemplo comunes a todos: Jugando = Clair Obscur: Expedition 33 y Stardew Valley; Quiero jugar = 1. Hollow Knight: Silksong, 2. Nebula Drift (ej.), 3. Baldur's Gate 3; Completado incluye Hades y Elden Ring. Hades II y Cyberpunk 2077 no están en la lista.

#### W1 · Escritorio · Mi lista (pantalla principal)
```text
+--------------------------------------------------------------------------------------------------+
| GameAgenda    [ (+) Apunta un juego...                              Ctrl+K ]        (s) Guardado |
+---------------+----------------------------------------------------------------------------------+
| > Mi lista    | Mi lista                                              Orden: [Prioridad v]   [?] |
|   Próximos  3 | [Pendientes 33] [Quiero jugar 28] [Jugando 2] [En pausa 3] [Completado 8] [Más v]|
|   Catálogo    | Compra: [[Todos]] [Comprados] [Sin comprar]   [ ] Platinado    [Filtrar lista...]|
|   Ajustes     | -------------------------------------------------------------------------------- |
|               | JUGANDO AHORA (2)                                                                |
|               |      [img] Clair Obscur: Expedition 33      (>) Jugando v        [$]             |
|               |            2025 · Sandfall Interactive                                           |
|               |      [img] Stardew Valley                   (>) Jugando v                        |
|               |            2016 · ConcernedApe · Deck: Verificado                                |
|               | QUIERO JUGAR (28) · arrastra o usa Alt+flechas para priorizar                    |
|               | 1 :: [img] Hollow Knight: Silksong         (*) Quiero jugar v                    |
|               |            2025 · Team Cherry   [(>) Empezar] [$ Comprado] [T Platinado] [...]   |
|               | 2 :: [img] Nebula Drift (ej.)              (*) Quiero jugar v                    |
|               |            Sale el jue, 19 nov 2026 · dentro de 22 días                          |
|               | 3 :: [img] Baldur's Gate 3                 (*) Quiero jugar v   [$]              |
|               |            2023 · Larian Studios                                                 |
|               | EN PAUSA (3)                                                           [Mostrar] |
|               |                                                                                  |
| [?] Atajos    | +----------------------------------------------------------------+               |
|               | | Marcado como comprado: Baldur's Gate 3   [Deshacer]   Ctrl+Z   |               |
|               | +----------------------------------------------------------------+               |
+---------------+----------------------------------------------------------------------------------+
```
- La fila 1 tiene el foco: sus acciones rápidas son visibles. Las marcas solo aparecen en la fila cuando están activas.
- El aviso nunca tapa la fila enfocada (`scroll-padding-bottom`).
- La entrada «Próximos» de la barra lateral es P1.

#### W2 · Escritorio · Paleta global (Ctrl+K) con resultados
```text
+--------------------------------------------------------------------------------------------------+
|              +----------------------------------------------------------------------+            |
|              | (+) hade|                                                        Esc |            |
|              |----------------------------------------------------------------------|            |
|              | > [img] Hades II                2025 · Supergiant Games Intro: Añadir|            |
|              |   [img] Hadeon Tactics (ej.)    Próximamente · 2027                  |            |
|              |   [img] Hadeville (ej.)         2024 · Estudio Indie (ej.)           |            |
|              |   [img] Hades                   2020 · En tu lista: (v) Completado   |            |
|              |----------------------------------------------------------------------|            |
|              |   Ver los 14 resultados en el Catálogo                               |            |
|              |   (+) Añadir «hade» manualmente                                      |            |
|              |----------------------------------------------------------------------|            |
|              | Intro añadir · Ctrl+Intro añadir y seguir · Mayús+Intro ficha        |            |
|              | Flechas moverse · Esc cerrar · Alt+Intro más acciones (P1)           |            |
|              +----------------------------------------------------------------------+            |
| (la pantalla actual sigue visible y atenuada detrás; nada se recarga)                            |
+--------------------------------------------------------------------------------------------------+
```
- Hades II va primero aunque Hades sea más popular: Hades ya está en la lista y baja al final de su rango (§3a.4).
- `↑` desde Hades II salta a «Añadir «hade» manualmente».

#### W2b · Escritorio · Paleta vacía (estado inicial)
```text
+--------------------------------------------------------------------------------------------------+
|              +----------------------------------------------------------------------+            |
|              | (+) |                                                            Esc |            |
|              |     Apunta un juego o pega un enlace de Steam                        |            |
|              |----------------------------------------------------------------------|            |
|              | RECIENTES                                                            |            |
|              |   [img] Hollow Knight: Silksong                     (*) Quiero jugar |            |
|              |   [img] Clair Obscur: Expedition 33                      (>) Jugando |            |
|              | ACCIONES (solo con el campo vacío)                                   |            |
|              |   Ir al Catálogo                                                 G C |            |
|              |   Exportar mi lista (JSON)                                           |            |
|              |   Ver atajos de teclado                                            ? |            |
|              +----------------------------------------------------------------------+            |
+--------------------------------------------------------------------------------------------------+
```

#### W3 · Escritorio · Catálogo (lista virtualizada)
```text
+--------------------------------------------------------------------------------------------------+
| GameAgenda    [ (+) Apunta un juego...                              Ctrl+K ]        (s) Guardado |
+---------------+----------------------------------------------------------------------------------+
|   Mi lista    | Catálogo de Steam                                                 123.456 juegos |
|   Próximos  3 | [ Filtrar el catálogo...       / ]       Orden: [Popularidad v]                  |
| > Catálogo    | Explorar: [Populares] [Próximamente] [Recién salidos]                            |
|   Ajustes     | [Tipo: Juegos v] [Lanzamiento: cualquiera v]     [ ] Ocultar los de mi lista     |
|               | -------------------------------------------------------------------------------- |
|               | [img] Baldur's Gate 3        2023 · Larian Studios              (*) Quiero jugar |
|               | [img] Elden Ring             2022 · FromSoftware                  (v) Completado |
|               | [img] Cyberpunk 2077         2020 · CD PROJEKT RED                           (+) |
|               | [img] Hades II               2025 · Supergiant Games                         (+) |
|               | [img] Outer Wilds            2020 · Mobius Digital                           (+) |
|               | [img] ~~~~~~~~~~~~~~~~~~     ~~~~ · ~~~~~~~~~~~~~                            ~~~ |
|               |                                                                      [Ir arriba] |
+---------------+----------------------------------------------------------------------------------+
```
- Nombre y año salen del índice local al instante; portada y desarrollador llegan por lotes a su hueco (`~~~`).
- **[P1]** Selector Lista / Cuadrícula y filtros Steam Deck y Sistema.

#### W3b · [P1] Escritorio · Catálogo en cuadrícula (solo la zona de contenido)
```text
+--------------------------------------------------------------------------------+
| +--------+  +--------+  +--------+  +--------+  +--------+  +--------+         |
| |  2:3   |  |  2:3   |  |  2:3   |  |  2:3   |  |  2:3   |  |  ~~~~  |         |
| |     (*)|  |     (v)|  |     (+)|  |     (+)|  |     (*)|  |  ~~~~  |         |
| +--------+  +--------+  +--------+  +--------+  +--------+  +--------+         |
| Baldur's    Elden Ring  Cyberpunk   Hades II    Silksong    ~~~~~~~~           |
| Gate 3      2022        2077        2025        2025        ~~~~               |
| 2023                    2020                                                   |
+--------------------------------------------------------------------------------+
```

#### W4 · Escritorio · Ficha como panel lateral (≥ 1280 px; la lista sigue visible)
```text
+--------------------------------------------------------------------------------------------------+
| GameAgenda    [ (+) Apunta un juego...                              Ctrl+K ]        (s) Guardado |
+---------------+--------------------------------------+-------------------------------------------+
| > Mi lista    | Mi lista               [Prioridad v] | Ficha                        [Cerrar] Esc |
|   Próximos  3 | [Pendientes 33] [Quiero 28] [Más v]  | +----------+  Hollow Knight: Silksong     |
|   Catálogo    | ------------------------------------ | |          |  Team Cherry                 |
|   Ajustes     | 1 :: [img] Hollow Knight: Sil...   < | |   2:3    |  Lanzado el 4 sept 2025      |
|               | 2 :: [img] Nebula Drift (ej.)        | |          |  Windows · macOS · Linux     |
|               | 3 :: [img] Baldur's Gate 3           | +----------+  Steam Deck: Verificado      |
|               | 4 :: [img] ...                       | Estado                                    |
|               |                                      | [[(*) Quiero jugar]] [(>) Jugando]        |
|               |                                      | [(||) En pausa] [(v) Completado]          |
|               |                                      | [(x) Abandonado]                          |
|               |                                      | [$ Comprado]  [T Platinado / 100 %]       |
|               |                                      | Juego en  [PC v]                          |
|               |                                      | Prioridad 1 de 28   [Subir] [Bajar] [...] |
|               |                                      | Nota [ Jugar después de Hollow Knight ]   |
|               |                                      | Añadido 12 oct 2026 · Empezado - · Fin -  |
|               |                                      | [Ver en Steam] [Abrir en la app de Steam] |
|               |                                      | Descripción                               |
|               |                                      | ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   |
|               |                                      | ~~~~~~~~~~~~~~~~~~~~ (carga diferida)     |
|               |                                      | [Quitar de mi lista]                      |
+---------------+--------------------------------------+-------------------------------------------+
```
- Entre 768 y 1279 px, el mismo panel se superpone a la lista. **[P1]** `[<]`/`[>]` o `J`/`K` para pasar de ficha, y capturas.

#### W5 · [P1] Escritorio · Próximos lanzamientos
```text
+--------------------------------------------------------------------------------------------------+
| GameAgenda    [ (+) Apunta un juego...                              Ctrl+K ]        (s) Guardado |
+---------------+----------------------------------------------------------------------------------+
|   Mi lista    | Próximos lanzamientos de tu lista                                                |
| > Próximos  3 | [Pendientes v]    [x] Incluir fechas aproximadas    [ ] Solo sin comprar         |
|   Catálogo    | -------------------------------------------------------------------------------- |
|   Ajustes     | YA DISPONIBLES (últimos 14 días)                                                 |
|               | lun, 26 oct   [img] Pixel Harbor (ej.)      Ya disponible     [(>) Empezar]  [$] |
|               | ESTA SEMANA                                                                      |
|               | vie, 30 oct   [img] Ember Protocol (ej.)    pasado mañana       (*) Quiero jugar |
|               | NOVIEMBRE DE 2026                                                                |
|               | jue, 19 nov   [img] Nebula Drift (ej.)      dentro de 22 días   (*) Quiero jugar |
|               | FECHA APROXIMADA                                                                 |
|               | T1 2027       [img] Ironwood Saga (ej.)     1.er trim. de 2027  (*) Quiero jugar |
|               | SIN FECHA                                                                        |
|               | -             [img] Hollow Depths (ej.)     Próximamente        (*) Quiero jugar |
+---------------+----------------------------------------------------------------------------------+
```

#### W6 · Escritorio · Ajustes (P0)
```text
+--------------------------------------------------------------------------------------------------+
| GameAgenda    [ (+) Apunta un juego...                              Ctrl+K ]        (s) Guardado |
+---------------+----------------------------------------------------------------------------------+
|   Mi lista    | Ajustes                                                                          |
|   Próximos  3 | > Apariencia         Tema         (o) Sistema   ( ) Claro   ( ) Oscuro           |
|   Catálogo    |   Teclado y acceso.  Movimiento   (o) Según el sistema   ( ) Reducido            |
| > Ajustes     |   Contenido                                                                      |
|               |   Datos                                                                          |
|               |   Acerca de                                                                      |
+---------------+----------------------------------------------------------------------------------+
```

#### W7 · Escritorio · Añadir a mano (diálogo pequeño con el título ya relleno)
```text
+--------------------------------------------------------------------+
| Añadir juego manualmente                                  [Cerrar] |
|                                                                    |
| Título *     [ Leyendas Pokémon: Z-A                     ]         |
| Plataforma   [PC] [PlayStation] [Xbox] [[Switch]] [Otra]           |
| Estado       [(*) Quiero jugar v]        [ ] Comprado              |
| Lanzamiento  [ 16/10/2025 ]  o  [ ] Sin fecha    (opcional)        |
| Nota         [                               ]  (opcional)         |
|                                                                    |
| (!) Parecido en tu lista: «Leyendas Pokémon: Arceus»   [Ver]       |
|                                        [Cancelar]  [Añadir  Intro] |
+--------------------------------------------------------------------+
```
- Ejemplo de juego que no está en Steam: la búsqueda no da resultados en el catálogo y la fila «Añadir manualmente» queda resaltada.

#### W8 · [P1] Importar desde Steam (vista previa antes de importar)
```text
+--------------------------------------------------------------------+
| Importar desde Steam                                      [Cerrar] |
| Perfil: jugador123 (ej.) · conectado con Steam           [Cambiar] |
|                                                                    |
| [x] Lista de deseos (57)  -> se añaden a Quiero jugar              |
| [x] Biblioteca (342)      -> se marcan como Comprado               |
|     ¿Cuáles entran además en tu lista?                             |
|     ( ) Ninguno: solo marcar los que ya están                      |
|     (o) Los no jugados (0 min) a «Por clasificar» (118)            |
|     ( ) Todos a «Por clasificar» (342)                             |
|                                                                    |
| No se cambia ningún estado que ya hayas puesto.                    |
|                                  [Cancelar]  [Importar 175 juegos] |
+--------------------------------------------------------------------+
```

#### W8b · [P1] Bandeja «Por clasificar» (una tecla o un toque por juego)
```text
+--------------------------------------------------------------------+
| Por clasificar · quedan 118                             [Terminar] |
| +--------+  Portal 2                                               |
| |  2:3   |  2011 · Valve                                           |
| |        |  Comprado · 0 min jugados                               |
| +--------+                                                         |
| [1 Quiero jugar] [2 Jugando] [3 En pausa] [4 Completado]           |
| [5 Abandonado]  [S Saltar]  [Supr No añadir]        Ctrl+Z deshace |
+--------------------------------------------------------------------+
```

#### M1 · Móvil · Mi lista (captura siempre visible encima de las pestañas)
```text
+--------------------------------------+
| Mi lista           (s) [...] [Orden] |
| [Pendientes 33] [Quiero 28] [Jug>    |
+--------------------------------------+
| JUGANDO AHORA (2)                    |
| [img] Clair Obscur: Expedi...   (>)  |
|       Jugando · Comprado             |
| [img] Stardew Valley            (>)  |
|       Jugando                        |
| ------------------------------------ |
| QUIERO JUGAR (28)                    |
| [img] Hollow Knight: Silksong   (*)  |
|  1    Quiero jugar                   |
| [img] Nebula Drift (ej.)        (*)  |
|  2    Sale dentro de 22 días         |
| [img] Baldur's Gate 3           (*)  |
|  3    Quiero jugar · Comprado        |
+--------------------------------------+
| [ (+) Apunta un juego...           ] |
+--------------------------------------+
| Mi lista  Próximos  Catálogo  Ajustes|
+--------------------------------------+
```
- Los chips se desplazan en horizontal (y todos están también en «Más»). El icono de estado de cada fila es un botón de 44 × 44 px que abre la hoja de estado y marcas.
- `[...]` incluye «Deshacer último cambio». Las pestañas muestran el estado P1; en P0 no está Próximos.

#### M2 · [P1] Móvil · Gestos de deslizamiento en una fila
```text
Deslizar a la derecha = avanzar estado (Quiero jugar -> Jugando)
+--------------------------------------+
| ##### (>) Empezar ##|[img] Hollow Kn |
+--------------------------------------+

Deslizar a la izquierda = Comprado · Platinado · Más
+--------------------------------------+
| ..Silksong|[$ Comprado][T Plat.][...]|
+--------------------------------------+
```

#### M3 · Móvil · Hoja de captura (se abre con el teclado ya activo)
```text
+--------------------------------------+
| [<]  [ hade|              (borrar) ] |
+--------------------------------------+
| [img] Hades II              (+)  (i) |
|       2025 · Supergiant Games        |
| [img] Hadeon Tactics (ej.)  (+)  (i) |
|       Próximamente · 2027            |
| [img] Hadeville (ej.)       (+)  (i) |
|       2024 · Estudio Indie (ej.)     |
|       ...                            |
| (+) Añadir «hade» manualmente        |
| [ ] Seguir apuntando                 |
+--------------------------------------+
| q  w  e  r  t  y  u  i  o  p         |
|  a  s  d  f  g  h  j  k  l  ñ        |
|    z  x  c  v  b  n  m    [Ir]       |
+--------------------------------------+
```
- Tocar la fila o `(+)` añade; `(i)` abre la ficha; la tecla «Ir» (`enterkeyhint="go"`) equivale a `Intro`.
- Hades (ya en tu lista) queda más abajo, en la zona de `...`.

#### M4 · Móvil · Catálogo (lista)
```text
+--------------------------------------+
| Catálogo                   [Filtros] |
| 123.456 juegos                       |
| [Populares] [Próximamente] [Recién>  |
+--------------------------------------+
| [img] Baldur's Gate 3           (*)  |
|       2023 · Larian Studios          |
| [img] Elden Ring                (v)  |
|       2022 · FromSoftware            |
| [img] Cyberpunk 2077            (+)  |
|       2020 · CD PROJEKT RED          |
| [img] ~~~~~~~~~~~~~~~~          ~~~  |
+--------------------------------------+
| [ Filtrar el catálogo...           ] |
+--------------------------------------+
| Mi lista  Próximos  Catálogo  Ajustes|
+--------------------------------------+
```

#### M5 · Móvil · Hoja de filtros del catálogo
```text
+--------------------------------------+
| Filtros                [Borrar todo] |
| Tipo         [Juegos v]              |
| Lanzamiento  [Próximamente v]        |
| [ ] Ocultar los de mi lista          |
|                                      |
| [       Ver 2.310 resultados       ] |
+--------------------------------------+
```
- **[P1]** Steam Deck y Sistema se añaden a esta hoja.

#### M6 · Móvil · Ficha (pantalla completa)
```text
+--------------------------------------+
| [<] Mi lista              (+)  [...] |
| +--------+  Hollow Knight: Silksong  |
| |  2:3   |  Team Cherry              |
| |        |  4 sept 2025              |
| +--------+  Deck: Verificado         |
| Estado                               |
| [[(*) Quiero]] [(>) Jugando]         |
| [(||) Pausa] [(v) Completado]        |
| [(x) Abandonado]                     |
| [$ Comprado]  [T Platinado / 100 %]  |
| Juego en  [PC v]                     |
| Prioridad 1 de 28    [Subir] [Bajar] |
| Nota [                             ] |
| [Ver en Steam]                       |
| Descripción                          |
| ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~   |
| [Quitar de mi lista]                 |
+--------------------------------------+
```
- `(+)` en la cabecera abre la hoja de captura: apuntar sigue a un toque de distancia también aquí y en Ajustes.

### 6. Teclado, gestos, foco y accesibilidad

#### 6.1 Mapa de atajos (escritorio)

**Globales**

| Atajo | Acción |
|---|---|
| `Ctrl + K` (`⌘K`) | Abrir la paleta. Funciona también dentro de campos de texto |
| `/` | Abrir la paleta (en Catálogo: ir a «Filtrar el catálogo…») |
| `?` | Ver los atajos |
| `G` y luego `L` / `C` / `A` (`P` en P1) | Ir a Mi lista / Catálogo / Ajustes (Próximos) |
| `Ctrl + Z` | Deshacer la última acción, con una pila de 20 (fuera de campos de texto). **[P1]** `Ctrl + Mayús + Z` o `Ctrl + Y` rehacen |
| `Esc` | Cerrar paleta, menú, diálogo o panel y devolver el foco |

**En la paleta**

| Atajo | Acción |
|---|---|
| `↑` `↓` | Moverse por los resultados; `↑` desde el primero va a «Añadir «…» manualmente» |
| `Intro` | Añadir a Quiero jugar (si ya está, abrir la ficha) |
| `Ctrl + Intro` | Añadir y seguir apuntando |
| `Mayús + Intro` | Abrir la ficha sin añadir |
| `Alt + Intro` **[P1]** | Más acciones: otro estado, Comprado, al principio, abrir en Steam |
| `Esc` | Cerrar (si hay un submenú abierto, primero el submenú) |

**Mi lista (con una fila enfocada)**

| Atajo | Acción |
|---|---|
| `↑` `↓` (o `J` `K`) · `Inicio` `Fin` · `Re Pág` `Av Pág` | Moverse entre filas |
| `Tab` | Entrar en los controles de la fila (estado, marcas, menú) |
| `Intro` | Abrir la ficha |
| `1` `2` `3` `4` `5` | Quiero jugar · Jugando · En pausa · Completado · Abandonado |
| `C` · `P` | Alternar Comprado · Platinado / 100 % |
| `Alt + ↑/↓` | Subir o bajar la prioridad una posición |
| `N` | Abrir la ficha con el foco en la nota |
| `Supr` | Quitar de la lista (con Deshacer) |
| `Mayús + F10` o tecla Menú | Menú contextual |
| `X` · `Mayús + ↑/↓` **[P1]** | Seleccionar · ampliar la selección |

**Otras pantallas**
- **Ficha:** `1`–`5`, `C`, `P` y `N` funcionan igual con el foco dentro del panel; `S` abre «Ver en Steam»; `Esc` cierra; **[P1]** `J`/`K` pasan al juego anterior o siguiente.
- **Catálogo (con el foco en la lista):** `↑↓` o `J K` para moverse, `A` o `+` para añadir, `Intro` para la ficha, `/` para filtrar y `F` para los filtros.

**Reglas del sistema de atajos**
- **Teclas sueltas.** `1`–`5`, `C`, `P`, `X`, `N`, `A`, `S` y `F` solo actúan con el foco en una fila, tarjeta o ficha (WCAG 2.1.4, excepción «solo activo con foco»). Las globales de una tecla (`/`, `?`, `G …`) se desactivan con un interruptor en *Ajustes › Teclado*. Para cumplir 2.1.4 basta con poder desactivarlas, así que no se ofrece reasignarlas.
- **Secuencias `G`.** Tras `G`, la siguiente tecla pulsada en menos de 1 s es el destino y tiene prioridad sobre los atajos de fila (`G` `C` va al Catálogo y no marca Comprado). `G` sola no hace nada.
- **Detección.** Letras y signos por carácter (`event.key`, sin distinguir mayúsculas); dígitos por posición (`event.code` `Digit1`–`Digit5` y `Numpad1`–`Numpad5`), para que también funcionen en AZERTY. Las teclas sueltas no actúan con `Ctrl`, `Alt` o `Meta` pulsadas, con el foco en un campo de texto ni durante una composición IME (`event.isComposing`).
- **Atajos del navegador.** `Ctrl + K` se intercepta con `preventDefault`, como hacen GitHub y Slack (fuera de la app, el navegador abre su búsqueda). No se interceptan `Ctrl + F`, `Ctrl + W`, `Ctrl + T`, `Ctrl + L`, `Ctrl + N`, `Alt + ←/→` ni `Ctrl + Z` dentro de un campo de texto.
- **Teclado español en Windows**
  - Nada de `Ctrl + Alt + …`: equivale a `AltGr` y escribe caracteres como `€`, `@` o `#`.
  - Nada de teclas que exigen `AltGr`: `@ # [ ] { } \ | ~`.
  - `/` es `Mayús + 7` y `?` es `Mayús + '`; por eso se detectan por carácter.
  - Ni `Alt + Inicio` (página de inicio del navegador) ni `Alt + Mayús` (cambio de idioma de entrada en Windows).
- **Descubribilidad.** `aria-keyshortcuts` en los controles con atajo, pistas visibles («Intro: Añadir», «Ctrl+K» en la cabecera) y la ayuda `?` siempre en el mismo sitio.
- **Lectores de pantalla.** En modo exploración, NVDA usa las letras sueltas para navegar; los atajos son un acelerador y nunca la única vía.

#### 6.2 [P1] Gestos en móvil

| Gesto | Dónde | Acción | Alternativa sin gesto |
|---|---|---|---|
| Deslizar → | Fila | Avanzar estado (etiqueta visible en el fondo) | Icono de estado de la fila o ficha |
| Deslizar ← | Fila | Revelar Comprado · Platinado · Más | Icono de estado, menú `[...]` o ficha |
| Mantener pulsado | Fila | Menú contextual completo | Botón `[...]` |
| Arrastrar el asa `::` (P0) | Fila (orden por Prioridad) | Reordenar | Subir/Bajar en la ficha o en el menú |
| Deslizar ↓ (P0) | Hoja inferior | Cerrar | Botón cerrar o atrás |
| Deslizar → / ← | Bandeja Por clasificar | Quiero jugar / No añadir | Botones |

- La acción se activa hacia el 40 % del ancho, con una vibración breve donde exista (`navigator.vibrate`, Android). Se cancela volviendo atrás antes de soltar (WCAG 2.5.2).
- **Zonas muertas en los dos bordes** (≥ 24 px): Android tiene el gesto «atrás» en ambos bordes, y Safari usa el izquierdo para «atrás» y el derecho para «adelante».
- Los gestos se activan o desactivan en Ajustes. Ninguno es la única forma de hacer algo (WCAG 2.5.1).

#### 6.3 Gestión del foco

- **Paleta, diálogos y hojas.** Al abrirlos se guarda el elemento activo y el foco pasa al campo o al encabezado. El foco queda atrapado dentro (`role="dialog"`, `aria-modal="true"`) y `Esc` cierra. **El foco vuelve al origen**; si el origen ya no existe, a la fila más cercana.
- **Después de añadir** desde la paleta, el foco vuelve a donde estaba. La fila nueva se resalta un momento si está visible, sin mover el scroll.
- **Al quitar una fila**, o al sacarla de la vista o de su sección, el foco pasa a la siguiente de la misma sección (o a la anterior si era la última).
- **Listas (P0): patrón sencillo.** `ul`/`li` nativos. La fila activa es la única parada de `Tab` de la lista (tabindex itinerante) y `↑`/`↓` cambian de fila. `Tab` entra en los botones nativos de esa fila; los de las demás filas llevan `tabindex="-1"`. Cada fila tiene un nombre accesible que resume su estado. **[P1]** Patrón *grid* de ARIA APG, solo si las pruebas lo justifican: es más costoso y el soporte de los lectores de pantalla con celdas interactivas es irregular.
- **Listas virtualizadas.** La fila enfocada nunca se desmonta. El total real se expone con `aria-setsize`/`aria-posinset`.
- **Foco nunca tapado.** Ni la cabecera fija, ni la barra de captura, ni las pestañas, ni los avisos tapan el foco: `scroll-padding-top/bottom` igual a su altura (WCAG 2.4.11).
- **Enlaces de salto:** «Saltar a la lista» y «Apuntar un juego».
- **Avisos.** No roban el foco. Su acción sigue disponible después con `Ctrl + Z` y con «Deshacer último cambio» del menú `[...]`.

#### 6.4 Accesibilidad WCAG 2.2 AA: cómo se cumple

| Criterio | Aplicación en GameAgenda |
|---|---|
| 1.4.1 Uso del color | El estado se muestra con icono, texto y color; las marcas, con icono y nombre accesible |
| 1.4.3 Contraste (mínimo) | Texto ≥ 4,5:1 (texto grande ≥ 3:1), recalculado en §10 también sobre las superficies de *hover* |
| 1.4.11 Contraste no textual | Foco, bordes de campos e iconos de estado ≥ 3:1. El estado elegido o pulsado de chips y segmentos se indica con algo más que el tinte: icono de *check*, borde o relleno con ≥ 3:1 |
| 1.4.4 / 1.4.10 / 1.4.12 | Sin scroll horizontal de la página a 320 px (la fila de chips se desplaza como componente y todos sus filtros están también en «Más»); usable con zoom del 200 al 400 % y con el espaciado de texto aumentado |
| 1.4.13 Contenido al pasar el ratón o con foco | *Tooltips* que se cierran con `Esc` y siguen visibles al pasar sobre ellos; las acciones del *hover* aparecen también con el foco |
| 2.1.1 / 2.1.2 Teclado | Todo se maneja con teclado; no hay trampas de foco salvo los diálogos modales, que se cierran con `Esc` |
| 2.1.4 Atajos de una tecla | Solo activos con el foco en el componente; los globales se pueden desactivar |
| 2.2.1 Tiempo ajustable | Avisos de 8 s que se pausan con *hover* o foco. Deshacer no caduca con el aviso: sigue en `Ctrl + Z` y en el menú `[...]`, también en táctil. **[P1]** Duración configurable |
| 2.4.3 / 2.4.7 Orden y foco visible | Orden lógico; anillo de foco de 2 px, con 2 px de separación y ≥ 3:1 (`:focus-visible`) |
| 2.4.11 Foco no tapado (mínimo) | `scroll-padding` bajo las barras fijas; los avisos se colocan fuera de la fila enfocada |
| 2.5.1 Gestos de puntero | Cada deslizamiento tiene un botón equivalente |
| 2.5.2 Cancelación del puntero | Las acciones se disparan al soltar; un deslizamiento se cancela volviendo atrás |
| 2.5.3 Etiqueta en el nombre | El nombre accesible empieza por el texto visible («Comprado…», «Jugando…», «Añadir…») |
| 2.5.7 Movimientos de arrastre | Reordenar también con Subir/Bajar, `Alt + ↑/↓` y el menú |
| 2.5.8 Tamaño del objetivo (mínimo) | Nunca menos de 24 × 24 px; diseño a 44 × 44 px en táctil y ≥ 32 px en escritorio |
| 3.2.6 Ayuda coherente | Ayuda y atajos siempre en el mismo sitio |
| 3.3.1 / 3.3.3 Errores | Mensajes en línea que dicen qué ha pasado y qué hacer |
| 3.3.7 Entrada redundante | El texto buscado rellena el título del alta manual; los filtros se recuerdan |
| 3.3.8 Autenticación accesible (mínimo) | **[P1]** Si hay cuenta: se permiten gestores de contraseñas y pegar; enlace mágico, *passkeys* o «Iniciar sesión con Steam»; sin CAPTCHA de rompecabezas |
| 4.1.2 Nombre, función y valor | Paleta como *combobox* según APG (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `listbox`/`option`). Las opciones no contienen elementos interactivos: el botón `(i)` es un elemento hermano, fuera de la opción, y con teclado se usa `Mayús + Intro`. Interruptores con `aria-pressed`; menú de estado con `menuitemradio` y `aria-checked`; control segmentado de la ficha como `radiogroup` |
| 4.1.3 Mensajes de estado | Avisos, recuentos de resultados y estado de guardado en `role="status"`; solo los errores críticos usan `role="alert"` |

**Etiquetas de ejemplo**
- Fila: «Hollow Knight: Silksong, Quiero jugar, posición 1 de 28».
- Interruptor: «Comprado: Hollow Knight: Silksong», con `aria-pressed`.
- Chip de estado: «Jugando: cambiar estado de Clair Obscur: Expedition 33», con `aria-haspopup="menu"`.
- Asa de arrastre: «Reordenar Hollow Knight: Silksong».
- Portada junto al título: `alt=""` (decorativa; evita que el título se lea dos veces).
- Documento: `lang="es-ES"`.

**Más allá de AA**
- Modo de alto contraste de Windows (`forced-colors: active`): iconos con `currentColor`, y foco y chips siempre visibles.
- Apariencia del foco al nivel de 2.4.13 (AAA).

**Pruebas (P0, todas posibles en Windows y sin Docker)**
- Uso solo con teclado y con zoom al 400 %.
- NVDA con Firefox o Chrome, y Narrador con Edge.
- axe-core con Playwright (`@axe-core/playwright`) y Lighthouse desde Node, en local o en CI; contraste comprobado en los dos temas.
- **[P1]** VoiceOver (iOS y macOS) y TalkBack (Android), si hay dispositivos.

### 7. Reglas de velocidad percibida

1. **Optimismo por defecto.** Cada cambio se aplica en memoria y se pinta en el mismo fotograma; se guarda en local justo después. **[P1, con sincronización]** La red va por una cola (*outbox*) con reintentos y espera exponencial. Si el servidor rechaza un cambio, se revierte con un aviso que explica el motivo y ofrece «Reintentar».
2. **Deshacer, no confirmar**
   - Aviso de 8 s, que se pausa con *hover* o foco, con una sola acción: «Deshacer».
   - Pila de 20 acciones con `Ctrl + Z` y «Deshacer último cambio» en el menú `[...]`. **[P1]** Rehacer.
   - Solo se pide confirmación para lo irreversible y masivo («Borrar todos mis datos», «Eliminar cuenta»), escribiendo una palabra.
3. **Respuesta en menos de 100 ms.** El gestor de eventos solo cambia el estado y pinta. Lo pesado (búsqueda, filtro y orden del catálogo, importación) va a un Web Worker.
4. **Sin indicadores de carga bloqueantes.** Nunca hay una pantalla completa de carga ni botones deshabilitados «esperando». Solo indicadores locales, p. ej. «Preparando el catálogo de Steam… 40 %» en la paleta.
5. ***Skeletons* con criterio.** Solo aparecen si la carga supera unos 200 ms (así no parpadean) y tienen la misma forma que el contenido final, para que la maquetación no salte.
6. **[P1] Precarga por intención**
   - *Hover* de al menos 80 ms, foco de teclado o `pointerdown` en una fila → precargar los datos de la ficha y la portada grande, **solo desde nuestra caché o backend**. Nunca una llamada a Steam por *hover*: esas peticiones salen de la IP del servidor y se suman a sus límites **[Supuesto: límites, track de API]**.
   - En la paleta, la portada del resultado resaltado tras 150 ms sin teclear.
   - En el catálogo, los metadatos del bloque siguiente al llegar al 70 % del desplazamiento.
   - Al arrancar, `preconnect` al CDN de imágenes y a la API.
   - Con «Ahorro de datos» (`navigator.connection.saveData`) no se precarga nada.
7. **Imágenes con el hueco reservado**
   - `aspect-ratio: 2 / 3` fijo y `decoding="async"`; `loading="lazy"`, salvo en la paleta y en las primeras filas visibles, que llevan `fetchpriority="high"`.
   - Mientras carga, portada provisional: color derivado del appid más las iniciales del título.
   - Fundido de 150 ms como máximo (ninguno con movimiento reducido).
   - Si la imagen falla, se queda la portada provisional; nunca el icono de imagen rota.
8. **Búsqueda sin esperas.** La local se lanza en cada pulsación, sin *debounce*, en el worker, y reutiliza los candidatos del prefijo anterior. (Con la opción B, la remota lleva *debounce* de 120–150 ms, `AbortController` y caché LRU por consulta.)
9. **Arranque instantáneo**
   - Mi lista se pinta desde el almacenamiento local antes de tocar la red, con el último filtro, el último orden y la misma posición de desplazamiento.
   - Si el prototipo es web, la estructura de la app queda en caché con un *service worker* básico, para abrir sin conexión.
   - La actualización con datos del servidor ocurre en segundo plano (*stale-while-revalidate*).
10. **Nada se mueve bajo el cursor**
    - Resultados estables en la paleta (§3a.6).
    - Huecos reservados para los datos que llegan tarde (§3a.5, §3d).
    - **[P1]** Los cambios llegados de otros dispositivos se aplican sin desplazar lo visible, con un resaltado breve.
11. **Animaciones cortas:** 120–200 ms y solo con `transform` u `opacity`.

### 8. Sin conexión y guardado

| Acción | Con conexión | Sin conexión |
|---|---|---|
| Ver, filtrar y ordenar Mi lista | Datos locales | Igual |
| Cambiar estado, marcas, prioridad o notas | Optimista; con cuenta, se sincroniza (P1) | Optimista; con cuenta, queda en cola |
| Buscar para apuntar | Índice local | Igual con la opción A; con la opción B, solo los populares y Mi lista |
| Apuntar | Normal | Normal con la opción A (la portada llega al volver la conexión). Con la opción B y sin coincidencia: **[P1]** «Apuntar «…» como pendiente», con el distintivo «Por vincular · Elegir» |
| Catálogo | Completo | Con la opción A, navegable con nombre y año; portadas y desarrollador solo si están en caché |
| Ficha | Completa | Datos guardados en la entrada; la descripción, solo si ya se visitó |
| Portadas | CDN + caché HTTP del navegador | Lo que haya en la caché HTTP, o la portada provisional |
| Importar de Steam (P1) | Disponible | Deshabilitado, con explicación |

**Que no se pierdan los datos (P0, sobre todo sin cuenta)**
- Llamar a `navigator.storage.persist()` tras la primera captura, para que el navegador no borre los datos cuando le falte espacio.
- **Safari (iOS y macOS)** borra todo lo que un sitio web guarda (IndexedDB incluido) tras 7 días de uso de Safari sin visitarlo; las apps añadidas a la pantalla de inicio no tienen ese límite. Sin cuenta, en iOS se sugiere una vez «Añadir a pantalla de inicio» y se recuerda la exportación.
- Exportar e importar JSON desde *Ajustes › Datos* y desde la paleta vacía.
- **[P2] Caché propia de portadas en el *service worker*.** Si el CDN de Steam no envía cabeceras CORS, las respuestas son opacas y Chrome cuenta cada una como unos 7 MB de cuota: un límite de 50 MB se llenaría con unas siete portadas **[Supuesto: cabeceras del CDN, track de API]**.

**Indicador de guardado** (en la cabecera: icono, texto corto y detalle en el *tooltip*)

| Estado | Texto | Notas |
|---|---|---|
| Sin cuenta (P0) | Guardado en este dispositivo | Enlace a «Exportar» y, en P1, a «Activar sincronización» **[Supuesto S7: la cuenta es opcional]** |
| Sin conexión (P0) | Sin conexión | Banda informativa una sola vez por episodio |
| Al día (P1) | Guardado | Detalle: «Todo guardado · hace 1 minuto» |
| Sincronizando (P1) | Guardando… | Solo si hay cambios pendientes durante más de 1 s, para que no parpadee |
| Cambios pendientes (P1) | Sin conexión · 3 cambios pendientes | — |
| Error (P1) | No se ha podido sincronizar · Reintentar | Además del botón, reintenta solo |

- **[P1] Conflictos entre dispositivos.** Gana el último cambio de cada campo, sin preguntar al usuario **[Supuesto de arquitectura]**. Si afecta a algo visible, aparece un aviso discreto: *Actualizado desde otro dispositivo*.
- **Anuncios.** El paso a «Sin conexión» o a «Error» se anuncia (`role="status"`); los guardados normales, no.

### 9. Estados del sistema y microcopy

**Tono**
- Tuteo y frases cortas, en español de España («ordenador», «móvil», «pulsa»), con pretérito perfecto para lo recién ocurrido («No hemos encontrado…»).
- Sin exclamaciones.
- Las teclas, con su nombre en el teclado español.
- En las tablas, los textos de interfaz van sin comillas exteriores.

**Estados vacíos**

| Contexto | Título | Texto | Acciones |
|---|---|---|---|
| Mi lista, primera vez (en escritorio, con el foco ya en «Apunta un juego…»; en móvil, con la barra resaltada) | Tu agenda de juegos está vacía | Escritorio: Apunta el primer juego que quieras jugar: escribe su nombre y pulsa Intro. Con Ctrl + K puedes apuntar desde cualquier pantalla. Móvil: Toca «Apunta un juego…» y escribe su nombre. | Explorar el catálogo · Importar JSON |
| Filtro sin juegos | No tienes juegos en Completado | Cuando termines uno, aparecerá aquí. | Quitar filtros |
| Próximos vacío (P1) | Ninguno de tus juegos sale próximamente | Apunta juegos que aún no han salido y aquí verás sus fechas. | Ver Próximamente en el catálogo |
| Por clasificar terminado (P1) | Todo clasificado | Has revisado 118 juegos. | Volver a Mi lista |

**Sin resultados (paleta y catálogo)**
- No hemos encontrado «mario kart» en Steam. → Acción principal, resaltada y con `Intro`: **Añadir «mario kart» manualmente** (quizá es de otra plataforma).
- **[P1]** Con una errata: ¿Querías decir «Hollow Knight»?
- Ayuda: Revisa la ortografía o prueba con menos palabras.
- Con filtros activos en el catálogo: No hay juegos con estos filtros. → **Quitar filtros**.
- Catálogo aún descargándose: Preparando el catálogo de Steam… 40 %. Mientras tanto, buscamos en tu lista.

**Sin conexión**
- Banda: Sin conexión. Puedes seguir usando GameAgenda: tus cambios se guardan en este dispositivo.
- Paleta con la opción A: sin mensaje, la búsqueda funciona igual. Con la opción B: Sin conexión: solo buscamos en tu lista y en los juegos más populares. → **[P1] Apuntar «…» como pendiente**.
- Catálogo: Sin conexión: verás nombres y años, pero no las portadas nuevas.

**Errores (en línea, nunca en un diálogo modal)**

| Situación | Mensaje | Acción |
|---|---|---|
| Guardado local fallido (cuota llena o almacenamiento bloqueado) | No hemos podido guardar en este dispositivo. Exporta tu lista para no perderla. | Exportar JSON · Reintentar |
| Descarga del catálogo fallida | No hemos podido descargar el catálogo de Steam. Mientras tanto, buscamos en tu lista. | Reintentar |
| Portadas o detalles que no llegan | (sin mensaje: se queda la portada provisional) | — |
| Descripción de la ficha | No se ha podido cargar la descripción. | Reintentar |
| Límite de peticiones de Steam | Steam está limitando las consultas. Lo reintentamos solos en unos segundos. | Reintento automático |
| **[P1]** Fallo de sincronización | No se han podido guardar 3 cambios en la nube. Lo seguiremos intentando. | Reintentar ahora |
| **[P1]** Cambio rechazado por el servidor | No se ha podido guardar el cambio en Hades II y lo hemos deshecho. | Reintentar |
| **[P1]** Perfil de Steam privado | Tu perfil de Steam es privado. Para importar, pon «Detalles del juego» en Público en la privacidad de Steam. | Abrir privacidad de Steam · Volver a intentarlo |
| **[P1]** Perfil no encontrado | No hemos encontrado ese perfil. Pega la URL completa (steamcommunity.com/id/… o /profiles/…). | — |

**Avisos (*toasts*)**
- Añadido a Quiero jugar: Hades II · [Deshacer]
- Hollow Knight: Silksong pasa a Jugando · [Deshacer]
- Marcado como comprado: Baldur's Gate 3 · [Deshacer]
- Platinado. También lo hemos marcado como Completado. · [Deshacer]
- Quitado de tu lista: Hades II · [Deshacer]
- Ya está en tu lista (Completado): Hades · [Abrir]
- **[P1]** 3 juegos movidos a Completado · [Deshacer]
- **[P1]** Apuntado como pendiente: «nebula drif». Lo vincularemos al volver la conexión.
- **[P1]** Importación lista: 57 a Quiero jugar, 118 a Por clasificar y 342 marcados como comprados · [Deshacer importación]

**Formatos (comprobados con `Intl` es-ES en Node 24.21, ICU 78.3 / CLDR 48)**
- Números: `1234`, `12.345`, `123.456`. En es-ES, los números de 4 cifras no llevan separador de miles.
- Fechas: `28 oct 2026`, `4 sept 2026` (la abreviatura es «sept»), `vie, 30 oct`, `jue, 19 nov 2026`. Para `28/10/2026` hacen falta las opciones `{ day: '2-digit', month: '2-digit', year: 'numeric' }`; `dateStyle: 'short'` da `28/10/26`.
- Cabeceras de mes: `Intl` devuelve «noviembre de 2026» en minúscula; la mayúscula inicial («Noviembre de 2026») se añade en código.
- Trimestres: `Intl` no los formatea; se escriben a mano («T1 2027», «1.er trimestre de 2027»).
- Fechas relativas (`Intl.RelativeTimeFormat` con `numeric: 'auto'`): «mañana», «pasado mañana», «dentro de 3 días», «ayer», «hace 2 horas».
- Porcentaje «100 %» y moneda «29,99 €», ambos con espacio irrompible (U+00A0).
- Teclas: `Ctrl + K`, `Intro`, `Mayús + Intro`, `Alt + Intro`, `Supr`, `Esc`.

### 10. Guía visual

#### 10.1 Tema y tokens
- **El tema sigue al sistema** (`prefers-color-scheme`), con selector Sistema / Claro / Oscuro. El oscuro es la referencia del diseño: encaja con el contexto de jugador y luce más las portadas.
- **Neutros fríos y un único acento** (se propone rosa) para la marca, el foco y la acción principal. Los colores de estado se reservan para chips e iconos; nunca tiñen una fila entera.
- **Identidad propia.** No imitar la paleta, la tipografía ni el logotipo de Steam **[Supuesto: guías de marca y ToS, track legal]**. «Ver en Steam» es un enlace de texto con icono de enlace externo.
- **Tipografía del sistema**, sin descargar fuentes: `"Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, Roboto, sans-serif` (Segoe UI Variable en Windows 11, SF en Apple, Roboto en Android). Cifras tabulares (`font-variant-numeric: tabular-nums`) en contadores, fechas y posiciones.
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

**Contrastes (fórmula WCAG, recalculados)**

| Par de colores | Oscuro | Claro |
|---|---|---|
| `--text` sobre `--surface` | 14,45:1 | 17,30:1 |
| `--text` sobre `--surface-2` | 12,90:1 | 15,27:1 |
| `--text-muted` sobre `--surface` | 7,61:1 | 6,31:1 |
| `--text-muted` sobre `--surface-2` | 6,80:1 | 5,57:1 |
| Foco (`--accent`) sobre `--bg` | 7,10:1 | 5,48:1 |
| Foco (`--accent`) sobre `--surface` | 6,49:1 | 5,87:1 |
| `--control-border` sobre `--surface` | 3,80:1 | 3,74:1 |
| `--control-border` sobre `--surface-2` | 3,39:1 | 3,30:1 |
| Botón principal | 7,10:1 (texto `#0E1116` sobre el acento) | 5,87:1 (texto blanco sobre el acento) |

#### 10.2 Densidad
- **Cómoda** (P0, por defecto): filas de 72 px, portada de 48 × 72, dos líneas (título y metadatos) y acciones al pasar el ratón o enfocar.
- **[P1] Compacta:** filas de 44 px, portada de 28 × 42 (o sin portada), una línea y el estado como icono y abreviatura con *tooltip*. Objetivos de al menos 32 px.
- **[P1] Cuadrícula** (en Catálogo; opcional en Mi lista): tarjetas 2:3 de 140–180 px en escritorio y 3 columnas en móvil.
- **En móvil**, los objetivos táctiles miden siempre al menos 44 × 44 px.

#### 10.3 Portadas (cápsula vertical)
- **Formato protagonista: 2:3**, la cápsula vertical de biblioteca (`library_600x900`) que devuelve GetItems, con `object-fit: cover`, radio de 6 px y un borde semitransparente de 1 px para que las portadas oscuras no se pierdan sobre el fondo oscuro.
- **Cadena de respaldo** (muchos juegos antiguos o pequeños no tienen cápsula vertical):
  1. Cápsula vertical.
  2. Imagen de cabecera horizontal, centrada sobre una versión desenfocada de sí misma.
  3. Portada provisional (color derivado del appid más las iniciales).
- **URL.** Se compone solo con la plantilla y el nombre de archivo (con hash) que devuelve GetItems, nunca con la antigua ruta fija por appid **[Supuesto: host del CDN y formato exacto, track de API]**.
- **Tamaño según el uso:** la miniatura de la lista no es la imagen de la ficha. **[P2, Supuesto S4]** Si el track legal permite cachear y redimensionar las imágenes de Steam, un proxy de miniaturas WebP/AVIF de unos 100 × 150 px reduce los datos en móvil en torno a un orden de magnitud. Si no, la imagen original se carga solo cuando es visible.
- **Texto sobre portada** (solo en cuadrícula y ficha): degradado negro de al menos el 60 % en **toda** la zona del texto. Texto blanco sobre negro al 60 % encima de una portada blanca (el peor caso) da 5,74:1.
- **Lectores de pantalla:** portadas decorativas (`alt=""`) cuando el título está al lado.

#### 10.4 Estados: color, icono y texto

| Estado / marca | Icono | Oscuro: texto · fondo del chip · contraste | Claro: texto · fondo del chip · contraste |
|---|---|---|---|
| Quiero jugar | marcapáginas | `#5AB0FF` · `#213345` · 5,60:1 | `#0B63C5` · `#E2ECF8` · 4,88:1 |
| Jugando | *play* | `#3FCF8E` · `#1D3833` · 6,32:1 | `#0D6E43` · `#E2EEE8` · 5,30:1 |
| En pausa | pausa | `#FF9F43` · `#3B3027` · 6,28:1 | `#A44F00` · `#F4EAE0` · 4,79:1 |
| Completado | círculo con *check* | `#B395FF` · `#2F2F45` · 5,37:1 | `#6A3FC8` · `#EDE8F8` · 5,54:1 |
| Abandonado | círculo tachado | `#9AA5B4` · `#2B3139` · 5,26:1 | `#5E6977` · `#ECEDEF` · 4,76:1 |
| Platinado / 100 % (marca) | trofeo | `#E8C35A` · `#38362B` · 7,16:1 | `#7A5A00` · `#EFEBE0` · 5,36:1 |
| Comprado (marca) | bolsa | `#A3ADBA` · `#2D323A` · 5,67:1 | `#556170` · `#EBECEE` · 5,33:1 |

- **Fondo del chip opaco.** Es el color del estado al 16 % (oscuro) o al 12 % (claro) sobre `--surface`, precalculado como token. Con un fondo translúcido, el contraste cambiaría con el *hover* de la fila: en el tema claro, sobre `--surface-2`, Quiero jugar bajaría a 4,35:1, En pausa a 4,27:1 y Abandonado a 4,25:1, por debajo de 4,5:1.
- **Sin chip** (icono y texto del color del estado directamente sobre la fila): ≥ 4,93:1 en claro y ≥ 6,19:1 en oscuro, también sobre `--surface-2`.
- **Borde del chip:** el chip se identifica por su texto, así que su fondo no necesita 3:1 frente a la superficie. El foco y el estado elegido, sí (§6.4).
- **Marcas:** en la fila solo se muestran cuando están activas (menos ruido). En la ficha se ven siempre, como interruptores con `aria-pressed`.
- **Daltonismo:** azul, verde, naranja, violeta y gris se distinguen además por icono y texto. Ningún estado depende solo del color.

#### 10.5 Movimiento
- Duraciones de 120–200 ms con `ease-out`. **[P1]** Deslizamientos con una física sutil y sin rebotes largos.
- Con `prefers-reduced-motion` (P0): los cambios ocurren sin animación, los *skeletons* no tienen brillo animado (*shimmer*) y las portadas no hacen fundido.

### 11. Supuestos y dependencias con otros tracks

| # | Supuesto | Track | Si no se cumple |
|---|---|---|---|
| S1 | Se puede generar y servir un índice compacto de **todos** los juegos (~1–2 MB comprimido, estimado) que el cliente guarda y busca en local | Arquitectura / API | Opción B: índice local de los ~10.000 más populares + búsqueda remota (p95 < 300 ms); sin conexión, solo se encuentran esos |
| S2 | Existe una señal de popularidad para ordenar resultados y catálogo | API de Steam | Ordenar por rango de coincidencia y fecha, con más alias manuales para los títulos más buscados |
| S3 | Los datos traen el tipo de app, el descriptor de contenido para adultos y la fecha de lanzamiento, incluida la aproximada; mejor si también géneros e idiomas | API de Steam | Ocultar los filtros sin datos; si falta el tipo, el filtro «Solo juegos» no es fiable y se avisa |
| S4 | Se pueden mostrar (y quizá cachear o redimensionar) las imágenes del CDN de Steam | Legal | Solo enlaces directos y carga perezosa estricta; sin proxy ni caché propia |
| S5 | Son viables «Iniciar sesión con Steam» y la importación de biblioteca y lista de deseos | API / Legal | El flujo (g) queda fuera |
| S6 | El prototipo es una app web instalable (PWA): *service worker*, accesos directos y, más adelante, Web Share Target y notificaciones | Arquitectura | Sin PWA no hay acceso directo en el icono ni apertura sin conexión; la captura solo funciona dentro de la app |
| S7 | La cuenta es opcional y la app funciona sin registro (local primero) | Arquitectura / Legal | Registro mínimo con enlace mágico o con Steam, nunca antes de la primera captura. Si es solo local, se aplican las salvaguardas de §8 (Safari borra los datos tras 7 días sin uso) |
| S8 | Portada, desarrollador y descripción se obtienen **por lotes** (GetItems) a través de un backend propio o de una caché generada por el job; el cliente no llama a Steam juego a juego | API / Arquitectura | Las filas muestran nombre, año y portada provisional; la ficha carga sus datos al abrirse |

### 12. Preguntas abiertas para el usuario

1. ¿Web instalable (PWA), app de escritorio (Tauri) o ambas? De eso dependen el acceso directo, el atajo global y la apertura sin conexión.
2. ¿Cuenta y sincronización entre móvil y PC en el prototipo, o solo datos locales con exportación? En iPhone sin cuenta hay riesgo de perder datos (§8).
3. ¿Los juegos nuevos entran al final de Quiero jugar (propuesta, como en una libreta) o al principio?
4. ¿Hacen falta más marcas, como Favorito o «Esperando oferta», o más plataformas en «Juego en»?
5. ¿Se muestran en la ficha el precio y las ofertas de Steam en España (`cc=es`)?
6. ¿El contenido para adultos va oculto por defecto con opción en Ajustes (propuesta) o se excluye del todo?
7. ¿Cuándo llegan otras plataformas al catálogo (PlayStation, Xbox, Switch)? Afecta a «Platinado», a «Juego en» y a los filtros.
8. ¿Se quiere mostrar la duración estimada de cada juego (tipo HowLongToBeat)? Steam no la ofrece y no hay API oficial.
9. ¿Cuáles serán el color de acento (se propone rosa), la marca y el logotipo definitivos?