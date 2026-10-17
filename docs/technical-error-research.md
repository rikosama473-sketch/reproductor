# Auditoría de errores web: hallazgos, evidencia y correcciones

**Fecha de revisión:** 17 de octubre de 2026  
**Proyecto auditado:** Ritmo, PWA de reproducción musical.  
**Alcance:** almacenamiento IndexedDB, reproductor HTML5/Web Audio, reproducción móvil, service worker, catálogo Internet Archive y publicación de GitHub Pages.

Este documento diferencia tres clases de evidencia: (1) defectos directamente visibles en el código de Ritmo, (2) problemas de plataforma descritos en reportes externos y (3) límites del navegador que no se pueden prometer solucionar solo con código web. Un reporte de terceros es un indicio para orientar pruebas, no una prueba de que todas las aplicaciones o dispositivos sufran el mismo fallo.

## Correcciones de Ritmo derivadas de la auditoría

| Zona | Problema encontrado | Cambio aplicado |
| --- | --- | --- |
| Historial / listas | Se guardaban en IndexedDB, pero el arranque solo recuperaba las canciones. Al recargar, historial y listas aparecían vacíos en memoria pese a seguir almacenados. | El arranque carga canciones, historial y listas juntos mediante Promise.allSettled, para recuperar cada conjunto de forma independiente. |
| IndexedDB | onblocked rechazaba la promesa compartida sin limpiar el singleton; la siguiente operación podía reutilizar para siempre la promesa rechazada. Además, una petición de apertura puede notificar success después de blocked. | Se limpia la promesa fallida para permitir reintentar, se cierra cualquier conexión que llegue tarde y se restablece el estado después de errores síncronos. |
| Historial de YouTube | Al volver a reproducir un video desde el historial, se preparaba el iframe, pero la aplicación podía continuar en la vista Historial mientras el reproductor está dentro de Música online. | La acción cambia primero a Música online y después abre el reproductor incrustado. |
| Prompt de listas | Los saltos de línea del selector de listas se representaban como texto literal en lugar de separar las opciones. | Se corrigieron los escapes de nueva línea. |
| Web Audio en móvil | Si el navegador suspendía el AudioContext mientras Ritmo quedaba en segundo plano, al volver podía quedar sin audio procesado. | Al volver a primer plano, Ritmo intenta reanudar el contexto. Si la política de reproducción lo impide, informa el fallo y ofrece Reintentar con una interacción del usuario. No es una promesa de audio de fondo. |
| Service worker | El caché de recursos obtenidos por red iniciaba cache.put() sin esperar ni capturar errores, por lo que podía perder la escritura al finalizar el evento y generar rechazos no manejados si fallaba el almacenamiento. | La escritura de caché extiende el evento con event.waitUntil() y captura errores de cuota/almacenamiento. Se incrementó la versión de caché a ritmo-shell-v6. |
| Automatización | Los smoke checks no tenían una regresión que comprobara un reintento real de la apertura IndexedDB bloqueada. | Se agregó scripts/indexeddb-recovery-check.mjs y se conectó a GitHub Actions. |

## Reportes y documentación externa consultados

### 1. IndexedDB: pestañas que bloquean una actualización

