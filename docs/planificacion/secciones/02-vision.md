## 2. Visión, principios y objetivos medibles

### 2.1 Visión

GameAgenda es una agenda personal de videojuegos con una prioridad por encima de todas: **apuntar en segundos el juego que se quiere jugar**, en el momento en que se descubre, desde el móvil o desde el PC. Para lograrlo, la app lleva dentro el catálogo de todos los juegos de Steam (≈196 600, ver §4), busca en el propio dispositivo y guarda sin esperar a la red. Después ayuda a llevar la lista al día con cinco estados y tres marcas que cuestan un toque (ver §3.3), sin formularios, sin registro y sin coste. El prototipo demuestra esa promesa con Steam; otras plataformas llegan en Fase 2 (ver §17).

> **Frase de producto:** «Apunta cualquier juego en 3 segundos y ten siempre a mano qué vas a jugar.»

### 2.2 Para quién

Una persona que juega sobre todo en PC (a menudo también en consola), que tiene más juegos pendientes que tiempo y que usa a diario el PC y el móvil. Descubre juegos en directos de anuncios, en la tienda o por recomendación, y los olvida porque apuntarlos cuesta demasiado. Necesita:

- **Apuntar sin pensar:** unas letras, unas siglas o un enlace, y que el primer resultado sea el bueno.
- **Apuntar en ráfaga:** varios juegos seguidos durante un directo, sin cerrar el buscador.
- **Recordar qué tiene y qué ha terminado:** Comprado, Completado y Platinado en un toque.
- **Decidir qué jugar después:** la lista en el orden que elija, con «A continuación» arriba.
- **La misma agenda en los dos dispositivos** (M4).

En el prototipo, el usuario es el propio desarrollador (sobre probadores externos, ver §18).

### 2.3 Principios

| Principio | Cómo se aplica al decidir |
|---|---|
| **1. La captura primero** | Apuntar está a un atajo (`Ctrl+K` o `/`) o a un toque en cualquier pantalla. Lo que añada un paso a la captura no entra. |
| **2. Sin esperas ni red** | Buscar y apuntar ocurren en el dispositivo: Steam y el servidor nunca están en el camino crítico. La interfaz pinta antes de guardar y nunca bloquea mientras carga. |
| **3. Todo se puede deshacer** | En lugar de pedir confirmación, el cambio se aplica y se ofrece «Deshacer». Solo se confirma «Borrar todos mis datos». |
| **4. Un toque** | Cada cambio frecuente es una sola acción. Lo exclusivo (el estado) va separado de lo que se suma (las marcas), así que no hay combinaciones absurdas. |
| **5. No inventar datos** | Las fechas automáticas son las del cambio en la app (editables); la de compra solo la escribe el usuario. No se adivinan portadas, no se vincula por parecido y lo que se importe de Steam solo se propone. Lo desconocido se muestra como tal («Por confirmar», portada generada). |
| **6. Privacidad por defecto** | Sin cuentas, analítica ni *cookies* no necesarias. Los datos se quedan en el dispositivo hasta que el usuario activa la sincronización, y se avisa de lo único que sale: las peticiones de portadas a Valve. |
| **7. Prototipo pequeño** | Cinco pantallas, un solo cliente web para móvil y escritorio y 0 €/mes. Lo que no ayude a apuntar rápido espera a Fase 2. |

### 2.4 Objetivos medibles

| Id | Objetivo | Meta | Cómo se mide | Hito |
|---|---|---|---|---|
| O-1 | Apuntar en segundos | p50 ≤3 s desde abrir la paleta hasta ver la confirmación (RNF-01); ninguna captura >5 s en la prueba guiada | E2E de Playwright, mediana de 5 juegos (ver §12), y prueba guiada en el móvil y el PC del desarrollador, sin guardar datos de los participantes: 3–5 personas (al menos 2 ajenas al proyecto) × 10 juegos dictados, con los tiempos del panel de rendimiento (ver §12). Como los participantes usan esos dispositivos y no introducen datos propios, no cuentan como probadores externos (los que obligan a tener antes los textos legales; ver §11.2) | M1 (E2E) · M3 (guiada) |
| O-2 | Acertar a la primera | El conjunto de referencia cumple sus umbrales (ver §8); en la prueba guiada, ≥80 % de las capturas sin flechas ni Deshacer | Test en CI con cada cambio del índice o del *ranking*, y prueba guiada (quien dicta anota las flechas y los Deshacer) | M1 · M3 |
| O-3 | Rápida y ágil en dispositivos reales | Todos los presupuestos de RNF-02 a RNF-05 (§3.2) | `npm run perf` en local y medición en un Android de gama media real y en iPhone (ver §12) | M1 · M3 |
| O-4 | Catálogo completo y fresco | Todos los juegos de Steam, con ≤36 h de antigüedad | Puertas de publicación (ver §4) y `generatedAt` del *manifest*; el *dead-man switch* avisa si se superan las 36 h | M2 |
| O-5 | Coste cero | 0 €/mes | Facturación a 0 € en Cloudflare, GitHub y healthchecks.io al cerrar cada hito | M0–M4 |

### 2.5 Qué no es objetivo del prototipo

- Red social, reseñas, valoraciones, descubrimiento o recomendaciones: ya los cubren Steam y otras apps de seguimiento.
- Precios, ofertas o alertas de rebajas.
- Cuentas con email y contraseña, perfiles públicos o listas compartidas.
- Detectar logros o trofeos: Platinado es una marca manual.
- Estadísticas, tiempo jugado o duración estimada de los juegos.
- Lo previsto para Fase 2: iniciar sesión con Steam e importar (ver §10), IGDB y otras plataformas (ver §17), DLC, marcas propias, avisos de lanzamiento e inglés.
- Operar como servicio con compromisos de disponibilidad o soporte, o monetizar (ver §18).
