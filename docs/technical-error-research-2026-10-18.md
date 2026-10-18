# Investigación de errores y soluciones para Ritmo — 18 de octubre de 2026

## Alcance y criterio de evidencia

Se revisaron los fallos que Ritmo ya presentó —inicio roto por sintaxis, botones que no respondían, recursos PWA potencialmente viejos— y los puntos delicados de sus rutas actuales de Android, IndexedDB, audio y service worker. Este informe distingue entre defectos demostrados en el código, patrones de fallo reportados por mantenedores y límites de plataforma. Un issue de otro proyecto guía una prueba: no demuestra por sí solo que el mismo bug ocurra en Ritmo.

## Corrección nueva aplicada en esta revisión

| Área | Riesgo observado | Cambio |
| --- | --- | --- |
| PWA / GitHub Pages | El Service Worker usaba network-first, pero una respuesta HTTP 404/5xx no dispara el catch de fetch. Podía devolver directamente una página de error o HTML no ejecutable para JavaScript, aunque existiera una copia válida en caché. | En 404 y 5xx consulta la copia conocida en caché; para navegación, usa el shell de `index.html` como alternativa. No oculta indiscriminadamente errores 400, 401, 403 ni respuestas dinámicas. Se añadieron pruebas de 404 para JS, 503 al navegar y 403 que se conserva. |
| Diagnóstico PWA | El panel decía solo “API disponible”, aunque el registro del Service Worker pudiera fallar; el error se descartaba con `.catch(() => {})`. | El diagnóstico diferencia “Registrando”, “Registrado y activo”, “Controlador activo”, “Error de registro” y entornos en los que el worker no está disponible. Los fallos se informan y ya no se silencian. |
| Selector de carpetas Android | Android 11+ prohíbe seleccionar ciertos directorios raíz y `Download` mediante `ACTION_OPEN_DOCUMENT_TREE`; el usuario puede interpretar esas restricciones como que el botón está roto. | Se añadió una indicación junto al botón: abrir Almacenamiento interno y elegir `Music/Música` o una subcarpeta. La búsqueda por MediaStore sigue disponible en la APK para dispositivos compatibles. |
| Integridad al compilar | Una comprobación de sintaxis aislada no basta para verificar el comportamiento desplegado. | Se mantienen las pruebas de estructura de handlers y navegación táctil; esta revisión amplía las pruebas ejecutables del Service Worker. Hay que volver a verificar la web desplegada, además de CI. |

## Referencias de mantenedores y qué aprendemos de ellas

