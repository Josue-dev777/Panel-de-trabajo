const fs = require('fs');
const http = require('http');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const archiver = require('archiver');
const unzipper = require('unzipper');
const sharp = require('sharp');
const { minify: minifyHtml } = require('html-minifier-terser');
const CleanCSS = require('clean-css');
const terser = require('terser');
const config = require('../config');
const { ensureDir, readJson, writeJson } = require('../utils/fs-store');
const { slugify } = require('../utils/slug');
const logHub = require('./logHub');
const githubService = require('./githubService');

class SiteManager {
  constructor() {
    this.file = path.join(config.paths.data, 'projects.json');
    this.processes = new Map();
    this.projects = [];
    this.busy = new Set();
    this.stopping = new Set();
    this.restartTimers = new Map();
  }

  async init() {
    await Promise.all([
      ensureDir(config.paths.data),
      ensureDir(config.paths.sites),
      ensureDir(config.paths.logs),
      ensureDir(config.paths.versions),
      ensureDir(config.paths.backups)
    ]);
    this.projects = await readJson(this.file, []);
    await this.seedDefault();
    for (const project of this.projects) {
      if (project.autostart !== false) {
        await this.start(project.id).catch((error) => {
          this.appendLog(project.id, `[boot] ${error.message}`);
        });
      }
    }
  }

  async seedDefault() {
    if (this.projects.length) return;
    await this.create({
      name: 'Landing Page Pro',
      type: 'static',
      code: `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Landing Page Pro</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#09090f;color:#f8fafc;font-family:Inter,system-ui,sans-serif}
    main{max-width:760px;padding:48px}
    h1{font-size:clamp(2.5rem,8vw,5rem);line-height:.92;margin:0}
    p{color:#94a3b8;font-size:1.2rem}
    a{color:#22d3ee}
  </style>
</head>
<body>
  <main>
    <h1>Tu web esta online.</h1>
    <p>Editala desde el panel y despliega cambios al instante.</p>
    <a href="/">Volver al panel</a>
  </main>
</body>
</html>`
    });
  }

  async save() {
    await writeJson(this.file, this.projects);
  }

  getAll() {
    return this.projects.map((project) => this.withRuntime(project));
  }

  get(id) {
    const project = this.projects.find((item) => item.id === id || item.slug === id);
    if (!project) {
      const error = new Error('Sitio no encontrado');
      error.status = 404;
      throw error;
    }
    return project;
  }

  getByHost(hostname) {
    const clean = cleanDomain(hostname).split(':')[0];
    const baseHost = cleanDomain(config.baseUrl).split(':')[0];
    return this.projects.find((project) => project.domain === clean || clean === `${project.slug}.${baseHost}`);
  }

  withRuntime(project) {
    const proc = this.processes.get(project.id);
    const isRunning = Boolean(proc && proc.child.exitCode === null);
    const status = this.busy.has(project.id) ? 'updating' : (isRunning ? 'online' : 'stopped');
    const uptimeMs = proc?.startedAt ? Date.now() - proc.startedAt : 0;
    const base = new URL(config.baseUrl);
    const supportsSubdomain = !['localhost', '127.0.0.1', '0.0.0.0'].includes(base.hostname)
      && !/^\d+\.\d+\.\d+\.\d+$/.test(base.hostname);
    const cleanUrl = project.domain
      ? `https://${project.domain}/`
      : (supportsSubdomain ? `https://${project.slug}.${base.hostname}/` : `${config.baseUrl.replace(/\/$/, '')}/sites/${project.slug}/`);
    return {
      ...project,
      github: githubService.publicGithub(project.github, config.baseUrl, project.id),
      status,
      uptimeMs,
      url: `/sites/${project.slug}/`,
      cleanUrl,
      directUrl: `http://localhost:${project.port}`
    };
  }

  allocatePort() {
    const used = new Set(this.projects.map((project) => project.port));
    for (let port = config.sitePortStart; port <= config.sitePortEnd; port += 1) {
      if (!used.has(port)) return port;
    }
    throw new Error('No hay puertos disponibles en el rango configurado');
  }

