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