**Referencia:** [MDN — IDBOpenDBRequest: blocked event](https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/blocked_event) y [referencia técnica de IDBOpenDBRequest](https://github.com/mdn/content/blob/main/files/en-us/web/api/idbopendbrequest/index.md).

MDN describe que el evento blocked aparece cuando una conexión abierta impide la transacción de cambio de versión de la base de datos. El caso de Ritmo estaba agravado por el código de gestión de promesas: el fallo no se limitaba a mostrar un aviso, podía volver imposible reintentar desde esa instancia de la página.

**Prevención adoptada:** limpiar el estado de la promesa, avisar al usuario que cierre las otras pestañas y cerrar la conexión tardía si la petición finalmente termina de abrirse después del rechazo. Hay una prueba que fuerza la secuencia blocked → retry → late success con una IndexedDB simulada.

### 2. Web Audio: fuentes cross-origin que se quedan mudas

**Referencia:** [Web Audio API — issue #2453: detectar CORS y revertir createMediaElementSource](https://github.com/WebAudio/web-audio-api/issues/2453).

El informe explica un riesgo importante: un elemento de audio con fuente de otro origen sin autorización CORS puede entregar silencio cuando se enruta mediante MediaElementAudioSourceNode. El problema no es equivalente a que el navegador no pueda reproducir normalmente el archivo, y la API no ofrece una reversión general y limpia del enrutamiento.

**Prevención adoptada:** el ecualizador de Ritmo se usa solo con archivos locales importados. Los enlaces online permanecen en el reproductor HTML5 directo, sin forzarlos a pasar por Web Audio. No se debe “arreglar” esto enviando los audios a un proxy que eluda la política CORS del proveedor.

### 3. Audio al volver del segundo plano en iOS

**Referencia:** [howler.js — issue #1702: audio interrumpido tras minimizar y volver a abrir en iOS](https://github.com/goldfire/howler.js/issues/1702).

El reporte recopila experiencias con Safari en iOS 16/17, y comentarios posteriores indican que las experiencias variaron entre versiones y posibles parches. Es evidencia útil de un problema dependiente del dispositivo, no de una solución universal garantizada.

**Prevención adoptada:** Ritmo intenta reanudar su propio AudioContext cuando la página vuelve a ser visible y presenta un botón Reintentar en caso de rechazo. Debe seguir probándose en teléfonos reales; la aplicación web no puede impedir que iOS suspenda o finalice una página.

### 4. Service worker: caché desactualizado o escrituras que terminan tarde

**Referencias:** [Workbox issue #1528: index.html en un estado de caché incorrecto tras desplegar](https://github.com/GoogleChrome/workbox/issues/1528), [Workbox issue #2883: mantener vivo el evento durante una actualización de caché](https://github.com/GoogleChrome/workbox/issues/2883) y [Chrome Developers — ciclo de vida del service worker](https://developer.chrome.com/docs/workbox/service-worker-lifecycle/).

Estos informes ilustran que actualizar un PWA implica más que descargar archivos: el ciclo de vida del worker y el tiempo de las escrituras de caché importan. El issue #2883 describe la solución de extender la vida del evento con waitUntil() para esperar la actualización asíncrona del caché.

**Prevención adoptada:** las escrituras runtime del service worker ahora se registran con event.waitUntil() y los errores de cuota se manejan sin generar rechazos no controlados. El shell esencial sigue prefijado durante la instalación; el catálogo externo y los streams no se afirman como disponibles offline.

### 5. Controles de pantalla bloqueada y límites de API

**Referencia:** [MDN — Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API).

MDN marca Media Session como de disponibilidad limitada porque no funciona de forma uniforme en todos los navegadores populares. Esta API permite publicar metadatos y conectar acciones de controles del sistema cuando se soportan; no concede por sí misma permiso para mantener vivo un proceso ni elimina las políticas de segundo plano de plataformas como YouTube.

**Prevención adoptada:** Ritmo comprueba la existencia de la API y mantiene controles en pantalla; el panel de diagnóstico comunica la disponibilidad detectada. No afirmamos compatibilidad universal ni que Web Audio/Wake Lock mantengan a la aplicación inmune al sistema operativo.

### 6. GitHub Pages que falla aunque la validación del código pase

**Referencias:** [GitHub Docs — configurar el origen de publicación de Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site) y [metadatos de actions/configure-pages](https://github.com/actions/configure-pages/blob/main/action.yml).

Una aplicación puede superar las pruebas de JavaScript y aun así no publicarse si el sitio Pages no está habilitado. La acción oficial no activa la publicación automáticamente con GITHUB_TOKEN por defecto; su opción enablement requiere un token con permisos más elevados.

**Estado de Ritmo:** la validación puede pasar, pero el flujo de despliegue continúa fallando en Configure GitHub Pages. La solución más segura y verificable es habilitar una vez **Settings → Pages → Build and deployment → Source: GitHub Actions** en el repositorio. No se debe añadir un token privado al código para intentar corregir esto.

### 7. Catálogo de Internet Archive y metadatos incompletos

**Referencia:** [Internet Archive — documentación de campos de metadatos](https://internetarchive.readthedocs.io/en/stable/metadata.html).

La documentación de Internet Archive aclara que licenseurl identifica una URL de licencia, pero recomienda Creative Commons sin exigirla a todos los elementos. Por tanto, una consulta que filtre estrictamente por ese campo puede dejar fuera obras que son gratuitas pero cuyo metadato no está completo.

**Decisión adoptada:** el catálogo conserva el filtro estricto y revisa cada ficha antes de mostrar archivos. Esto reduce falsos positivos, aunque puede dar falsos negativos. El usuario puede visitar la búsqueda pública del archivo para inspeccionar otras entradas, pero Ritmo no debe afirmar que una canción es descargable/licenciada solo por parecer gratuita.

## Próximas pruebas recomendadas

1. Abrir Ritmo en dos pestañas y probar la ruta de actualización/versionado de IndexedDB; comprobar que la segunda pestaña ofrece un reintento recuperable.
2. Añadir una lista y entradas de historial, recargar la aplicación y confirmar que ambas reaparecen.
3. En Android y iPhone, reproducir un archivo local con ecualizador, minimizar, volver a la aplicación y comprobar que vuelve el sonido o aparece un aviso accionable.
4. Probar modo sin conexión después de haber abierto Ritmo una vez con internet. Confirmar que shell, biblioteca local e historial siguen accesibles y que el catálogo externo informa correctamente que necesita conexión.
5. Activar GitHub Pages desde Settings y verificar el despliegue por separado de los smoke checks.

La automatización actual verifica sintaxis, selectores y regresiones simuladas. No reemplaza la comprobación real en Safari/Android ni garantiza que un archivo o una fuente externa siga disponible.


## Segunda pasada — 17 de octubre de 2026

Esta segunda auditoría encontró tres fallos adicionales de la aplicación y un riesgo de compatibilidad que queda explícitamente sin confirmar en hardware real.

| Hallazgo | Evidencia en Ritmo | Corrección |
| --- | --- | --- |
| El volumen guardado se sobrescribía al arrancar | La inicialización aplicaba \`audioPrefs.volume\` y después fijaba ambos motores en \`0.8\`. Si la preferencia guardada era silencio, la interfaz podía indicar silencio mientras el motor quedaba al 80 %. | Eliminadas las asignaciones fijas posteriores; se conserva el valor que cargó la preferencia guardada. |
| Retención innecesaria de URLs de objetos | Cada archivo local reproducido recibía una URL \`blob:\` almacenada en un mapa, pero las URLs de temas anteriores no se revocaban al cambiar de pista. | Al cambiar de fuente, se revocan todas las URLs inactivas; se conserva solo la de la pista local seleccionada. Al detener el audio para pasar a YouTube o quitar la pista actual, se vacía la fuente y se liberan las URLs. |
| Caché de PWA no versionada para este cambio | La estrategia prioriza respuestas cacheadas. Cambiar `app.js` sin cambiar el script del service worker impide que este detecte una nueva versión del shell instalado. | Incrementada la caché del shell a `ritmo-shell-v7`, con comprobaciones actualizadas para verificar que el despliegue invalide la caché anterior. |
| Dedupe de importación confundía archivos de carpetas distintas | La huella solo usaba nombre, tamaño y fecha de modificación. Dos archivos homónimos con tamaño/fecha iguales podían hacer que uno se descartara al importar una carpeta. | La huella usa la ruta relativa de la carpeta cuando existe y la persiste en \`sourcePath\`; los archivos con el mismo nombre en rutas distintas ya no colisionan. |
| Reapertura de una PWA en iOS puede dejar el audio en silencio | WebKit contiene un reporte abierto de un fallo al reabrir una PWA instalada en iOS 26: \`play()\` puede resolverse aunque no salga sonido. | Riesgo documentado, no declarado como reparado: no podemos confirmar una solución sin probar en un iPhone/iPad y en las versiones de iOS afectadas. Ritmo ya ofrece la acción de reintento, pero no detecta silencios del sistema cuando el navegador no los informa. |

### Fuentes nuevas revisadas

- MDN, [blob: URLs y gestión de memoria](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/blob): cada URL creada debe revocarse cuando deja de ser necesaria; mantenerlas puede impedir liberar sus recursos.
- MDN, [URL.revokeObjectURL()](https://developer.mozilla.org/en-US/docs/Web/API/URL/revokeObjectURL_static): referencia del mecanismo para liberar URLs de objetos.
- WebKit Bugzilla, [Bug 295518 — Audio Element Fails to Play on Reopen in PWA (Add to Home Screen)](https://bugs.webkit.org/show_bug.cgi?format=multiple&id=295518): reporte abierto relacionado con Safari/iOS 26; requiere verificación física antes de afirmar que una corrección funciona.
- MDN, [Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB): nota sobre duración de transacciones; se mantuvo la importación en transacciones agrupadas y no se introdujeron esperas asíncronas dentro de una transacción.

### Validación

Se añadieron comprobaciones de regresión al smoke check para asegurar que el volumen guardado no vuelva a sobrescribirse, las URLs de objetos inactivas se limpien y las importaciones por carpeta distingan archivos homónimos. Estas comprobaciones son de código/estructura; no sustituyen una prueba manual en Safari/iOS ni una sesión de escucha real.


## Tercera pasada — 17 de octubre de 2026

Se encontraron dos clases más de fallos funcionales al revisar qué ocurre cuando el almacenamiento rechaza una escritura y cuando el usuario cambia el volumen con el temporizador ya iniciado.

| Hallazgo | Cómo se manifestaba | Corrección aplicada |
| --- | --- | --- |
| Favoritos optimistas después de un fallo de almacenamiento | Las vistas de biblioteca y el reproductor cambiaban `track.favorite` antes de `saveTrack()`. Si IndexedDB rechazaba la escritura, el estado en memoria no volvía al valor guardado y la interfaz podía mostrar un favorito que se perdería al recargar. | Se conserva el valor anterior y se restaura tanto el estado en memoria como la interfaz cuando falla la escritura. |
| Cambios de listas no se revertían al fallar IndexedDB | Agregar o quitar una pista modificaba `list.trackIds` antes de `savePlaylist()`. En caso de error, los siguientes intentos usaban la lista modificada en memoria aunque nunca se hubiera guardado. | Se guarda una copia previa de la lista y su marca de modificación; ante el error, ambos se restauran y se vuelve a representar la vista. |
| La búsqueda vacía de la biblioteca no mostraba ayuda | Cuando la biblioteca ya tenía canciones, una búsqueda sin coincidencias escondía el único estado vacío. El usuario veía una lista en blanco sin saber si no había resultados. | Añadido `library-no-results` separado de la invitación a importar música y ajustada su visibilidad para distinguir biblioteca vacía de consulta sin coincidencias. |
| El temporizador de apagado sobrescribía un volumen más reciente | El cierre gradual conservaba en una variable el volumen leído al iniciar el temporizador. Un cambio hecho por el usuario mientras el temporizador esperaba, o durante el fundido, se perdía al bajar o restaurar el volumen. | Cada paso del fundido lee el control de volumen actual y, al detener la música, restaura ese mismo valor vigente, no el capturado al principio. |

### Fuentes consultadas

- MDN, [IDBTransaction](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction): una transacción puede abortar por errores de E/S o por cuota excedida; el estado de la interfaz no debe dar por guardado un cambio rechazado.
- MDN, [HTMLMediaElement.volume](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/volume): documenta que el volumen del medio se controla mediante un valor entre 0 y 1. La lógica del fundido debe respetar el volumen que el usuario tiene seleccionado actualmente.

### Validación

Se ampliaron los smoke checks para detectar si las ediciones de favoritos y listas incluyen rollback en caso de error de persistencia y si el temporizador lee el volumen actualizado tanto durante el fundido como al terminar. Son pruebas de regresión estructurales; los casos de presión de cuota y reproducción prolongada todavía conviene verificarlos manualmente en navegadores/dispositivos reales.


## Cuarta pasada — investigación externa y carreras asíncronas (17 de octubre de 2026)

Esta pasada contrastó el patrón de interrupción de reproducción documentado por Chrome Developers y errores reportados en proyectos de reproductores. Se encontraron tres problemas aplicables en Ritmo:

| Hallazgo | Cómo podía ocurrir | Corrección |
| --- | --- | --- |
| Una solicitud de reproducción antigua podía terminar después de seleccionar otra pista | `HTMLMediaElement.play()` devuelve una promesa que puede tardar en resolverse; cambiar `src`, llamar `load()` o pausar mientras queda pendiente puede interrumpirla. Al alternar rápidamente pistas, una promesa obsoleta podía limpiar el aviso, mostrar error o continuar actualizando el estado después de la nueva selección. | Cada operación nativa de reproducción recibe un identificador de solicitud. Después de los `await` relevantes y dentro de `catch` se comprueba que sigue siendo la solicitud actual. Iniciar un video de YouTube invalida cualquier solicitud de audio nativo que aún esté pendiente. Las reproducciones que sí llegaron a iniciarse pueden quedar registradas, pero la operación obsoleta no vuelve a representar el reproductor. |
| Una búsqueda vieja de YouTube podía pisar una nueva | La búsqueda realiza dos pasos de red: buscar videos y consultar su estado de incrustación. Una respuesta lenta del término A podía regresar cuando el usuario ya había lanzado el término B y reemplazar las tarjetas, el token de paginación o el estado de búsqueda. | Se asoció un identificador a cada solicitud y se descartan resultados/cambios visuales obsoletos después de los `await`. Los bloques `finally` solo reactivan botones si pertenecen a la búsqueda vigente. |
| La paginación de YouTube podía mezclar el texto nuevo con un token viejo | La función de cargar más tomaba el texto que estuviera actualmente en el campo de búsqueda, aunque el token perteneciera a una consulta anterior. | Cargar más utiliza `state.youtubeQuery`, es decir, la consulta que generó el token. Una búsqueda nueva borra el token anterior y oculta el control de paginación mientras se actualizan los resultados. |
| La búsqueda de Internet Archive podía reemplazar resultados más recientes | También es una operación de red asíncrona que actualiza listas, total y desplazamiento de paginación después de varias promesas. Una llamada anterior podía finalizar después de una búsqueda más reciente. | Se agregó un identificador de solicitud actual, captura explícita del desplazamiento de página y protección en resultados, errores y `finally`; una solicitud antigua ya no puede cambiar los resultados ni desbloquear los controles de otra solicitud. |


| Eliminar una pista y limpiar sus listas no era atómico | La UI borraba el registro de la pista en una transacción, luego leía todas las listas y las guardaba una por una. Si una escritura fallaba, la canción podía estar eliminada mientras algunas listas persistían con una referencia vieja. | Añadida `deleteTrackAndPrunePlaylists()`, que elimina la pista y recorre/actualiza listas en una sola transacción `readwrite` sobre ambos almacenes. Si falla una operación, la transacción puede abortar el conjunto en lugar de dejar una limpieza parcial. La UI también elimina el ID de la cola en memoria. |

### Fuentes externas revisadas

- Chrome Developers, [DOMException — The play() request was interrupted](https://developer.chrome.com/blog/play-request-was-interrupted/), artículo técnico actualizado el 6 de mayo de 2021: explica que `play()` es asíncrono y que `pause()`, `load()` o cambiar la fuente pueden interrumpir la promesa; recomienda gestionar sus resoluciones/rechazos y sincronizar la interfaz con el resultado real.
- Video.js, [Issue #3474 — Issue with async play() in Chrome](https://github.com/videojs/video.js/issues/3474): reporte histórico sobre errores de `play()` al cambiar la posición o interrumpir el medio mientras la promesa está pendiente. Se utilizó como ejemplo del patrón de concurrencia, no como prueba de un defecto interno idéntico en Video.js y Ritmo.
- Howler.js, [Issue #1753 — Audio not playing after returning from background on iOS Chrome and a possible solution](https://github.com/goldfire/howler.js/issues/1753), 23 de febrero de 2025: un desarrollador documenta que en iOS Chrome el audio puede quedar en silencio al volver del segundo plano y propone reanudar el contexto cuando el estado esté suspendido/interrumpido. Esta compatibilidad sigue dependiendo del navegador y del dispositivo; no afirmamos que el problema de iOS esté resuelto.
- MDN, [BaseAudioContext.state](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state#resuming_interrupted_play_states_in_ios_safari): describe el estado `interrupted` y el patrón para intentar recuperar la reproducción en Safari móvil.

### Validación y límites

Se añadieron comprobaciones de regresión estructurales para los identificadores de solicitud, los controles posteriores a `await`, la protección de los bloques `finally` y la consulta usada por la paginación. Las pruebas automatizadas pueden verificar que la protección esté presente, pero no simulan toda la variabilidad de la red ni certifican la reproducción física en iOS. El fallo de audio silencioso reportado para algunas PWA sigue pendiente de reproducirse en un dispositivo Apple real.

## Quinta pasada — actualización de caché, transacciones fallidas y reproducción pendiente (17 de octubre de 2026)

Esta revisión volvió a comprobar los cambios acumulados después de las pasadas anteriores, en lugar de evaluar cada commit de forma aislada. Encontró dos errores de estado y un defecto de actualización de la PWA.

| Hallazgo | Causa comprobada en el código | Corrección |
| --- | --- | --- |
| Instalaciones de Ritmo podían seguir usando JavaScript antiguo | El service worker mantenía `ritmo-shell-v7`, versión introducida antes de los cambios posteriores de las pasadas tercera y cuarta. Su estrategia busca la caché antes de la red; como el código del propio worker no había cambiado desde entonces, un cambio aislado en `app.js` o `storage.js` no desencadenaba la instalación de un worker nuevo. | Subida la caché del shell a `ritmo-shell-v8` y actualizados los checks. Esto provoca una instalación nueva del worker y limpieza de la caché anterior al activar la nueva versión. |
| Un callback de almacenamiento podía fallar después de encolar una escritura | `storeTransaction()` rechazaba la promesa cuando el callback de operación lanzaba una excepción sin abortar la transacción. Si el callback hubiera encolado una operación antes de lanzar, IndexedDB todavía podía intentar completarla. | Ahora se colocan los manejadores antes de ejecutar el callback y, ante una excepción síncrona, se llama a `tx.abort()` antes de rechazar la operación. Se añadió una prueba simulada que verifica que se solicita el aborto cuando ya se había intentado encolar la escritura. |
| Una reproducción pendiente podía sobrevivir a la eliminación de su pista | `removeCurrent()` detenía el elemento y eliminaba su fuente, pero no invalidaba el identificador de solicitud. Una continuación asíncrona de una llamada previa a `playTrack()` podía intentar seguir después de limpiar el estado. | `removeCurrent()` incrementa ahora el identificador de reproducción y vuelve obsoletas las continuaciones previas. |
| Reanudar desde los controles podía saltarse el control de concurrencia | El botón principal y Media Session llamaban directamente a `audio.play()`. Si el motor aún estaba preparando otra pista, esta vía podía volver a iniciar el elemento anterior sin pasar por la protección de solicitudes. | Se unificó la reanudación en `resumeCurrentTrack()`, que vuelve a resolver la pista seleccionada y ejecuta `playTrack()` con el control de solicitudes vigente. |

### Fuentes públicas consultadas

- Chrome Developers, [DOMException — The play() request was interrupted](https://developer.chrome.com/blog/play-request-was-interrupted/): explica que `play()` es asíncrono y que cambiar la fuente, llamar a `load()` o pausar puede interrumpirlo; la interfaz debe manejar las promesas reales, no suponer que la reproducción empezó.
- Google Chrome Developers, [Service worker lifecycle](https://developer.chrome.com/docs/workbox/service-worker-lifecycle/): explica cómo el navegador comprueba cambios del script del worker, activa nuevas versiones y limpia cachés antiguas durante `activate`.
- Google Chrome Developers, [Handling service worker updates with immediacy](https://developer.chrome.com/docs/workbox/handling-service-worker-updates/): documenta los efectos de un worker nuevo que espera a páginas antiguas y las alternativas de actualización de la aplicación.
- MDN, [IDBTransaction](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction): describe el aborto de transacciones IndexedDB y el rollback de sus cambios frente a errores.
- MDN, [Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB): referencia para agrupar escrituras relacionadas en transacciones y evitar estados parcialmente guardados.

### Validación y límites

Se actualizaron las comprobaciones estructurales de versión, se añadieron comprobaciones para que la reanudación y la eliminación respeten los identificadores de solicitud, y se amplió el test de recuperación IndexedDB para exigir el aborto en una excepción síncrona después de una escritura simulada. La CI valida sintaxis y estas regresiones; no constituye una prueba completa de navegador ni sustituye a pruebas reales de reproducción y actualización en teléfonos.