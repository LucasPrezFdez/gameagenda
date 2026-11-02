# Protocolo: prueba guiada de M3 (CA3.6)

**Qué se comprueba** (§2.4, O-1 y O-2): que apuntar es rápido y acierta a la primera con personas que no son el desarrollador.
- **O-1:** ninguna captura pasa de 5 s, de abrir la paleta a ver la confirmación.
- **O-2:** al menos el 80 % de las capturas se hacen sin flechas ni Deshacer.

**Con quién:** 3–5 personas, al menos 2 ajenas al proyecto, cada una con 10 juegos dictados. Usan tu móvil y tu PC y no escriben nada suyo, así que no cuentan como probadores externos (§11.2) y no se guarda nada de ellas.

**Cuánto lleva:** unos 5 minutos por persona.

## 1. Antes de empezar

- **Una ventana privada para cada persona**, en el móvil (Chrome o Safari) y en el PC: así empieza con Mi lista vacía y, al cerrarla, no queda nada. Entra en https://ga-web.gameagenda.workers.dev y **espera a que cargue el catálogo**: unos segundos, hasta que al teclear «celeste» salga Celeste (sin pulsar Intro: luego `Esc`). Esto lo haces tú, antes de que llegue la persona.
- **Abre Ajustes › Rendimiento** y pulsa «Borrar las medidas»: el panel contará solo las 10 capturas de esa persona. Vuelve a Mi lista.
- **Ten a mano la hoja del apartado 4** para anotar.
- **Mitad y mitad:** si puedes, que unas personas lo hagan en el móvil y otras en el PC.

## 2. Qué se le dice

> «Te voy a decir el nombre de un juego. Apúntalo en la lista lo más rápido que puedas, como lo escribirías tú. En el móvil, toca la barra de abajo; en el PC, pulsa Ctrl+K. Si te equivocas, arréglalo como quieras.»

No le enseñes nada más: ni las flechas, ni Intro, ni Deshacer. Si pregunta, repite el nombre del juego.

## 3. Los 10 juegos

Díctalos así, en este orden, cuando la persona esté lista. Espera a que salga la confirmación («Apuntado en Quiero jugar: …») antes de decir el siguiente.

| # | Dicta | Debe quedar apuntado |
|---|---|---|
| 1 | «Elden Ring» | ELDEN RING |
| 2 | «Hollow Knight» | Hollow Knight |
| 3 | «Baldur's Gate 3» | Baldur's Gate 3 |
| 4 | «Hades 2» | Hades II |
| 5 | «Stardew Valley» | Stardew Valley |
| 6 | «GTA 5» | Grand Theft Auto V Enhanced |
| 7 | «The Witcher 3» | The Witcher 3: Wild Hunt (con o sin «Remastered») |
| 8 | «Los Sims 4» | The Sims™ 4 |
| 9 | «Counter-Strike 2» | Counter-Strike 2 |
| 10 | «Red Dead Redemption 2» | Red Dead Redemption 2 |

Escritos como se dicen, todos salen los primeros (comprobado sobre el catálogo congelado el 02-11-2026, también «gta 5», «hades 2», «witcher 3» y «sims 4»). Ojo con un atajo: «hollow» a secas da otro juego, Hollow. Si la persona se para ahí, cuenta lo que haga después.

**Qué anotas por juego:**
- **Flechas:** si usó `↑` o `↓`, o tocó una fila que no era la primera.
- **Deshacer:** si deshizo algo o quitó un juego mal apuntado.
- **Mal:** si quedó apuntado otro juego o uno a mano. Cuenta como captura sin acierto.

El tiempo no lo cronometras tú: lo mide la app.

## 4. Al acabar cada persona

1. Abre **Ajustes › Rendimiento**. En la fila «Apuntar: abrir la paleta → confirmación» tienen que salir **10 muestras**. Con 10, el p95 es la captura más lenta.
2. Pulsa **«Copiar informe»** y pégalo en una nota. Si no deja copiarlo, el informe sale en un campo para copiarlo a mano.
3. Rellena la fila de la persona y cierra la ventana privada.

| Persona | ¿Ajena al proyecto? | Dispositivo | p50 (s) | Máximo, p95 (s) | Con flechas | Con Deshacer | Mal | Sin flechas ni Deshacer (de 10) |
|---|---|---|---|---|---|---|---|---|
| A | | | | | | | | |
| B | | | | | | | | |
| C | | | | | | | | |
| D | | | | | | | | |
| E | | | | | | | | |

No apuntes nombres: «A», «B»… bastan.

**Pasa si:**
- ningún máximo pasa de 5 s (O-1);
- de todas las capturas, al menos el 80 % van sin flechas ni Deshacer y sin estar mal (O-2).

## 5. Dónde guardarlo

Pega en el chat la tabla y los informes copiados. El asistente los guardará en `docs/medidas/prueba-guiada-m3-AAAAMMDD.md`, calculará O-1 y O-2 y, si algo falla (un juego que nadie acierta a la primera, por ejemplo), propondrá el arreglo de la búsqueda.
