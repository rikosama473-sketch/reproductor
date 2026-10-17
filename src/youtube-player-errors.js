const PLAYER_ERROR_MESSAGES = new Map([
  [2, "YouTube rechazó la solicitud porque el identificador o un parámetro del video no es válido. Abrí el video directamente en YouTube."],
  [5, "El reproductor HTML5 de YouTube no pudo reproducir este contenido. Probá abrirlo directamente en YouTube."],
  [100, "El video no está disponible: pudo ser eliminado o marcado como privado. Abrí su ficha en YouTube para comprobarlo."],
  [101, "El propietario del video no permite reproducirlo en reproductores insertados. Abrilo directamente en YouTube."],
  [150, "El propietario del video no permite reproducirlo en reproductores insertados. Abrilo directamente en YouTube."],
  [153, "YouTube no recibió el encabezado Referer ni una identificación equivalente del cliente. Abrí Ritmo desde HTTPS o localhost y revisá que el navegador o sus extensiones no eliminen el Referer; también podés abrir el video directamente en YouTube."]
]);

export function readableYoutubePlayerError(code) {
  const numericCode = Number(code);
  const knownMessage = PLAYER_ERROR_MESSAGES.get(numericCode);
  if (knownMessage) return knownMessage;
  const label = Number.isFinite(numericCode) ? "código " + numericCode : "código desconocido";
  return "YouTube informó un error de reproducción (" + label + "). Probá abrir el video directamente en YouTube.";
}
