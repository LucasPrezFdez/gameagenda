## 11. Seguridad, privacidad y cumplimiento

### 11.1 Condiciones de la Steam Web API (ToU, julio de 2010)

| Obligación | Cómo se cumple |
|---|---|
| Máximo **100 000 llamadas/día** | ≈ 204/día en el job del catálogo; la importación de cuentas, con cuotas por usuario y cola |
| Clave **confidencial**, sin compartirla | Solo en secretos de CI y del Worker; nunca en el repositorio ni en el bundle; se envía en la cabecera `x-webapi-key`. Rotarla si se filtra |
| **Política de privacidad**; informar de qué datos de Steam se guardan y **en qué país** | Política en español, por capas; *hosting* en la UE |
| Obtener datos de un usuario **solo a petición suya** | La importación la lanza siempre el propio usuario |
| No insinuar respaldo de Valve | Nombre neutro («GameAgenda», sin «Steam» en el nombre ni en el icono); aviso de marca en «Acerca de»; botones oficiales «Sign in through Steam»; enlaces a Steam sin `rel="nofollow"` |
| Borrar los datos de Steam al terminar | Opción «Desconectar Steam y borrar datos» |
| Uso comercial | Los ToU no dicen nada. **Antes de monetizar, consultar a Valve.** |

Aviso de marca recomendado: *«Steam y el logotipo de Steam son marcas comerciales o registradas de Valve Corporation en EE. UU. y otros países. GameAgenda no está afiliada ni respaldada por Valve.»*

### 11.2 RGPD / LOPDGDD (operador en España)

- **Prototipo local-first:** las listas viven en el dispositivo. No hay cuentas ni datos personales en nuestros servidores, lo que reduce mucho las obligaciones. Aun así se publica un aviso de privacidad, porque el CDN de Steam recibe la IP del usuario (la sentencia del LG München de 2022 sobre Google Fonts es el precedente).
- **Cuando haya sincronización o importación:**
  - El SteamID64 y los datos de juego son **datos personales**. La base jurídica es el art. 6.1.b (contrato).
  - **Minimización:** solo `steamid64` + estado por `appid`, horas y fechas; nada de `realname`, ubicación ni respuestas brutas.
  - Exportación JSON/CSV y borrado, atendidos en un mes (art. 12.3).
  - Información por capas (art. 11 LOPDGDD).
  - Registro de actividades de tratamiento con **Facilita RGPD** (AEPD).
  - Edad mínima de **14 años** (art. 7 LOPDGDD; hay un proyecto de ley para subirla a 16, así que conviene vigilarlo).
- ***Cookies*/almacenamiento local:** solo los estrictamente necesarios: cookie de sesión `HttpOnly` cuando exista login, preferencias e IndexedDB con los datos que el propio usuario introduce. **Sin banner de consentimiento.** Cualquier analítica de terceros lo necesitaría: el prototipo **no** la incluye (como mucho, analítica propia agregada y anónima con *opt-out*).

### 11.3 Seguridad (OWASP ASVS nivel 1 como referencia)

- **Cabeceras:**
  - CSP estricta: `default-src 'self'`; `img-src 'self' https://shared.akamai.steamstatic.com https://shared.fastly.steamstatic.com data:`; `connect-src 'self' https://<edge-api>`.
  - `Referrer-Policy: strict-origin-when-cross-origin`, `X-Content-Type-Options: nosniff` y `Permissions-Policy` mínima.
- **Edge API:**
  - Validación de entrada con Zod (los `appid` son enteros y van en una lista blanca de rutas).
  - *Rate limiting* por IP.
  - Solo puede llamar a destinos permitidos (`api.steampowered.com`, `store.steampowered.com`); nunca es un proxy abierto.
  - Respuestas cacheadas.
- **Contenido de Steam:** las descripciones se tratan siempre como **texto no confiable**. Se renderizan como texto o se sanean; nunca se inyecta HTML de Steam.
- **Dependencias:** Dependabot/Renovate, `npm audit` en CI, *lockfile* obligatorio y versiones exactas en lo crítico (p. ej. Prisma tiene una RC como `latest` en npm).
- **Integridad del snapshot:** `sha256` en el `manifest.json`, verificado en el cliente antes de sustituir el catálogo local.
- **Copias de seguridad del usuario:** exportación manual y recordatorio periódico mientras no haya sincronización (Safari borra los datos de webs no instaladas tras 7 días sin uso).
