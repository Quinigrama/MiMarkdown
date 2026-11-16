// Mi Markdown — motor de conversión PDF → Markdown (100 % local)
// Funciona con pdf.js tanto en el navegador como en Node (para pruebas).

const BULLET_RE = /^\s*([•·▪◦●○■□➢➤►\-–—*])\s+/;
const NUMBERED_RE = /^\s*(\d{1,3}|[a-zA-Z])([.)])\s+/;
const MIN_IMG_PX = 40000;      // imágenes menores (iconos, viñetas) no cuentan
const MIN_PATHS_GRAFICO = 20;  // muchos trazos vectoriales → probable gráfico o tabla dibujada

/**
 * Convierte un documento pdf.js ya cargado en Markdown.
 * opts.OPS  → pdfjsLib.OPS (para detectar imágenes y gráficos)
 * opts.ocr  → async (page, numPagina) => texto   (opcional, para páginas escaneadas)
 */
export async function pdfToMarkdown(pdf, opts = {}, onProgress = () => {}) {
  const o = { quitarRepetidos: true, separadorPaginas: false, ...opts };
  const pages = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const boldFonts = new Set();
    let imagenes = 0, trazos = 0;
    let tc;
    try {
      const ops = await page.getOperatorList(); // además carga las fuentes para conocer sus nombres reales
      if (o.OPS) {
        const IMG = [o.OPS.paintImageXObject, o.OPS.paintInlineImageXObject, o.OPS.paintImageXObjectRepeat];
        ops.fnArray.forEach((fn, i) => {
          if (IMG.includes(fn)) {
            const a = ops.argsArray[i] || [];
            const w = typeof a[1] === 'number' ? a[1] : a[0]?.width || 0;
            const h = typeof a[2] === 'number' ? a[2] : a[0]?.height || 0;
            if (w * h >= MIN_IMG_PX) imagenes++;
          } else if (fn === o.OPS.constructPath) {
            // pdf.js agrupa varios trazos en una sola operación: contamos los trazos de dentro
            const sub = ops.argsArray[i]?.[0];
            trazos += Array.isArray(sub) ? Math.max(1, sub.length) : 1;
          }
        });
      }
      tc = await page.getTextContent();
      for (const it of tc.items) {
        if (!it.fontName || boldFonts.has(it.fontName)) continue;
        try {
          const f = page.commonObjs.get(it.fontName);
          if (f && /bold|black|heavy|semibold|demi/i.test(f.name || '')) boldFonts.add(it.fontName);
        } catch (_) {}
      }
    } catch (_) {
      tc = tc || await page.getTextContent();
    }
    const lines = buildLines(tc.items, boldFonts);
    const chars = lines.reduce((a, l) => a + l.text.trim().length, 0);
    const pg = { n: p, lines, imagenes, grafico: trazos >= MIN_PATHS_GRAFICO, tabla: false, ocr: false };

    // Página sin texto → escaneada: OCR si está disponible
    // (con imagen grande: así una página con solo un gráfico vectorial y un título no pasa por OCR)
    if (chars < 25 && o.ocr && (imagenes > 0 || !o.OPS)) {
      onProgress(p, pdf.numPages, 'ocr');
      try {
        const txt = await o.ocr(page, p);
        if (txt && txt.trim()) { pg.ocrText = txt; pg.ocr = true; pg.lines = []; }
      } catch (e) { console.warn('OCR falló en la página', p, e); }
    }
    pages.push(pg);
    page.cleanup();
    onProgress(p, pdf.numPages, 'texto');
  }

  const totalChars = pages.reduce((s, pg) => s + (pg.ocrText || '').length + pg.lines.reduce((a, l) => a + l.text.length, 0), 0);
  if (totalChars < 20 * pdf.numPages && totalChars < 200) {
    return { markdown: '', escaneado: true, paginas: pdf.numPages, destacadas: [] };
  }

  if (o.quitarRepetidos && pages.filter(pg => !pg.ocr).length >= 2) removeRepeated(pages.filter(pg => !pg.ocr));

  // Tamaño de letra del cuerpo = el más frecuente (ponderado por caracteres)
  const sizeCount = new Map();
  for (const pg of pages) for (const l of pg.lines) {
    const k = Math.round(l.size * 2) / 2;
    sizeCount.set(k, (sizeCount.get(k) || 0) + l.text.length);
  }
  const body = [...sizeCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const headingSizes = [...sizeCount.keys()].filter(s => s >= body * 1.15).sort((a, b) => b - a);
  const levelOf = s => {
    const i = headingSizes.findIndex(h => Math.abs(h - s) < 0.6);
    return i < 0 ? 0 : Math.min(i + 1, 3);
  };

  const out = [];
  for (const pg of pages) {
    if (o.separadorPaginas) out.push({ type: 'raw', text: `<!-- Página ${pg.n} -->` });
    if (pg.ocr) out.push(...ocrBlocks(pg.ocrText));
    else out.push(...pageBlocks(pg, body, headingSizes, levelOf));
    if (pg.imagenes || pg.grafico || pg.tabla || pg.ocr) out.push({ type: 'raw', img: true, text: `<!-- img:${pg.n} -->` });
  }

  // Unir párrafos cortados entre páginas (el anterior no acaba en puntuación y el siguiente empieza en minúscula)
  const merged = [];
  for (const b of out) {
    let j = merged.length - 1;
    while (j >= 0 && merged[j].type === 'raw') j--;
    const last = merged[j];
    if (last && b.type === 'p' && last.type === 'p' && !/[.!?:;»")\]]$/.test(last.text) && /^[a-záéíóúñü]/.test(b.text)) {
      last.text = joinLines(last.text, b.text);
    } else merged.push(b);
  }

  let result = '';
  merged.forEach((b, i) => {
    const prevB = merged[i - 1];
    const sep = i === 0 ? '' : (b.type === 'li' && prevB?.type === 'li') ? '\n' : '\n\n';
    result += sep + renderBlock(b);
  });

  const destacadas = pages
    .filter(pg => pg.imagenes || pg.grafico || pg.tabla || pg.ocr)
    .map(pg => ({ n: pg.n, imagen: pg.imagenes > 0, grafico: pg.grafico, tabla: pg.tabla, ocr: pg.ocr }));

  return { markdown: result.trim() + '\n', escaneado: false, paginas: pdf.numPages, destacadas, paginasOcr: pages.filter(p => p.ocr).length };
}

function pageBlocks(pg, body, headingSizes, levelOf) {
  const out = [];
  let para = null, table = null, prev = null;
  const flush = () => {
    if (para) { out.push(para); para = null; }
    if (table) {
      if (table.rows.length >= 2) { out.push(table); pg.tabla = true; }
      else out.push({ type: 'p', text: table.rows.map(r => r.join(' ')).join(' ') });
      table = null;
    }
  };

  for (const l of pg.lines) {
    const t = l.text.trim();
    if (!t) continue;
    const k = Math.round(l.size * 2) / 2;
    const lvl = levelOf(k);
    const gap = prev ? prev.y - l.y : 0;

    // Filas de tabla: 3 o más bloques separados por huecos grandes (o 2 si ya estamos dentro de una tabla)
    if (l.cells.length >= 3 || (table && l.cells.length >= 2 && gap < l.size * 3)) {
      if (!table || gap > l.size * 3) { flush(); table = { type: 'table', rows: [] }; }
      table.rows.push(l.cells.map(stripMarks));
      prev = { ...l, isHeading: false };
      continue;
    }

    if (lvl && t.length < 120) {
      flush();
      const last = out[out.length - 1];
      if (last && last.type === 'h' && last.level === lvl && prev && prev.isHeading && gap < l.size * 1.8) last.text += ' ' + stripMarks(t);
      else out.push({ type: 'h', level: lvl, text: stripMarks(t) });
      prev = { ...l, isHeading: true };
      continue;
    }

    // Línea entera en negrita, corta y sin punto final → subtítulo
    if (l.allBold && t.length < 90 && !/[.,;:]$/.test(stripMarks(t)) && Math.abs(k - body) < 1) {
      flush();
      out.push({ type: 'h', level: Math.min(headingSizes.length + 1, 4), text: stripMarks(t) });
      prev = { ...l, isHeading: true };
      continue;
    }

    const bullet = t.match(BULLET_RE);
    const numbered = t.match(NUMBERED_RE);
    const bigGap = prev && (gap > l.size * 1.75 || gap < -l.size); // salto o cambio de columna
    // En una lista, una línea que empieza a la altura de la viñeta (o más a la izquierda) ya no es parte del elemento
    const indentChange = prev && para && para.type === 'li' && l.x <= para.x + 2;

    if (bullet || (numbered && (!para || bigGap || para.type === 'li' || /[.:]$/.test(para.text)))) {
      flush();
      para = { type: 'li', ordered: !bullet, text: bullet ? t.replace(BULLET_RE, '') : t, x: l.x };
    } else if (!para || table || bigGap || prev?.isHeading || indentChange) {
      flush();
      para = { type: 'p', text: t };
    } else {
      para.text = joinLines(para.text, t);
    }
    prev = { ...l, isHeading: false };
  }
  flush();
  return out;
}

function ocrBlocks(text) {
  const out = [];
  for (const chunk of text.replace(/\r/g, '').split(/\n\s*\n/)) {
    let para = null;
    for (const raw of chunk.split('\n')) {
      const t = raw.trim();
      if (!t) continue;
      const bullet = t.match(BULLET_RE);
      if (bullet) { if (para) out.push(para); para = { type: 'li', text: t.replace(BULLET_RE, '') }; }
      else if (!para) para = { type: 'p', text: t };
      else para.text = joinLines(para.text, t);
    }
    if (para) out.push(para);
  }
  return out;
}

function renderBlock(b) {
  if (b.type === 'h') return '#'.repeat(b.level) + ' ' + b.text;
  if (b.type === 'li') return (b.ordered ? '' : '- ') + tidy(b.text);
  if (b.type === 'raw') return b.text;
  if (b.type === 'table') {
    const n = Math.max(...b.rows.map(r => r.length));
    const row = r => '| ' + Array.from({ length: n }, (_, i) => tidy(r[i] || '').replace(/\|/g, '\\|')).join(' | ') + ' |';
    return [row(b.rows[0]), '| ' + Array(n).fill('---').join(' | ') + ' |', ...b.rows.slice(1).map(row)].join('\n');
  }
  return tidy(b.text);
}

function buildLines(items, boldFonts) {
  const rows = [];
  for (const it of items) {
    if (!it.str) continue;
    const [a, b, , d, x, y] = it.transform;
    const size = Math.hypot(b, d) || Math.abs(a) || it.height || 10;
    let row = rows.find(r => Math.abs(r.y - y) < size * 0.45);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push({ str: it.str, x, w: it.width, size, bold: boldFonts.has(it.fontName) });
  }
  rows.sort((r1, r2) => r2.y - r1.y);

  return rows.map(r => {
    r.items.sort((i1, i2) => i1.x - i2.x);
    // Tamaño dominante de la línea (el que más caracteres tiene, para que un «•» grande no la convierta en título)
    const bySize = new Map();
    for (const i of r.items) bySize.set(i.size, (bySize.get(i.size) || 0) + i.str.trim().length);
    const size = [...bySize.entries()].sort((x, y) => y[1] - x[1])[0][0];
    const visible = r.items.filter(i => i.str.trim());
    const allBold = visible.length > 0 && visible.every(i => i.bold);

    let text = '', end = null, boldOpen = false;
    const cells = [''];
    for (const i of r.items) {
      const hueco = end !== null ? i.x - end : 0;
      if (end !== null && hueco > i.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(i.str)) text += ' ';
      if (end !== null && hueco > i.size * 1.2 && i.str.trim() && cells[cells.length - 1].trim()) cells.push('');
      cells[cells.length - 1] += (cells[cells.length - 1] && hueco > i.size * 0.15 ? ' ' : '') + i.str;
      const markBold = !allBold && i.bold && i.str.trim().length > 1;
      if (markBold && !boldOpen) { text += '**'; boldOpen = true; }
      if (!markBold && boldOpen && i.str.trim()) { text = text.replace(/(\s*)$/, '**$1'); boldOpen = false; }
      text += i.str;
      if (i.str.trim()) end = i.x + i.w; else if (end === null) end = i.x + i.w;
    }
    if (boldOpen) text = text.replace(/(\s*)$/, '**$1');
    text = text.replace(/\*\*(\s+)\*\*/g, '$1').replace(/\*\*\s*\*\*/g, '').replace(/\*\*(\s+)/g, '$1**').replace(/\s{2,}/g, ' ');
    return { text, y: r.y, x: r.items[0].x, size, allBold, cells: cells.map(c => c.trim()).filter(Boolean) };
  });
}

function removeRepeated(pages) {
  const norm = t => t.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
  const counts = new Map();
  for (const pg of pages) {
    const seen = new Set();
    for (const l of [...pg.lines.slice(0, 3), ...pg.lines.slice(-3)]) {
      const n = norm(l.text);
      if (n && !seen.has(n)) { seen.add(n); counts.set(n, (counts.get(n) || 0) + 1); }
    }
  }
  const limit = Math.max(2, Math.ceil(pages.length * 0.5));
  for (const pg of pages) {
    const n = pg.lines.length;
    pg.lines = pg.lines.filter((l, i) => {
      if (!(i < 3 || i >= n - 3)) return true;
      const t = l.text.trim();
      if (/^(p[áa]g(ina)?\.?\s*)?\d{1,4}(\s*(de|of|\/)\s*\d{1,4})?$/i.test(t)) return false; // números de página
      return (counts.get(norm(t)) || 0) < limit;
    });
  }
}

function joinLines(a, b) {
  // Palabra partida con guion al final de línea: "conver-" + "sión" → "conversión"
  if (/[a-záéíóúñü]-$/i.test(a) && /^[a-záéíóúñü]/.test(b)) return a.slice(0, -1) + b;
  return a + ' ' + b;
}

const stripMarks = t => t.replace(/\*\*/g, '').trim();
const tidy = t => t.replace(/\s+([,.;:!?)\]»])/g, '$1').replace(/([(\[«¿¡])\s+/g, '$1').replace(/\s{2,}/g, ' ').trim();

/** Prepara el Markdown final: las páginas elegidas se enlazan como imagen y el resto de marcas se quitan. */
export function markdownFinal(md, elegidas, nombreImagen) {
  const sel = new Set(elegidas);
  let res = md.replace(/\n*<!-- img:(\d+) -->\n*/g, (_, n) =>
    sel.has(+n) ? `\n\n![Página ${n}](${nombreImagen(+n)})\n\n` : '\n\n');
  // Páginas añadidas a mano que no tenían marca → al final
  const sinMarca = [...sel].filter(n => !new RegExp(`<!-- img:${n} -->`).test(md)).sort((a, b) => a - b);
  if (sinMarca.length) res = res.trimEnd() + '\n\n## Imágenes adjuntas\n\n' + sinMarca.map(n => `![Página ${n}](${nombreImagen(n)})`).join('\n\n');
  return res.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

/** Limpia una transcripción de YouTube copiada (quita marcas de tiempo y forma párrafos). */
export function transcriptToMarkdown(raw, { titulo = '', url = '', frasesPorParrafo = 5 } = {}) {
  const lines = raw.replace(/\r/g, '').split('\n');
  const TS = /^\s*\(?\d{1,2}:\d{2}(:\d{2})?\)?\s*/;
  const SKIP = /^(transcripci[óo]n|transcript|buscar en el v[íi]deo|search in video|mostrar transcripci[óo]n|\d+\s*(segundos?|minutos?|horas?)(,?\s*\d+\s*(segundos?|minutos?))*)$/i;
  const parts = [];
  for (let l of lines) {
    l = l.trim();
    if (!l || /^\d{1,2}:\d{2}(:\d{2})?$/.test(l)) continue;
    l = l.replace(TS, '');
    if (!l || SKIP.test(l)) continue;
    if (/^\[(m[úu]sica|music|aplausos|applause|risas|laughter)\]$/i.test(l)) continue;
    parts.push(l);
  }
  const text = parts.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (!text) return '';

  const sentences = text.match(/[^.!?…]+[.!?…]+["»)]?\s*|[^.!?…]+$/g) || [text];
  const paragraphs = [];
  if (sentences.length > 2) {
    for (let i = 0; i < sentences.length; i += frasesPorParrafo) paragraphs.push(sentences.slice(i, i + frasesPorParrafo).join('').trim());
  } else {
    const words = text.split(' '); // sin puntuación (subtítulos automáticos): párrafos de ~90 palabras
    for (let i = 0; i < words.length; i += 90) paragraphs.push(words.slice(i, i + 90).join(' '));
  }
  let md = '';
  if (titulo) md += `# ${titulo.trim()}\n\n`;
  if (url) md += `Fuente: ${url.trim()}\n\n`;
  return md + paragraphs.join('\n\n') + '\n';
}

/** Estimación de tokens (aprox. 1 token ≈ 3,5 caracteres en español). */
export const estimarTokens = texto => Math.ceil((texto || '').length / 3.5);
/** Coste aproximado de una imagen de página enviada a Claude. */
export const TOKENS_IMAGEN = 1600;
