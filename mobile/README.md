# RITMO móvil — Android

Esta carpeta es el punto de entrada para la aplicación nativa móvil. Su proyecto Capacitor, su configuración y sus salidas generadas viven aquí; no se mezclan con la salida de PC.

El reproductor y sus módulos se mantienen en la raíz del repositorio como fuente compartida para evitar que Android y PC acumulen versiones distintas de la biblioteca, reproducción, historial o ecualizador. `npm run prepare:web` copia esa fuente a `mobile/www` y agrega el runtime de Capacitor antes del módulo de la aplicación. `mobile/www` y `mobile/android` son generados, no se editan manualmente.

## Requisitos

- Node.js 22 o superior.
- JDK 21.
- Android SDK con plataforma API 36 y Build Tools 36.0.0 para reproducir el flujo de CI.
- En Windows, Android Studio es la opción más sencilla para abrir y compilar el proyecto.

## Primera configuración

Desde esta carpeta:

```bash
npm install
npm run android:init
```

El comando prepara los recursos web, crea el proyecto Android de Capacitor y configura los plugins nativos de biblioteca musical y reproducción Media3.

## Actualizar el proyecto existente

Después de cambios en el código compartido:

```bash
npm run android:sync
```

No vuelvas a ejecutar `android:init` sobre un proyecto ya creado. Para abrir el proyecto, usa Android Studio sobre la carpeta `mobile/android`.

## Compilar una APK de depuración

En Linux/macOS, desde `mobile`:

```bash
npm run android:sync
cd android
./gradlew assembleDebug
```

En Windows, usa PowerShell desde `mobile`:

```powershell
npm run android:sync
cd android
.\gradlew.bat assembleDebug
```

La APK de depuración aparece en `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. Es para pruebas e instalación personal; no es una versión firmada para publicar en Play Store.

## Prioridad móvil

Las verificaciones de empaquetado comprueban que el puente de Capacitor se carga antes de la aplicación, que están presentes el selector de archivos y carpetas, el acceso a la biblioteca Android, los plugins de reproducción y los recursos offline. Las pruebas automatizadas no sustituyen una prueba real en un teléfono: permisos y comportamiento de segundo plano todavía deben comprobarse en dispositivos físicos y versiones de Android relevantes.

La app de navegador para teléfonos sigue disponible como PWA adaptable; esta carpeta es específicamente el proyecto nativo Android. iOS no queda declarado como compatible nativamente por esta separación.
