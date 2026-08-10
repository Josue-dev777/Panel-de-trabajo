const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const si = require('systeminformation');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { WebSocketServer } = require('ws');
const config = require('./config');
process.env.XDG_CACHE_HOME = process.env.XDG_CACHE_HOME || path.join(config.root, 'tmp', '.cache');
fs.mkdirSync(process.env.XDG_CACHE_HOME, { recursive: true });
const sharp = require('sharp');
const { signSession, verifySessionToken, authRequired } = require('./middleware/auth');
const siteManager = require('./services/siteManager');
const userManager = require('./services/userManager');
const analyticsService = require('./services/analyticsService');
const databaseService = require('./services/databaseService');
const { copyPack, bannerSvg } = require('./services/marketingService');
const logHub = require('./services/logHub');
const { seoPack, publicSiteUrl, pingIndexes } = require('./services/seoService');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
fs.mkdirSync(path.join(config.root, 'tmp'), { recursive: true });
const upload = multer({ dest: path.join(config.root, 'tmp') });

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(cookieParser());
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  hsts: config.nodeEnv === 'production'
    ? { maxAge: 15552000, includeSubDomains: true, preload: false }
    : false
}));
app.use(cors({
  origin(origin, callback) {
    if (!origin || !config.allowedOrigins.length || config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Origen no permitido por CORS'));
  },
  credentials: true
}));

app.use((req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use((req, res, next) => {
  let csrf = req.cookies.csrf_token;
  if (!csrf || !/^[a-f0-9]{64}$/i.test(csrf)) {
    csrf = crypto.randomBytes(32).toString('hex');
    res.cookie('csrf_token', csrf, {
      httpOnly: false,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production',
      maxAge: 12 * 60 * 60 * 1000
    });
  }
  req.csrfToken = csrf;
  next();
});

function csrfRequired(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.path === '/api/auth/login') return next();
  if (req.path.startsWith('/api/webhooks/github/')) return next();
  const header = req.get('x-csrf-token');
  if (!header || header !== req.cookies.csrf_token) {
    return res.status(403).json({ error: 'Token CSRF invalido' });
  }
  return next();
}

const proxies = new Map();

if (config.nodeEnv === 'production' && config.jwtSecret === 'dev_only_replace_me') {
  throw new Error('JWT_SECRET debe cambiarse en produccion');
}

function proxyFor(site) {
  if (!proxies.has(site.id)) {
    proxies.set(site.id, createProxyMiddleware({
      target: `http://127.0.0.1:${site.port}`,
      changeOrigin: true,
      ws: true,
      pathRewrite: (_path, req) => req.originalUrl.replace(new RegExp(`^/sites/${site.slug}`), '') || '/'
    }));
  }
  return proxies.get(site.id);
}

function requireAdmin(req) {
  return userManager.requireAdmin(req.user);
}

function assertSiteAccess(req, siteId) {
  const site = siteManager.get(siteId);
  if (!userManager.canAccessSite(req.user, site.id)) {
    const error = new Error('No tienes acceso a este sitio');
    error.status = 403;
    throw error;
  }
  return site;
}

async function proxySite(site, req, res, next) {
  analyticsService.track(site.id, req).catch(() => {});
  return proxyFor(site)(req, res, next);
}

app.use(async (req, res, next) => {
  try {
    const host = req.headers.host;
    const site = host ? siteManager.getByHost(host) : null;
    if (site) return proxySite(site, req, res, next);
  } catch {
    // Fall through to the normal panel/API routes.
  }
  return next();
});

app.use('/sites/:slug', async (req, res, next) => {
  try {
    const site = siteManager.get(req.params.slug);
    return proxySite(site, req, res, next);
  } catch (error) {
    return res.status(error.status || 502).send(error.message);
  }
});

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'self'"
    ].join('; ')
  );
  next();
});

app.use(express.json({ limit: '4mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(csrfRequired);

app.use('/api/auth/login', rateLimit({ windowMs: 60_000, max: 8 }));
app.use('/api/', rateLimit({ windowMs: 60_000, max: 180, standardHeaders: true, legacyHeaders: false }));
app.use('/public', express.static(config.paths.public));
app.use(express.static(config.paths.public));

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await userManager.validate(username, password);

  if (!user) {
    return res.status(401).json({ error: 'Credenciales invalidas' });
  }

  const token = signSession(user);
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 12 * 60 * 60 * 1000
  });
  return res.json({ ok: true, user });
});

app.get('/api/public-config', (req, res) => {
  res.json({
    baseUrl: config.baseUrl,
    production: config.nodeEnv === 'production',
    csrfToken: req.csrfToken,
    security: {
      csrf: true,
      httpOnlySession: true,
      bcrypt: true,
      rateLimit: true,
      hstsReady: config.nodeEnv === 'production'
    }
  });
});

