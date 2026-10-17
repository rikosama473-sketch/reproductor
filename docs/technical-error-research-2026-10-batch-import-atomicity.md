# Revisión técnica: integridad de importaciones por lotes (17 de octubre de 2026)

## Hallazgo reproducible

La rutina `saveManyTracks()` creaba una transacción IndexedDB y llamaba repetidamente a `objectStore.put()`, pero solo asignaba los manejadores de finalización después de encolar todas las escrituras. Si uno de esos `put()` lanzaba una excepción sincrónica —por ejemplo, por un dato que no puede clonarse o una clave inválida—, el ejecutor de `Promise` rechazaba la promesa pero la transacción no se abortaba expresamente. Las escrituras anteriores ya encoladas podían terminar confirmándose, de modo que la importación devolvía error aunque hubiera persistido una parte del lote.

Este es un fallo de consistencia, no una afirmación de que toda importación normal lo reprodujera: depende de que una operación de escritura lance sincrónicamente una excepción mientras ya hay solicitudes previas encoladas.

## Cambio aplicado

- Los manejadores de `complete`, `error` y `abort` se registran inmediatamente después de crear la transacción.
- La preparación y el recorrido de escrituras están protegidos con `try/catch`.
- Una excepción sincrónica guarda el error original e invoca `tx.abort()`; IndexedDB revierte así las escrituras pendientes del lote.
- Se amplió `scripts/indexeddb-recovery-check.mjs` para modelar el caso exacto: un primer `put()` se encola y el segundo falla. La prueba exige que la promesa rechace y que se aborte la transacción.
- Se agregó una aserción estructural a los smoke checks y se incrementó el cache shell PWA de `ritmo-shell-v12` a `ritmo-shell-v13` para distribuir el código actualizado.

## Fuentes de ingeniería consultadas

- MDN, [IDBObjectStore.put()](https://developer.mozilla.org/en-US/docs/Web/API/IDBObjectStore/put): documenta las excepciones sincrónicas que puede lanzar `put()`, incluidas `DataError` y `DataCloneError`.
- MDN, [IDBTransaction.abort()](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/abort): describe que abortar la transacción revierte los cambios asociados y marca las solicitudes pendientes con `AbortError`.
- MDN, [Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB): explica el comportamiento de rollback cuando una transacción aborta y por qué es importante manejar errores de solicitudes.
- Chrome for Developers, [Defining the scope of IndexedDB transactions](https://developer.chrome.com/blog/defining-scope-In-indexeddb-transactions?hl=es-419): referencia de ingeniería sobre el alcance y la organización de transacciones IndexedDB.

Las fuentes explican el comportamiento de la plataforma que permite entender y solucionar el riesgo encontrado en Ritmo; no se afirma que describan este mismo bug de la aplicación.

## Validación y límites

La prueba simulada cubre una excepción sincrónica después de encolar una escritura previa y la CI valida la sintaxis y los regresores. No sustituye una prueba de integración con un navegador real ni prueba fallos de disco, cuota o cierre abrupto del navegador. El despliegue público también sigue dependiendo de que GitHub Pages esté habilitado en la configuración del repositorio.
