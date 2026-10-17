# Empaquetado Android de Ritmo

## Diseño elegido

Ritmo sigue siendo la misma app web estática: `scripts/prepare-mobile.mjs` copia HTML, CSS, JavaScript, service worker, manifest e iconos a `www/`. Capacitor 8.5.3 crea una actividad Android que sirve ese contenido desde el origen HTTPS local de Capacitor; la biblioteca de audio continúa guardándose en IndexedDB del dispositivo y los archivos elegidos siguen pasando por el selector del usuario. No se sube la biblioteca local a un servidor.

El proyecto nativo `android/`, `www/` y `node_modules/` se generan en el build y se ignoran en Git para no incluir compilados ni árboles generados. Se pueden crear localmente mediante `npm install` y `npm run android:init`; en las ejecuciones siguientes se puede usar `npm run android:sync`.

## APK CI

El workflow `.github/workflows/android-apk.yml` se ejecuta en push a `main` o manualmente. Fija Node 22, JDK 21 y SDK API 36, instala versiones iguales y exactas de `@capacitor/core`, `@capacitor/android` y `@capacitor/cli`, crea/sincroniza el proyecto y ejecuta `assembleDebug`. El número de versión aumenta con el número de ejecución del workflow.

Antes de publicar el artefacto ejecuta `apksigner verify --verbose`, calcula SHA-256 y adjunta metadatos con el commit de origen. El artefacto se conserva durante 30 días.

## Por qué APK de depuración

Android documenta que `assembleDebug` produce un APK firmado automáticamente con la clave de depuración, listo para instalarse en dispositivos para pruebas. Esa firma no es una identidad de distribución. Cada runner efímero podría generar un certificado de depuración distinto; por ello, una APK nueva no debe prometer una actualización in-place respecto de otra compilada en otro runner. La desinstalación puede borrar la biblioteca local.

Para distribuir actualizaciones sin esa limitación, crear un APK de lanzamiento exige una clave privada estable, protegida como secreto en el entorno de compilación. No se crea ni se guarda una clave de lanzamiento en un repositorio público.

## Revisión técnica y límites

- Capacitor 8 requiere Node 22+ y Android SDK. En octubre de 2026 la línea estable consultada es 8.5.3; su historial incluye correcciones recientes de Android, por eso se evita usar una previsualización de Capacitor 9.
- El service worker se conserva y sus recursos se comprueban al preparar `www/`, pero las pruebas estáticas no demuestran reproducción real en todos los WebView.
- La selección de archivos, la reproducción en segundo plano, Media Session, los enlaces externos y los embeds de YouTube requieren una prueba manual en dispositivos Android físicos. Android WebView/YouTube pueden imponer restricciones independientes de la app.
- Las funciones de búsqueda online y streaming necesitan red; la biblioteca local previamente importada está diseñada para seguir disponible offline. No se descarga ni se extrae audio desde YouTube.

## Fuentes oficiales consultadas

