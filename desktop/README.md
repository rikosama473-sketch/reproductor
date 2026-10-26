# RITMO para PC

Ritmo tiene dos salidas independientes para escritorio:

- **Aplicación Windows**: instalador asistido `.exe` y ejecutable portable `.exe`. No requiere instalar Node.js en el ordenador donde se usa.
- **PWA para navegadores**: salida estática ligera, útil si no querés instalar una aplicación.

## Descargar la aplicación Windows

**Versión publicada:** consultá [GitHub Releases de Ritmo](https://github.com/rikosama473-sketch/reproductor/releases). En una publicación marcada `Latest`, descargá `Ritmo-1.0.0-Setup-x64.exe` para instalar o `Ritmo-1.0.0-Portable-x64.exe` para ejecutar sin instalador.

**Compilación más reciente (temporal):** si todavía no hay una publicación `Latest`, abrí [las ejecuciones de «Build Ritmo for Windows PC»](https://github.com/rikosama473-sketch/reproductor/actions/workflows/desktop-windows.yml), entrá en la última ejecución correcta de `main` y descargá el artefacto `Ritmo-Windows-…`. Los artefactos de Actions se conservan 30 días; los adjuntos publicados en GitHub Releases permanecen disponibles mientras no se elimine la publicación.

Si Windows muestra una advertencia de aplicación desconocida, tené en cuenta que este build no tiene certificado comercial de firma de código.

## Publicación de versiones

Al crear y subir una etiqueta `vN.N.N` que coincida con `desktop/package.json` (por ejemplo, `v1.0.0` para la versión actual), el workflow vuelve a compilar en Windows, valida el paquete, ejecuta las pruebas de extremo a extremo y publica automáticamente ambos ejecutables, sus SHA-256 y `build-info.json` como una versión de GitHub Releases. La publicación se cancela si la etiqueta y la versión del paquete no coinciden o si alguna prueba falla. La publicación requiere permisos de escritura de contenidos en el token de GitHub Actions.

Antes de publicar, la compilación instala de forma silenciosa el paquete NSIS en una carpeta temporal y prueba tanto la versión portable como la instalada, dos reinicios por paquete y perfiles aislados. El smoke test genera una muestra WAV sintética, la convierte desde la interfaz real, valida el encabezado PCM16, la agrega mediante la importación normal, comprueba que aparece al buscarla en Biblioteca y verifica que el motor de audio puede reproducir la muestra silenciada. Después confirma que el archivo importado persiste al reiniciar y elimina los registros de prueba; también comprueba la desinstalación silenciosa. No reproduce música del usuario ni importa archivos personales, y elimina los perfiles temporales al terminar.

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
