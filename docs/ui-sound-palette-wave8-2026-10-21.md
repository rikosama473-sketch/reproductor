# Paleta de sonidos Ritmo — wave 8 (21/10/2026)

## Cambios
- La paleta pasa de 80 a 88 perfiles sintetizados localmente: Saxo aterciopelado, Chelo cálido, Clavinet suave, Metalófono mate, Conga acolchada, Subgrave sintético, Pad de seda y Campana tubular tenue.
- El modo automático reconoce rock, punk, metal, grunge, hardcore, emo y alternative a partir de las etiquetas de género. Pop y electrónica conservan sus rutas anteriores.
- Ritmo Rock añade una quinta filtrada, breve y de baja amplitud.
- Los microacentos dejan de añadirse a cada clic: aparecen cada dos interacciones en Pop/Rock y cada tres en Cyber.
- Se conserva el límite de salida, la atenuación durante música/vídeo, el silencio durante la síntesis vocal, los controles de diseño silenciosos, el opt-in explícito y la síntesis Web Audio sin archivos ni bibliotecas adicionales.

## Validaciones esperadas
`npm run validate` comprueba sintaxis, los 88 perfiles y sus opciones, la inferencia por etiquetas y la separación de acentos por modo. La integración debe considerarse publicada solo cuando terminen correctamente los workflows de GitHub Actions.
