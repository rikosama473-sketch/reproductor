# RITMO para PC — PWA

Esta carpeta prepara una salida independiente para PC y navegadores de escritorio. No comparte configuración nativa de Capacitor con Android: la salida se genera en `desktop/dist`, mientras el código de la aplicación se mantiene en la raíz para conservar una sola fuente del reproductor.

## Ejecutar en Windows, Linux o macOS

Se necesita Node.js 22 o superior. Desde esta carpeta:

```bash
npm run start
```

Abre la dirección local mostrada en la terminal (por defecto `http://localhost:4173`). El servidor sirve únicamente el contenido de `desktop/dist` y está enlazado a `127.0.0.1`; no hace falta instalar dependencias adicionales. También puedes ejecutar `npm run prepare` para generar los archivos estáticos sin iniciar el servidor.

## Qué significa esta versión

Es una PWA para PC que se puede abrir en el navegador y, si el navegador lo permite, instalar como aplicación. **No genera por sí sola un instalador .exe**. La biblioteca musical se conserva en el almacenamiento local del navegador y no se sincroniza automáticamente con el teléfono; cada dispositivo tiene su propia biblioteca.

Para la aplicación móvil nativa Android, usa la carpeta `mobile/`.
