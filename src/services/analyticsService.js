const path = require('path');
const { readJson, writeJson, ensureDir } = require('../utils/fs-store');
const config = require('../config');

class AnalyticsService {
  constructor() {
    this.file = path.join(config.paths.data, 'analytics.json');
    this.data = {};
  }

  async init() {
    await ensureDir(config.paths.data);
    this.data = await readJson(this.file, {});
  }

  async save() {
    await writeJson(this.file, this.data);
  }

  async track(siteId, req) {
    const today = new Date().toISOString().slice(0, 10);
    const country = String(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || 'Desconocido');
    const page = req.path || '/';
    const site = this.data[siteId] ||= { daily: {}, pages: {}, countries: {} };
    site.daily[today] = (site.daily[today] || 0) + 1;
    site.pages[page] = (site.pages[page] || 0) + 1;
    site.countries[country] = (site.countries[country] || 0) + 1;
    await this.save().catch(() => {});
  }

  summary(siteId) {
    const site = this.data[siteId] || { daily: {}, pages: {}, countries: {} };
    const rank = (object) => Object.entries(object)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));
    return {
      daily: site.daily,
      popularPages: rank(site.pages),
      countries: rank(site.countries),
      total: Object.values(site.daily).reduce((sum, count) => sum + count, 0)
    };
  }
}

module.exports = new AnalyticsService();
