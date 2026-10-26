# RITMO para PC

Ritmo tiene dos salidas independientes para escritorio:

- **Aplicación Windows**: instalador asistido `.exe` y ejecutable portable `.exe`. No requiere instalar Node.js en el ordenador donde se usa.
- **PWA para navegadores**: salida estática ligera, útil si no querés instalar una aplicación.

## Descargar la aplicación Windows

1. Abrí [las ejecuciones de «Build Ritmo for Windows PC»](https://github.com/rikosama473-sketch/reproductor/actions/workflows/desktop-windows.yml).
2. Entrá en la última ejecución correcta de la rama `main`.
3. Descargá el artefacto `Ritmo-Windows-…` y descomprimilo.
4. Ejecutá `Ritmo-1.0.0-Setup-x64.exe` para instalarlo, o `Ritmo-1.0.0-Portable-x64.exe` para iniciarlo sin pasar por el instalador.
5. Si Windows muestra una advertencia de aplicación desconocida, tené en cuenta que este build no tiene certificado comercial de firma de código.

El workflow publica ambos ejecutables, sus SHA-256 y un `build-info.json` en el mismo artefacto. Antes de subirlos, instala de forma silenciosa el paquete NSIS en una carpeta temporal, inicia tanto el ejecutable portable como la versión instalada dos veces cada uno en perfiles aislados, verifica inicialización, navegación entre Inicio, Biblioteca y Conversor y persistencia de una pista temporal en IndexedDB entre reinicios, y ejecuta la desinstalación silenciosa. Las pistas temporales y los perfiles de prueba se eliminan al terminar. No reproduce audio ni importa archivos del usuario. Los archivos se conservan 30 días en GitHub Actions; no se publican automáticamente como una versión de GitHub Releases.

## Compilar o ejecutar desde el código

Requiere Node.js 22 o superior. Desde la carpeta raíz:

```bash
npm --prefix desktop install
npm run desktop:app
```

Para crear los ejecutables Windows desde una máquina Windows:

```bash
npm --prefix desktop install
npm run desktop:package:windows
```

Los archivos resultantes aparecen en `desktop/release/`. También podés usar `npm run desktop:prepare` y `npm run desktop:start` para servir la PWA desde `http://127.0.0.1:4173`.

## Biblioteca y privacidad

La aplicación de escritorio reutiliza el mismo código de Ritmo, conversor y biblioteca local, pero los datos guardados en Windows no se sincronizan automáticamente con Android. Se guardan en el almacenamiento local del perfil de la aplicación.

La app crea un servidor HTTP ligado solo a `127.0.0.1` en el puerto estable `41739`. Ese origen estable es importante: así la biblioteca IndexedDB y el caché sin conexión permanecen disponibles entre reinicios. Si otra aplicación ocupa el puerto, Ritmo avisa en vez de cambiar a otro origen y aparentar que la biblioteca desapareció.

La ventana usa aislamiento de contexto, Node.js desactivado en el contenido, sandbox y navegación externa limitada a HTTP, HTTPS y enlaces de correo. Los medios en streaming siguen dependiendo de las restricciones del sitio y de la conexión a Internet.

## Límite del primer paquete

La primera distribución oficial automatizada es **Windows x64**. La PWA sigue disponible para Linux, macOS y navegadores; aún no se publican instaladores nativos para esos sistemas.
