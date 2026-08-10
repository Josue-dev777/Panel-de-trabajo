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

module.exports = { copyPack, makeQrSvg };
