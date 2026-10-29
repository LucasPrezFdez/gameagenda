# ADR-001 · Arquitectura del prototipo: PWA *local-first* con catálogo estático

- **Estado:** aceptada
- **Fecha:** 28-10-2026. El 29-10-2026, antes de copiarla al repositorio, se ajustó una consecuencia: la app de escritorio (envoltorio Tauri) pasó de Fase 2 a M3. La decisión no cambió.
- **Deciden:** el usuario y el asistente

## Contexto y problema

Hay que apuntar en segundos, desde el móvil y el PC, juegos del catálogo completo de Steam (≈196 600). Las APIs de Steam no envían CORS, la clave de la Web API es confidencial y los endpoints sin clave no están documentados. Lo construye una persona en Windows 11, sin Docker.

¿Qué arquitectura cumple los presupuestos de la §3.2 sin poner a Steam ni a un servidor en el camino crítico?

## Factores de la decisión

- Apuntar p50 ≤3 s en móvil y escritorio (RNF-01).
- Tecla → resultados ≤50 ms p95 sin red (RNF-02).
- Viable para una persona en este PC.
- Condiciones de uso (ToU) de Steam y RGPD.
- Datos que no dependan de un solo navegador.
- 0 €/mes.

## Opciones consideradas

Se redactaron tres arquitecturas completas e independientes y se evaluaron con tres criterios, cada uno sobre 60 puntos (§5.5):

- **A:** PWA *local-first* con catálogo estático.
- **B:** escritorio nativo con Tauri 2, núcleo en Rust y SQLite FTS5, con una PWA compañera para el móvil en el cuarto hito.
- **C:** PWA con API propia, D1 y R2 en la UE y cuentas de invitado desde el primer día.

| Criterio | A | B | C |
|---|---|---|---|
| Velocidad y UX de captura | **48** | 45 | 45 |
| Viabilidad para una persona en este PC | **42** | 25 | 29 |
| Robustez, cumplimiento y futuro | 42,5 | 44 | **48** |

## Decisión

Opción elegida: **A, con injertos de B y de C**. Se elige porque:

- gana dos de los tres criterios;
- es la más sencilla para una persona;
- sus dos carencias de robustez eran de secuencia: la importación sin autenticar la corrige el login obligatorio (Fase 2), y la falta de copia fuera del dispositivo, la sincronización de M4.

Cada criterio, por separado, recomendaba partir de A con piezas de B y de C.

- **De B:**
  - el rigor de la búsqueda (orden de normalización, niveles de *ranking*, alias);
  - los ids naturales;
  - el *manifest* como plano de control (firma ed25519 y *kill switches*).
- **De C:**
  - contratos de respuesta;
  - puertas con consultas de humo;
  - credencial de dispositivo en cookie `__Host-` `HttpOnly`;
  - una sola `merge()`;
  - sincronización ligera en M4.
- **De A:** catálogo estático con *hash*, *shards* de detalles y coste 0 €.
- **Corrección de A:** ninguna llamada a Steam por usuario sin un login OpenID verificado (Fase 2).
- **Se descartan:**
  - de B, el núcleo en Rust: la lógica existiría dos veces;
  - de C, las cuentas de invitado, R2 y la búsqueda en el servidor para la primera visita (la sustituye el núcleo de arranque de M3).

### Consecuencias

- Bien, porque buscar y apuntar funcionan sin red tras la primera visita, con un solo cliente para móvil y escritorio.
- Bien, porque Steam no está en el camino crítico y el coste es 0 €/mes.
- Bien, porque con ids naturales, HLC y `outbox` desde M1, la sincronización de M4 es un añadido y no una reescritura (ver ADR-004).
- Mal, porque la primera visita descarga el núcleo antes de buscar: de ≈2,6 a ≈3,1 MB comprimido, según cómo lo comprima el CDN (§7.6). Mientras tanto se apunta a mano o con un enlace. Después se busca por escaneo lineal mientras se construye el índice (ver ADR-005), y M3 añade un núcleo de arranque.
- Mal, porque hasta M4 la agenda vive en un solo navegador (mitigación en la §16).
- Mal, porque no hay atajo global en Windows hasta el envoltorio Tauri de M3, ni *Web Share Target* en iOS. Se cubre con «Pegar enlace» y, en M4, con un Atajo de iOS que envía al buzón.
- Mal, porque el catálogo se actualiza como mucho una vez al día y su enriquecimiento depende de endpoints no documentados. Lo cubren el plan B y los *kill switches* (§4).

### Confirmación

- **M1:** apuntar en <3 s y buscar sin red con CPU ×4 (CA1.4, CA1.5, CA1.8 y CA1.11).
- **M3:** los presupuestos, en el Android de referencia y en iPhone (§15).

## Pros y contras de las opciones

Las notas sobre 10 son los subcriterios en los que se separaron (§5.5).

### A · PWA *local-first* con catálogo estático

- Bien, porque es la más rápida al capturar (48 sobre 60) y la más viable para una persona (42 sobre 60).
- Bien, porque tiene pocas piezas móviles (7) y es la más fácil de mantener para una persona (7).
- Mal, porque, tal como estaba escrita, importaba con la clave datos de cualquier perfil sin autenticar al usuario. Se corrige exigiendo el login OpenID.
- Mal, porque no guardaba ninguna copia fuera del dispositivo (durabilidad, 6). Lo corrige M4.

### B · Escritorio nativo con Tauri 2, Rust y SQLite FTS5

- Bien, porque la clave de Steam queda fuera del cliente (ToU, 8) y los datos son más duraderos (8).
- Mal, porque no permite apuntar desde el móvil hasta el cuarto hito, tras ≈18 días de desarrollo (captura en <3 s, 4).
- Mal, porque obliga a mantener dos clientes con la misma lógica, en Rust y en TypeScript (piezas móviles, 3; mantenibilidad, 3).

### C · PWA con API propia, D1 y R2 en la UE y cuentas de invitado

- Bien, porque es la más robusta: ToU y confidencialidad de la clave (9) y durabilidad (8,5).
- Bien, porque captura en <3 s en escritorio y móvil desde el principio (8).
- Mal, porque exige un backend multiusuario (invitados, sesiones, fusión de cuentas y purgas) antes de apuntar el primer juego (piezas móviles, 4; mantenibilidad, 4).

## Más información

- **Desarrollo:** [§5 de `prototipe.md`](../../prototipe.md#5-arquitectura) (vista general, componentes, flujos y principios). La evaluación está en la [§5.5](../../prototipe.md#55-alternativas-evaluadas) y el registro de ADR, en la [§5.6](../../prototipe.md#56-adr-001-y-registro-de-decisiones).
- **Porqué:** [`DECISIONES.md`](../planificacion/DECISIONES.md), en la §2 (ADR-001) y en D-01. La §10.16 adelanta la app de escritorio a M3 y manda sobre lo anterior.
- **Evaluaciones completas:** `docs/planificacion/panel-arquitectura/`.
- **Relacionados:** ADR-002 (stack), ADR-004 (datos del usuario), ADR-005 (búsqueda), ADR-006 (catálogo) y ADR-010 (app de escritorio).
- **Cuándo revisarla:**
  - Si al cerrar M1 la captura en escritorio pasa de 3 s, o si casi todo se apunta en el PC (PA-01), el envoltorio Tauri pasa de M3 a justo después de M1.
  - Si se cierran los endpoints sin clave, se aplica el plan B, sin tocar la arquitectura.
  - El tiempo real, las agendas compartidas o un backend para IGDB exigen un ADR nuevo.
