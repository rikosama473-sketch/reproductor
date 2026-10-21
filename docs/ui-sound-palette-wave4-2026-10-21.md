# Paleta de sonidos de interfaz — cuarta tanda
**Fecha:** 21 de octubre de 2026

Esta tanda añade 12 timbres sintetizados localmente y lleva el catálogo de Ritmo de 52 a 64 estilos. Los nombres describen el carácter del timbre: no representan grabaciones de instrumentos reales.

## Nuevos perfiles

| Estilo | Carácter sonoro | Control de intensidad |
|---|---|---|
| Clavicémbalo mate | Cuerda pulsada con armónico breve y filtrado | Ataque corto, armónico muy bajo |
| Órgano vintage suave | Dos tonos cálidos de registro medio | Volumen interno reducido y caída rápida |
| Bajo redondo | Nota grave descendente, como una cuerda amortiguada | Filtro de paso bajo y duración de 38 ms |
| Taiko amortiguado | Golpe percusivo grave | Filtrado de graves y sin transitorio explosivo |
| Láser mate | Deslizamiento electrónico descendente | Tono corto y limitado en brillo |
| Terminal silenciosa | Clic digital seco | Ruido filtrado de 12 ms |
| Glitch delicado | Dos microcortes tonales | Dos impulsos de nivel bajo, sin distorsión |
| FM cristalino suave | Nota digital con un armónico discreto | Fundamental suave y armónico secundario reducido |
| Synth-pop cálido | Intervalo de sintetizador redondeado | Ataque suave y segundo tono de bajo nivel |
| Pulso neón | Pequeño impulso ascendente seguido de un tono grave | Dos impulsos de pocos milisegundos |
| Sueño vaporoso | Par de tonos suaves | Ataque lento y energía contenida |
| Casete analógico | Textura filtrada de cinta y nota grave | Ruido y tono a muy bajo nivel |

## Ritmo y mezcla segura

Los 64 perfiles conviven con los modos de respuesta ya disponibles: Automático por género, Suave y espaciado, Pop animado y Cyber / electrónico. Los acentos rítmicos se generan únicamente después de una interacción del usuario; no hay BPM artificial en bucle ni ambiente continuo.

Las salvaguardas permanecen sin cambios:
- Sonidos desactivados al instalarse; volumen inicial de preferencias nuevas: 15 %.
- Ganancia global máxima de salida de efectos: `0.025`.
- Al detectar música o vídeo en reproducción, factor de atenuación: `0.04`.
- Intervalo mínimo entre efectos automáticos: `160 ms`.
- El estudio vocal, la síntesis de voz y las zonas de diseño de personajes siguen silenciadas.
- No se emiten efectos al escribir, pasar el cursor o desplazarse.
- No se incorporan archivos de audio, bibliotecas ni peticiones de red.

Los porcentajes del mezclador son límites internos de ganancia, no mediciones de sonoridad acústica; el volumen general del dispositivo sigue siendo relevante.

## Pruebas
`scripts/ui-sounds-check.mjs` comprueba la lista completa de perfiles, sus ramas de síntesis, las etiquetas de cada opción de la interfaz, la persistencia de modos de ritmo, el silenciamiento de voz y los límites de ganancia/atenuación. La caché de la PWA se actualiza a `ritmo-shell-v56`.
