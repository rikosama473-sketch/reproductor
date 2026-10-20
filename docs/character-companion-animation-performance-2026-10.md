# Rendimiento del personaje acompañante — 20 de octubre de 2026

## Problema

El acompañante podía quedar oculto cuando la música estaba pausada, pero su elemento `img` mantenía el archivo GIF/WebP/APNG adjunto. En móviles, seguir cargando una animación innecesaria puede retener el decodificador y memoria aunque el personaje no esté visible.

## Cambio

- `src/app.js` conserva la URL actual del personaje, pero solo la asigna al elemento pequeño cuando la reproducción está activa.
- Al pausar, se oculta el acompañante y se quita el atributo `src` del elemento de reproducción, para dejar de decodificar fotogramas.
- Al reanudar, se restaura la fuente de imagen guardada y vuelve la animación. El objeto URL y el Blob de IndexedDB se conservan, por lo que el personaje personalizado no se pierde ni vuelve a pedirse desde Internet.
- La vista previa de Ajustes conserva la imagen para que el usuario pueda comprobar qué personaje eligió.
- La caché del shell PWA se incrementó a `ritmo-shell-v43` y se añadieron pruebas de regresión en `scripts/character-companion-check.mjs`.

## Validación y límites

La suite verifica que el elemento principal retire su fuente al pausar y la restaure al reproducir. Esto no mide consumo de CPU en todos los teléfonos; se necesita una comprobación de batería/memoria en un dispositivo real.

El GIF del usuario debe elegirse una vez en Ajustes → **Tu personaje acompañante**. La imagen predeterminada incluida con Ritmo es independiente de la imagen personalizada, que se guarda en ese dispositivo.
