# Enrutamiento externo de YouTube/Spotify en Ritmo — 20 de octubre de 2026

## Hallazgo

El botón de búsqueda de respaldo y los resultados comunitarios abrían enlaces mediante un ancla oculto `target="_blank"`. Eso deja la elección de aplicación enteramente al comportamiento del WebView. En una APK híbrida conviene solicitar explícitamente el enrutamiento Android para que el sistema pueda elegir YouTube si tiene los enlaces asociados o el navegador predeterminado (por ejemplo, Brave) si corresponde.

## Corrección

- Se añadió `src/external-navigation.js`, una allowlist común y comprobable. Solo admite HTTPS, sin credenciales ni puertos arbitrarios, para búsquedas/vídeos de YouTube y búsquedas de Spotify.
- En Android, el puente `RitmoPlayback.openExternal` usa `Intent.ACTION_VIEW` con categoría `BROWSABLE`. Android elige la aplicación instalada o el navegador predeterminado; Ritmo no intenta forzar Brave ni cambiar preferencias del sistema.
- Si el puente nativo no existe o falla, la web/PWA conserva su apertura de enlace como alternativa.
- El módulo nuevo entra en el shell offline y se cambia la caché a `ritmo-shell-v41`.
- `scripts/external-navigation-check.mjs` cubre URLs válidas, esquemas inseguros, hosts engañosos, credenciales, puertos no estándar y los enlaces/rutas que usa la app.

## Límites deliberados

Este cambio no habilita audio de YouTube cuando Ritmo está minimizado, no oculta el reproductor y no separa la pista de audio. Google prohíbe ofrecer reproducción de fondo del reproductor integrado cuando la ventana del cliente está cerrada o minimizada. Para música local y fuentes directas compatibles, Ritmo conserva el camino de reproducción de fondo Android Media3.

## Fuentes técnicas

- Android Developers, [crear enlaces profundos y resolución de intents](https://developer.android.com/training/app-links/create-deeplinks): Android resuelve un URI mediante la aplicación predeterminada, una app compatible o un selector.
- Android Developers, [troubleshooting de App Links](https://developer.android.com/training/app-links/troubleshoot): documenta casos donde un enlace abre navegador en vez de app.
- Google for Developers, [políticas para desarrolladores de YouTube](https://developers.google.com/youtube/terms/developer-policies-guide): prohíbe la reproducción de fondo mediante el reproductor integrado.
- Google for Developers, [funcionalidad mínima requerida del reproductor](https://developers.google.com/youtube/terms/required-minimum-functionality): documenta requisitos y restricciones del reproductor incrustado.

## Validación

Las pruebas automatizadas validan el enrutamiento, la allowlist y el empaquetado en el shell. La selección real de YouTube/Brave depende de las apps instaladas y de la preferencia de enlaces del teléfono, por lo que debe comprobarse también en un Android físico. No se afirma que las pruebas de CI simulen un teléfono.
