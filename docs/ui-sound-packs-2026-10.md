# Paquetes de sonido de interfaz — 20 de octubre de 2026

Ritmo ya cuenta con un ecualizador independiente para archivos locales. Esta ampliación añade sonidos opcionales para pulsar botones de la interfaz; no altera el audio de la canción.

## Perfiles disponibles

- **Piano clásico:** nota breve con armónicos y caída suave.
- **Punk / rock:** acorde sintetizado corto, con energía de guitarra eléctrica.
- **Cibernético:** dos tonos electrónicos con barrido descendente de frecuencia.

Los tonos se generan mediante Web Audio localmente. No agregan archivos de audio, peticiones de red ni dependencias. Son aproximaciones sintetizadas, no grabaciones de instrumentos reales.

## Control y privacidad

En Ajustes → **Sonidos de interfaz**, se puede activar/desactivar la función, elegir el perfil, regular su volumen y probarlo. Empieza desactivada para evitar sonidos inesperados. La preferencia se almacena en el navegador de ese dispositivo bajo el nombre de almacenamiento ritmo.ui-sounds.v1.

La escucha se asocia a clics de botones y controles accionables; escribir en el buscador o en campos de texto no genera efectos. El sonido de interfaz tiene su propio nivel, no mueve los controles del ecualizador ni modifica la señal de la música.

La caché offline avanzó a ritmo-shell-v44, y la validación comprueba las preferencias, perfiles y recursos de web/Android. Las pruebas automatizadas no sustituyen una prueba auditiva real en navegador y teléfono.
