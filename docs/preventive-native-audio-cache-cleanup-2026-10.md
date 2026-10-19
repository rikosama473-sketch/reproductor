# Limpieza preventiva de la caché local de audio — octubre de 2026

## Riesgo confirmado

Cuando Android no permite conservar un permiso persistente para una URI de audio, `RitmoMusicLibraryPlugin.resolveAudioPath()` copia el archivo a `Context.getCacheDir()/ritmo-audio`. La biblioteca también conserva un Blob en IndexedDB para poder recuperarse si Android elimina esa caché. Antes de esta corrección, eliminar una canción limpiaba su registro y las referencias de listas, pero no retiraba las copias nativas huérfanas. La acumulación podía consumir almacenamiento interno.

## Corrección aplicada

- Añadido `pruneAudioCache` al plugin nativo. Recibe las rutas `nativePath` que la biblioteca aún utiliza y solo considera archivos regulares cuyo directorio canónico sea exactamente la caché administrada por Ritmo.
- Se conservan las rutas referenciadas por cualquier pista y se ignoran rutas que escapen del directorio gestionado.
- Se aplica una ventana de gracia de una hora para proteger archivos recién creados/reutilizados mientras se termina de registrar una importación. Reutilizar una copia también actualiza su fecha de modificación.
- La limpieza se intenta al cargar la biblioteca y después de eliminar una pista. Es de mejor esfuerzo y no bloquea importación ni reproducción.
- Se incrementó la versión de caché PWA de `ritmo-shell-v27` a `ritmo-shell-v28`.

## Validación

Las pruebas de regresión comprueban el método nativo, la protección de rutas referenciadas, la limitación al directorio gestionado, la ventana de gracia, la actualización de uso de archivos reutilizados y las llamadas al limpiar/cargar la biblioteca.

## Fuente técnica

Documentación oficial de Android: [Acceder a archivos específicos de la app](https://developer.android.com/training/data-storage/app-specific). Android avisa que el sistema puede eliminar archivos de caché cuando falta espacio y recomienda que la propia aplicación administre estos archivos en vez de confiar en la limpieza automática.

## Protección adicional contra importaciones simultáneas

La resolución de archivos de proveedores se ejecuta en hilos de trabajo. Las copias que no reutilizan un archivo existente ahora pasan por un método sincronizado, evitando que dos solicitudes del mismo URI escriban a la vez en el temporal compartido `.tmp`. La prueba de regresión verifica que esa exclusión se mantenga.
