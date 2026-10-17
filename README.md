# Ritmo — reproductor musical personal

Ritmo es una aplicación web progresiva (PWA), sin framework ni dependencias de compilación, orientada a una experiencia de reproductor musical cuidada y respetuosa de la privacidad.

## Estado de esta base

- Importar varios archivos de audio y guardarlos en IndexedDB en el dispositivo.
- Biblioteca persistente con búsqueda, favoritos y vistas de archivos locales / fuentes online.
- Reproducción con anterior/siguiente, aleatorio, repetición (cola o canción), barra de tiempo y volumen.
- Añadir URL directa de un archivo o radio que el navegador pueda reproducir.
- PWA instalable, shell cacheado mediante Service Worker y biblioteca local disponible sin internet después de importar los archivos.
- Interfaz responsive para escritorio, móvil y tablet; atajos de teclado básicos.

## Publicar la versión online

El workflow `.github/workflows/deploy-pages.yml` publica el sitio estático en GitHub Pages cuando los cambios llegan a `main`. En la primera publicación, si el repositorio no tiene Pages habilitado, abrí **Settings → Pages** y seleccioná **GitHub Actions** como fuente de publicación; luego ejecutá el workflow `Deploy Ritmo to GitHub Pages` desde la pestaña Actions.

La URL esperada para este repositorio es https://rikosama473-sketch.github.io/reproductor/ una vez que Pages haya terminado de publicar correctamente.

## Ejecutar localmente

Los Service Workers requieren un contexto seguro. Para probar localmente, iniciá un servidor estático en la raíz:

```bash
python -m http.server 8000
```

Luego abrí http://localhost:8000. En producción, publicá la carpeta completa en un host estático con HTTPS (GitHub Pages, por ejemplo, sirve para la capa estática).

## Importante sobre online y offline

Los archivos locales se guardan en IndexedDB del navegador; no se suben a ningún servidor. El navegador y el sistema operativo controlan la cuota, y pueden limpiar datos en ciertas circunstancias. La aplicación intenta solicitar almacenamiento persistente, pero el navegador decide si lo concede. Exportar/copiar los originales sigue siendo recomendable.

Los enlaces online guardan solamente la URL y metadatos mínimos. Necesitan conexión, pueden fallar por CORS, tipo MIME, geobloqueo, restricciones del host o formato no compatible. Esta base no descarga, extrae ni vuelve a alojar audio desde YouTube, Spotify u otros servicios; las fuentes deben ser directas y estar autorizadas para su uso.

El almacenamiento offline actual está pensado para archivos importados por el usuario, no para almacenar automáticamente el contenido de URLs externas.

## Limitaciones actuales / siguiente etapa

- No hay todavía catálogo de búsqueda musical online, backend de cuentas ni sincronización en la nube.
- Los metadatos se infieren del nombre del archivo; aún no se leen etiquetas ID3/Vorbis, carátulas embebidas ni letras sincronizadas.
- La cola reproduce la biblioteca cargada; todavía no tiene administración manual de cola ni listas de reproducción editables.
- Un reproductor web no garantiza la reproducción en segundo plano o controles de pantalla bloqueada en todos los navegadores/dispositivos.
- La compatibilidad PWA depende del navegador; para Android/iOS nativos haría falta un empaquetado y una capa de audio nativa.

## Privacidad

Sin cuenta, analítica ni telemetría en esta versión. La tipografía web puede hacer una petición externa; las fuentes de audio online las decide el usuario. Para una distribución totalmente independiente, se puede retirar la fuente tipográfica remota y alojar tipografías propias con sus licencias.

## Licencia

Pendiente de elegir antes de publicar una distribución formal.