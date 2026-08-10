function copyPack({ siteName, url, product = '', tone = 'directo' }) {
  const subject = product || siteName;
  return {
    headline: `${subject}: la oferta que tus clientes estaban esperando`,
    productDescription: `Presenta ${subject} con una propuesta clara, beneficios visibles y una llamada a la accion inmediata. Ideal para convertir visitas en contactos o ventas.`,
    shortAd: `Entra a ${siteName} y descubre ${subject}. Disponible ahora: ${url}`,
    social: {
      x: `${subject} ya esta disponible. Mira la web oficial: ${url}`,
      whatsapp: `Te comparto ${siteName}. Tiene informacion y ofertas de ${subject}: ${url}`,
      discord: `Nuevo recurso publicado: ${siteName}. Enlace directo: ${url}`,
      tiktok: `Nuevo lanzamiento de ${subject}. Link en la web: ${url}`
    },
    tone
  };
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;'
  }[char]));
}

function wrapLines(text, maxChars = 22, maxLines = 3) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.length ? lines : ['Promocion premium'];
}

function bannerSvg({ title = '', subtitle = '', cta = '', prompt = '', colors = [] }) {
  const palette = colors.length >= 3 ? colors : ['#22d3ee', '#a3e635', '#030712'];
  const titleLines = wrapLines(title || prompt || 'Promocion premium', 21, 3);
  const subLines = wrapLines(subtitle || 'Lista para redes sociales', 34, 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${escapeXml(palette[2])}"/>
      <stop offset=".52" stop-color="${escapeXml(palette[0])}"/>
      <stop offset="1" stop-color="${escapeXml(palette[1])}"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="26" stdDeviation="24" flood-color="#000" flood-opacity=".35"/>
    </filter>
  </defs>
  <rect width="1080" height="1080" fill="url(#g)"/>
  <g opacity=".24" fill="none" stroke="#fff" stroke-width="2">
    ${Array.from({ length: 16 }, (_, index) => `<rect x="${80 + index * 18}" y="${72 + index * 16}" width="${920 - index * 30}" height="${920 - index * 30}" rx="8"/>`).join('')}
  </g>
  <rect x="82" y="626" width="916" height="314" rx="18" fill="#030712" opacity=".82" filter="url(#shadow)"/>
  <text x="122" y="722" fill="#f8fafc" font-family="Inter, Arial, sans-serif" font-size="82" font-weight="900">
    ${titleLines.map((line, index) => `<tspan x="122" dy="${index ? 88 : 0}">${escapeXml(line.toUpperCase())}</tspan>`).join('')}
  </text>
  <text x="124" y="900" fill="#c4f1ff" font-family="Inter, Arial, sans-serif" font-size="38" font-weight="700">
    ${subLines.map((line, index) => `<tspan x="124" dy="${index ? 46 : 0}">${escapeXml(line)}</tspan>`).join('')}
  </text>
  <rect x="704" y="856" width="250" height="72" rx="10" fill="${escapeXml(palette[1])}"/>
  <text x="829" y="903" text-anchor="middle" fill="#07111c" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="900">${escapeXml((cta || 'Ver oferta').toUpperCase())}</text>
</svg>`;
}

function makeQrSvg(text) {
  const size = 29;
  const cells = [];
  let seed = [...String(text)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 2166136261);
  const next = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return seed >>> 0;
  };
  const finder = (x, y) => x < 7 && y < 7 || x >= size - 7 && y < 7 || x < 7 && y >= size - 7;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const inFinder = finder(x, y);
      const border = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const dot = inFinder
        ? border || x % 6 === 0 || y % 6 === 0 || (x % 6 >= 2 && x % 6 <= 4 && y % 6 >= 2 && y % 6 <= 4)
        : (next() + x * 17 + y * 23) % 3 === 0;
      if (dot) cells.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><g fill="#020617">${cells.join('')}</g></svg>`;
}

module.exports = { copyPack, makeQrSvg, bannerSvg };
