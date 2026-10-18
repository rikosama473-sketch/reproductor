# Revisión técnica — ciclo de vida Media3 y recuperación del controlador (18 de octubre de 2026)

## Resultado aplicado en Ritmo

La revisión del puente Android encontró una debilidad concreta en `native/android/RitmoPlaybackPlugin.java`:

- El `ListenableFuture<MediaController>` de `buildAsync()` se conservaba en un campo durante toda la vida del plugin y no se liberaba de forma explícita al destruirse el puente.
- Si la conexión inicial al servicio multimedia fallaba, el futuro fallido seguía guardado. Las llamadas de reproducción posteriores podían reutilizar ese futuro terminal y repetir el error sin intentar conectar de nuevo.
- El código no distinguía la excepción al obtener el controlador de una excepción lanzada por una operación de reproducción.

Correcciones:
1. Se añadió `handleOnDestroy()`, que separa el futuro guardado y llama a `MediaController.releaseFuture()`.
2. Si `future.get()` falla, se limpia el futuro solo si sigue siendo la conexión que el plugin posee. Esto evita que respuestas tardías de dos llamadas concurrentes borren una conexión más nueva.
3. El siguiente intento puede crear un nuevo `MediaController`.
4. La limpieza libera el controlador del puente; no detiene al `ExoPlayer` del servicio, por lo que no corta intencionalmente el audio en segundo plano.
5. Se añadieron comprobaciones de regresión al script Android ejecutado por la validación de GitHub Actions.

La corrección se basa en el contrato publicado de Media3, no en asumir que un reporte ajeno reproduce exactamente el defecto de Ritmo.

## Referencias externas verificadas

### Media3: liberar el controlador cuando termina su uso

La referencia de AndroidX Media3 para [`MediaController`](https://developer.android.com/reference/androidx/media3/session/MediaController) recomienda usar `releaseFuture(Future)` o `release()` para limpiar recursos. También explica que liberar el controlador ayuda a que el servicio de sesión se desasocie cuando ya no quedan controladores asociados. Se aplicó esa limpieza al ciclo de vida de Capacitor y al futuro de conexión fallido.

Fuente: [AndroidX Media3 — MediaController API](https://developer.android.com/reference/androidx/media3/session/MediaController#releaseFuture(java.util.concurrent.Future)).

### Capacitor Android: cambios correctivos publicados

El [changelog oficial de Capacitor Android](https://github.com/ionic-team/capacitor/blob/main/android/CHANGELOG.md) publica correcciones de mantenimiento recientes, incluida la comprobación de valores nulos al obtener permisos desde anotaciones de plugins en **8.5.2 (11 de septiembre de 2026)**, además de una corrección anterior que concede explícitamente permisos de URI para la captura de imágenes en **8.4.2 (14 de julio de 2026)**. No son el mismo error de Ritmo; sirven como evidencia de que los permisos y las URI deben tratarse como partes del ciclo de vida y no darse por garantizados. Ritmo conserva Capacitor **8.5.3**.

### Media3: revisar las notas de versión antes de actualizar

Las [notas oficiales de Media3](https://developer.android.com/jetpack/androidx/releases/media3) documentan **1.11.1, publicada el 10 de septiembre de 2026**, con correcciones de estabilidad de ExoPlayer, incluido un bloqueo de reproducción durante el precalentamiento de un renderizador secundario. Ritmo ya fija Media3 **1.11.1**. No se actualiza a una versión distinta sin verificar primero la disponibilidad de una versión estable y su compatibilidad con el empaquetado.

### Android: gestión del foco de audio

La [guía oficial de Android sobre foco de audio](https://developer.android.com/media/optimize/audio-focus) recomienda permitir que ExoPlayer lo gestione automáticamente mediante `setAudioAttributes(attributes, true)`. La configuración actual de Ritmo ya emplea esa opción y `setHandleAudioBecomingNoisy(true)`; la auditoría la verificó y la conserva, en vez de duplicar la gestión del foco manualmente.

### Ciclo de vida del servicio multimedia

El código público de [`MediaSessionService` en AndroidX Media3](https://github.com/androidx/media/blob/release/libraries/session/src/main/java/androidx/media3/session/MediaSessionService.java) y los ejemplos de la biblioteca son la referencia primaria para el servicio de reproducción. Los reportes de incidencias de [androidx/media](https://github.com/androidx/media/issues) muestran que el cierre de servicios de sesión puede depender de la relación entre controlador, sesión y reproductor; no prueban por sí solos que un fallo reportado ocurra en Ritmo.

## Validación y límites

- La prueba automática confirma la presencia de la liberación, el restablecimiento condicional del futuro y el manejador de ciclo de vida.
- La validación de GitHub Actions compila el proyecto Android generado por Capacitor y verifica el APK. Ese resultado debe consultarse en la ejecución correspondiente al nuevo commit.
- No se afirma que se haya probado la reproducción en un teléfono físico. Siguen siendo necesarios ensayos en Android real para comprobar reconexión después de cerrar/abrir la app, audio con pantalla bloqueada y comportamiento tras interrupciones del sistema.

## Criterio de seguridad

No se copian claves privadas ni tokens, no se omiten permisos del usuario y no se intenta eludir límites de URI/CORS. Las referencias externas guían la revisión; las correcciones se mantienen localizadas en el ciclo de vida del controlador Android.