app.post('/api/auth/logout', (_req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

app.get('/api/session', authRequired, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/sites', authRequired, (req, res) => {
  const sites = siteManager.getAll()
    .filter((site) => userManager.canAccessSite(req.user, site.id));
  res.json({ sites });
});

app.post('/api/sites', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    const site = await siteManager.create(req.body);
    res.status(201).json({ site });
  } catch (error) {
    next(error);
  }
});

app.get('/api/sites/:id/code', authRequired, async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.id);
    res.json(await siteManager.readCode(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.put('/api/sites/:id/code', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    const site = await siteManager.updateCode(req.params.id, req.body.code || '', req.body.type);
    res.json({ site });
  } catch (error) {
    next(error);
  }
});

app.post('/api/sites/:id/:action(start|stop|restart)', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    const site = await siteManager[req.params.action](req.params.id);
    res.json({ site });
  } catch (error) {
    next(error);
  }
});

app.put('/api/sites/:id/github', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    const site = await siteManager.configureGithub(req.params.id, req.body || {});
    res.json({ site });
  } catch (error) {
    next(error);
  }
});

app.post('/api/sites/:id/github/sync', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    const site = await siteManager.syncGithub(req.params.id, req.body?.token || '');
    res.json({ site });
  } catch (error) {
    next(error);
  }
});

app.post('/api/webhooks/github/:id/:secret', async (req, res, next) => {
  try {
    const site = siteManager.get(req.params.id);
    if (!site.github?.webhookSecret || site.github.webhookSecret !== req.params.secret) {
      return res.status(403).json({ error: 'Webhook no autorizado' });
    }
    const refBranch = String(req.body?.ref || '').replace('refs/heads/', '');
    if (refBranch && site.github.branch && refBranch !== site.github.branch) {
      return res.json({ ok: true, ignored: true, reason: 'Rama diferente' });
    }
    siteManager.syncGithub(site.id).catch((error) => {
      siteManager.appendLog(site.id, `[github-webhook] ${error.message}`);
    });
    return res.json({ ok: true, queued: true });
  } catch (error) {
    return next(error);
  }
});

app.get('/api/sites/:id/logs', authRequired, async (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.id);
    res.json({ lines: await siteManager.logs(req.params.id, req.query.lines) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/sites/:id/backup', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    const backup = await siteManager.backup(req.params.id);
    res.download(backup.file, backup.filename);
  } catch (error) {
    next(error);
  }
});

app.post('/api/sites/:id/restore', authRequired, upload.single('backup'), async (req, res, next) => {
  try {
    requireAdmin(req);
    if (!req.file) return res.status(400).json({ error: 'Archivo ZIP requerido' });
    const site = await siteManager.restore(req.params.id, req.file.path);
    return res.json({ site });
  } catch (error) {
    return next(error);
  }
});

app.delete('/api/sites/:id', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    await siteManager.delete(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/seo/:id', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    const site = assertSiteAccess(req, req.params.id);
    const pack = seoPack({
      name: site.name,
      url: publicSiteUrl(site),
      description: req.body.description,
      keywords: req.body.keywords
    });
    if (req.body.apply === true) {
      await siteManager.applySeo(site.id, pack);
    }
    res.json(pack);
  } catch (error) {
    next(error);
  }
});

