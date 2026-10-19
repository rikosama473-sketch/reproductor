# Paleta cálida de personaje en Ritmo — 19 de octubre de 2026

## Referencia visual
Se tomó como referencia el PNG del personaje alojado en el repositorio: https://github.com/rikosama473-sketch/reproductor/blob/main/pngtuber-capibara.png . La imagen tiene una gama de marrones cacao/umber, blancos crema, piel durazno y pequeños acentos coral/rojo.

## Implementación
- Se reemplazó el predominio violeta de los acentos de `styles.css` por marrones moderados, crema cálido y terracota apagado; el fondo pasa a carbón cálido.
- Se actualizó `assets/icon.svg` para que el icono instalado comparta la misma gradación cacao.
- Se sincronizaron `theme-color` de `index.html` y colores de lanzamiento del `manifest.webmanifest`.
- Se incrementó la caché del shell PWA de `ritmo-shell-v29` a `ritmo-shell-v30`, evitando que instalaciones existentes sigan usando el tema anterior desde caché.
- Se agregaron pruebas de regresión a `scripts/smoke-check.mjs` para las variables principales de tema, el icono y la versión de caché.

## Fuentes
- Personaje del repositorio: https://github.com/rikosama473-sketch/reproductor/blob/main/pngtuber-capibara.png
- PNG original: https://raw.githubusercontent.com/rikosama473-sketch/reproductor/main/pngtuber-capibara.png

## Validación
El conjunto de pruebas y el APK del tema anterior estaban correctos en el commit `526a6c2f5cbe86822968aca7a878f693f374d430`. Este ajuste de colores requiere una nueva ejecución de CI y compilación antes de declarar validado el tema final.


## Refuerzo preventivo de superficies — 19 de octubre de 2026

La revisión posterior detectó que el fondo principal ya era cálido, pero la barra lateral, la barra superior y varios paneles secundarios conservaban colores azul grisáceos de la versión visual anterior. Se armonizaron esos fondos, bordes y textos secundarios con cacao, marrón y crema, manteniendo los colores variables de las miniportadas y los acentos de estado para no borrar distinciones útiles. Se añadió una prueba de regresión para impedir que reaparezcan los tonos antiguos y la caché PWA pasó a `ritmo-shell-v37`.

La verificación automatizada cubre las reglas CSS y el empaquetado. La apariencia final debe revisarse también en móvil y escritorio reales.
