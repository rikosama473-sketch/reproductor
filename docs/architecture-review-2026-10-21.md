# Revisión integral de arquitectura — Ritmo
**Fecha:** 21 de octubre de 2026

## Arquitectura encontrada

Ritmo es una PWA local-first, estática y sin framework ni paso de compilación para la versión web. La interfaz vive en `index.html` y `styles.css`; `src/app.js` conserva el estado y coordina las vistas, el reproductor, fuentes online y el puente Android. La lógica secundaria ya está separada en módulos para almacenamiento, Media Session, volumen, presets del ecualizador, huellas de importación, compuertas de concurrencia, navegación externa, errores de YouTube, servicios online y personaje acompañante.

La persistencia web usa IndexedDB v3 con almacenes de pistas, historial, listas y ajustes. En Android, Capacitor conecta la interfaz a Media3 para reproducción de sistema y a MediaStore/SAF para descubrir o elegir archivos locales. `sw.js` usa caché versionada, prioriza la red para el shell estable y conserva fallbacks para desconexiones o errores transitorios. `npm run validate` concentra comprobaciones de sintaxis y regresión; el workflow de APK ejecuta esa misma batería antes de compilar.

Fortalezas verificadas en el código: importación por lotes, rollback ante errores síncronos de IndexedDB, recuperación de aperturas bloqueadas, control de intenciones de reproducción asíncronas, fallback para fallos del motor nativo, compatibilidad explícita con límites del navegador, comprobaciones del estado de vídeos de YouTube antes de incrustarlos y restauración del shell PWA ante ciertos errores HTTP.

## Referencias comparadas y decisiones aplicables

- **[PWA-LumenMusic](https://github.com/Behnooddev/PWA-LumenMusic):** es una referencia cercana por el uso de JavaScript modular, IndexedDB y funcionamiento offline sin backend. Su separación de acceso a datos, servicios y componentes favorece pruebas aisladas. Sus notas también documentan una fuga por suscripciones de eventos y una carrera de renderizado/ordenamiento causada por preferencias asíncronas. Lección transferible: limitar el alcance de cada lectura y liberar los recursos/eventos al terminar su ciclo de vida. Ritmo ya cuenta con módulos de datos y de concurrencia; esta revisión corrige una lectura no acotada del historial.

- **[Jellyfin Web — releases](https://github.com/jellyfin/jellyfin-web/releases):** una base madura que sigue corrigiendo problemas de renderizado, rendimiento, estado y seguridad. Sus notas recientes registran el escape de títulos/URL externos, una restricción de longitud en búsquedas, invalidación de caché y una fuga de listeners de reproducción. Lección transferible: codificar texto externo, limpiar suscripciones, invalidar datos derivados y convertir problemas que parecen invisibles en pruebas de regresión. No se copia su arquitectura de servidor/API porque Ritmo no tiene backend.

- **[Koel](https://github.com/koel/koel):** ofrece una referencia funcional más amplia —biblioteca, listas inteligentes, scrobbling e integraciones— sobre una aplicación de servidor. Es útil para priorizar funciones futuras, pero introducir cuentas, base de datos remota o un backend ahora contradiría el objetivo actual de biblioteca privada y offline.

- **[MDN: IDBIndex.openCursor()](https://developer.mozilla.org/en-US/docs/Web/API/IDBIndex/openCursor) y [MDN: uso de IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB):** documentan el recorrido por cursor, incluyendo dirección descendente y lectura incremental. Para una consulta con límite, esto evita materializar todos los registros primero.

## Cambio aplicado en esta revisión

### Historial de reproducciones

Antes, `getHistory(limit)` solicitaba todas las filas con `getAll()`, ordenaba la colección completa y finalmente devolvía las primeras entradas. Aunque la interfaz normalmente pide 100, el coste de lectura y ordenamiento dependía del historial total.

Ahora normaliza el límite antes de abrir IndexedDB y recorre el índice existente `playedAt` en orden descendente. La consulta termina al alcanzar el límite solicitado, mantiene el máximo de seguridad de 5.000 entradas y devuelve inmediatamente una lista vacía para límites nulos normalizados a cero o negativos. No requiere migración de esquema ni modifica los registros persistidos.

La suite `scripts/history-limit-check.mjs` comprueba límites cero, positivos, fraccionarios, predeterminados, nulos y negativos, y además verifica que se visiten únicamente las entradas solicitadas y que la ruta no recurra a `getAll()`.

## Riesgos restantes y orden de trabajo recomendado

1. **Reducir gradualmente `src/app.js`:** es el principal punto de acoplamiento. Extraer cada frontera con pruebas propias —cola, selección de motor, navegación y control de medios— es más seguro que una reescritura masiva.
2. **Medir en dispositivos reales:** la CI no certifica permisos SAF de cada fabricante, comportamiento bajo presión de memoria ni reproducción con pantalla bloqueada.
3. **Perfeccionar metadatos y carátulas locales:** actualmente la lectura de etiquetas es parcial por formato; cualquier nueva extracción debe ser local, tolerante a archivos malformados y cubierta por muestras de regresión.
4. **Proteger datos derivados y recursos:** mantener límites en resultados externos, limpieza de listeners/temporizadores/controladores y escapado de contenido proporcionado por fuentes externas.
5. **Preservar privacidad y licencias:** no mover la biblioteca a un backend ni descargar audio de fuentes que no autorizan su conservación para implementar funciones que pueden seguir siendo locales.

## Validación

La rama de esta revisión contiene una optimización de almacenamiento y su prueba de regresión. La aprobación definitiva depende de que GitHub Actions ejecute correctamente la batería compartida en el pull request; no se afirma haber probado hardware Android físico en esta sesión.
