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

## Sexta pasada — compatibilidad de GitHub Actions tras retirar Node 20 (17 de octubre de 2026)

Los logs del despliegue de la revisión anterior emitieron un aviso concreto: las referencias `actions/checkout@v4` y `actions/configure-pages@v5` todavía declaraban el runtime anterior. No fue la causa inmediata del fallo de publicación —`Configure GitHub Pages` se detuvo porque el sitio Pages no está habilitado—, pero dejar acciones obsoletas en un flujo central aumenta el riesgo de una futura incompatibilidad.

| Hallazgo | Evidencia | Corrección |
| --- | --- | --- |
| El workflow de validación usaba releases antiguas de acciones de GitHub | Los checks usaban `checkout@v4` y `setup-node@v4`; el runtime Node 20 fue retirado de GitHub Actions el 23 de septiembre de 2026. | Actualizadas las acciones a `checkout@v7` y `setup-node@v7`, manteniendo Node.js 22 como la versión de ejecución de los smoke tests del proyecto. |
| El workflow de despliegue tenía referencias antiguas de runtime | Los logs indicaron `checkout@v4` y `configure-pages@v5`; el paso de despliegue también utilizaba `deploy-pages@v4`. | Actualizadas a `checkout@v7`, `configure-pages@v6` y `deploy-pages@v5`, releases que usan Node 24 según sus metadatos/changelogs oficiales. |
| GitHub Pages continúa sin publicarse | La acción oficial no pudo recuperar el sitio Pages (404 / Not Found) con `enablement: false`. El token predeterminado no activa el sitio cuando Pages todavía no está configurado. | No se introdujo un token con permisos ampliados ni se modificó el contenido para ocultar el error. Sigue requiriendo habilitar **Settings → Pages → Build and deployment → Source: GitHub Actions**; actualizar los runtimes de Actions no corrige esa configuración por sí solo. |

### Fuentes oficiales

