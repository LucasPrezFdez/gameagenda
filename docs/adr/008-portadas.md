# ADR-008 · Portadas desde el CDN de Valve y aviso de privacidad

- **Estado:** propuesta
- **Fecha:** 31-10-2026
- **Deciden:** el usuario y el asistente

## Contexto y problema

Desde M2, Mi lista, la paleta y la ficha llevan portada (§9.5, regla 5). Los ficheros de imagen son de Valve, y el catálogo solo publica, por juego, `asset_url_format` y los nombres de `library_capsule` y `header` en los *shards* de detalles (§4.10 y §7.6). Pedirlas desde el navegador manda la IP del usuario a Valve, en EE. UU. (§11.2), y la app tiene que seguir siendo «rápida y ágil»: nada se mueve bajo el cursor y nada bloquea la captura (§9.5).

¿De dónde salen las portadas, cuándo se piden y qué se le dice al usuario antes de la primera?

## Factores de la decisión

- Privacidad (§11.2): sin banner de cookies, pero con aviso de primera capa antes de la primera portada, interruptor «Cargar portadas» y «Datos de Steam que guardamos» (CA2.7).
- Derechos: republicar una copia es una nueva comunicación pública (TJUE, Renckhoff, C-161/17), así que las portadas se enlazan y nunca se copian a un servidor propio (§11.1).
- Integridad (CA2.6): ninguna URL fuera de `asset_url_format`; las rutas sin *hash* dan 404 o arte viejo (§4.10).
- Rendimiento: JS inicial ≤150 KB brotli (§6.2), sin tareas largas al teclear (RNF-03) y huecos fijos de 2:3 (§9.5, reglas 3 y 4).
- CSP sin `unsafe-inline` y con `img-src` limitado a `https://shared.akamai.steamstatic.com` (§11.3).
- *Kill switches* `covers` y `details` en el *manifest* (CA2.3).

## Opciones consideradas

1. Enlazar el CDN de Valve desde el navegador con las URL de los *shards*, tras un aviso de primera capa que solo informa y con «Cargar portadas» encendido por defecto.
2. Lo mismo, pero con las portadas apagadas hasta que el usuario las encienda (consentimiento previo).
3. Copiar las portadas a `ga-catalog` (o a otro servidor propio) y servirlas desde allí.
4. Sin portadas: solo la generada con las iniciales.

## Decisión

Opción elegida: **1**, porque da portadas desde el primer día sin servidor propio ni copia, informa antes de la primera petición y deja apagarlas en un toque, como pide la §11.2 (base propuesta: interés legítimo, art. 6.1.f RGPD, a validar al redactar la política).

### Cómo se construye la URL (`apps/web/src/details/cover-url.ts`)

- `https://shared.akamai.steamstatic.com/store_item_assets/` + `asset_url_format` con `${FILENAME}` sustituido por el fichero, sin tocar el `?t=`.
- El formato tiene que llevar `${FILENAME}` una sola vez, con segmentos de ruta normales delante (`steam/apps/730/`) y, detrás, nada o una consulta (`?t=…`). El fichero solo admite segmentos de ruta sin `..` (`library_600x900.jpg`, `<sha1>/library_capsule.jpg`). Lo demás no se pide: queda la portada generada.
- Orden: `library_capsule`, después `header` (si falla la primera) y, si no hay ninguna o fallan, la generada con CSS.

### Cuándo se piden

- Las filas de Mi lista piden sus detalles al acercarse a la pantalla (un `IntersectionObserver` compartido, 600 px de margen); la ficha, al abrirse; la paleta, tras 150 ms sin teclear. La imagen va con `loading="lazy"`, `decoding="async"`, `referrerpolicy="no-referrer"` y `crossorigin="anonymous"` (sin cookies ni página de origen).
- La imagen se pinta encima de la portada generada, en el mismo hueco de 2:3: lo que llega tarde no mueve nada.
- Sin peticiones a Valve cuando «Cargar portadas» está apagado, con el *kill switch* `covers` (o `details`), sin índice de *shards* o mientras el aviso de primera capa no ha salido.

### Aviso de primera capa (`components/CoverNotice.tsx`)

- Ajuste `coverNotice`: `unseen` → `shown` → `done`. Mientras está en `unseen`, las portadas que ya tienen URL esperan y lo piden; el aviso sale (fijo abajo, sin empujar la lista) y, tras pintarse, pasa a `shown`: solo entonces se cargan.
- Sigue a la vista hasta «Entendido» o «Desactivar portadas» (que apaga el ajuste); «Más información» abre Ajustes › Privacidad, donde el aviso no sale.
- La paleta no lo saca (taparía la captura): sus portadas esperan a que haya salido en Mi lista o en la ficha.
- Texto, en la §9.9.

### Detalles de los *shards* (`apps/web/src/details/`)

