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