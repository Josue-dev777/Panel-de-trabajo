const sanitize = require('sanitize-filename');

function slugify(input) {
  const clean = String(input || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return sanitize(clean || `site-${Date.now()}`);
}

module.exports = { slugify };