app.post('/api/seo/:id/ping', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    const site = assertSiteAccess(req, req.params.id);
    const results = await pingIndexes(`${publicSiteUrl(site)}sitemap.xml`);
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

app.get('/api/metrics', authRequired, async (_req, res, next) => {
  try {
    const [load, mem, fsSize, net, cpu] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.cpu()
    ]);
    res.json({
      cpu: { usage: load.currentLoad, cores: cpu.cores, brand: cpu.brand },
      memory: { used: mem.active, total: mem.total },
      storage: fsSize.map((disk) => ({ fs: disk.fs, used: disk.used, size: disk.size, use: disk.use })),
      network: net.map((item) => ({ iface: item.iface, rx_sec: item.rx_sec, tx_sec: item.tx_sec }))
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/marketing/prompt', authRequired, (req, res) => {
  const prompt = String(req.body.prompt || 'Oferta especial');
  const palette = ['#06b6d4', '#f97316', '#a3e635', '#e11d48', '#8b5cf6'];
  const hash = [...prompt].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  res.json({
    headline: prompt.slice(0, 54),
    subhead: 'Imagen generada localmente por plantilla Canvas. Conecta un proveedor IA para generacion fotografica real.',
    colors: [palette[hash % palette.length], palette[(hash + 2) % palette.length], '#030712']
  });
});

app.post('/api/marketing/banner', authRequired, async (req, res, next) => {
  try {
    const prompt = String(req.body.prompt || 'Oferta especial');
    const palette = ['#06b6d4', '#f97316', '#a3e635', '#e11d48', '#8b5cf6'];
    const hash = [...prompt].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const colors = [palette[hash % palette.length], palette[(hash + 2) % palette.length], '#030712'];
    const svg = bannerSvg({
      title: req.body.title || prompt,
      subtitle: req.body.subtitle,
      cta: req.body.cta,
      prompt,
      colors
    });
    const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
    res.json({
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      colors,
      headline: String(req.body.title || prompt).slice(0, 72)
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/marketing/copy', authRequired, (req, res, next) => {
  try {
    const site = assertSiteAccess(req, req.body.siteId);
    res.json(copyPack({
      siteName: site.name,
      url: publicSiteUrl(site),
      product: req.body.product,
      tone: req.body.tone
    }));
  } catch (error) {
    next(error);
  }
});

app.get('/api/marketing/:id/qr', authRequired, async (req, res, next) => {
  try {
    const site = assertSiteAccess(req, req.params.id);
    const dataUrl = await QRCode.toDataURL(publicSiteUrl(site), {
      width: 768,
      margin: 2,
      color: { dark: '#020617', light: '#ffffff' }
    });
    res.json({ dataUrl, url: publicSiteUrl(site) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/popups', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    const updated = await siteManager.applyGlobalPopup(req.body.popup || {}, req.body.siteIds || []);
    res.json({ sites: updated });
  } catch (error) {
    next(error);
  }
});

app.put('/api/sites/:id/settings', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    const site = await siteManager.updateSettings(req.params.id, req.body);
    res.json({ site });
  } catch (error) {
    next(error);
  }
});

app.post('/api/sites/:id/optimize', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    res.json(await siteManager.optimizeAssets(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.get('/api/sites/:id/versions', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    res.json({ versions: await siteManager.versions(req.params.id) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/sites/:id/rollback', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    const site = await siteManager.rollback(req.params.id, req.body.versionId);
    res.json({ site });
  } catch (error) {
    next(error);
  }
});

app.get('/api/analytics/:id', authRequired, (req, res, next) => {
  try {
    assertSiteAccess(req, req.params.id);
    res.json(analyticsService.summary(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.get('/api/database/:id', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    res.json(await databaseService.read(req.params.id));
  } catch (error) {
    next(error);
  }
});

app.put('/api/database/:id', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    res.json(await databaseService.write(req.params.id, req.body));
  } catch (error) {
    next(error);
  }
});

app.post('/api/database/:id/:table', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    res.status(201).json({ row: await databaseService.upsertRow(req.params.id, req.params.table, req.body) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/clients', authRequired, (req, res, next) => {
  try {
    requireAdmin(req);
    res.json({ clients: userManager.listClients() });
  } catch (error) {
    next(error);
  }
});

app.post('/api/clients', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    siteManager.get(req.body.siteId);
    const client = await userManager.createClient(req.body);
    res.status(201).json({ client });
  } catch (error) {
    next(error);
  }
});

app.put('/api/clients/:username', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    if (req.body.siteId) siteManager.get(req.body.siteId);
    const client = await userManager.updateClient(req.params.username, req.body);
    res.json({ client });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/clients/:username', authRequired, async (req, res, next) => {
  try {
    requireAdmin(req);
    await userManager.deleteClient(req.params.username);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  if (!error.status || error.status >= 500) console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Error interno' });
});

const wss = new WebSocketServer({ server, path: '/ws/logs' });
wss.on('connection', (socket, req) => {
  const cookies = Object.fromEntries(String(req.headers.cookie || '')
    .split(';')
    .map((item) => item.trim().split('='))
    .filter(([key, value]) => key && value)
    .map(([key, value]) => [key, decodeURIComponent(value)]));

  try {
    var user = verifySessionToken(cookies.session);
  } catch {
    socket.close(1008, 'No autenticado');
    return;
  }

  const handler = (payload) => {
    if (!userManager.canAccessSite(user, payload.siteId)) return;
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
  };
  logHub.on('line', handler);
  socket.on('close', () => logHub.off('line', handler));
});

Promise.all([siteManager.init(), userManager.init(), analyticsService.init(), databaseService.init()]).then(() => {
  setInterval(() => siteManager.healthCheckAll().catch((error) => {
    console.error('[health-check]', error);
  }), 60_000).unref();
  server.listen(config.port, config.host, () => {
    console.log(`Hosting panel listening at http://${config.host}:${config.port}`);
  });
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
