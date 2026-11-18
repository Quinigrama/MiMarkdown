// Mi Markdown — motor de anonimización (100 % local)
// Busca los datos de tu lista (sin importar mayúsculas ni tildes) y los datos
// personales típicos (DNI/NIE, teléfonos, emails, IBAN) en un texto.

const VARIANTES = {
  a: 'aáàäâã', e: 'eéèëê', i: 'iíìïî', o: 'oóòöôõ', u: 'uúùüû', n: 'nñ', c: 'cç',
};
const escapar = ch => ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** Convierte una entrada de la lista en una expresión regular flexible. */
function patronDeEntrada(texto) {
  const base = texto.trim().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let p = '';
  const chars = [...base];
  chars.forEach((ch, i) => {
    const sig = chars[i + 1];
    if (/\s/.test(ch)) { if (!/\s$/.test(p)) p += '\\s+'; return; }
    if (VARIANTES[ch]) p += `[${VARIANTES[ch]}]`;
    else p += escapar(ch);
    // Entre cifras permitimos separadores: 612345678 = 612 34 56 78 = 612-345-678
    if (/\d/.test(ch) && sig && /\d/.test(sig)) p += '[\\s.\\-]?';
  });
  p = p.replace(/(\\s\+)+$/, '');
  // Que no sea parte de otra palabra ("Ana" no debe tapar "Mariana")
  return new RegExp(`(?<![\\p{L}\\p{N}])${p}(?![\\p{L}\\p{N}])`, 'giu');
}

const telValido = m => { const d = m.replace(/\D/g, ''); return d.length === 9 || (d.length === 11 && d.startsWith('34')); };

export const AUTOMATICOS = [
  { clave: 'email', nombre: 'Emails', por: '[EMAIL]', re: new RegExp([
    '[\\p{L}\\p{N}._%+-]+@[\\p{L}\\p{N}-]+(?:\\.[\\p{L}\\p{N}-]+)+',
    // El OCR a veces lee la @ como O, 0, © o ®: «anaOcorreo.es»
    '[\\p{L}\\p{N}._%+-]+[O0©®Q][a-z0-9-]{2,}\\.(?:com|es|net|org|eu|info|cat|gal|eus|biz|me|io)(?![\\p{L}\\p{N}])',
  ].join('|'), 'gu') },
  { clave: 'iban', nombre: 'IBAN / cuentas', por: '[IBAN]', re: /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?:[ ]?[\dA-Z]{4}){4,7}(?:[ ]?[\dA-Z]{1,3})?(?![\p{L}\p{N}])/gu },
  { clave: 'dni', nombre: 'DNI / NIE', por: '[DNI]', re: new RegExp([
    '(?<![\\p{L}\\p{N}])[XYZxyz]?[\\s-]?\\d{2}[.]?\\d{3}[.]?\\d{3}[\\s-]?[A-Za-z](?![\\p{L}\\p{N}])',   // 12.345.678-Z
    '(?<![\\p{L}\\p{N}])[XYZ][\\s-]?\\d{7}[\\s-]?[A-Za-z](?![\\p{L}\\p{N}])',                      // X1234567L
    // Lo que venga detrás de «DNI», «NIE» o «NIF» (atrapa también letras mal leídas por el OCR)
    '(?<=(?<![\\p{L}])(?:D\\.?N\\.?I|N\\.?I\\.?[EF])\\.?(?:\\s*(?:n[ºo°.]*|número|num\\.?))?[\\s:]*)[\\dXYZxyz][\\d.\\-\\s]{5,12}[\\dA-Za-z]{1,2}(?![\\p{L}\\p{N}])',
  ].join('|'), 'gu') },
  { clave: 'tel', nombre: 'Teléfonos', por: '[TELÉFONO]', re: /(?<![\p{N}+])(?:\+34[\s.-]?|0034[\s.-]?)?[6789]\d{1,2}(?:[\s.-]?\d{2,3}){2,3}(?!\p{N})/gu, valida: telValido },
];

/**
 * Prepara las reglas a partir de tu lista y de los automáticos activados.
 * lista: [{ texto, por }]   autos: { email: true, dni: true, ... }
 */
export function crearReglas(lista = [], autos = {}) {
  const reglas = lista
    .filter(e => e.texto && e.texto.trim().length >= 2)
    .sort((a, b) => b.texto.length - a.texto.length)
    .map(e => ({ re: patronDeEntrada(e.texto), por: e.por || '[OCULTO]', nombre: e.texto.trim() }));
  for (const a of AUTOMATICOS) if (autos[a.clave]) reglas.push({ re: a.re, por: a.por, nombre: a.nombre, valida: a.valida });
  return reglas;
}

/** Devuelve las coincidencias sin solaparse: [{ s, e, por, nombre }] (s = inicio, e = fin). */
export function buscar(texto, reglas) {
  const todas = [];
  reglas.forEach((r, prioridad) => {
    r.re.lastIndex = 0;
    for (const m of texto.matchAll(r.re)) {
      if (!m[0].trim() || (r.valida && !r.valida(m[0]))) continue;
      todas.push({ s: m.index, e: m.index + m[0].length, por: r.por, nombre: r.nombre, prioridad });
    }
  });
  // Primero las de la lista (más largas antes), luego las automáticas
  todas.sort((a, b) => a.prioridad - b.prioridad || (b.e - b.s) - (a.e - a.s));
  const elegidas = [];
  for (const m of todas) if (!elegidas.some(x => m.s < x.e && x.s < m.e)) elegidas.push(m);
  return elegidas.sort((a, b) => a.s - b.s);
}

/** Sustituye en un texto. Devuelve { texto, recuento: { nombre: veces } }. */
export function anonimizarTexto(texto, reglas) {
  const ms = buscar(texto, reglas);
  const recuento = {};
  let out = '', pos = 0;
  for (const m of ms) {
    out += texto.slice(pos, m.s) + m.por;
    pos = m.e;
    recuento[m.nombre] = (recuento[m.nombre] || 0) + 1;
  }
  return { texto: out + texto.slice(pos), recuento, total: ms.length };
}

/** Etiqueta propuesta para una entrada nueva, según el tipo y cuántas hay ya de ese tipo. */
export function etiquetaSugerida(tipo, lista) {
  const base = { nombre: 'NOMBRE', dni: 'DNI', tel: 'TELÉFONO', email: 'EMAIL', dir: 'DIRECCIÓN', cuenta: 'CUENTA', empresa: 'EMPRESA', otro: 'DATO' }[tipo] || 'DATO';
  const nums = lista.map(e => (e.por || '').match(new RegExp(`^\\[${base} (\\d+)\\]$`))).filter(Boolean).map(m => +m[1]);
  return `[${base} ${nums.length ? Math.max(...nums) + 1 : 1}]`;
}
