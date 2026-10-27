# Géneros musicales y reconocimiento de canciones

## Qué hace Ritmo hoy

Ritmo no ejecuta actualmente un clasificador acústico de géneros. El campo **Género** se obtiene principalmente de etiquetas incorporadas al archivo o facilitadas por el proveedor nativo. Los lectores ID3, Vorbis/FLAC/Opus, WAV y metadatos nativos comparten la normalización de etiquetas en `src/music-genres.js`.

La normalización convierte códigos numéricos ID3 conocidos en sus etiquetas, conserva las etiquetas compuestas admitidas y no inventa un género cuando el código es desconocido. Los campos ausentes permanecen vacíos: no se deben adivinar a partir del nombre del archivo o del artista.

## Sonidos de interfaz automáticos

`inferUiSoundRhythm()` **no clasifica el género musical**. Solo decide el ritmo de los sonidos opcionales de la interfaz a partir de etiquetas conocidas: actualmente devuelve una familia de comportamiento como `pop`, `rock` o `cyber`; para estilos que no reconoce devuelve `null` y el sistema usa el perfil neutro. Esta regla no modifica ni ecualiza el audio de la canción. El modo de sonidos de interfaz está desactivado por defecto.

No debe presentarse esta función como reconocimiento de géneros basado en el audio ni ampliarse con equivalencias arbitrarias que etiqueten, por ejemplo, jazz, cumbia, rap o música clásica como pop/rock/electrónica.

## Reconocimiento de una canción

Es una función separada del género. La captura breve del micrófono se envía, cuando el usuario la activa y configura su token, al servicio de reconocimiento; la respuesta puede devolver título, artista, álbum y enlaces. Requiere conexión y credenciales válidas. No es exclusiva de teléfonos: la app de escritorio también puede usarla si Windows concede permiso de **micrófono**. La búsqueda manual de canciones no necesita ese reconocimiento por micrófono.

Esta integración tampoco equivale a un clasificador de género acústico. Para detectar automáticamente el estilo a partir del sonido se necesita una fuente de metadatos fiable o un modelo acústico dedicado y probado; no debe sustituirse por conjeturas de palabras clave.

## Regresión ID3 cubierta

Los modificadores ID3 `(RX)` (remix) y `(CR)` (cover) deben eliminarse antes de interpretar códigos adyacentes, por ejemplo `(RX)(17)` → `Rock` y `(CR)(13)` → `Pop`. Un código numérico desconocido sigue sin convertirse en una etiqueta inventada.

## Sugerencias de género desde un catálogo

El editor de metadatos puede consultar, solo cuando el usuario pulsa **Buscar sugerencias**, el catálogo de Apple/iTunes por título y artista. La respuesta incluye un género primario catalogado, no una predicción acústica. La interfaz muestra la pista que coincidió y un indicador de similitud textual; ese porcentaje no expresa la confianza de la clasificación musical. La persona elige una propuesta y todavía debe pulsar **Guardar cambios**. La búsqueda no modifica el archivo fuente, no analiza el audio y no ejecuta cambios por lotes.

La petición usa metadatos de texto y no envía el archivo ni un fragmento de audio al catálogo. Requiere conexión y Modo Internet. La respuesta procede de [iTunes Search API de Apple](https://performance-partners.apple.com/search-api), que documenta \`primaryGenreName\` en los resultados de canción y el parámetro de callback para búsquedas entre sitios. Si el navegador bloquea \`fetch()\` por CORS, Ritmo usa el callback dentro de un iframe con origen opaco y sin acceso al almacenamiento de la aplicación. Si el catálogo no responde, la ficha queda sin cambios.

La fuente del catálogo puede tener un género amplio o distinto al que el usuario considera correcto. Para estilos minoritarios, lanzamientos regionales o metadatos ausentes, debe prevalecer la revisión humana; no se debe presentar una etiqueta como verdad acústica.
