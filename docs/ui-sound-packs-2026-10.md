# Sonidos de interfaz discretos — 20 de octubre de 2026

Ritmo conserva su ecualizador de música por separado. Estos perfiles solamente generan respuesta sonora para los clics de interfaz.

## Perfiles disponibles

- **Piano clásico:** nota suave y amortiguada.
- **Punk / rock suave:** acorde sintetizado con frecuencias altas limitadas.
- **Cibernético:** pulso electrónico corto.
- **Madera suave:** pequeño transitorio filtrado, sin ruido agudo sostenido.
- **Cristal delicado:** campanilla breve y amortiguada.
- **Retro 8-bit:** pulso cuadrado muy corto y filtrado.
- **Sintetizador cálido:** nota redonda de medios-bajos.
- **Clic minimalista:** transitorio discreto de baja frecuencia.

Son aproximaciones sintetizadas mediante Web Audio, no grabaciones de instrumentos. Se generan localmente sin peticiones de red, bibliotecas extra ni archivos de audio.

## Protección de voces y experiencia visual

- El nivel máximo del bus de efectos está limitado por código; el control del usuario solo puede reducirlo.
- Cuando el reproductor de audio está reproduciendo o existe un reproductor musical externo incrustado, el nivel de los efectos cae al 15% del valor seleccionado. Con contenido incrustado, la detección es conservadora porque el estado de reproducción de un iframe externo no es legible directamente.
- Los tonos duran entre 24 y 82 ms; el efecto punk está filtrado para limitar agudos y no produce un acorde largo.
- Los clics automáticos tienen una pausa mínima entre efectos, y no se reproducen por eventos sintéticos de la página. Escribir en campos no dispara sonidos.
- Los sonidos no cambian las pistas de audio, la ecualización, las voces, el volumen de la música ni la representación visual del personaje.

Los ajustes se guardan en el dispositivo, empiezan desactivados y tienen control de volumen entre 0 y 100. La caché offline se actualiza a ritmo-shell-v45; las pruebas automáticas verifican estilos, límite de ganancia, atenuación y empaquetado web/Android. Se necesita una escucha real para evaluar el timbre en distintos equipos.
