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