### 1. Google Android Developers — notas de versión de Media3
Referencia: [Media3 release notes](https://developer.android.com/jetpack/androidx/releases/media3).

La versión estable **1.11.1**, publicada el 10 de septiembre de 2026, lista correcciones de ExoPlayer relacionadas con un bloqueo causado por el prewarming de un renderer secundario y otros fallos durante cambios de posición/timeline. Ritmo ya genera la APK con Media3 1.11.1; esta revisión no justificaba una actualización de dependencia innecesaria. Se conserva la versión y se refuerzan las pruebas de recuperación.

### 2. Android Developers — límites del selector de archivos y carpetas
Referencia: [Access documents and other files from shared storage](https://developer.android.com/training/data-storage/shared/documents-files?authuser=104).

La documentación explica que Android 11 (API 30) y posteriores restringen `ACTION_OPEN_DOCUMENT_TREE` para la raíz del almacenamiento interno, la raíz de ciertos volúmenes SD y `Download`; también advierte del coste de recorrer árboles con muchos archivos. Esto coincide con el diseño de Ritmo: seleccionar una carpeta válida, limitar elementos procesados y avisar si una carpeta es demasiado grande. No es una restricción corregible con CSS ni debe resolverse solicitando permisos globales innecesarios.

### 3. Capawesome — changelog del selector de archivos para Capacitor
Referencia: [File Picker changelog](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/file-picker/CHANGELOG.md).

El historial del mantenedor registra un arreglo Android de 8.0.4 para dispositivos sin la columna `COLUMN_LAST_MODIFIED`, y en 8.0.3 una ruta alternativa para evitar URI `file://` ilegibles en algunos OEM al seleccionar medios. Ritmo **no depende de ese plugin**, y la solución de 8.0.3 se refiere a fotos/vídeos, no prueba un fallo idéntico de música. La lección aplicable es probar URI, metadatos opcionales y el selector en distintos fabricantes, sin asumir que todos exponen las mismas columnas.

### 4. web.dev — estrategias de caché y actualización PWA
Referencias: [Serving / caching strategies](https://web.dev/learn/pwa/serving?hl=en) y [Updating a PWA](https://web.dev/learn/pwa/update).

web.dev diferencia cache-first, network-first y stale-while-revalidate, y advierte que `skipWaiting()` puede hacer que una nueva versión controle páginas que todavía cargaron HTML/JS antiguos. Ritmo usa network-first para el shell estático, espera las escrituras con `event.waitUntil()`, versiona el caché al actualizar el shell y ofrece recarga iniciada por el usuario si cambia un controlador existente. Esta revisión cubre el caso que faltaba: un 404/5xx es una respuesta HTTP, no una excepción de red, por lo que hay que comprobarla antes de devolverla.

### 5. MDN — toques y reproducción de audio
Referencias: [`touch-action`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/touch-action), [Touch Events](https://developer.mozilla.org/en-US/docs/Web/API/Touch_events) y [Autoplay guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Autoplay).

MDN explica que el navegador coordina los gestos táctiles y eventos de puntero, y que `HTMLMediaElement.play()` puede rechazarse por políticas de reproducción automática. Ritmo utiliza controles de toque amplios y muestra errores/reintento; no debe simular toques para eludir políticas del navegador o del sistema operativo.

### 6. GitHub Changelog — retirada de Node 20 para Actions
Referencia: [Node 20 is no longer available in GitHub Actions](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-in-github-actions/).

Desde el 23 de septiembre de 2026, los runners ya no ejecutan JavaScript Actions en Node 20. Los workflows de Ritmo usan versiones principales actuales de las acciones (`checkout@v7`, `setup-node@v7`, `setup-java@v6`), así que esta auditoría no cambió versiones a ciegas. El `node-version: 22` de `setup-node` elige el runtime para ejecutar pruebas del proyecto y es diferente del runtime interno de cada GitHub Action.

## Referencias de problemas previamente corregidos que permanecen cubiertos

- [IndexedDB blocked event — MDN](https://developer.mozilla.org/en-US/docs/Web/API/IDBOpenDBRequest/blocked_event): conexiones abiertas pueden bloquear actualizaciones; Ritmo limpia promesas de apertura fallidas y prueba reintentos.
- [Web Audio API issue #2453](https://github.com/WebAudio/web-audio-api/issues/2453): una fuente cross-origin sin CORS puede quedar muda al pasarla por `MediaElementAudioSourceNode`; el ecualizador de Ritmo se mantiene para archivos locales y las fuentes online usan reproducción directa.
- [Chrome remote debugging WebViews](https://developer.chrome.com/docs/devtools/remote-debugging/webviews/): cuando la APK y la web se comportan distinto, la consola del WebView permite aislar errores nativos/de red de errores JavaScript.

## Estado de validación

- Rama de destino: `main`.
- No se actualizan dependencias nativas por intuición; las versiones se comparan con la publicación oficial.
- La nueva cobertura automática comprueba recuperación de 404/5xx en el shell, conserva 403 y verifica el diagnóstico del registro del worker.
- CI no certifica todos los modelos Xiaomi. La comprobación final requiere el dispositivo real para permisos, carpetas, formatos, reproducción local y pantalla bloqueada.

## Corrección adicional del proceso de entrega — 18 de octubre de 2026

### Hallazgo: compilación Android separada de la batería de regresiones

Los workflows de validación y de APK arrancaban por separado al recibir cada push. El workflow Android compilaba y publicaba el artefacto sin ejecutar por sí mismo los tests de shell, IndexedDB, reproducción y navegación táctil. Aunque ambos workflows existían, su estado no era un gate común: una compilación podía progresar aunque la validación independiente estuviera fallando.

**Cambio aplicado:** se centralizaron comprobaciones de sintaxis y suites de regresión en `scripts/validate.mjs`, invocado por `npm run validate`. El workflow Validate y el build Android ejecutan ahora exactamente esa batería; la compilación no llega a `assembleDebug` ni sube una APK si falla la validación. La batería incluye empaquetado web, pruebas de caché, IndexedDB, límites de historial, diagnóstico de Media3 y pruebas táctiles.

### Hallazgo: el formato ES Module dependía de detección automática de Node

Los logs de CI habían mostrado `MODULE_TYPELESS_PACKAGE_JSON` al importar fuentes `.js` que contienen `import`/`export`. Node podía volver a analizar los archivos como módulos, pero esa detección implícita genera advertencias y trabajo extra.

**Cambio aplicado:** `package.json` declara explícitamente `"type": "module"`; la fuente JavaScript de Ritmo ya usa sintaxis ES Module. El nuevo ejecutor agrupa comprobaciones y detiene la batería ante el primer fallo.

### Documentación primaria revisada

- Node.js, [Modules: Packages — determining module system](https://nodejs.org/api/packages.html): recomienda declarar explícitamente `type` para evitar detección ambigua y definir cómo interpretar archivos `.js`.
- GitHub, [workflow jobs and dependencies](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-jobs): documenta cómo hacer que las fases dependientes se ejecuten solo tras el éxito de sus predecesoras; en Ritmo se comparte la misma batería para que la validación del build no diverja.
- GitHub Changelog, [Node 20 is no longer available in GitHub Actions](https://github.blog/changelog/2026-09-23-node-20-is-no-longer-available-on-github-actions/): desde el 23 de septiembre de 2026 las GitHub Actions ya no pueden usar Node 20; los workflows de Ritmo mantienen acciones actualizadas y usan Node 22 para ejecutar las pruebas del proyecto.
- Capacitor Android, [changelog oficial](https://github.com/ionic-team/capacitor/blob/main/android/CHANGELOG.md): 8.5.3 (7 de octubre de 2026) fue solo un version bump; 8.5.2 incluye correcciones de null checks en permisos y System Bars. Ritmo ya fija 8.5.3, por lo que no se cambió a una versión no verificada.
- AndroidX Media3, [notas oficiales de versión](https://developer.android.com/jetpack/androidx/releases/media3): Media3 1.11.1 (10 de septiembre de 2026) documenta, entre otras correcciones, un bloqueo de reproducción al precalentar un renderer secundario. Ritmo ya fija 1.11.1; se conserva hasta que una incidencia concreta justifique una actualización compatible.

### Limitaciones

CI valida código y empaquetado, no sustituye una prueba en el Xiaomi físico. El flujo de APK mantiene firma de depuración y el audio remoto sigue sujeto a CORS, disponibilidad del proveedor y políticas del sistema.

## Refuerzo de rendimiento y caché de audio — 18 de octubre de 2026

### MediaStore: límite explícito para bibliotecas grandes

**Riesgo detectado en el código:** `listAudio()` recorría todas las filas de `MediaStore.Audio.Media` y construía un `JSArray` completo antes de devolverlo a JavaScript. En teléfonos con bibliotecas enormes, esto puede provocar picos de memoria y pausas evitables; a diferencia del escaneo SAF, el resultado no tenía un límite.

**Cambio aplicado:** se limitó el resultado inicial a 10.000 registros y se añadió el campo `truncated` a la respuesta. La interfaz avisa cuando se alcanzó el límite y recomienda elegir Música o una subcarpeta para acotar la consulta. El límite protege el puente nativo; no solicita permisos más amplios ni modifica los archivos originales.

Referencia de plataforma: [Android — acceso a documentos y archivos compartidos](https://developer.android.com/training/data-storage/shared/documents-files?authuser=104) advierte que recorrer árboles grandes mediante `ACTION_OPEN_DOCUMENT_TREE` puede afectar al rendimiento y documenta restricciones del selector en Android 11+. El mismo criterio de limitar trabajo se aplicó al resultado MediaStore de Ritmo.

### Caché de audio: clave estable más resistente a colisiones

**Riesgo detectado en el código:** la copia fallback a caché identificaba cada URI mediante `String.hashCode()`, un hash de 32 bits. Dos cadenas distintas pueden compartir ese hash; si ya existía un archivo no vacío con esa clave, la aplicación podía reutilizarlo para otra URI.

**Cambio aplicado:** la clave ahora deriva de SHA-256 sobre la URI UTF-8, reduciendo drásticamente la posibilidad práctica de colisión y manteniendo el nombre reproducible entre sesiones.

### Relación con correcciones publicadas por mantenedores

- El [changelog oficial de Capacitor Android](https://github.com/ionic-team/capacitor/blob/main/android/CHANGELOG.md) incluye correcciones sobre comprobaciones nulas de permisos en 8.5.2 (11 de septiembre de 2026) y la concesión explícita de permisos URI en 8.4.2 (14 de julio de 2026). Ritmo conserva Capacitor 8.5.3, sin actualización arbitraria.
- El [changelog de Capawesome File Picker](https://github.com/capawesome-team/capacitor-plugins/blob/main/packages/file-picker/CHANGELOG.md) registra una corrección por ausencia de `COLUMN_LAST_MODIFIED` en Android 8.0.4 y una solución para URI `file://` ilegibles en ciertos fabricantes en 8.0.3. Ritmo no depende de ese plugin; esos cambios se usan como guía de compatibilidad OEM, no como prueba de que el mismo fallo esté presente.
- Las [notas oficiales de Media3](https://developer.android.com/jetpack/androidx/releases/media3?authuser=86) muestran correcciones de bloqueo y concurrencia en 1.11.1/1.11.0. Como Ritmo ya fija Media3 1.11.1, esa versión se conserva sin actualizar dependencias a ciegas.

### Pruebas añadidas

- `scripts/android-music-library-check.mjs` ahora exige el límite de MediaStore, la señal `truncated`, el aviso al usuario y la clave SHA-256.
- La batería común `npm run validate` ejecuta el check; el workflow Android también debe superarlo antes de ejecutar `assembleDebug`.
- Estas pruebas automatizadas inspeccionan el contrato y el empaquetado; no sustituyen una medición en el Xiaomi físico.
