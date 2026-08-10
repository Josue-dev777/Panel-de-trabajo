const config = require('../config');

function seoPack({ name, url, description, keywords = [] }) {
  const title = `${name} | Sitio oficial`;
  const desc = description || `Conoce ${name}, novedades, ofertas y contenido actualizado.`;
  const tagList = Array.isArray(keywords) && keywords.length
    ? keywords
    : [name, 'ofertas', 'servicios', 'web oficial'];

  const meta = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(desc)}">`,
    `<meta name="keywords" content="${escapeHtml(tagList.join(', '))}">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(desc)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta name="twitter:card" content="summary_large_image">`
  ].join('\n');

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${escapeXml(url)}</loc>
    <lastmod>${new Date().toISOString()}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>`;

  const copy = {
    x: `Ya esta disponible ${name}: ${url} #web #lanzamiento`,
    discord: `Nuevo lanzamiento: **${name}**\n${desc}\n${url}`,
    whatsapp: `Mira ${name}: ${desc}\n${url}`,
    tiktok: `Idea para video: muestra el antes/despues de ${name}, cierra con "${url}" y CTA: visita el enlace.`
  };

  return { title, description: desc, keywords: tagList, meta, sitemap, copy };
}

function publicSiteUrl(site) {
  return `${config.baseUrl.replace(/\/$/, '')}/sites/${site.slug}/`;
}

async function pingIndexes(url) {
  const encoded = encodeURIComponent(url);
  const targets = [
    `https://www.bing.com/ping?sitemap=${encoded}`,
    `https://www.google.com/ping?sitemap=${encoded}`
  ];

  const results = [];
  for (const target of targets) {
    try {
      const response = await fetch(target, { method: 'GET' });
      results.push({ target, ok: response.ok, status: response.status });
    } catch (error) {
      results.push({ target, ok: false, error: error.message });
    }
  }
  return results;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function escapeXml(value) {
  return escapeHtml(value);
}

module.exports = { seoPack, publicSiteUrl, pingIndexes };