- GitHub Changelog, [Node 20 is no longer available in GitHub Actions](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/), publicado el 23 de septiembre de 2026: ordena actualizar a versiones de las acciones que soporten Node 24.
- GitHub, [actions/checkout — changelog de releases](https://github.com/actions/checkout/blob/main/CHANGELOG.md): las releases modernas migraron el runtime a Node 24.
- GitHub, [actions/setup-node releases](https://github.com/actions/setup-node/releases): la rama v7 es la release actual del 8 de octubre de 2026 y conserva la configuración de versión de Node solicitada por el workflow.
- GitHub, [actions/configure-pages releases](https://github.com/actions/configure-pages/releases): la versión v6 actualiza el runtime a Node 24.
- GitHub, [actions/deploy-pages releases](https://github.com/actions/deploy-pages/releases): la versión v5 actualiza el runtime a Node 24.

### Validación

Se actualizaron las dos definiciones YAML de Actions y se añadieron smoke checks para que las versiones de checkout, setup-node, configure-pages y deploy-pages no vuelvan silenciosamente a las referencias previas. La validación del JavaScript sigue ejecutándose con Node 22 de forma intencionada; esto es distinto del runtime de Node usado internamente por las acciones de GitHub. La publicación seguirá marcada como fallida hasta habilitar Pages en la configuración del repositorio.

## Séptima pasada — cancelación de intención de reproducción pendiente (17 de octubre de 2026)

Esta revisión tomó como punto de partida los informes de Chrome sobre promesas asíncronas de `play()` y el historial del issue WHATWG/HTML #996. El código aún tenía un borde reproducible: el botón principal decidía si estaba en pausa mirando solo `audio.paused`. Durante la espera del ecualizador o antes de que se resolviera `audio.play()`, el elemento puede seguir pausado aunque exista una reproducción solicitada. Un segundo toque podía iniciar otra solicitud en lugar de cancelar la primera. De forma similar, el temporizador de sueño podía llamar a `pause()` cuando el audio aún no había empezado, sin invalidar la continuación asíncrona.

| Hallazgo | Solución implementada |
| --- | --- |
| El control de pausa no distinguía entre “pausado” y “play solicitado, todavía pendiente” | Se añadió `pendingPlaybackRequestId`. La solicitud se marca pendiente antes de iniciar cualquier preparación asíncrona y se limpia al confirmarse el inicio o fallar la promesa actual. Un toque en el botón mientras la solicitud está pendiente la cancela. |
| Una pausa explícita no invalidaba continuaciones de la solicitud actual | Se centralizó en `pauseCurrentTrack()` la invalidación del identificador y la pausa del motor activo. Los controles Media Session (play/pause/stop) usan el mismo camino. |
| El temporizador podía dejar vivo un inicio de reproducción asíncrono | Al completar el fade se invalida el intento pendiente antes de pausar ambos motores; al finalizar sin fade se usa igualmente el helper de pausa con cancelación. |
| La repetición de una pista usaba una llamada `element.play()` directa | La repetición vuelve a entrar por `resumeCurrentTrack()`, que usa el control de solicitudes vigente. |

### Fuentes públicas de ingeniería

- Chrome for Developers, [DOMException: Se interrumpió la solicitud play()](https://developer.chrome.com/blog/play-request-was-interrupted?hl=es): describe que `play()` es asíncrono y puede ser interrumpido por `pause()`, `load()` o un cambio de fuente; recomienda manejar el resultado de la promesa.
- WHATWG HTML, [issue #996 — pause() followed by play() will reject the play() promise](https://github.com/whatwg/html/issues/996): documenta la carrera entre tareas que rechazan y resuelven promesas de reproducción.
- MDN, [HTMLMediaElement.pause()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/pause): confirma que `pause()` no tiene efecto cuando el elemento ya está pausado; por eso no basta para cancelar la intención lógica de una reproducción que aún no empezó.
- MDN, [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API): explica que los controles del sistema invocan manejadores definidos por la página, que deben mantener sincronizado el estado real del reproductor.

### Validación y límites

Se añadieron smoke checks para que el botón principal, los controles del sistema, la repetición y el temporizador utilicen la misma cancelación de solicitudes. Estas pruebas verifican que estén los guardas, pero no simulan todas las temporizaciones internas de todos los navegadores. El audio que queda silencioso en iOS después de volver del fondo sigue necesitando prueba con un dispositivo real, tal como muestran los casos públicos de Howler.js sobre iOS: https://github.com/goldfire/howler.js/issues/1753 y https://github.com/goldfire/howler.js/issues/1743.

## Octava pasada — historial de YouTube basado en reproducción confirmada (17 de octubre de 2026)

Esta revisión encontró que playYoutubeVideo() escribía una entrada en el historial inmediatamente después de asignar la URL del iframe. Ese punto solo confirma que se seleccionó el video; no demuestra que el embed empezara. La reproducción puede bloquearse por políticas del navegador, fallar por restricciones del video o no arrancar por un error de red. El historial acababa mezclando selecciones con reproducciones reales.

| Hallazgo | Corrección aplicada |
| --- | --- |
| El historial decía que el video se reprodujo antes de recibir confirmación del reproductor | Se dejó de escribir el historial al seleccionar. Ahora se observa el evento YT.PlayerState.PLAYING del YouTube IFrame Player API y se persiste el registro solo cuando el video actual coincide con la sesión seleccionada. |
| Eventos retrasados de un video anterior podían contaminar la selección nueva | Cada selección recibe una sesión. Un evento que no corresponde al ID activo se descarta y al salir de la vista se invalida la sesión. |
| Una misma sesión podía disparar varios eventos PLAYING tras buffering/reanudación | El controlador marca la sesión como registrada antes de iniciar la operación de almacenamiento, evitando duplicados por eventos repetidos. |
| La integración de eventos no debía romper el arranque del iframe | La aplicación establece la URL del reproductor oficial inmediatamente desde el clic del usuario y carga la API de eventos de forma asíncrona. Si la API no está disponible, el iframe directo sigue funcionando, pero no se inventa una entrada de historial sin confirmación. |

### Fuentes públicas consultadas

- Google for Developers, [YouTube IFrame Player API Reference](https://developers.google.com/youtube/iframe_api_reference): documenta onStateChange, el valor 1/PLAYING, la lectura de datos del video y cómo adjuntar la API a un iframe existente.
- Chrome for Developers, [Autoplay policy in Chrome](https://developer.chrome.com/blog/autoplay/): advierte que los desarrolladores no deben asumir que el video empezó y deben reflejar el estado real, porque una política del navegador puede impedir la reproducción.
- Chrome for Developers, [The play() request was interrupted](https://developer.chrome.com/blog/play-request-was-interrupted/): explica por qué una petición de reproducción puede rechazarse o interrumpirse de forma asíncrona; el patrón general refuerza que “seleccionado” y “reproduciendo” no son estados equivalentes.

### Pruebas y límites

Se agregó un controlador aislado con pruebas para impedir entradas al seleccionar, ignorar IDs distintos, registrar una sola vez tras PLAYING, descartar eventos atrasados y cancelar al salir del reproductor. Los checks se conectaron al workflow y el cache shell subió a ritmo-shell-v9 para que la PWA descargue el nuevo módulo. La validación automatizada verifica la lógica y la integración; no sustituye una prueba manual en navegador con videos bloqueados/no disponibles ni permite garantizar el comportamiento de la red o de las políticas de autoplay de cada dispositivo.


## Novena pasada — renovación visual de Ritmo (17 de octubre de 2026)

Se implementó la dirección de interfaz elegida: navegación y reproductor persistente inspirados en Spotify, exploración por portadas con alternancia lista/cuadrícula inspirada en Apple Music y una vista expandida de escucha inspirada en Plexamp.

| Cambio | Implementación |
| --- | --- |
| Biblioteca visual y biblioteca detallada | Se añadió una cuadrícula responsiva de tarjetas musicales con portadas generadas localmente, título, artista, estado de origen y accesos a favoritos, listas, eliminación y guardado offline cuando corresponda. La tabla detallada sigue disponible mediante un selector accesible. La preferencia lista/cuadrícula queda guardada en el navegador. |
| Reproductor inmersivo | Se añadió una vista ampliada con fondo difuminado por paleta, arte geométrico generado en CSS, información de pista, progreso, controles principales, repetición, aleatorio, favorito y volumen. El panel utiliza el estado real del reproductor y no crea un segundo motor de audio. |
| Sincronización de controles | Reproducir/pausar, anterior/siguiente, favorito, aleatorio, repetición, volumen y posición en la vista expandida reutilizan los controles y eventos existentes. El volumen continúa pasando por el handler habitual para guardar la preferencia. |
| Instalaciones PWA | Se incrementó la shell cache de ritmo-shell-v9 a ritmo-shell-v10 para descargar HTML, CSS y JavaScript actualizados después de instalar la nueva versión. |
| Diseño adaptable y accesibilidad | La cuadrícula refluye en pantallas pequeñas; los controles cuentan con nombres accesibles, foco visible y estilos que respetan la preferencia del sistema de reducir movimiento. |

### Validación

Se añadieron smoke checks de integración para la vista de cuadrícula, el selector de modo, el reproductor expandido, su barra de progreso, el control de volumen sincronizado y la versión de caché PWA. La validación estructural no sustituye una revisión visual manual en Chrome/Firefox/Safari ni pruebas móviles en dispositivos reales.

### Referencias de diseño

- Spotify, [rediseño de la experiencia de escritorio y vista de reproducción](https://newsroom.spotify.com/2023-06-20/spotify-desktop-experience-redesign-your-library-now-playing-views-customize/): navegación, biblioteca lateral y controles persistentes como patrones de referencia.
- Apple, [guía de Apple Music](https://support.apple.com/guide/music/welcome/mac): organización visual de biblioteca, álbumes y listas.
- Plexamp, [sitio oficial](https://www.plex.tv/plexamp/): referencia para una experiencia de reproducción más inmersiva. Estos productos se usan como inspiración de UX, no se copian sus recursos de marca.


## Décima pasada — evitar doble activación por teclado en tarjetas visuales (17 de octubre de 2026)

Durante la revisión final de la cuadrícula nueva se identificó una interacción duplicada: el helper que permite activar con Enter/Espacio las filas implementadas como elementos con rol de botón también se ejecutaba sobre el nuevo botón HTML nativo de cada portada. El navegador ya sintetiza el clic de activación del botón nativo, así que la vía manual podía enviar dos solicitudes seguidas.

Se limitó el manejador de teclado manual a los elementos no nativos que realmente lo necesitan; los botones HTML conservan la activación nativa y accesible del navegador. Se añadió una aserción de regresión y se incrementó la shell PWA a ritmo-shell-v11, porque la aplicación usa una estrategia de caché del shell que necesita una versión nueva para recibir el JavaScript actualizado.


## Undécima pasada — actualización segura de PWA y sincronización de silencio (17 de octubre de 2026)

### Hallazgo 1: pestaña abierta con código viejo después de cambiar el Service Worker

Ritmo usa un Service Worker que llama a `skipWaiting()` durante la instalación y `clients.claim()` al activarse. Eso permite que la nueva versión tome el control de pestañas abiertas, pero el JavaScript ya cargado en una pestaña no se reemplaza por arte de magia. La misma pestaña puede quedar ejecutando el código anterior mientras el Service Worker nuevo sirve recursos nuevos.

**Solución aplicada:** si una pestaña ya controlada detecta `controllerchange`, ahora muestra un aviso accesible que ofrece actualizar ahora o más tarde. La recarga es voluntaria para no cortar la reproducción sin permiso. La primera instalación no activa el aviso. La cache shell pasó de `ritmo-shell-v11` a `ritmo-shell-v12`.

### Hallazgo 2: silencio desincronizado en el reproductor expandido

El control de silencio ya persistía el volumen y actualizaba los dos motores de audio, pero no movía el deslizador que aparece en la vista expandida. Después de silenciar desde el reproductor inferior, la vista de pantalla completa podía mostrar un nivel antiguo hasta el siguiente cambio de volumen.

**Solución aplicada:** el handler de silenciar/restaurar actualiza también `#expanded-volume-bar`, conservando una única preferencia y el mismo estado de volumen.

### Referencias consultadas

- Chrome for Developers, [Service Worker lifecycle](https://developer.chrome.com/docs/workbox/service-worker-lifecycle/): explica que las versiones nuevas pueden tomar el control, que las cachés anteriores deben gestionarse y que la sustitución de controlador puede afectar recursos de una página ya abierta.
- Chrome for Developers, [Handling service worker updates](https://developer.chrome.com/docs/workbox/handling-service-worker-updates/): describe el patrón de avisar cuando hay una actualización y permitir que el usuario recargue para cargar recursos y lógica coherentes.
- MDN, [HTMLMediaElement.play()](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play): confirma que el inicio de audio es asíncrono y puede ser rechazado; por eso la actualización no fuerza una recarga durante la sesión de escucha.
- WebKit, [Safari Technology Preview 252 release notes](https://webkit.org/blog/18304/release-notes-for-safari-technology-preview-252/): ejemplo de notas oficiales que documentan fallos de Web Audio/streaming y su reparación. Estas variaciones refuerzan la necesidad de pruebas reales entre navegadores; no se atribuye a Ritmo un bug interno de Safari.

### Validación

Se añadieron comprobaciones de regresión para el aviso de actualización, la exclusión del primer registro, la acción de recarga, la sincronización del volumen expandido y el número de caché. La validación automática no sustituye pruebas manuales en navegadores móviles.


## Duodécima pasada — control de volumen en la cadena Web Audio (17 de octubre de 2026)

### Hallazgo

Ritmo enviaba el audio procesado al destino de Web Audio a través de filtros y un compresor, pero intentaba aplicar el volumen exclusivamente mediante `HTMLMediaElement.volume`. WebKit publicó en sus notas de Safari 27 una corrección para una incidencia donde ajustar esa propiedad no surtía efecto cuando el elemento estaba conectado a un `AudioContext`. No significa que todas las versiones de Safari necesariamente reproduzcan mal ni que el bug pertenezca a Ritmo: sí identifica un riesgo de compatibilidad que el diseño original no cubría y que afectaba el slider, silencio y fundido cuando estaba activo el ecualizador.

### Solución

- Se añadió un `GainNode` maestro al final de la cadena: ecualizador → compresor → ganancia de salida → destino.
- El motor procesado deja `equalizedAudio.volume = 1` y aplica el valor solicitado al nodo de ganancia, evitando que los navegadores que sí soportan la propiedad nativa multipliquen el volumen dos veces.
- El motor sin procesar conserva `HTMLMediaElement.volume`.
- El slider principal, el reproductor expandido, silencio/restauración, el cambio de motor y el temporizador/fundido usan una única función que limita el volumen al intervalo 0–1.
- Se añadió `src/audio-output-volume.js` con pruebas aisladas de salida nativa, salida procesada, silencio, valores fuera de rango y valores no numéricos. Se agregaron a CI y se precargan para uso offline con la versión `ritmo-shell-v14`.

### Fuentes oficiales consultadas

- WebKit, [News from WWDC26: WebKit in Safari 27 beta](https://webkit.org/blog/17967/news-from-wwdc26-webkit-in-safari-27-beta/), publicado el 8 de junio de 2026: registra entre las correcciones de HTML multimedia el caso de `HTMLMediaElement.volume` sin efecto al conectar el elemento a un `AudioContext`.
- MDN, [AudioContext.createMediaElementSource()](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource): explica que el audio del elemento se redirige a la cadena de procesamiento del contexto.
- MDN, [GainNode.gain](https://developer.mozilla.org/en-US/docs/Web/API/GainNode/gain): documenta el control de ganancia mediante `AudioParam`.
- MDN, [Using the Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Using_Web_Audio_API): recomienda cambiar el nivel a través del parámetro de ganancia y usar interpolación de AudioParam para evitar cambios bruscos audibles.

### Validación y límites

Las pruebas de controlador verifican el valor encaminado a la ganancia de salida, el comportamiento del motor nativo y el mute/clamp. La CI también comprueba la sintaxis, la ubicación del nodo en el grafo y su inclusión en la shell offline. Todavía se recomienda una verificación manual del sonido en Safari/iOS, Firefox y Chromium con el ecualizador activado; las pruebas de Node no simulan la implementación real del motor multimedia del navegador.


## Revisión adicional — caché obsoleta para el shell y los archivos JS/CSS (17 de octubre de 2026)

### Hallazgo reproducible

El service worker anterior consultaba `caches.match(request)` antes de la red para todas las solicitudes GET del mismo origen. Eso incluye la navegación a `index.html` y los archivos `src/app.js`, `src/storage.js` y hojas de estilo, todos con URL estable y sin hash de contenido. Aunque los cambios recientes suelen incrementar el nombre de caché, un olvido de ese incremento podía dejar una página online con HTML/JavaScript antiguo indefinidamente, porque el caché respondía antes de consultar la red.

### Corrección

- Las navegaciones y las solicitudes `document`, `script`, `style` y `manifest` usan ahora **network-first**.
- Si la red responde, se devuelve el recurso actual y se actualiza la caché en segundo plano del evento.
- Si falla la red, se devuelve la entrada cacheada; las navegaciones a rutas profundas también pueden volver al `index.html` de la shell offline.
- Las imágenes siguen siendo cache-first para evitar viajes de red innecesarios con recursos visuales.
- Se añadió una prueba que ejecuta el propio listener `fetch` de `sw.js` bajo un entorno Service Worker simulado. Comprueba documento nuevo sobre caché antigua, JS nuevo, fallback offline, ruta profunda y estrategia cache-first de imágenes.
- Se actualizó el shell a `ritmo-shell-v15` y la prueba está integrada en GitHub Actions.

### Fuentes de ingeniería consultadas

- Google Chrome for Developers, [Expectations around service worker deployment](https://developer.chrome.com/docs/workbox/service-worker-deployment?authuser=1046689488): advierte que una estrategia cache-first para archivos estáticos con URL sin versionar puede seguir entregando `app.js` antiguo, y propone usar una estrategia que consulte la red o utilizar recursos con hash.
- Google Chrome for Developers, [Caching strategies overview](https://developer.chrome.com/docs/workbox/caching-strategies-overview/): compara cache-first y network-first y describe network-first como un patrón apropiado para documentos/markup cuando importa la frescura.
- GoogleChrome, [Modern Web Guidance: performance](https://github.com/GoogleChrome/modern-web-guidance/blob/main/skills/modern-web-guidance/guides/performance/performance.md): recomienda NetworkFirst para documentos HTML y CacheFirst para recursos estáticos inmutables versionados.

### Límites de la validación

La nueva prueba comprueba el listener real con APIs simuladas de Service Worker/Cache Storage; no es una prueba end-to-end en DevTools ni una auditoría de latencia en una red móvil. La configuración de GitHub Pages sigue siendo independiente: las validaciones de código pasan, pero publicar requiere que Pages esté habilitado y configurado en Actions.

## Revisión adicional — el límite cero del historial se convertía en el valor predeterminado (17 de octubre de 2026)

### Hallazgo reproducible

`getHistory(limit)` normalizaba el límite mediante `Number(limit) || 100`. En JavaScript, el operador `||` sustituye cualquier valor *falsy*, incluido el número válido `0`; por eso `getHistory(0)` devolvía hasta 100 registros en vez de una lista vacía. Esto rompe el contrato intuitivo de un límite de cero y puede sorprender a cualquier pantalla o función que quiera pedir expresamente cero resultados.

### Corrección aplicada

- Se distingue un argumento ausente o `null` del número cero.
- Se truncan los límites fraccionarios, los límites negativos se restringen a cero y el máximo sigue limitado a 5.000.
- Se añadieron regresiones automatizadas para cero, límite positivo, valor fraccionario, argumento omitido, `null` y valor negativo.
- La prueba nueva se ejecuta en el workflow de validación del repositorio.

### Referencia pública consultada

- MDN, [Operador de coalescencia nula (??)](https://developer.mozilla.org/es/docs/Web/JavaScript/Reference/Operators/Nullish_coalescing): explica que `||` usa el segundo operando para todos los valores falsy, incluido `0`, mientras que `??` solo lo hace con `null` o `undefined`. La solución conserva explícitamente cero como límite válido y aplica el valor predeterminado solo a argumento ausente/nulo o numéricamente no finito.

### Validación y límites

La prueba usa un IndexedDB simulado para verificar el resultado real de `getHistory`; no depende de datos del navegador del usuario. La suite sigue sin reemplazar pruebas manuales de toda la aplicación en navegadores y dispositivos reales.
