# YouTube: consentimiento de red y límites de reproducción (octubre de 2026)

## Cambios verificables en Ritmo

- YouTube queda apagado por defecto. La persona activa el uso desde un botón visible y confirma un aviso sobre consumo de datos.
- La interfaz informa si el navegador declara Wi-Fi/datos móviles o si el tipo de red no está disponible. No estima MB ni cargos que no puede conocer.
- Al apagar YouTube, Ritmo cancela una búsqueda pendiente, invalida respuestas antiguas, limpia los resultados de la pantalla y cambia el iframe a `about:blank`. Esto evita dejar el documento de YouTube cargado tras detener la reproducción.
- La búsqueda sin API solo intenta instancias que figuran en el directorio público documentado de Invidious. La consulta se transmite al servicio comunitario elegido; no se promete disponibilidad de terceros.
- Los resultados de búsqueda comunitaria siguen sin considerarse autorizados para incrustar. Solo se reproducen dentro de Ritmo los resultados cuya autorización se ha verificado con la API oficial.
- No se anuncia reproducción de YouTube en segundo plano ni controles de pantalla bloqueada como una función admitida. La política del reproductor/API de YouTube prohíbe que un cliente permita reproducir cuando su ventana se cierra o minimiza. Para reproducción de fondo, Ritmo usa Media3 para archivos locales y fuentes directas compatibles, no para capturar o separar el audio de YouTube.

## Fuentes técnicas

- Lista pública actual de instancias Invidious: https://docs.invidious.io/instances/
  - La documentación señala que las instancias públicas no incluidas en su lista no se consideran confiables.
- Requisitos mínimos oficiales del reproductor y políticas de API de YouTube: https://developers.google.com/youtube/terms/required-minimum-functionality
  - La sección de reproducción de fondo prohíbe que los clientes permitan reproducir el reproductor de YouTube cuando la ventana del cliente se cierra o minimiza.
- Guía de políticas de YouTube para desarrolladores: https://developers.google.com/youtube/terms/developer-policies-guide
- Reproducción en segundo plano oficial de Android Media3: https://developer.android.com/media/media3/session/background-playback
  - El servicio de sesión publica controles del sistema a través del reproductor nativo Media3. Que esos controles funcionen con una fuente determinada necesita validación real en el dispositivo.

## Validación automatizada

Las pruebas de servicios online validan la lista permitida, resultados comunitarios no verificados, cancelación, persistencia de la opción y que el reproductor se descargue al apagar YouTube. El tipo de red expuesto por el navegador y la reproducción en pantalla bloqueada siguen dependiendo de las capacidades del dispositivo/navegador.
