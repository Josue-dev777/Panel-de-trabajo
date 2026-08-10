const fs = require('fs/promises');
const path = require('path');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

module.exports = { ensureDir, readJson, writeJson };