  async create({ name, type = 'static', code = '', domain = '', deploymentMethod = 'manual', github = {} }) {
    if (!String(name || '').trim()) {
      const error = new Error('Nombre de proyecto requerido');
      error.status = 400;
      throw error;
    }
    if (!['static', 'node'].includes(type)) {
      const error = new Error('Tipo de sitio invalido');
      error.status = 400;
      throw error;
    }
    const slugBase = slugify(name);
    let slug = slugBase;
    let counter = 2;
    while (this.projects.some((project) => project.slug === slug)) {
      slug = `${slugBase}-${counter}`;
      counter += 1;
    }

    const project = {
      id: slug,
      slug,
      name,
      type,
      port: this.allocatePort(),
      domain: cleanDomain(domain),
      popup: { enabled: false, message: '', cta: '', url: '' },
      deploymentMethod: deploymentMethod === 'github' ? 'github' : 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      autostart: true
    };

    this.projects.push(project);
    try {
      if (project.deploymentMethod === 'github') {
        await this.configureGithub(project.id, github, { initial: true });
      } else {
        await this.writeCode(project, code || this.defaultCode(name, type), { skipVersion: true });
        await this.save();
        await this.start(project.id);
      }
      return this.withRuntime(project);
    } catch (error) {
      this.projects = this.projects.filter((item) => item.id !== project.id);
      await fsp.rm(this.siteDir(project), { recursive: true, force: true }).catch(() => {});
      await this.save();
      throw error;
    }
  }

