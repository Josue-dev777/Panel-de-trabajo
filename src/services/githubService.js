const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const unzipper = require('unzipper');
const config = require('../config');
const { ensureDir } = require('../utils/fs-store');

const TOKEN_ALGORITHM = 'aes-256-gcm';
const TOKEN_VERSION = 'v1';

function parseRepo(input) {
  const raw = String(input || '').trim().replace(/\.git$/, '');
  if (!raw) throw badRequest('Repositorio de GitHub requerido');

  let owner;
  let repo;
  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      if (url.hostname !== 'github.com') throw badRequest('La URL debe pertenecer a github.com');
      [owner, repo] = url.pathname.replace(/^\/+/, '').split('/');
    } else {
      [owner, repo] = raw.split('/');
    }
  } catch (error) {
    if (error.status) throw error;
    throw badRequest('Formato de repositorio invalido. Usa usuario/repositorio o URL completa.');
  }

  if (!/^[A-Za-z0-9_.-]+$/.test(owner || '') || !/^[A-Za-z0-9_.-]+$/.test(repo || '')) {
    throw badRequest('Formato de repositorio invalido. Usa usuario/repositorio o URL completa.');
  }
  return { owner, repo, fullName: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}` };
}

function encryptToken(token) {
  if (!token) return null;
  const key = crypto.createHash('sha256').update(config.jwtSecret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(TOKEN_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${TOKEN_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptToken(payload) {
  if (!payload) return '';
  const [version, iv, tag, encrypted] = String(payload).split(':');
  if (version !== TOKEN_VERSION || !iv || !tag || !encrypted) throw new Error('Token GitHub cifrado invalido');
  const key = crypto.createHash('sha256').update(config.jwtSecret).digest();
  const decipher = crypto.createDecipheriv(TOKEN_ALGORITHM, key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

async function fetchJson(url, token) {
  const response = await request(url, { token, accept: 'application/vnd.github+json' });
  if (response.statusCode >= 200 && response.statusCode < 300) {
    return JSON.parse(response.body.toString('utf8'));
  }
  throw githubError(response, 'No se pudo consultar GitHub');
}

async function downloadZip({ owner, repo, branch, token, targetZip }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/zipball/${encodeURIComponent(branch)}`;
  const response = await request(url, {
    token,
    accept: 'application/vnd.github+json',
    streamTo: targetZip
  });
  if (response.statusCode >= 200 && response.statusCode < 300) return;
  throw githubError(response, 'No se pudo descargar el repositorio');
}

async function resolveBranch(repoInfo, requestedBranch, token) {
  const candidates = String(requestedBranch || '').trim()
    ? [String(requestedBranch).trim()]
    : ['main', 'master'];

  let lastError;
  for (const branch of candidates) {
    try {
      const data = await fetchJson(
        `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/branches/${encodeURIComponent(branch)}`,
        token
      );
      return {
        branch,
        commit: data.commit?.sha || '',
        commitDate: data.commit?.commit?.committer?.date || data.commit?.commit?.author?.date || ''
      };
    } catch (error) {
      lastError = error;
      if (requestedBranch) throw error;
    }
  }
  throw lastError || badRequest('No se encontro la rama main ni master');
}

async function extractZip(zipPath, targetDir) {
  await fsp.rm(targetDir, { recursive: true, force: true });
  await ensureDir(targetDir);
  const directory = await unzipper.Open.file(zipPath);
  const rootName = directory.files.find((file) => file.path.includes('/'))?.path.split('/')[0];
  const safeRoot = path.resolve(targetDir);
  for (const file of directory.files) {
    if (file.type !== 'File') continue;
    const relative = rootName ? file.path.replace(new RegExp(`^${escapeRegExp(rootName)}/?`), '') : file.path;
    if (!relative || relative.includes('..')) continue;
    const target = path.resolve(targetDir, relative);
    if (target !== safeRoot && !target.startsWith(`${safeRoot}${path.sep}`)) continue;
    await ensureDir(path.dirname(target));
    await new Promise((resolve, reject) => {
      file.stream().pipe(fs.createWriteStream(target)).on('finish', resolve).on('error', reject);
    });
  }
}

async function installAndBuild(projectDir, log) {
  const pkgPath = path.join(projectDir, 'package.json');
  let pkg = null;
  try {
    pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw badRequest('package.json invalido');
  }

  if (!pkg) return { hasPackage: false, type: 'static', staticDir: '' };

  await runCommand('npm', ['install'], projectDir, log);
  if (pkg.scripts?.build) await runCommand('npm', ['run', 'build'], projectDir, log);

  const staticDir = await firstExistingDir(projectDir, ['dist', 'build', 'public']);
  const hasStart = Boolean(pkg.scripts?.start);
  if (hasStart && !staticDir) {
    return { hasPackage: true, type: 'node', startCommand: { command: 'npm', args: ['start'] }, staticDir: '' };
  }
  if (hasStart && pkg.hostingControl?.runtime === 'node') {
    return { hasPackage: true, type: 'node', startCommand: { command: 'npm', args: ['start'] }, staticDir: '' };
  }
  return { hasPackage: true, type: 'static', staticDir: staticDir ? path.relative(projectDir, staticDir) : '' };
}

