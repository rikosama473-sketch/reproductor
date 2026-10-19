# Corrección de la carrera del indicador de sondeo nativo — 19 de octubre de 2026

## Hallazgo

Al proteger una consulta Media3 atrasada con una generación, se detectó otro caso límite: si un sondeo nuevo empieza antes de que termine el Promise viejo, un booleano compartido no distingue qué sesión posee el bloqueo. Una finalización antigua puede dejar bloqueado el siguiente sondeo.

## Implementación

- Se extrajo `createAsyncGenerationGate` en `src/async-generation-gate.js`. El bloqueo pertenece a una generación, no a un booleano global.
- Invalidar una generación libera su ranura lógica; la finalización de una consulta vieja no puede liberar la ranura de la nueva.
- Se añadió una regresión ejecutable que simula el orden problemático: iniciar A, invalidar A, iniciar B, completar A y comprobar que B conserva correctamente su bloqueo.
- El módulo se incluye en el shell offline y en el paquete Android. La caché pasa a `ritmo-shell-v36`.

## Referencias técnicas

- [MDN: Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API): los temporizadores de páginas ocultas pueden limitarse; por eso Ritmo refresca la sesión al volver al primer plano.
- [Android Developers: reproducción en segundo plano con MediaSessionService](https://developer.android.com/media/media3/session/background-playback): describe las notificaciones de reproducción y los controles del sistema usados por el motor nativo.

## Validación y límites

La nueva regresión comprueba el intercalado que podía dejar atascadas las consultas. La validación automática y la compilación Android del nuevo SHA deben verificarse por separado; la presencia de los controles de pantalla bloqueada aún necesita una prueba en un teléfono real.
