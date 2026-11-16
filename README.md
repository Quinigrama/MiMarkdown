# Mi Markdown

Convierte **PDF** y **transcripciones de YouTube** a **Markdown** directamente en tu navegador, para subirlos a Claude gastando muchos menos tokens.

- 100 % local: el PDF nunca sale de tu dispositivo
- Detecta títulos, listas, negritas y une las palabras partidas con guion
- Quita encabezados, pies y números de página repetidos
- Convierte las tablas sencillas en tablas Markdown
- **OCR** (Tesseract.js) para páginas escaneadas, también en local
- Detecta páginas con **imágenes, gráficos o tablas** y te deja elegir cuáles adjuntar como imagen (ZIP con `.md` + `pagina-N.jpg`, o compartir todo junto)
- Calcula los tokens estimados y el ahorro
- Descargar `.md`, copiar o compartir directamente con la app de Claude
- Instalable (PWA) y funciona sin conexión

## Publicar en GitHub Pages
1. Sube todos los archivos a la raíz del repositorio `MiMarkdown`.
2. *Settings → Pages → Deploy from a branch → `main` / `(root)`*.
3. Abre `https://<usuario>.github.io/MiMarkdown/` y pulsa «Instalar» / «Añadir a pantalla de inicio».

## Limitaciones
- El OCR descarga unos 6 MB la primera vez y tarda unos segundos por página; revisa el texto, puede tener fallos.
- Las tablas complejas (celdas en varias líneas) pueden salir desordenadas: adjunta esa página como imagen.
