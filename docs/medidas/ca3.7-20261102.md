# CA3.7: apuntar con el atajo en la app de escritorio instalada (02-11-2026)

**Criterio** (§15.6 de `prototipe.md`):
- con el instalador de `npm run desktop:build`, instalado sin derechos de administrador, `Ctrl+Mayús+Espacio` desde otra aplicación pone delante la ventana con la paleta y el foco, sin recargar la página;
- apuntar así, de pulsar el atajo a ver la confirmación, da p50 ≤3 s en 10 altas;
- volver a pulsarlo oculta la ventana, cerrarla la deja en la bandeja y abrir la app otra vez muestra la que ya está abierta.

**Resultado: cumplido en las 10 altas.**

| Medida | Resultado |
|---|---|
| Del atajo a la confirmación | p50 de 1,24 s y máximo de 1,98 s |
| Del atajo a la ventana delante | p50 de 28 ms |
| Del atajo a la paleta con el foco | p50 de 37 ms |
| Sin recargar | 10 de 10 en el mismo documento |
| Segunda pulsación | 10 de 10 ocultan la ventana y devuelven el foco a la otra |

**Quién tecleó.** El ADR-010 pedía «una persona al teclado». A petición del usuario, las altas las ha hecho el asistente con tecleo simulado: el ritmo es el de una persona (100 ms por carácter y 300 ms de reacción antes de Intro), pero no es una persona.

## Método

**La app.** GameAgenda 0.2.0, que el usuario instaló con el instalador NSIS por usuario (`%LOCALAPPDATA%\GameAgenda`). Carga `ga-web` de producción tras el despliegue de `279c10a`.

**La otra aplicación.** Una ventana propia, de WinForms desde PowerShell, que se pone delante antes de cada alta. No se usa el Bloc de notas: el 31-10-2026, Windows restauró con él una sesión con `.env.local` abierto.

**El atajo y el tecleo**, con `SendInput`:
- el atajo, con las teclas virtuales;
- el texto, en Unicode, a 100 ms por carácter (el ritmo de la §12.3);
- cuando la primera fila es la esperada, 300 ms de pausa (lo que tarda una persona en verla) e Intro.

Antes de cada tecla se comprueba que delante está GameAgenda; si no, la prueba se corta sin teclear nada. Un primer intento se cortó así, antes del primer atajo: Windows no dejaba poner delante la ventana de prueba. Se resolvió con `AttachThreadInput`.

**Los tiempos.**
- **Inicio:** desde la llamada a `SendInput` del atajo, con el reloj del sistema (`DateTimeOffset.UtcNow`, de 1 a 16 ms de resolución).
- **Fin:** hasta que el aviso «Apuntado en Quiero jugar: …» aparece en la página. Lo registra un `MutationObserver` con `performance.timeOrigin + performance.now()`.
- **La ventana delante:** se sondea `GetForegroundWindow` cada 5 ms.
- **La paleta con el foco:** se sondea por CDP `document.hasFocus()` y el `combobox` activo.

**La página, por CDP.** La app se abrió con `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333`, en `127.0.0.1` y solo durante la prueba. Después se reabrió sin ese puerto, y se ha comprobado que está cerrado.

**La limpieza.** Las 10 altas se quitaron con «Quitar de mi lista». La agenda de escritorio tenía 2 juegos antes y tiene los mismos 2 después.

Los *scripts* no se versionan, como los del 31-10-2026: un ayudante de PowerShell y uno de Node con Playwright `connectOverCDP`.

## Resultados

Prueba hecha el 02-11-2026, de 00:18:56 a 00:19:18 UTC.

| # | Búsqueda | Apuntado | Caracteres | Atajo → delante | Atajo → paleta | Atajo → «Apuntado» |
|---|---|---|---|---|---|---|
| 1 | `stardew valley` | Stardew Valley | 14 | 31 ms | 40 ms | 1 941 ms |
| 2 | `celeste` | Celeste | 7 | 41 ms | 51 ms | 1 173 ms |
| 3 | `terraria` | Terraria | 8 | 24 ms | 33 ms | 1 226 ms |
| 4 | `hades ii` | Hades II | 8 | 38 ms | 45 ms | 1 250 ms |
| 5 | `portal 2` | Portal 2 | 8 | 22 ms | 31 ms | 1 226 ms |
| 6 | `outer wilds` | Outer Wilds | 11 | 25 ms | 33 ms | 1 699 ms |
| 7 | `disco elysium` | Disco Elysium - The Final Cut | 13 | 40 ms | 47 ms | 1 980 ms |
| 8 | `balatro` | Balatro | 7 | 37 ms | 45 ms | 1 184 ms |
| 9 | `dead cells` | Dead Cells | 10 | 24 ms | 32 ms | 1 450 ms |
| 10 | `factorio` | Factorio | 8 | 23 ms | 31 ms | 1 229 ms |
| | | | | **p50 28 ms** | **p50 37 ms** | **p50 1 240 ms** · máx. 1 980 |

**De dónde sale el tiempo.** Casi todo es teclear: los caracteres por 100 ms, más los 300 ms de reacción. Lo demás, entre 125 y 380 ms por alta, incluye:
- abrir la ventana;
- esperar a que la primera fila sea la buena (que la prueba sondea);
- apuntar y pintar el aviso.

Las altas más largas son las de búsquedas más largas. Una persona que teclee más despacio, a 200 ms por carácter, seguiría por debajo de 3 s con búsquedas de hasta unos 12 caracteres.

## Lo que no se ha repetido

- **La bandeja y la segunda instancia.** Que cerrar la ventana la deja en la bandeja y que abrir la app otra vez muestra la misma lo comprobó el agente el 31-10-2026, con la app instalada (ADR-010, «Confirmación»). La parte nativa no ha cambiado desde entonces.
- **CA3.8** (modo avión de verdad, y el menú de la bandeja con el atajo cogido por otra aplicación) sigue pendiente.
