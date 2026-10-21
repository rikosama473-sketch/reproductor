# Paleta de sonidos de interfaz con prioridad de voz — 21 de octubre de 2026

## Resultado

Ritmo incorpora 10 perfiles nuevos, pasando de 30 a 40. Los timbres se generan con la Web Audio API; no se añaden paquetes ni muestras descargadas. La preferencia sigue desactivada por defecto y se conserva en el almacenamiento local.

## Perfiles añadidos

| Clave | Nombre visible | Característica |
|---|---|---|
| `felt` | Piano de fieltro | Ataque de triángulo suave, tono medio-grave y cola de 44 ms. |
| `lofi` | Lo-fi aterciopelado | Pulso cálido filtrado; sin ruido de fondo agregado. |
| `pixel` | Píxel pastel | Timbre retro de onda triangular en vez de cuadrada. |
| `musicbox` | Caja musical tenue | Nota sinusoidal corta y un armónico de bajo nivel. |
| `ceramic` | Cerámica mate | Toque de ruido filtrado, sin resonancia larga. |
| `water` | Gota de agua suave | Frecuencia descendente y caída de 35 ms. |
| `analog` | Sintetizador analógico suave | Barrido bajo de triángulo y filtro de 520 Hz. |
| `windchime` | Carillón de viento tenue | Nota breve con filtro de paso bajo. |
| `typewriter` | Tecla mecánica suave | Clic acolchado de 18 ms; no se activa al escribir. |
| `moonlight` | Luz de luna | Dos tonos leves y filtrados en la zona grave. |

## Protección de música, voz y controles de diseño

- El nivel máximo de ganancia principal pasa de `0.035` a `0.025`.
- La atenuación cuando hay un elemento multimedia activo pasa de `0.10` a `0.06`.
- El enfriamiento entre efectos automáticos pasa de 90 a 125 ms para reducir ráfagas en interfaces con muchos botones.
- Se conserva la detección de reproducción en elementos `audio`/`video` y en reproductores incrustados conocidos. Cuando el reproductor está activo, los efectos reciben solo el 6 % de la ganancia que correspondería al volumen seleccionado.
- Los efectos se omiten si `speechSynthesis.speaking` o la muestra del estudio vocal está activa. El evento de inicio de muestra corta inmediatamente el bus de efectos.
- El editor del personaje, el estudio vocal, los controles de ecualización y controles marcados como exclusión siguen sin sonidos de clic.
- El sonido solo se reproduce tras una activación explícita de la función y una interacción confiable. No hay sonidos de hover, scroll ni escritura, y la muestra de voz conserva su propia ruta.
- El menú agrupa los perfiles por carácter para que los 40 nombres no formen una sola lista plana.

La atenuación de música y el silencio de voz son controles preventivos de la aplicación; el nivel percibido también depende del sistema, el dispositivo de salida, la pista y los ajustes personales. No se afirma una medida de sonoridad idéntica para todos los equipos.

## Referencias técnicas revisadas

- [MDN — Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices): crear/reanudar el contexto en respuesta a una interacción y dar al usuario controles de mute y volumen.
- [MDN — Using the Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API): advierte que el audio inesperado puede resultar intrusivo y que los navegadores aplican políticas de reproducción automática.
- [UI SFX — implementación de referencia](https://github.com/romainsimon/uisfx): separación entre personalidad sonora y evento de interfaz, preferencias persistentes, rate limit y voces acotadas. Ritmo no importa este paquete ni sus assets.
- [Jellyfin Web — changelog](https://github.com/jellyfin/jellyfin-web/releases): sus notas de versiones recuerdan que la limpieza de listeners y el estado de la reproducción son asuntos de mantenimiento permanentes en apps multimedia.
- [Josh W. Comeau — use-sound y accesibilidad](https://www.joshwcomeau.com/react/announcing-use-sound-react-hook/): el audio debe ser opcional y no interferir con narración de lectores de pantalla. Ritmo mantiene el sonido desactivado por defecto.

## Regresiones cubiertas

`scripts/ui-sounds-check.mjs` verifica el catálogo de 40 claves, etiquetas y opciones del selector, límites de ganancia, atenuación multimedia, intervalo mínimo, exclusión de voz y personaje, y empaquetado offline/web/Android. La versión del Service Worker cambia a `ritmo-shell-v52` y las aserciones de integración se actualizan a esa misma versión.

## Validación pendiente

El workflow de validación de GitHub Actions debe pasar en el PR antes de integrar. Las pruebas estáticas y de regresión no equivalen a medir acústicamente el efecto en cada teléfono; comprobar la mezcla en altavoces y auriculares reales continúa siendo recomendable.
