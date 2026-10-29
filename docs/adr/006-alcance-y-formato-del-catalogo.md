---
status: propuesto
date: 2026-10-29
decision-makers: Lucas (propietario del proyecto)
---

# ADR-006 · Alcance y formato del catálogo

## Contexto y planteamiento del problema

La app busca y apunta sin red sobre el catálogo completo de Steam, que llega como ficheros estáticos propios (ADR-001). Hay que fijar **qué juegos entran**, **en qué formato se publican** y, en M1, **cómo se construye sin la clave** de la Web API (plan B de la §4.8 de `prototipe.md`). El 29-10-2026 se ejecutó el pipeline (`npm run catalog:build -- --keyless`, pasos 0–5 de la §4.5) contra Steam, y este ADR recoge lo medido. Desarrollo: §4 y §7.6.

## Factores de decisión

- Completo: ≥190 000 juegos y todo `appid` del volcado público explicado (CA1.1).
- Ligero: núcleo ≤3 MiB con brotli 11 (§7.6), para descargarlo en la primera visita.
- Buscable: puertas de humo y de calidad de la §8.10 sobre el núcleo construido.
- Barato y educado con Steam: ≤230 llamadas al día, una cada 3 s y sin 429 (§4.7).
- Un solo formato para el pipeline y la app: los códecs de `packages/core/catalog-format`.

## Opciones consideradas (nombre base en el plan B)

El alcance y el formato son los de la §4.9 y la §7.6. La única pregunta nueva es de dónde sale el **nombre base** sin `GetAppList`: Query en `spanish` devuelve el nombre traducido, y el 29-10-2026 se comprobó que Steam también traduce `store_url_slug` y `store_url_path` y que ningún `data_request` trae un nombre sin traducir.

1. Solo el nombre de Query (el plan al pie de la letra): `nameEs` siempre vacío.
2. Segunda pasada de Query en `english` (+208 peticiones, ≈+10 min).
3. `GetItems` en `english` solo para los nombres que parecen españoles (letras o palabras del español) o vienen vacíos.
4. Comparar el nombre con el *slug*: descartada, porque el *slug* también se traduce y su cobertura es del 0 %.
5. Tomar los nombres del volcado `jsnli/steamappidlist`: prohibido, porque el volcado nunca se publica (§4.8).

## Resultado de la decisión

**Opción 3**, en este orden de preferencia para el nombre base: `GetAppList` (con clave, desde M2), luego `GetItems` en `english` y por último el nombre de Query. Cuesta 18 peticiones (3 450 juegos) y recupera el 75,7 % de los 3 110 nombres que, en la copia congelada, siguen distintos tras `normalize()`. Con ella, la pasada se queda en ≈226 llamadas, dentro del presupuesto.

**Alcance** (§4.9): solo `type 0`, con «próximamente», gratuitos, acceso anticipado y demos de tipo 0. Los adultos (descriptores 3 o 4) se ocultan por defecto. Los retirados se conservan con el bit 16 y van al final. Quedan fuera:
- los nombres vacíos;
- los inexistentes (`success 15` y `appid 0`; Steam devuelve el `appid` pedido en `id`);
- la lista negra **exacta** por par `appid`–nombre (866490 `TestApp`, 639770 `UNTITLED` y 1025620 `Untitled`; «Untitled Goose Game» entra);
- los SKU regionales duplicados de un juego visible en ES (se queda el visible).

Los bloqueados por país se piden en US y se conservan. `success 15` sin `appid 0` nunca se trata como eliminado. Sin DLC hasta la Fase 2.

**Formato** (§7.6), sin cambios respecto a `core/catalog-format`:
- `core.<hash16>.tsv` con la cabecera `#gacat-core v1⇥AAAAMMDD.N` y las columnas `appid`, `name`, `nameEs`, `flags`, `year` y `pop`, con `pop = min(63, ⌊2·log2(reseñas+1)⌋)`.
- `aliases.<hash16>.tsv`: los 50 alias curados (47 presentes) más las siglas de los 5 000 juegos con más reseñas. Reproduce byte a byte los alias congelados.
- `manifest.json` de M1, sin `sig`, `killSwitches`, `recent` ni `details`.
- Orden de las filas: reseñas descendentes, a igualdad `appid` descendente, y los retirados al final.
- «Fecha por confirmar» (bit 32) cuando Steam no muestra fecha: `text_tba`, `text_comingsoon`, sin `coming_soon_display` o sin fecha.
- Versión `AAAAMMDD.N` según el día en Europe/Madrid.

### Consecuencias