  defaultCode(name, type) {
    if (type === 'node') {
      return `const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.send('<h1>${escapeJs(name)}</h1><p>Sitio Node.js activo.</p>');
});

app.listen(port, () => console.log('Site listening on ' + port));`;
    }

    return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(name)}</title></head>
<body style="font-family:system-ui;background:#09090f;color:white;display:grid;place-items:center;min-height:100vh">
  <main><h1>${escapeHtml(name)}</h1><p>Sitio desplegado desde el panel.</p></main>
</body>
</html>`;
  }

  siteDir(project) {
    return path.join(config.paths.sites, project.slug);
  }

  staticRoot(project) {
    return project.staticDir ? path.join(this.siteDir(project), project.staticDir) : this.siteDir(project);
  }

  async writeCode(project, code, options = {}) {
    const dir = this.siteDir(project);
    await ensureDir(dir);
    if (!options.skipVersion) await this.recordVersion(project);
    const finalCode = await this.optimizeCode(code, project.type);
    if (project.type === 'node') {
      await fsp.writeFile(path.join(dir, 'server.js'), finalCode, 'utf8');
    } else {
      await fsp.writeFile(path.join(dir, 'index.html'), this.injectPopup(finalCode, project), 'utf8');
    }
    project.updatedAt = new Date().toISOString();
  }

  async optimizeCode(code, type) {
    if (type === 'node') return code;
    try {
      return await minifyHtml(String(code), {
        collapseWhitespace: true,
        removeComments: true,
        minifyCSS: (css) => new CleanCSS({ level: 1 }).minify(css).styles,
        minifyJS: async (js) => (await terser.minify(js)).code || js
      });
    } catch {
      return String(code)
        .replace(/<!--(?! hosting-control-)[\s\S]*?-->/g, '')
        .replace(/>\s+</g, '><')
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
  }

  popupBlock(project) {
    if (!project.popup?.enabled || !project.popup.message) return '';
    const message = escapeHtml(project.popup.message);
    const cta = escapeHtml(project.popup.cta || 'Ver oferta');
    const url = escapeHtml(project.popup.url || '#');
    return `<div id="hosting-global-popup" style="position:fixed;left:16px;right:16px;bottom:16px;z-index:2147483647;background:#020617;color:#e5f0ff;border:1px solid #22d3ee;border-radius:8px;padding:14px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between;font-family:system-ui,sans-serif;box-shadow:0 18px 60px rgba(0,0,0,.45)"><span>${message}</span><a href="${url}" style="background:#22d3ee;color:#031016;border-radius:6px;padding:9px 12px;text-decoration:none;font-weight:800">${cta}</a><button onclick="this.parentElement.remove()" style="background:transparent;color:#e5f0ff;border:0;font-size:18px">x</button></div>`;
  }

  injectPopup(code, project) {
    const block = `<!-- hosting-control-popup:start -->${this.popupBlock(project)}<!-- hosting-control-popup:end -->`;
    let html = String(code).replace(/<!-- hosting-control-popup:start -->[\s\S]*?<!-- hosting-control-popup:end -->/g, '');
    if (!project.popup?.enabled) return html;
    if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${block}</body>`);
    return `${html}${block}`;
  }

  async recordVersion(project) {
    const file = project.type === 'node'
      ? path.join(this.siteDir(project), project.entry || 'server.js')
      : path.join(this.staticRoot(project), 'index.html');
    try {
      const code = await fsp.readFile(file, 'utf8');
      const versions = await this.versions(project.id);
      versions.unshift({
        id: `${Date.now()}`,
        createdAt: new Date().toISOString(),
        type: project.type,
        code
      });
      await writeJson(path.join(config.paths.versions, `${project.id}.json`), versions.slice(0, 5));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  async versions(id) {
    const project = this.get(id);
    return readJson(path.join(config.paths.versions, `${project.id}.json`), []);
  }

  async rollback(id, versionId) {
    const project = this.get(id);
    const versions = await this.versions(project.id);
    const version = versions.find((item) => item.id === versionId) || versions[0];
    if (!version) {
      const error = new Error('No hay versiones para restaurar');
      error.status = 404;
      throw error;
    }
    project.type = version.type;
    await this.writeCode(project, version.code);
    await this.save();
    await this.restart(project.id);
    this.appendLog(project.id, `rollback aplicado a version ${version.id}`);
    return this.withRuntime(project);
  }

  async readCode(id) {
    const project = this.get(id);
    const file = project.type === 'node'
      ? path.join(this.siteDir(project), project.entry || 'server.js')
      : path.join(this.staticRoot(project), 'index.html');
    try {
      return { project: this.withRuntime(project), code: await fsp.readFile(file, 'utf8') };
    } catch (error) {
      if (error.code === 'ENOENT' && project.deploymentMethod === 'github') {
        return {
          project: this.withRuntime(project),
          code: 'Proyecto desplegado desde GitHub. Usa "Sincronizar con GitHub" para traer cambios.'
        };
      }
      throw error;
    }
  }

  async updateCode(id, code, type) {
    const project = this.get(id);
    if (type && !['static', 'node'].includes(type)) {
      const error = new Error('Tipo de sitio invalido');
      error.status = 400;
      throw error;
    }
    this.busy.add(project.id);
    try {
    if (type && type !== project.type) {
      project.type = type;
    }
    project.deploymentMethod = project.deploymentMethod || 'manual';
    await this.writeCode(project, code);
    await this.save();
    await this.restart(project.id);
    return this.withRuntime(project);
    } finally {
      this.busy.delete(project.id);
    }
  }

  async updateSettings(id, settings) {
    const project = this.get(id);
    if (settings.domain !== undefined) project.domain = cleanDomain(settings.domain);
    if (settings.popup) {
      project.popup = {
        enabled: Boolean(settings.popup.enabled),
        message: String(settings.popup.message || ''),
        cta: String(settings.popup.cta || ''),
        url: String(settings.popup.url || '')
      };
      if (project.type === 'static') {
        const current = await this.readCode(project.id);
        await this.writeCode(project, current.code);
      }
    }
    await this.save();
    return this.withRuntime(project);
  }

  async configureGithub(id, github = {}, options = {}) {
    const project = this.get(id);
    const repoUrl = github.repoUrl || github.repo || project.github?.repoUrl || project.github?.repo;
    const token = String(github.token || '').trim() || githubService.getSavedToken(project);
    const saveCredentials = Boolean(github.saveCredentials || project.github?.tokenEncrypted);
    if (!repoUrl) {
      const error = new Error('Repositorio de GitHub requerido');
      error.status = 400;
      throw error;
    }

    this.busy.add(project.id);
    try {
      if (!options.initial) await this.recordVersion(project).catch(() => {});
      await this.stop(project.id).catch(() => {});
      const result = await githubService.deploy({
        project,
        repoUrl,
        branch: github.branch || project.github?.branch,
        token,
        saveCredentials,
        targetDir: this.siteDir(project),
        log: (line) => {
          if (line) this.appendLog(project.id, `[github] ${line}`);
        }
      });

      project.deploymentMethod = 'github';
      project.type = result.runtime.type;
      project.staticDir = result.runtime.staticDir || '';
      project.startCommand = result.runtime.startCommand || null;
      project.github = {
        enabled: true,
        repo: result.repo,
        repoUrl: result.repoUrl,
        branch: result.branch,
        lastCommit: result.lastCommit,
        lastCommitAt: result.lastCommitAt,
        lastSyncAt: result.lastSyncAt,
        tokenEncrypted: result.tokenEncrypted,
        webhookSecret: project.github?.webhookSecret || crypto.randomBytes(18).toString('hex')
      };
      project.updatedAt = new Date().toISOString();
      await this.save();
      await this.optimizeAssets(project.id).catch((error) => this.appendLog(project.id, `[optimizer] ${error.message}`));
      await this.start(project.id);
      this.appendLog(project.id, `[github] desplegado commit ${result.lastCommit ? result.lastCommit.slice(0, 7) : 'desconocido'}`);
      return this.withRuntime(project);
    } finally {
      this.busy.delete(project.id);
    }
  }

  async syncGithub(id, token = '') {
    const project = this.get(id);
    if (project.deploymentMethod !== 'github' || !project.github?.enabled) {
      const error = new Error('Este sitio no tiene GitHub configurado');
      error.status = 400;
      throw error;
    }
    return this.configureGithub(project.id, {
      repoUrl: project.github.repoUrl || project.github.repo,
      branch: project.github.branch,
      token,
      saveCredentials: Boolean(project.github.tokenEncrypted)
    });
  }

  async applyGlobalPopup(popup, siteIds = []) {
    const targets = siteIds.length ? siteIds.map((id) => this.get(id)) : this.projects;
    const updated = [];
    for (const project of targets) {
      updated.push(await this.updateSettings(project.id, { popup }));
    }
    return updated;
  }

  async healthCheckAll() {
    for (const project of this.projects) {
      if (project.autostart === false || this.busy.has(project.id)) continue;
      const runtime = this.withRuntime(project);
      if (runtime.status !== 'online') {
        this.appendLog(project.id, 'health checker detecto sitio detenido; reiniciando');
        await this.start(project.id).catch((error) => this.appendLog(project.id, `[health] ${error.message}`));
        continue;
      }
      const ok = await this.healthCheck(project).catch(() => false);
      if (!ok) {
        this.appendLog(project.id, 'health checker detecto error HTTP; reiniciando');
        await this.restart(project.id).catch((error) => this.appendLog(project.id, `[health] ${error.message}`));
      }
    }
  }

  healthCheck(project) {
    return new Promise((resolve) => {
      const req = http.get({ host: '127.0.0.1', port: project.port, path: '/', timeout: 5000 }, (res) => {
        res.resume();
        resolve(res.statusCode < 500);
      });
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
      req.on('error', () => resolve(false));
    });
  }

  async start(id) {
    const project = this.get(id);
    const current = this.processes.get(project.id);
    if (current && current.child.exitCode === null) return this.withRuntime(project);
    if (this.restartTimers.has(project.id)) {
      clearTimeout(this.restartTimers.get(project.id));
      this.restartTimers.delete(project.id);
    }

    const logFile = path.join(config.paths.logs, `${project.slug}.log`);
    const out = fs.createWriteStream(logFile, { flags: 'a' });
    const command = project.type === 'node'
      ? (project.startCommand?.command || process.execPath)
      : process.execPath;
    const args = project.type === 'node'
      ? (project.startCommand?.args || [path.join(this.siteDir(project), project.entry || 'server.js')])
      : [path.join(config.root, 'src/runtime/static-site-server.js')];

    const child = spawn(command, args, {
      cwd: this.siteDir(project),
      env: {
        ...process.env,
        PORT: String(project.port),
        SITE_PUBLIC_DIR: this.staticRoot(project)
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const startedAt = Date.now();
    const writeLine = (chunk) => {
      const lines = chunk.toString().split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        const formatted = `[${new Date().toISOString()}] ${line}`;
        out.write(`${formatted}\n`);
        logHub.emitLine(project.id, formatted);
      }
    };

    child.stdout.on('data', writeLine);
    child.stderr.on('data', writeLine);
    child.on('exit', (code, signal) => {
      const line = `[${new Date().toISOString()}] process exited code=${code} signal=${signal || 'none'}`;
      out.write(`${line}\n`);
      out.end();
      logHub.emitLine(project.id, line);
      const currentProc = this.processes.get(project.id);
      if (currentProc?.child === child) this.processes.delete(project.id);

      const intentionalStop = this.stopping.has(project.id);
      this.stopping.delete(project.id);
      if (!intentionalStop && project.autostart !== false) {
        const timer = setTimeout(() => {
          this.restartTimers.delete(project.id);
          this.appendLog(project.id, 'auto-restarting after unexpected exit');
          this.start(project.id).catch((error) => this.appendLog(project.id, `[auto-restart] ${error.message}`));
        }, 2000);
        timer.unref();
        this.restartTimers.set(project.id, timer);
      }
    });

    this.processes.set(project.id, { child, startedAt });
    this.appendLog(project.id, `started on port ${project.port}`);
    return this.withRuntime(project);
  }

  async stop(id) {
    const project = this.get(id);
    const proc = this.processes.get(project.id);
    if (proc && proc.child.exitCode === null) {
      this.stopping.add(project.id);
      proc.child.kill('SIGTERM');
      setTimeout(() => {
        if (proc.child.exitCode == null) proc.child.kill('SIGKILL');
      }, 3000).unref();
      await new Promise((resolve) => {
        proc.child.once('exit', resolve);
        setTimeout(resolve, 4500).unref();
      });
    }
    this.processes.delete(project.id);
    this.appendLog(project.id, 'stopped');
    return this.withRuntime(project);
  }

  async restart(id) {
    const project = this.get(id);
    this.busy.add(project.id);
    try {
    await this.stop(project.id);
    return this.start(project.id);
    } finally {
      this.busy.delete(project.id);
    }
  }

  async logs(id, lines = 200) {
    const project = this.get(id);
    const file = path.join(config.paths.logs, `${project.slug}.log`);
    try {
      const content = await fsp.readFile(file, 'utf8');
      return content.split(/\r?\n/).filter(Boolean).slice(-Number(lines || 200));
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }

  appendLog(id, line) {
    const project = this.get(id);
    const formatted = `[${new Date().toISOString()}] ${line}`;
    fs.appendFile(path.join(config.paths.logs, `${project.slug}.log`), `${formatted}\n`, () => {});
    logHub.emitLine(project.id, formatted);
  }

  async backup(id) {
    const project = this.get(id);
    const name = `${project.slug}-${Date.now()}.zip`;
    const outputPath = path.join(config.paths.backups, name);
    await ensureDir(config.paths.backups);

    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', { zlib: { level: 9 } });
      output.on('close', resolve);
      archive.on('error', reject);
      archive.pipe(output);
      archive.directory(this.siteDir(project), project.slug);
      archive.finalize();
    });

    this.appendLog(project.id, `backup created ${name}`);
    return { file: outputPath, filename: name };
  }

  async delete(id) {
    const project = this.get(id);
    await this.stop(project.id);
    if (this.restartTimers.has(project.id)) {
      clearTimeout(this.restartTimers.get(project.id));
      this.restartTimers.delete(project.id);
    }
    await fsp.rm(this.siteDir(project), { recursive: true, force: true });
    await fsp.rm(path.join(config.paths.logs, `${project.slug}.log`), { force: true });
    this.projects = this.projects.filter((item) => item.id !== project.id);
    await this.save();
  }

  async restore(id, zipPath) {
    const project = this.get(id);
    this.busy.add(project.id);
    try {
    await this.stop(project.id);
    await fsp.rm(this.siteDir(project), { recursive: true, force: true });
    await ensureDir(this.siteDir(project));

    const extracted = await unzipper.Open.file(zipPath);
    const prefix = extracted.files[0]?.path.split('/')[0];
    const siteRoot = path.resolve(this.siteDir(project));
    for (const file of extracted.files) {
      if (file.type !== 'File') continue;
      const relative = prefix ? file.path.replace(new RegExp(`^${prefix}/?`), '') : file.path;
      if (!relative) continue;
      const target = path.resolve(this.siteDir(project), relative);
      if (target !== siteRoot && !target.startsWith(`${siteRoot}${path.sep}`)) continue;
      await ensureDir(path.dirname(target));
      await new Promise((resolve, reject) => {
        file.stream().pipe(fs.createWriteStream(target)).on('finish', resolve).on('error', reject);
      });
    }

    project.updatedAt = new Date().toISOString();
    await this.save();
    await fsp.rm(zipPath, { force: true });
    await this.optimizeAssets(project.id);
    await this.start(project.id);
    this.appendLog(project.id, 'backup restored');
    return this.withRuntime(project);
    } finally {
      this.busy.delete(project.id);
      await fsp.rm(zipPath, { force: true }).catch(() => {});
    }
  }

  async applySeo(id, pack) {
    const project = this.get(id);
    const dir = this.siteDir(project);
    await fsp.writeFile(path.join(dir, 'sitemap.xml'), pack.sitemap, 'utf8');
    await fsp.writeFile(path.join(dir, 'seo-pack.json'), JSON.stringify(pack, null, 2), 'utf8');

    if (project.type !== 'static') {
      this.appendLog(project.id, 'seo pack generated for Node site');
      return;
    }

    const file = path.join(dir, 'index.html');
    let html = await fsp.readFile(file, 'utf8');
    const block = `<!-- hosting-control-seo:start -->\n${pack.meta}\n<!-- hosting-control-seo:end -->`;
    if (/<!-- hosting-control-seo:start -->[\s\S]*?<!-- hosting-control-seo:end -->/.test(html)) {
      html = html.replace(/<!-- hosting-control-seo:start -->[\s\S]*?<!-- hosting-control-seo:end -->/, block);
    } else if (/<\/head>/i.test(html)) {
      html = html.replace(/<\/head>/i, `${block}\n</head>`);
    } else {
      html = `${block}\n${html}`;
    }
    await fsp.writeFile(file, html, 'utf8');
    project.updatedAt = new Date().toISOString();
    await this.save();
    this.appendLog(project.id, 'seo meta tags and sitemap applied');
  }

  async optimizeAssets(id) {
    const project = this.get(id);
    const root = this.siteDir(project);
    const optimized = [];
    await walk(root, async (file) => {
      if (!/\.(png|jpe?g)$/i.test(file)) return;
      const output = file.replace(/\.(png|jpe?g)$/i, '.webp');
      try {
        await sharp(file).webp({ quality: 82 }).toFile(output);
        optimized.push(path.relative(root, output));
      } catch (error) {
        this.appendLog(project.id, `[optimizer] ${path.basename(file)}: ${error.message}`);
      }
    });
    if (optimized.length) this.appendLog(project.id, `imagenes optimizadas a WebP: ${optimized.join(', ')}`);
    return { optimized };
  }
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

function escapeJs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

module.exports = new SiteManager();

function cleanDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

async function walk(dir, visitor) {
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, visitor);
    else await visitor(full);
  }
}