async function detectRuntime(projectDir) {
  const server = await fileExists(path.join(projectDir, 'server.js'));
  const index = await fileExists(path.join(projectDir, 'index.html'));
  if (server && !index) return { type: 'node', startCommand: { command: 'node', args: ['server.js'] }, staticDir: '' };
  return { type: 'static', staticDir: '' };
}

async function runCommand(command, args, cwd, log) {
  log(`ejecutando ${command} ${args.join(' ')}`);
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => log(chunk.toString().trim()));
    child.stderr.on('data', (chunk) => log(chunk.toString().trim()));
    child.on('error', (error) => reject(badRequest(`No se pudo ejecutar ${command}: ${error.message}`)));
    child.on('exit', (code) => {
      if (code === 0) return resolve();
      return reject(badRequest(`${command} ${args.join(' ')} fallo con codigo ${code}`));
    });
  });
}

async function deploy({ project, repoUrl, branch, token, saveCredentials, targetDir, log }) {
  const repoInfo = parseRepo(repoUrl);
  const cleanToken = String(token || '').trim();
  const resolved = await resolveBranch(repoInfo, branch, cleanToken);
  const zipPath = path.join(config.root, 'tmp', `${project.id}-${Date.now()}-github.zip`);
  await ensureDir(path.dirname(zipPath));

  try {
    log(`descargando ${repoInfo.fullName}@${resolved.branch}`);
    await downloadZip({ ...repoInfo, branch: resolved.branch, token: cleanToken, targetZip: zipPath });
    await extractZip(zipPath, targetDir);
    let runtime = await installAndBuild(targetDir, log);
    if (!runtime.hasPackage) runtime = { ...runtime, ...(await detectRuntime(targetDir)) };

    return {
      repo: repoInfo.fullName,
      repoUrl: repoInfo.url,
      branch: resolved.branch,
      lastCommit: resolved.commit,
      lastCommitAt: resolved.commitDate,
      lastSyncAt: new Date().toISOString(),
      tokenEncrypted: saveCredentials && cleanToken ? encryptToken(cleanToken) : project.github?.tokenEncrypted || '',
      hasToken: Boolean((saveCredentials && cleanToken) || project.github?.tokenEncrypted),
      runtime
    };
  } finally {
    await fsp.rm(zipPath, { force: true }).catch(() => {});
  }
}

function getSavedToken(project) {
  return decryptToken(project.github?.tokenEncrypted);
}

function publicGithub(github = {}, baseUrl = config.baseUrl, siteId = '') {
  return {
    enabled: Boolean(github.enabled),
    repo: github.repo || '',
    repoUrl: github.repoUrl || '',
    branch: github.branch || '',
    lastCommit: github.lastCommit || '',
    lastCommitShort: github.lastCommit ? github.lastCommit.slice(0, 7) : '',
    lastCommitAt: github.lastCommitAt || '',
    lastSyncAt: github.lastSyncAt || '',
    hasToken: Boolean(github.tokenEncrypted || github.hasToken),
    webhookUrl: github.webhookSecret && siteId
      ? `${baseUrl.replace(/\/$/, '')}/api/webhooks/github/${siteId}/${github.webhookSecret}`
      : ''
  };
}

function request(url, { token, accept, streamTo } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      headers: {
        'User-Agent': 'Vento-Hosting-Control',
        Accept: accept || 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        request(res.headers.location, { token, accept, streamTo }).then(resolve).catch(reject);
        return;
      }

      if (streamTo && res.statusCode >= 200 && res.statusCode < 300) {
        const file = fs.createWriteStream(streamTo);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.alloc(0) })));
        file.on('error', reject);
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('GitHub no respondio a tiempo')));
    req.end();
  });
}

function githubError(response, fallback) {
  let message = fallback;
  try {
    message = JSON.parse(response.body.toString('utf8')).message || message;
  } catch {}
  const error = new Error(response.statusCode === 401 || response.statusCode === 403
    ? `Token GitHub invalido o sin permisos: ${message}`
    : response.statusCode === 404
      ? `Repositorio o rama no encontrados: ${message}`
      : `${fallback}: ${message}`);
  error.status = response.statusCode >= 500 ? 502 : 400;
  return error;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

async function firstExistingDir(root, names) {
  for (const name of names) {
    const dir = path.join(root, name);
    try {
      const stat = await fsp.stat(dir);
      if (stat.isDirectory()) return dir;
    } catch {}
  }
  return '';
}

async function fileExists(file) {
  try {
    const stat = await fsp.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  deploy,
  encryptToken,
  getSavedToken,
  parseRepo,
  publicGithub
};