- Capacitor, [Instalar en una aplicación web existente](https://capacitorjs.com/docs/getting-started): explica `package.json`, `webDir`, `npx cap add android` y `npx cap sync`.
- Capacitor, [requisitos de entorno](https://capacitorjs.com/docs/getting-started/environment-setup): Node 22+, JDK/Android Studio y SDK.
- Ionic Capacitor, [versiones y notas oficiales](https://github.com/ionic-team/capacitor/releases): versión estable 8.5.3 (11 de septiembre de 2026); las notas del Android plugin documentan correcciones de null checks y otros errores de Android.
- Android Developers, [compilar desde la línea de comandos](https://developer.android.com/build/building-cmdline?hl=es): `assembleDebug` genera un APK instalable con firma de depuración; un lanzamiento requiere firma propia.
- Android Developers, [firmar aplicaciones desde la línea de comandos](https://developer.android.com/build/building-cmdline?hl=es#sign_cmdline): referencia sobre apksigner y las claves privadas de lanzamiento.

El build automatizado comprueba el ensamblado y la firma, pero no sustituye las pruebas de dispositivo ni la firma de distribución.


## Incidencia CI: paquetes Android interpretados como un solo argumento

La primera ejecución de Actions falló en `Set up Android SDK`: el log mostró que `sdkmanager` recibió una cadena con saltos de línea y respondió `Failed to find package 'platform-tools platforms;android-36 build-tools;36.0.0'`. La compilación ni siquiera había llegado a instalar Node dependencies, por lo que no era un fallo de Capacitor ni del código de Ritmo.

**Primera corrección insuficiente:** separar los nombres con comas tampoco funcionó: el segundo log confirma que la acción pasó toda la cadena como un único argumento. **Corrección definitiva:** se deja que `setup-android@v4` instale sus herramientas predeterminadas y se ejecuta en un paso independiente `sdkmanager "platforms;android-36" "build-tools;36.0.0"`, pasando cada paquete como argumento real al programa.


### Seguimiento de la misma incidencia

La ejecución posterior [39068069529](https://github.com/rikosama473-sketch/reproductor/actions/runs/39068069529) demostró que la separación por comas tampoco es interpretada por la acción: el log literal dice `Failed to find package 'platform-tools,platforms;android-36,build-tools;36.0.0'`. El workflow ya no usa el input `packages`; invoca a `sdkmanager` directamente con dos argumentos separados. El resultado de la próxima ejecución determinará si el problema quedó resuelto.


## Corrección de importación y biblioteca Android

La primera APK solo utilizaba un `<input type="file">` HTML dentro del WebView. Además, `folder-picker` no estaba enlazado a ningún botón y no existía una consulta nativa a la biblioteca multimedia del dispositivo. Por eso no podía descubrir automáticamente los MP3 ya guardados.

La solución incorpora `native/android/RitmoMusicLibraryPlugin.java` y lo registra en cada proyecto Android generado por `scripts/prepare-android-native.mjs`:

- **Buscar música del teléfono** solicita `READ_MEDIA_AUDIO` en Android 13+ y `READ_EXTERNAL_STORAGE` hasta Android 12; consulta `MediaStore.Audio.Media` y añade metadatos/URI de pistas indexadas.
- **Importar archivos** abre `ACTION_OPEN_DOCUMENT`; el usuario puede navegar por carpetas y seleccionar varios archivos de audio. Después Ritmo importa sus bytes a IndexedDB para permitir escucha sin conexión.
- Las canciones descubiertas mediante MediaStore conservan su URI. En la reproducción, Ritmo resuelve una ruta local; si un proveedor de documentos no proporciona ruta directa, el puente nativo copia el archivo a la caché privada de la app.
- El escaneo depende de que Android indexe el audio y de que el usuario conceda el permiso. Para audios no indexados, ubicaciones USB/red o proveedores externos se puede usar el selector de archivos.

Android distingue correctamente ambas operaciones: los documentos escogidos por el usuario mediante Storage Access Framework no requieren permiso general, mientras que enumerar la biblioteca de audio de otras aplicaciones usa un permiso de medios granular. Fuentes: [Android: acceso a documentos y archivos](https://developer.android.com/training/data-storage/shared/documents-files?hl=es-419), [Android: acceso a medios compartidos](https://developer.android.com/training/data-storage/shared/media?hl=es), [Android 13: permisos de medios granulares](https://developer.android.com/about/versions/13/behavior-changes-13?hl=es-419), [Capawesome File Picker: documentación y correcciones recientes](https://github.com/capawesome-team/capacitor-plugins/tree/main/packages/file-picker).


## Corrección adicional: puente JavaScript y selección de carpetas

Se corrigió un fallo de integración de la aplicación estática: el código dependía de `window.Capacitor.registerPlugin()`, API que pertenece al runtime JavaScript de Capacitor y que no está garantizada cuando la página no importa/bundlea `@capacitor/core`. La app ahora usa el puente de promesas nativo directamente si falta ese registro y ya no cae silenciosamente al selector web cuando detecta que se ejecuta en Android.

Se agregó **Elegir carpeta de música**: abre el selector SAF de Android con `ACTION_OPEN_DOCUMENT_TREE`, conserva el permiso persistente para la carpeta elegida y recorre subcarpetas para registrar audio reconocido por MIME o extensión. La selección de carpeta no precisa permiso global de almacenamiento. La búsqueda de toda la biblioteca continúa usando `READ_MEDIA_AUDIO` (Android 13+) o `READ_EXTERNAL_STORAGE` (Android 12 y anteriores).

Referencias: [Capacitor: registro de complementos nativos](https://next.capacitorjs.com/docs/next/android/custom-code), [Capacitor 8 runtime](https://github.com/ionic-team/capacitor/blob/8.5.3/core/src/runtime.ts), [Android: selector de documentos y carpetas](https://developer.android.com/training/data-storage/shared/documents-files?hl=es-419), [Android: permisos multimedia y MediaStore](https://developer.android.com/training/data-storage/shared/media?hl=es).


## Auditoría adicional — runtime real del puente nativo (2026-10-17)

Se encontró un segundo defecto en el empaquetado que las comprobaciones anteriores no detectaban: aunque src/app.js contenía llamadas a window.Capacitor.nativePromise, scripts/prepare-mobile.mjs no copiaba el runtime de Capacitor a www ni insertaba su etiqueta antes de cargar el módulo de la app. En una app vanilla sin bundler, una referencia en el código no inicializa por sí sola window.Capacitor; el resultado podía ser que la app no llegara a invocar el plugin Java y, por tanto, no mostrara el permiso, el selector de carpetas ni la biblioteca.

Corrección aplicada:

- prepare-mobile.mjs copia node_modules/@capacitor/core/dist/capacitor.js al paquete Android y lo carga antes de src/app.js.
- La preparación falla de forma explícita si el runtime falta o no expone nativePromise y getPlatform, en lugar de generar silenciosamente un paquete incompleto.
- mobile-package-check.mjs valida el orden de carga, la presencia del archivo empaquetado y las API del puente.
- La validación CI instala las dependencias fijadas antes de preparar el paquete.
- Se incrementó el caché del shell a ritmo-shell-v20 para evitar reutilizar un shell anterior después de instalar el APK actualizado.

Fuentes comparadas:

- [Capacitor: carga de runtime como script en una app vanilla](https://github.com/ionic-team/capacitor/discussions/3174) — indica que la aplicación sin bundler necesita cargar capacitor.js antes del código de la aplicación.
- [Capacitor: nativePromise no definido (issue #5989)](https://github.com/ionic-team/capacitor/issues/5989) — antecedente público del síntoma de un puente no inicializado.
- [Paquete oficial @capacitor/core 8.5.3](https://github.com/ionic-team/capacitor/blob/main/core/package.json) — declara dist/capacitor.js como bundle de navegador.
- [Capacitor: registro de plugins Android personalizados](https://capacitorjs.com/docs/v6/android/custom-code) — documenta el registro del plugin nativo en MainActivity y el enlace desde JavaScript.

Las pruebas de paquete ahora verifican el recurso real que se entrega, no solo la existencia de llamadas a nativePromise en el código fuente. La reproducción en hardware físico sigue siendo la comprobación final de dispositivo.
