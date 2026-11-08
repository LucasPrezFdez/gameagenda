# Registro de actividades de tratamiento

Registro del art. 30 RGPD. Es obligatorio aunque el proyecto sea pequeño, porque la exención del art. 30.5 no cubre los tratamientos habituales (§11.2 de `prototipe.md`). Es un documento interno y no se publica. Lo que ven los usuarios está en la política de privacidad (`apps/web/src/legal/texts.ts`, en `/privacidad`).

- **Versión:** 1, del 08-11-2026, con la versión 1 de los textos legales (M4, CA4.7).
- **Cómo se hizo:** a partir de la estructura de Facilita RGPD de la AEPD, para tratamientos de bajo riesgo.
- **Revisión:** cada vez que cambie qué datos se tratan, para qué, con quién o durante cuánto tiempo. Hay que cambiar a la vez este registro, la política y su `LEGAL_VERSION`.

## Responsable

| Campo | Valor |
|---|---|
| Responsable | **Pendiente:** el nombre o alias que decida el usuario, el mismo de `apps/web/src/legal/controller.ts` |
| Contacto | **Pendiente:** el correo de contacto, el mismo de `controller.ts` |
| Delegado de protección de datos | No hace falta: no hay tratamiento a gran escala ni datos de categorías especiales (art. 37 RGPD) |

## Actividad 1 · Sincronización de la agenda (M4)

