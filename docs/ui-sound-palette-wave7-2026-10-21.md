# Paleta de sonidos, onda 7: ducking de reproducción y ritmo adaptativo
**Fecha:** 21 de octubre de 2026

## Hallazgo técnico: el motor nativo no aparece en el DOM

El atenuador de sonidos de interfaz detectaba reproducción buscando elementos HTML `audio` y `video`. Ritmo en Android usa Media3 para algunas pistas locales y streams; durante esas sesiones el audio podía sonar sin que hubiera un elemento HTML activo. En ese camino, los efectos no reducían su ganancia y podían competir con una canción o una voz.

## Corrección

- `updatePlayer()` comunica el estado real mediante el evento local `ritmo:playback-context`, con origen `native`, `local`, `youtube`, `spotify` o `none`.
- El sintetizador trata como música activa el estado comunicado por cualquier motor, además de revisar medios HTML e iframes integrados.
- Si la música comienza mientras una nota UI aún está decayendo, el nodo de ganancia se atenúa en una transición de 3 ms; no espera al siguiente clic.
- Se conserva el factor de atenuación `0.04` y la ganancia máxima `0.025`, y se mantiene el silencio total durante vistas previas vocales.

## Ritmo adaptativo y estilos nuevos

El ritmo automático ahora también influye en la densidad de clics: Pop admite un mínimo de 170 ms entre sonidos; Cyber, 150 ms; y Suave, 240 ms. La cadencia solo controla respuestas a clics del usuario: no hay una pista de clics en bucle ni se afirma sincronización BPM.

El catálogo pasa a 80 timbres y añade Vibráfono aterciopelado, Shamisen tenue, Caña suave, Metal apagado, Tambor de marco, Bajo de circuito, Barrido suave y Circuito digital. Los ocho nuevos perfiles se sintetizan localmente, con amplitudes individuales bajas y colas breves.

## Pruebas y publicación

`scripts/ui-sounds-check.mjs` comprueba la lista exacta de 80 perfiles, las opciones visibles, los ocho nuevos sintetizadores, el cálculo de la cadencia Pop/Cyber/Suave, el evento de estado de todos los motores y la reducción inmediata de ganancia al empezar la música. El service worker usa `ritmo-shell-v59`.
