# Ritmo — tercera expansión de sonidos discretos de interfaz
**Fecha:** 21 de octubre de 2026

## Cambios

La paleta crece de 40 a 52 perfiles sintetizados en tiempo real. No se descargan muestras, no se instalan dependencias y no se toca la ruta de la música ni el ecualizador de tres bandas.

### Doce estilos añadidos

| Clave | Nombre en la interfaz | Diseño del sonido |
| --- | --- | --- |
| `celesta` | Celesta amortiguada | Seno corto y filtrado, sin campana larga. |
| `electricpiano` | Piano eléctrico mate | Triángulo redondo más armónico casi imperceptible. |
| `handpan` | Handpan apacible | Nota baja percutiva con armónico atenuado. |
| `mutedguitar` | Guitarra limpia muteada | Cuerda sintetizada de registro medio-grave; no usa distorsión. |
| `plush` | Terciopelo | Ruido muy corto, con filtro grave y sin cola. |
| `cloud` | Nube suave | Seno descendente, ataque lento y nivel reducido. |
| `sakura` | Sakura | Dos tonos suaves, con el segundo armónico mucho más bajo. |
| `shore` | Ola mansa | Textura grave filtrada de 34 ms, sin bucle ambiental. |
| `holo` | Holograma suave | Barrido sinusoidal ascendente, sin pitido penetrante. |
| `softbit` | 8-bit aterciopelado | Onda triangular corta, no una cuadrada brillante. |
| `starglow` | Brillo estelar | Dos tonos breves de volumen relativo bajo. |
| `arcade` | Arcade cálido | Pulso retro grave y fugaz. |

## Prioridad para música, voz y diseño

- El volumen máximo global de efectos sigue limitado a `0.025`.
- Con audio o vídeo activo, el factor de atenuación baja de `0.06` a `0.04`.
- El intervalo mínimo entre efectos aumenta de 125 a 160 ms para evitar ráfagas al accionar controles seguidos.
- El volumen predeterminado para nuevas preferencias pasa del 20 % al 15 %. Las preferencias existentes se conservan: no se sobreescriben ajustes guardados por el usuario.
- Se mantiene el inicio desactivado por defecto, el límite de reproducción por interacción real y el silencio cuando `speechSynthesis` está hablando o el estudio emite una muestra vocal.
- Los controles del estudio vocal, el editor de personaje, la ecualización y los controles excluidos de forma explícita permanecen silenciosos. No hay sonidos para escribir, desplazar, pasar el cursor o manipular diseños.
- El menú de estilos mantiene cuatro grupos y agrega opciones dentro de ellos; no crea una biblioteca de assets, carpetas de medios ni peticiones HTTP.

El factor de mezcla es una limitación de ganancia de la aplicación, no una medición LUFS ni una garantía acústica universal. La sonoridad percibida depende del volumen del sistema, los auriculares/altavoces, la pista y los ajustes del usuario.

## Referencias técnicas

- [MDN — Web Audio API best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices): resume la creación/reanudación del contexto en respuesta a interacción y la necesidad de ofrecer mute/volumen y controles accesibles.
- [MDN — Using the Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API): explica la composición de nodos de audio, filtros, ganancias y el control programático del sonido.
- [UI SFX](https://github.com/romainsimon/uisfx): referencia para packs de personalidad coherentes, feedback breve, mute persistente y reducción de eventos repetidos. Ritmo no incorpora su paquete ni sus muestras.
- [websfx](https://github.com/remarkablemark/websfx): ejemplo de sonidos generados mediante Web Audio, controles sencillos de volumen y ausencia de dependencias de audio. Ritmo conserva su propio módulo.

## Pruebas y caché

`scripts/ui-sounds-check.mjs` comprueba el catálogo de 52 estilos, que cada estilo tenga etiqueta, opciones coincidentes entre JavaScript y HTML, límite de ganancia, atenuación multimedia, cooldown, exclusión de voz/diseño y empaquetado web/Android sin descargas. La versión de Service Worker sube a `ritmo-shell-v53` y las pruebas del shell quedan sincronizadas con ese marcador.
