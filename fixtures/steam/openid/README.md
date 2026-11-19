# Aserciones de OpenID 2.0 de Steam

*Fixtures* de las pruebas del login con Steam (`apps/web/worker/test/steam.test.ts`; ADR-012). El CI nunca llama a Steam.

- `id-res.json`: la vuelta de Steam tras iniciar sesión (`openid.mode=id_res`), con los campos y la lista `openid.signed` que manda Steam. `{steamId}` y `{returnTo}` los rellena el Steam falso de las pruebas (`FakeSteamOpenId`, en `worker/test/steam-support.ts`), que además la firma con su propia clave (`openid.sig`), porque la de Steam no la tiene nadie. Así, `check_authentication` contra el Steam falso hace lo mismo que el de verdad: recalcula la firma de los campos de `openid.signed` y dice `is_valid:true` solo si coincide.
- `check-authentication-valid.txt` y `check-authentication-invalid.txt`: las dos respuestas de `check_authentication`, en el formato clave-valor de OpenID 2.0.

En la prueba a mano con Steam de verdad (paso 5 del encargo), se comparan con lo que devuelve Steam y se ajustan. Nunca se guarda aquí un SteamID64 real ni una firma de Steam.
