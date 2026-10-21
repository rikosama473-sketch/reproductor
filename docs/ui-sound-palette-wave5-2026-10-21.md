# Paleta de sonidos de interfaz: quinta tanda y protección de voz
**Fecha:** 21 de octubre de 2026

## Objetivo

Ampliar los timbres sin convertir los sonidos de interfaz en una segunda banda sonora y corregir dos condiciones de comportamiento encontradas al revisar el módulo: la vista previa automática al cambiar de estilo y una posible reproducción diferida después del inicio de una muestra de voz.

## Ocho timbres nuevos

- **Cuerda pizzicato:** nota corta de cuerda punteada, amortiguada.
- **Ocarina tenue:** tono redondo con ataque suave.
- **Bloque de madera:** clic hueco y táctil.
- **Guitarra de nylon:** punteo cálido sin rasgueo.
- **Bombo acolchado:** pulso grave breve, sin retumbo.
- **Canicas:** dos tonos cortos separados, de carácter juguetón.
- **FM profunda:** timbre digital grave y redondeado; entra en la familia de fallback Cyber.
- **Ondulación:** barrido acuoso corto; puede usar el fallback Cyber si no hay género.

El catálogo pasa de 64 a 72 perfiles. No se agregan archivos de audio, dependencias, llamadas de red ni reproducción rítmica en bucle.

## Protección de voz y mezcla

- La ganancia máxima de la salida de efectos permanece limitada a `0.025`; con música o vídeo detectado se conserva el factor conservador `0.04`.
- Todos los nuevos timbres tienen envolventes cortas y amplitudes individuales bajas.
- Cambiar el selector de estilo o modificar preferencias permanece en silencio; la escucha de prueba se hace únicamente con **Probar sonido elegido**.
- Cada reanudación asíncrona de Web Audio conserva un identificador. Cambiar ajustes o iniciar una muestra vocal invalida peticiones que todavía esperaban a que `AudioContext.resume()` finalizara.
- Los eventos de voz siguen bajando la ganancia de efectos y bloquean nuevas notas durante la muestra. Los controles de diseño/acompañante y del estudio vocal continúan excluidos.

## Validación automatizada

`scripts/ui-sounds-check.mjs` comprueba los 72 IDs, que cada perfil tiene rama de síntesis, presencia de los ocho selectores, atenuación durante reproducción, filtro de controles de voz/diseño, descarte de sonidos diferidos obsoletos y cambio de caché PWA a `ritmo-shell-v58`. Los workflows de GitHub Actions deben completar la validación del PR antes de integrar este cambio.