- Bien, porque el núcleo del 29-10-2026 (versión `20261029.1`) tiene **197 031 juegos** y pasa todas las puertas de la §4.6:
  - tamaño: 6,99 MB; 3,04 MB con gzip -9; 2,59 MB con brotli 5; **2,25 MB con brotli 11** (≤3 MiB);
  - consultas de humo: las 4;
  - dorado (98): top-1 94,9 % y top-5 100 %;
  - 2 000 exactos: 100 % en el top-5;
  - prefijos de 4 letras: 93,1 % en el top-10;
  - negativas: ningún resultado de nivel 0–1;
  - los alias son 3 570 pares (16 KB con brotli 11).
- Bien, porque el **CA1.1** se cumple. El volcado del 29-10-2026 tiene 197 169 juegos (197 151 con nombre): 196 926 están en el núcleo y los 225 restantes figuran en el informe con su motivo (ninguno queda sin motivo):
  - 204 bloqueados en ES, que en M2 entran por H1;
  - 15 SKU regionales duplicados (p. ej., 22490 «Fallout: New Vegas» → 22380);
  - 3 de la lista negra;
  - 1 que no es juego (473930 «Steam Gift Cards», tipo 14);
  - 1 retirado;
  - 1 visible en `GetItems` pero no en Query.
  
  Los 18 sin nombre siguen vacíos también en `GetItems` en inglés: se excluyen y se cuentan.
- Bien, porque Query responde bien sin clave. La pasada fueron 208 páginas, todas 200, sin un solo 429 ni reintento, en 624 s.
  - Por página: 234 KB gzip de media (p50 185 KB, p95 341 KB, de 132 a 343 KB) y 1,61 MB sin comprimir (de 0,81 a 2,04 MB).
  - Tiempo por página: 1,09 s de media (p50 1,16 s, p95 1,57 s, máximo 2,30 s).
  - En total, 48,6 MB gzip; la estimación de la §4.7 era ≈240 KB por página y ≈50 MB por pasada.
- Bien, porque queda **verificado el punto «a verificar en M0»**: sin `include_basic_info` siguen llegando `is_free` (23 748), `is_early_access` (19 334), `is_coming_soon` (62 712) y `content_descriptorids` (45 621). Steam omite los falsos y las listas vacías. No hace falta `include_basic_info`.
- Mal, porque en M1 faltan los ≈204 bloqueados en ES (se apuntan pegando el enlace) y ≈750 nombres traducidos se quedan sin su nombre base. Frente al volcado, 1 461 nombres base distintos (0,74 %), muchos solo por espacios, ™ o emojis, y 2 442 `nameEs` frente a los 3 221 de la copia congelada. Se corrige en M2 con `GetAppList`.
- Neutral: frente a la copia congelada del 28-10-2026 (196 665 juegos), hay 196 654 comunes, 377 altas y 11 bajas (3 de ellas por la lista negra).
  - Renombrados: 1 489 (0,76 %), casi todos por el nombre base del plan B. Por eso la primera versión se salta la puerta de renombrados, y en M2 habrá que relanzar con `--skip-delta-gates`.
  - `pop`: igual en el 99,83 %.
  - `flags`: 302 «próximamente» ya publicados; en «fecha por confirmar», 105 bits nuevos y 197 que se quitan, en parte por la regla de la §7.6 sin `coming_soon_display`.

### Confirmación

- Cada `catalog:build` ejecuta las puertas de la §4.6 con `@gameagenda/core/search-quality` (el mismo código que las pruebas de `core`) y, si una falla, no escribe `pipeline/out/`.
- Hay pruebas del pipeline sin red, sobre `fixtures/steam/`: política HTTP, contrato, clasificación, puertas, plan B y determinismo.
- La app carga el catálogo nuevo. `e2e/full-catalog.spec.ts` pasa, con su recuento fijo de 196 665 cambiado por el del *manifest*:
  - 197 031 filas; Fin y la barra llegan a la última;
  - `search:ready`: 0,66 s en la primera visita y ≈0,45 s tras reiniciar con caché;
  - pulsación: p95 de 31,9 ms.

## Más información

- Informes de la ejecución (no se versionan): `pipeline/state/reports/20261029.1/`, con `build.json`, `coverage.json`, `coverage-missing.tsv`, `excluded.tsv` y `frozen-diff.json`.
- Zod sin JIT (`z.config({ jitless: true })`, como en `core`) valida las 208 páginas en ≈0,94 s, frente a ≈0,38 s con JIT: no se nota en una pasada de 10 min.
- Se revisa en M2: nombre base con `GetAppList`, H1 y H2 reales, estado en la *Release* `catalog-state` y firma del *manifest* (ADR-007).