| Campo | Contenido |
|---|---|
| Finalidad | Tener la misma agenda de videojuegos en los dispositivos del usuario y una copia fuera de ellos |
| Base jurídica | Art. 6.1.b RGPD: es el servicio que pide el usuario al activarla, con un gesto explícito |
| Interesados | Usuarios que activan la sincronización y declaran tener 14 años o más (art. 7 LOPDGDD) |
| Datos | La agenda: juegos, estados, marcas, fechas, notas, orden y lápidas. El nombre que el usuario da a cada dispositivo y cuándo sincronizó por última vez. Los SHA-256 de las credenciales, del código de recuperación y de los códigos de emparejamiento. No hay email, nombre, contraseña ni IP. Las notas son texto libre, y el usuario podría escribir en ellas datos de terceros: es su responsabilidad |
| Destinatarios | Cloudflare, Inc., encargado del tratamiento: Workers y D1, con su DPA (<https://www.cloudflare.com/cloudflare-customer-dpa/>). No hay cesiones |
| Transferencias internacionales | D1 está en la jurisdicción UE. La micro-API se ejecuta en el centro de datos de Cloudflare más cercano al usuario, que puede estar fuera de la UE. Garantías: Cloudflare está adherido al Marco de Privacidad de Datos UE-EE. UU., y su DPA incluye las cláusulas contractuales tipo (Decisión 2021/914) para cuando el marco deje de valer |
| Plazos | Mientras el usuario mantenga la agenda. Con «Borrar todos mis datos», se borra en cascada. A los 13 meses sin sincronizar, se borra sola. Las lápidas y los esqueletos duran 90 días tras borrarlos. Los códigos de emparejamiento, 10 minutos o hasta usarlos. Time Travel de D1 conserva lo borrado 7 días |
| Medidas de seguridad | HTTPS y HSTS. Cookie `__Host-` `HttpOnly` `Secure` `SameSite=Lax`, y en D1 solo SHA-256 de secretos de ≥128 bits. Zod estricto, tope de tamaño en cada ruta y `Origin` propio en todo lo que no es GET. Límites por IP (con el SHA-256 de la IP) y por *token*. Sin registros de cuerpos ni de *tokens*. Interruptor `SYNC_ENABLED`. ADR-011 y §11.4 |

## Actividad 2 · Buzón del Atajo de iOS (M4)

| Campo | Contenido |
|---|---|
| Finalidad | Apuntar en la agenda un juego compartido desde iOS sin abrir la app |
| Base jurídica | Art. 6.1.b RGPD: lo pide el usuario al crear el *token* y usar el atajo |
| Interesados | Usuarios de la sincronización que crean un *token* del buzón |
| Datos | El enlace canónico de la tienda de Steam (`appid` y *slug*), la fecha y el SHA-256 del *token*, con su nombre y su última vez |
| Destinatarios | Cloudflare, Inc., como encargado (ver la actividad 1) |
| Transferencias | Como en la actividad 1 |
| Plazos | Cada enlace dura hasta que una app de la agenda lo apunta. El *token*, hasta revocarlo o borrar la agenda |
| Medidas de seguridad | *Token* de solo escritura en `Authorization`, nunca en la URL. Solo admite enlaces de Steam. Límite por *token*, tope de 200 enlaces pendientes y revocación desde la lista de dispositivos |

## Actividad 3 · Portadas de los juegos (M2)

| Campo | Contenido |
|---|---|
| Finalidad | Enseñar la portada de cada juego |
| Base jurídica | Art. 6.1.f RGPD, interés legítimo, con oposición en un toque («Cargar portadas») |
| Datos | La IP del usuario y su navegador, que llegan a Valve cuando el navegador pide la imagen. GameAgenda no recibe ni guarda nada |
| Destinatarios | Valve Corporation (EE. UU.), que decide por su cuenta qué hace con ello. Es responsable de su propio tratamiento, no encargado nuestro. Declara estar adherida al Marco de Privacidad de Datos UE-EE. UU. |
| Plazos | GameAgenda no guarda nada. Las portadas se quedan en la caché del navegador (≈300, LRU) |
| Medidas | `referrerpolicy="no-referrer"`, sin cookies, aviso de primera capa e interruptor general de las portadas en el catálogo |

## Actividad 4 · Nombres de juegos que no están en el catálogo (`resolve`, M4)

| Campo | Contenido |
|---|---|
| Finalidad | Completar el nombre de un juego apuntado con un enlace cuando el catálogo local no lo tiene |
| Base jurídica | Art. 6.1.b RGPD: forma parte de apuntar el juego, que es lo que pide el usuario |
| Datos | El `appid` y la IP de la petición, que llegan a Cloudflare. La app pide sin cookies, y la IP solo pasa por el límite como SHA-256. En D1 se guarda el nombre público del juego, sin saber quién lo pidió |
| Destinatarios | Cloudflare, como encargado. Valve recibe el `appid` desde el servidor, nunca la IP del usuario |
| Plazos | La caché de nombres dura 30 días, y la de «Steam no lo conoce», 1 día. No son datos personales |

## Actividad 5 · Protección del servicio

| Campo | Contenido |
|---|---|
| Finalidad | Evitar abusos y agotar la cuota gratuita (100 000 peticiones al día) |
| Base jurídica | Art. 6.1.f RGPD, interés legítimo en la seguridad del servicio (considerando 49) |
| Datos | El SHA-256 de la IP, o del *token* en el buzón, en los contadores aproximados de Cloudflare (`ratelimits`) |
| Plazos | Lo que dure la ventana del contador: 60 s |

## Lo que no se trata

- No hay analítica, publicidad ni cookies de terceros, así que no hace falta un banner (art. 22.2 LSSI).
- Sin sincronizar, la agenda, los ajustes, el registro de errores y las medidas de rendimiento se quedan en el dispositivo. El responsable no los recibe.
- GitHub (EE. UU.) guarda el estado del pipeline del catálogo, con datos públicos de Steam y ningún dato de usuarios.

## Derechos (arts. 15–22)

- Acceso y portabilidad: exportar en JSON o CSV.
- Rectificación: editar en la app.
- Supresión: «Borrar todos mis datos», que también borra la agenda del servidor si está emparejado.
- Oposición a las portadas: «Cargar portadas».
- Por correo: plazo de un mes (art. 12.3).
- Sin identificadores, el responsable no puede encontrar una agenda a partir de un correo (art. 11 RGPD). Por eso se ayuda al usuario a hacerlo desde un dispositivo emparejado, y nunca se pide el código de recuperación.
