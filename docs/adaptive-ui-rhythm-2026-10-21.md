# Ritmo adaptativo de respuesta — Pop y Cyber
**Fecha:** 21 de octubre de 2026

## Comportamiento
Ritmo conserva la paleta de 52 timbres. La opción nueva **Ajustes → Sonidos de interfaz → Ritmo de respuesta** modifica el acento que acompaña a un clic:
- **Automático por género:** reconoce categorías a partir de metadatos fiables de la pista. Pop activa un pequeño acento ascendente; géneros electrónicos conocidos activan dos micropulsos electrónicos.
- **Suave y espaciado:** no añade acentos; permanece un único sonido de interfaz.
- **Pop animado:** añade una sola nota ligera, breve y ascendente después del sonido base.
- **Cyber / electrónico:** añade dos micropulsos cortos y filtrados después del sonido base.

Los acentos solo ocurren cuando el usuario interactúa con un botón. No hay metrónomo, golpes continuos, temporizador de fondo ni generación de sonido en bucle.

## Cómo se determina el género
1. Al importar un MP3, el lector ID3 obtiene `TCON` si ese fotograma está presente; se reconocen identificadores numéricos comunes, entre ellos Pop (13), Dance (3), Techno (18), Industrial (19), Trance (31) y Electronic (38/52).
2. Para emisoras de Radio Browser se pueden usar las etiquetas `radioTags` ya guardadas.
3. Si el género falta o no es reconocible, la opción automática se mantiene conservadora: usa el ritmo suave, salvo que el perfil de sonido elegido sea uno de los efectos digitales/cyber, en cuyo caso acompaña ese carácter. También se puede seleccionar Pop o Cyber manualmente.

No se infiere el género a partir de nombres de artistas o títulos porque sería poco fiable. Tampoco se hace análisis de audio, extracción de BPM ni sincronización con el pulso musical en tiempo real. Esas funciones serían un proyecto aparte; esta versión realiza una adaptación semántica a partir de etiquetas de género.

## Prioridad para música, voz y diseño
- Ganancia máxima global de efectos: `0.025`.
- Al detectar audio/vídeo en reproducción, factor de atenuación: `0.04`.
- Intervalo mínimo entre efectos automáticos: `160 ms`.
- El patrón Pop contiene un microacento de 16 ms; Cyber usa dos microacentos de 14 y 11 ms, ambos con niveles internos bajos.
- Los efectos siguen desactivados por defecto y el volumen inicial de preferencias nuevas es 15 %. Los datos existentes de preferencias no se reescriben.
- La reproducción se mantiene silenciosa durante síntesis de voz y muestras del estudio vocal, y en los controles excluidos de personaje/diseño. No se añaden sonidos de escritura, hover o scroll.

El porcentaje de ganancia es una protección del mezclador de la aplicación, no una medición de sonoridad acústica ni una garantía independiente del volumen del dispositivo.

## Validación
`scripts/ui-sounds-check.mjs` verifica los modos de ritmo, clasificación de géneros reconocidos, preferencia manual, opciones de interfaz, protección de voz, mezcla de audio y que la fuente del reproductor comparta el contexto de género con el módulo de sonidos.

## Referencias técnicas
- [MDN — Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices): controles del sonido, iniciar/resumir el contexto por interacción y tratar el audio como una función opcional.
- [MDN — Using the Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API): generación mediante osciladores, filtros y ganancias, sin descargar muestras externas.