- `details-store.ts`, en el JS inicial y sin Zod: estado por `appid` (`loading`, `ready` o `unavailable`) con suscripción para `useSyncExternalStore`, peticiones del mismo pintado juntas y agrupadas por *shard*, reintento tras 30 s si falla la red, y el *kill switch* `details`.
- `details-source.ts`, en un *chunk* diferido con Zod: el índice (comprobado con el `sha256` y los bytes del *manifest*), los *shards* (el SHA-256 empieza por el *hash* del nombre y el esquema de `core` valida), como mucho 4 a la vez y cediendo el hilo entre uno y otro. Se guardan en Cache Storage `gacat-details` y, con un índice nuevo, se borra en un rato ocioso lo que ya no es suyo.

### Consecuencias

- Bien, porque no hay servidor ni copia de las imágenes: el CDN de Valve las sirve con `Access-Control-Allow-Origin: *` y caché de ≈10 años (§4.10).
- Bien, porque el aviso sale antes de la primera petición y apagar las portadas es un toque, en el aviso o en Ajustes › Privacidad.
- Bien, porque el JS inicial solo crece con la parte sin Zod: 121,0 KB brotli tras M2 parte C, frente a 114,8 KB (presupuesto 150 KB); el *chunk* de los *shards* va aparte.
- Mal, porque la IP del usuario llega a Valve (EE. UU.): se declara en «Datos de Steam que guardamos» y en la política completa (antes del primer probador externo).
- Mal, porque un juego cuyos ficheros fallan en el CDN se queda con la portada generada hasta el siguiente catálogo.
- Mal, porque el Worker de búsqueda borra todas las cachés `gacat-*` al cambiar de versión (también `gacat-details`): los *shards* se vuelven a pedir (a la caché HTTP, porque son inmutables). Se corrige limitando ese borrado a `gacat-<versión>`.
- Pendiente (M2): comprobar en el dispositivo el peso de los `portrait.png` antiguos (alguno, 545 KB; §4.10) y, en Safari, que `crossorigin="anonymous"` no rompe la caché del CDN.
- Pendiente: CA2.6 con una agenda de 300 juegos reales cuando el pipeline publique los *shards*.

### Confirmación

- **Vitest, sin red:** `cover-url.test.ts` (formato, rutas no válidas y orden), `details-source.test.ts` (*hashes*, esquema, Cache Storage, sin red, un 404, limpieza al cambiar de índice y concurrencia) y `details-store.test.ts` (agrupación, *kill switches*, índice nuevo, reintento y demanda de portadas).
- **E2E** (`covers.spec.ts`, Chromium y `webkit-movil`): el aviso sale antes de la primera petición a Valve; `library_capsule` → `header` → generada; con «Cargar portadas» apagado, tras «Desactivar portadas» o con el *kill switch* `covers`, 0 peticiones a `*.steamstatic.com`; axe y 0 violaciones de CSP. Las imágenes se sirven con `context.route`: ninguna prueba llega al CDN real.

## Pros y contras de las opciones

### 1 · CDN de Valve tras un aviso que informa

- Bien, porque es lo que pide la §11.2 y no añade infraestructura.
- Mal, porque la IP llega a Valve desde la primera portada.

### 2 · Portadas apagadas hasta encenderlas

- Bien, porque nada sale del dispositivo sin un gesto.
- Mal, porque casi nadie las encendería y Mi lista perdería lo que más ayuda a reconocer un juego de un vistazo; la §11.2 propone interés legítimo con oposición en un toque.

### 3 · Copia en un servidor propio

- Bien, porque la IP no llegaría a Valve.
- Mal, porque es una nueva comunicación pública de obras ajenas (Renckhoff) y multiplicaría el tamaño de cada despliegue de `ga-catalog`.

### 4 · Solo la portada generada

- Bien, porque es lo más privado y lo más ligero.
- Mal, porque no cumple M2 (§15.5) ni el CA2.6.

## Más información

- **En `prototipe.md`:** [§4.10](../../prototipe.md#410-imágenes-portadas) (URL), [§7.6](../../prototipe.md#76-formatos-publicados-del-catálogo) (*shards* y cachés), [§9.5](../../prototipe.md#95-reglas-de-respuesta-inmediata-m1-portadas-desde-m2) (imágenes diferidas), [§9.9](../../prototipe.md#99-microcopy-español-de-españa) (texto del aviso), [§11.2](../../prototipe.md#112-privacidad-rgpd-lopdgdd-y-lssi) y [§11.3](../../prototipe.md#113-seguridad-de-la-app-y-del-catálogo) (CSP), y [§15.5](../../prototipe.md#155-m2--catálogo-vivo-v020--45-días-ideales) (CA2.6–CA2.8).
- **Porqué:** [`DECISIONES.md`](../planificacion/DECISIONES.md), §10.10 (M2 trae la ficha completa y Próximos).
- **Relacionados:** ADR-001 (catálogo estático), ADR-006 (formato del catálogo) y ADR-007 (pipeline, *manifest* firmado y *kill switches*).
