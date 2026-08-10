const path = require('path');
const { ensureDir, readJson, writeJson } = require('../utils/fs-store');
const config = require('../config');

class DatabaseService {
  constructor() {
    this.dir = path.join(config.paths.data, 'site-databases');
  }

  async init() {
    await ensureDir(this.dir);
  }

  file(siteId) {
    return path.join(this.dir, `${siteId}.json`);
  }

  async read(siteId) {
    const data = await readJson(this.file(siteId), { tables: { contactos: [] } });
    return data.tables ? data : { tables: data };
  }

  async write(siteId, data) {
    const normalized = data && data.tables ? data : { tables: data || {} };
    await writeJson(this.file(siteId), normalized);
    return normalized;
  }

  async upsertRow(siteId, table, row) {
    const db = await this.read(siteId);
    db.tables[table] ||= [];
    const id = row.id || `${Date.now()}`;
    const current = db.tables[table].findIndex((item) => item.id === id);
    const saved = { ...row, id, updatedAt: new Date().toISOString() };
    if (current >= 0) db.tables[table][current] = saved;
    else db.tables[table].push(saved);
    await this.write(siteId, db);
    return saved;
  }
}

module.exports = new DatabaseService();
