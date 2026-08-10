const state = {
  token: '',
  sites: [],
  clients: [],
  user: null,
  publicConfig: null,
  editingSite: null,
  liveLogSite: null,
  ws: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const views = {
  dashboard: ['Dashboard', 'Gestiona sitios independientes sin tumbar los demas.'],
  clients: ['Clientes', 'Crea accesos limitados a una sola web.'],
  resilience: ['Salud & Rollback', 'Auto-reinicio, versiones y optimizacion.'],
  studio: ['Marketing Studio', 'Crea banners, miniaturas y anuncios exportables.'],
  growth: ['Promocion Gratis', 'SEO, indexacion y copys para difundir tus webs.'],
  analytics: ['Analitica & Datos', 'Visitas, paginas populares y datos internos.'],
  security: ['Servidor & SSL', 'Preparacion para 24/7, backups y HTTPS.']
};

function api(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const csrfToken = getCookie('csrf_token');
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
      ...(options.headers || {})
    },
    credentials: 'include'
  }).then(async (res) => {
    const type = res.headers.get('content-type') || '';
    const body = type.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error(body.error || body || 'Error de solicitud');
    return body;
  });
}

function getCookie(name) {
  return document.cookie
    .split(';')
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1) || '';
}

function formatUptime(ms) {
  if (!ms) return '0s';
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours}h ${minutes}m ${rest}s`;
}

function formatDate(value) {
  if (!value) return 'Nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function bytes(value) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let amount = Number(value || 0);
  let index = 0;
  while (amount > 1024 && index < units.length - 1) {
    amount /= 1024;
    index += 1;
  }
  return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function showApp() {
  $('#loginScreen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  const isAdmin = state.user?.role === 'super-admin';
  $$('.admin-only').forEach((item) => item.classList.toggle('hidden', !isAdmin));
  $$('.client-only').forEach((item) => item.classList.toggle('hidden', isAdmin));
  $('#newSiteBtn').classList.toggle('hidden', !isAdmin);
  const allowedClientViews = new Set(['dashboard', 'studio', 'analytics']);
  $$('.nav-btn').forEach((button) => {
    const allowed = isAdmin || allowedClientViews.has(button.dataset.view);
    button.classList.toggle('hidden', !allowed);
  });
  if (!isAdmin && !allowedClientViews.has($('.nav-btn.active')?.dataset.view)) {
    switchView('dashboard');
  }
}

function showLogin() {
  $('#app').classList.add('hidden');
  $('#loginScreen').classList.remove('hidden');
}

async function loadSites() {
  const data = await api('/api/sites');
  state.sites = data.sites;
  renderSites();
  renderSiteSelectors();
  updateChromeStatus();
  if (state.user?.role === 'super-admin') loadClients().catch(() => {});
}

function renderSites() {
  const grid = $('#siteGrid');
  const isAdmin = state.user?.role === 'super-admin';
  grid.innerHTML = state.sites.map((site) => `
    <article class="site-card">
      <div class="site-head">
        <div>
          <h3>${escapeHtml(site.name)}</h3>
          <span>${escapeHtml(site.type.toUpperCase())} · puerto ${site.port}</span>
        </div>
        <span class="status ${site.status}">${statusLabel(site.status)}</span>
      </div>
      <div class="site-meta">
        <div class="meta-box"><span>URL proxy</span><strong><a href="${site.url}" target="_blank">${site.url}</a></strong></div>
        <div class="meta-box"><span>Dominio limpio</span><strong>${escapeHtml(site.cleanUrl)}</strong></div>
        <div class="meta-box"><span>Uptime</span><strong>${formatUptime(site.uptimeMs)}</strong></div>
        ${site.github?.enabled ? `<div class="meta-box"><span>GitHub</span><strong>${escapeHtml(site.github.repo)} · ${escapeHtml(site.github.branch)}</strong></div>` : ''}
        ${site.github?.enabled ? `<div class="meta-box"><span>Commit</span><strong>${escapeHtml(site.github.lastCommitShort || 'Pendiente')}</strong></div>` : ''}
        ${!isAdmin ? '<div class="meta-box"><span>Vista cliente</span><strong>Solo métricas y cambios</strong></div>' : ''}
      </div>
      ${site.github?.enabled ? `<div class="github-strip">
        <span>Ultima sync: ${escapeHtml(formatDate(site.github.lastSyncAt))}</span>
        <code>${escapeHtml(site.github.webhookUrl || 'Webhook pendiente')}</code>
      </div>` : ''}
      ${isAdmin ? `
        <div class="button-row">
          <button class="ghost-btn" data-action="edit" data-id="${site.id}">Actualizar codigo</button>
          ${site.github?.enabled ? `<button class="primary-btn" data-action="github-sync" data-id="${site.id}">Sincronizar con GitHub</button>` : ''}
          <button class="ghost-btn" data-action="restart" data-id="${site.id}">Reiniciar</button>
          <button class="${site.status === 'online' ? 'danger-btn' : 'ghost-btn'}" data-action="${site.status === 'online' ? 'stop' : 'start'}" data-id="${site.id}" ${site.status === 'updating' ? 'disabled' : ''}>
            ${site.status === 'online' ? 'Detener' : 'Iniciar'}
          </button>
          <button class="ghost-btn" data-action="logs" data-id="${site.id}">Logs</button>
          <button class="ghost-btn" data-action="backup" data-id="${site.id}">Backup ZIP</button>
          <button class="ghost-btn" data-action="restore" data-id="${site.id}">Restaurar</button>
          <button class="ghost-btn" data-action="versions" data-id="${site.id}">Rollback</button>
          <button class="ghost-btn" data-action="settings" data-id="${site.id}">Dominio/Popup</button>
          <button class="ghost-btn" data-action="github-config" data-id="${site.id}">Configurar GitHub</button>
          <button class="danger-btn" data-action="delete" data-id="${site.id}">Eliminar</button>
        </div>
      ` : `
        <div class="button-row">
          <button class="ghost-btn" data-action="open" data-id="${site.id}">Ver web</button>
          <button class="ghost-btn" data-action="logs" data-id="${site.id}">Actualizaciones</button>
          <button class="primary-btn" data-action="analytics" data-id="${site.id}">Mis metricas</button>
          <button class="ghost-btn" data-action="qr" data-id="${site.id}">Mi QR</button>
        </div>
      `}
    </article>
  `).join('');
}

function statusLabel(status) {
  return {
    online: 'En linea',
    stopped: 'Detenido',
    updating: 'Actualizando'
  }[status] || status;
}

function renderSiteSelectors() {
  const options = state.sites.map((site) => `<option value="${site.id}">${escapeHtml(site.name)}</option>`).join('');
  ['seoSite', 'clientSite', 'versionSite', 'marketingSite', 'analyticsSite', 'databaseSite'].forEach((id) => {
    const element = $(`#${id}`);
    if (element) element.innerHTML = options;
  });
  const popup = $('#popupSite');
  if (popup) popup.innerHTML = `<option value="">Todas las webs</option>${options}`;
}

async function siteAction(action, id) {
  if (action === 'open') {
    const site = state.sites.find((item) => item.id === id);
    window.open(site?.cleanUrl || site?.url || `/sites/${id}/`, '_blank');
    return;
  }
  if (action === 'analytics') {
    $('#analyticsSite').value = id;
    switchView('analytics');
    await loadAnalytics();
    return;
  }
  if (action === 'qr') {
    $('#marketingSite').value = id;
    switchView('studio');
    await generateQr(false);
    return;
  }
  if (action === 'edit') return openEditor(id);
  if (action === 'logs') return openLogs(id);
  if (action === 'backup') return downloadBackup(id);
  if (action === 'restore') return restoreBackup(id);
  if (action === 'delete') return deleteSite(id);
  if (action === 'versions') return openVersions(id);
  if (action === 'settings') return updateSiteSettings(id);
  if (action === 'github-sync') return syncGithub(id);
  if (action === 'github-config') return openEditor(id, true);
  await api(`/api/sites/${id}/${action}`, { method: 'POST' });
  await loadSites();
}

async function updateSiteSettings(id) {
  const site = state.sites.find((item) => item.id === id);
  const domain = prompt('Dominio personalizado sin https://', site?.domain || '');
  if (domain === null) return;
  await api(`/api/sites/${id}/settings`, {
    method: 'PUT',
    body: JSON.stringify({ domain })
  });
  await loadSites();
}

async function openEditor(id = null, forceGithub = false) {
  state.editingSite = id;
  $('#modalTitle').textContent = id ? 'Actualizar sitio' : 'Nuevo sitio';
  $('#siteName').disabled = Boolean(id);
  if (id) {
    const data = await api(`/api/sites/${id}/code`);
    $('#siteName').value = data.project.name;
    $('#siteType').value = data.project.type;
    $('#siteCode').value = data.code;
    $('#deployMethod').value = forceGithub || data.project.deploymentMethod === 'github' ? 'github' : 'manual';
    $('#githubRepo').value = data.project.github?.repoUrl || data.project.github?.repo || '';
    $('#githubBranch').value = data.project.github?.branch || '';
    $('#githubToken').value = '';
    $('#githubSaveToken').checked = Boolean(data.project.github?.hasToken);
    $('#githubSavedHint').textContent = data.project.github?.hasToken
      ? 'Este proyecto ya tiene un token cifrado guardado. Pega uno nuevo solo si quieres reemplazarlo.'
      : 'Si el repositorio es privado, pega un token y marca guardar credenciales.';
  } else {
    $('#siteName').value = '';
    $('#siteType').value = 'static';
    $('#deployMethod').value = 'manual';
    $('#githubRepo').value = '';
    $('#githubBranch').value = '';
    $('#githubToken').value = '';
    $('#githubSaveToken').checked = false;
    $('#githubSavedHint').textContent = '';
    $('#siteCode').value = defaultTemplate('static');
  }
  toggleGithubFields();
  $('#siteModal').showModal();
}

async function saveEditor(event) {
  event.preventDefault();
  const payload = {
    name: $('#siteName').value.trim(),
    type: $('#siteType').value,
    code: $('#siteCode').value,
    deploymentMethod: $('#deployMethod').value,
    github: githubPayload()
  };
  if (state.editingSite) {
    if (payload.deploymentMethod === 'github') {
      await api(`/api/sites/${state.editingSite}/github`, {
        method: 'PUT',
        body: JSON.stringify(payload.github)
      });
    } else {
      await api(`/api/sites/${state.editingSite}/code`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
    }
  } else {
    await api('/api/sites', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }
  $('#siteModal').close();
  await loadSites();
}

function githubPayload() {
  return {
    repoUrl: $('#githubRepo').value.trim(),
    branch: $('#githubBranch').value.trim(),
    token: $('#githubToken').value,
    saveCredentials: $('#githubSaveToken').checked
  };
}

function toggleGithubFields() {
  const isGithub = $('#deployMethod').value === 'github';
  $('#githubFields').classList.toggle('hidden', !isGithub);
  $('#siteCode').closest('label').classList.toggle('hidden', isGithub);
  $('#siteType').closest('label').classList.toggle('hidden', isGithub);
}

async function syncGithub(id) {
  const site = state.sites.find((item) => item.id === id);
  let token = '';
  if (!site?.github?.hasToken) {
    token = prompt('Este proyecto no tiene token guardado. Pega un GitHub PAT si el repositorio es privado, o deja vacio si es publico.') || '';
  }
  await api(`/api/sites/${id}/github/sync`, {
    method: 'POST',
    body: JSON.stringify({ token })
  });
  await loadSites();
  await openLogs(id);
}

function defaultTemplate(type) {
  if (type === 'node') {
    return `const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (_req, res) => {
  res.send('<h1>Nuevo sitio Node</h1><p>Desplegado desde Hosting Control.</p>');
});

app.listen(port, () => console.log('Site listening on ' + port));`;
  }
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nuevo sitio</title>
</head>
<body>
  <h1>Nuevo sitio</h1>
  <p>Desplegado desde Hosting Control.</p>
</body>
</html>`;
}

async function openLogs(id) {
  state.liveLogSite = id;
  const site = state.sites.find((item) => item.id === id);
  $('#logsTitle').textContent = `Logs en vivo · ${site.name}`;
  const data = await api(`/api/sites/${id}/logs?lines=250`);
  $('#logsOutput').textContent = data.lines.join('\n');
  $('#logsModal').showModal();
}

function connectLogs() {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${scheme}://${location.host}/ws/logs`);
  state.ws.onmessage = (event) => {
    const payload = JSON.parse(event.data);
    if (payload.siteId !== state.liveLogSite) return;
    const output = $('#logsOutput');
    output.textContent += `\n${payload.line}`;
    output.scrollTop = output.scrollHeight;
  };
  state.ws.onclose = () => setTimeout(connectLogs, 2000);
}

function downloadBackup(id) {
  const link = document.createElement('a');
  link.href = `/api/sites/${id}/backup`;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function restoreBackup(id) {
  const input = $('#restoreInput');
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const body = new FormData();
    body.append('backup', file);
    const response = await fetch(`/api/sites/${id}/restore`, {
      method: 'POST',
      body,
      credentials: 'include',
      headers: {
        ...(getCookie('csrf_token') ? { 'X-CSRF-Token': getCookie('csrf_token') } : {})
      }
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || 'No se pudo restaurar el backup');
    }
    input.value = '';
    await loadSites();
  };
  input.click();
}

async function deleteSite(id) {
  const site = state.sites.find((item) => item.id === id);
  if (!confirm(`Eliminar ${site?.name || id}? Esta accion borra codigo y logs del sitio.`)) return;
  await api(`/api/sites/${id}`, { method: 'DELETE' });
  await loadSites();
}

async function loadClients() {
  const data = await api('/api/clients');
  state.clients = data.clients;
  $('#clientList').innerHTML = data.clients.map((client) => {
    const site = state.sites.find((item) => item.id === client.siteId);
    return `<article class="mini-card">
      <div><strong>${escapeHtml(client.username)}</strong><span>${escapeHtml(site?.name || client.siteId)} · ${client.active ? 'Activo' : 'Revocado'}</span></div>
      <div class="button-row">
        <button class="ghost-btn" data-client-toggle="${client.username}" data-active="${client.active ? 'false' : 'true'}">${client.active ? 'Revocar' : 'Activar'}</button>
        <button class="danger-btn" data-client-delete="${client.username}">Eliminar</button>
      </div>
    </article>`;
  }).join('') || '<p>No hay clientes secundarios creados.</p>';
}

async function createClient(event) {
  event.preventDefault();
  await api('/api/clients', {
    method: 'POST',
    body: JSON.stringify({
      username: $('#clientUsername').value.trim(),
      password: $('#clientPassword').value,
      siteId: $('#clientSite').value
    })
  });
  event.currentTarget.reset();
  await loadClients();
}

async function clientAction(event) {
  const toggle = event.target.closest('[data-client-toggle]');
  const remove = event.target.closest('[data-client-delete]');
  if (toggle) {
    await api(`/api/clients/${toggle.dataset.clientToggle}`, {
      method: 'PUT',
      body: JSON.stringify({ active: toggle.dataset.active === 'true' })
    });
    await loadClients();
  }
  if (remove && confirm(`Eliminar acceso de ${remove.dataset.clientDelete}?`)) {
    await api(`/api/clients/${remove.dataset.clientDelete}`, { method: 'DELETE' });
    await loadClients();
  }
}

async function openVersions(id = $('#versionSite').value) {
  $('#versionSite').value = id;
  const data = await api(`/api/sites/${id}/versions`);
  $('#versionsList').innerHTML = data.versions.map((version) => `
    <article class="mini-card">
      <div><strong>Version ${escapeHtml(version.id)}</strong><span>${new Date(version.createdAt).toLocaleString()} · ${escapeHtml(version.type)}</span></div>
      <button class="primary-btn" data-rollback="${version.id}">Restaurar</button>
    </article>
  `).join('') || '<p>Aun no hay versiones. Se guardaran automaticamente al actualizar codigo.</p>';
  switchView('resilience');
}

async function rollbackVersion(versionId) {
  const id = $('#versionSite').value;
  await api(`/api/sites/${id}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ versionId })
  });
  await loadSites();
  await openVersions(id);
}

async function optimizeAssets() {
  const id = $('#versionSite').value;
  const data = await api(`/api/sites/${id}/optimize`, { method: 'POST' });
  $('#versionsList').innerHTML = `<pre class="code-output compact">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
}

async function loadMetrics() {
  try {
    const data = await api('/api/metrics');
    const ram = data.memory.total ? (data.memory.used / data.memory.total) * 100 : 0;
    const disk = data.storage[0]?.use || 0;
    const net = data.network.reduce((sum, item) => sum + Math.max(0, item.rx_sec || 0) + Math.max(0, item.tx_sec || 0), 0);
    $('#cpuMetric').textContent = `${data.cpu.usage.toFixed(0)}%`;
    $('#cpuBar').value = data.cpu.usage;
    $('#ramMetric').textContent = `${ram.toFixed(0)}%`;
    $('#ramBar').value = ram;
    $('#diskMetric').textContent = `${disk.toFixed(0)}%`;
    $('#diskBar').value = disk;
    $('#netMetric').textContent = `${bytes(net)}/s`;
  } catch {
    // Metrics are non-critical for panel operation.
  }
}

async function generateSeo() {
  const id = $('#seoSite').value;
  const keywords = $('#seoKeywords').value.split(',').map((item) => item.trim()).filter(Boolean);
  const data = await api(`/api/seo/${id}`, {
    method: 'POST',
    body: JSON.stringify({ description: $('#seoDescription').value, keywords, apply: true })
  });
  $('#seoOutput').textContent = JSON.stringify(data, null, 2);
}

async function pingSeo() {
  const id = $('#seoSite').value;
  const data = await api(`/api/seo/${id}/ping`, { method: 'POST' });
  $('#seoOutput').textContent = JSON.stringify(data, null, 2);
}

async function generateBanner() {
  const prompt = $('#imagePrompt').value;
  const payload = {
    prompt,
    title: $('#bannerTitle').value,
    subtitle: $('#bannerSub').value,
    cta: $('#bannerCta').value
  };
  const generated = await api('/api/marketing/banner', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  await drawBannerFromDataUrl(generated.dataUrl);
  $('#copyOutput').textContent = `Cartel generado correctamente.\nTitulo: ${generated.headline}`;
}

async function generateCopy() {
  const data = await api('/api/marketing/copy', {
    method: 'POST',
    body: JSON.stringify({
      siteId: $('#marketingSite').value,
      product: $('#copyProduct').value,
      tone: 'persuasivo'
    })
  });
  $('#copyOutput').textContent = JSON.stringify(data, null, 2);
}

async function generateQr(autoDownload = true) {
  if (!$('#marketingSite').value) {
    throw new Error('Primero crea o selecciona un sitio para generar su QR.');
  }
  const data = await api(`/api/marketing/${$('#marketingSite').value}/qr`);
  $('#qrPreview').src = data.dataUrl;
  $('#qrPreview').classList.remove('hidden');
  if (autoDownload) {
    const link = document.createElement('a');
    link.href = data.dataUrl;
    link.download = `qr-${$('#marketingSite').value}.png`;
    link.click();
  }
  $('#copyOutput').textContent = `${autoDownload ? 'QR generado y descargado' : 'QR generado'} para:\n${data.url}`;
}

async function applyPopup() {
  const siteId = $('#popupSite').value;
  const data = await api('/api/popups', {
    method: 'POST',
    body: JSON.stringify({
      siteIds: siteId ? [siteId] : [],
      popup: {
        enabled: $('#popupEnabled').checked,
        message: $('#popupMessage').value,
        cta: $('#popupCta').value,
        url: $('#popupUrl').value
      }
    })
  });
  $('#seoOutput').textContent = JSON.stringify(data, null, 2);
  await loadSites();
}

async function loadAnalytics() {
  const data = await api(`/api/analytics/${$('#analyticsSite').value}`);
  $('#analyticsOutput').textContent = JSON.stringify(data, null, 2);
}

async function loadDatabase() {
  const data = await api(`/api/database/${$('#databaseSite').value}`);
  $('#databaseJson').value = JSON.stringify(data, null, 2);
}

async function saveDatabase() {
  const data = JSON.parse($('#databaseJson').value || '{}');
  const saved = await api(`/api/database/${$('#databaseSite').value}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  $('#databaseJson').value = JSON.stringify(saved, null, 2);
}

function switchView(name) {
  $$('.nav-btn').forEach((item) => item.classList.toggle('active', item.dataset.view === name));
  $$('.view').forEach((view) => view.classList.remove('active'));
  $(`#${name}View`).classList.add('active');
  $('#viewTitle').textContent = views[name][0];
  $('#viewSubtitle').textContent = views[name][1];
}

async function loadPublicConfig() {
  state.publicConfig = await api('/api/public-config');
  updateChromeStatus();
}

function updateChromeStatus() {
  const officialUrl = state.publicConfig?.baseUrl || location.origin;
  $('#officialUrlText').textContent = officialUrl;
  $('#deployModeText').textContent = state.publicConfig?.production
    ? 'Produccion HTTPS'
    : 'Desarrollo / listo para dominio';
  $('#lastRefreshText').textContent = new Date().toLocaleTimeString();
  if (state.user) {
    $('#sessionBadge').textContent = `${state.user.role === 'super-admin' ? 'Maestro' : 'Cliente'} · ${state.user.username}`;
  }
  const hsts = $('#hstsPill');
  if (hsts && state.publicConfig?.security?.hstsReady) {
    hsts.classList.add('ok');
    hsts.textContent = 'HSTS activo';
  }
}

async function copyOfficialUrl() {
  const officialUrl = $('#officialUrlText').textContent;
  await navigator.clipboard.writeText(officialUrl);
  $('#copyOfficialUrlBtn').textContent = 'URL copiada';
  setTimeout(() => { $('#copyOfficialUrlBtn').textContent = 'Copiar URL oficial'; }, 1400);
}

function generateDomainChecklist() {
  const domain = ($('#domainExampleInput').value || 'panel.tudominio.com').trim();
  $('#domainChecklistOutput').textContent = [
    `1. Crear registro DNS A/AAAA para ${domain} apuntando a la IP del servidor.`,
    `2. En .env definir BASE_URL=https://${domain}`,
    '3. En .env definir JWT_SECRET con un valor largo y unico.',
    `4. En Caddy/Nginx hacer reverse proxy de ${domain} hacia el puerto interno del panel.`,
    '5. Ejecutar npm run pm2:start o docker compose up -d --build.',
    '6. Abrir Chrome en la URL HTTPS y verificar el candado SSL.'
  ].join('\n');
}

function drawBanner(colors = ['#22d3ee', '#a3e635', '#030712'], promptText = '') {
  const canvas = $('#bannerCanvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Tu navegador no permitio iniciar el editor Canvas.');
  const title = $('#bannerTitle').value || promptText;
  const sub = $('#bannerSub').value;
  const cta = $('#bannerCta').value;
  const gradient = ctx.createLinearGradient(0, 0, 1080, 1080);
  gradient.addColorStop(0, colors[2]);
  gradient.addColorStop(.52, colors[0]);
  gradient.addColorStop(1, colors[1]);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1080, 1080);

  ctx.globalAlpha = .23;
  for (let i = 0; i < 18; i += 1) {
    ctx.strokeStyle = i % 2 ? '#ffffff' : '#020617';
    ctx.lineWidth = 2;
    ctx.strokeRect(80 + i * 18, 80 + i * 16, 920 - i * 28, 920 - i * 28);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = 'rgba(3, 7, 18, .78)';
  ctx.fillRect(86, 650, 908, 270);

  ctx.fillStyle = '#f8fafc';
  ctx.font = '800 92px Inter, sans-serif';
  wrapText(ctx, title.toUpperCase(), 120, 735, 850, 96);
  ctx.fillStyle = '#c4f1ff';
  ctx.font = '600 42px Inter, sans-serif';
  wrapText(ctx, sub, 120, 830, 760, 50);

  ctx.fillStyle = '#a3e635';
  ctx.fillRect(120, 890, 330, 76);
  ctx.fillStyle = '#07111c';
  ctx.font = '800 31px Inter, sans-serif';
  ctx.fillText(cta.toUpperCase(), 150, 940);
}

function drawBannerFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = $('#bannerCanvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Tu navegador no permitio iniciar el editor Canvas.'));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve();
    };
    image.onerror = () => reject(new Error('No se pudo cargar el cartel generado.'));
    image.src = dataUrl;
  });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text).split(' ');
  let line = '';
  for (const word of words) {
    const test = `${line}${word} `;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = `${word} `;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  ctx.fillText(line, x, y);
}

function downloadCanvas(type) {
  const canvas = $('#bannerCanvas');
  const link = document.createElement('a');
  link.href = canvas.toDataURL(type === 'jpg' ? 'image/jpeg' : 'image/png', .92);
  link.download = `banner-${Date.now()}.${type === 'jpg' ? 'jpg' : 'png'}`;
  link.click();
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

$('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  $('#loginError').textContent = '';
  try {
    const form = new FormData(event.currentTarget);
    const data = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(Object.fromEntries(form))
    });
    state.user = data.user;
    localStorage.removeItem('hostingToken');
    showApp();
    await loadSites();
  } catch (error) {
    $('#loginError').textContent = error.message;
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('hostingToken');
  state.token = '';
  showLogin();
});

$('#newSiteBtn').addEventListener('click', () => openEditor());
$('#copyOfficialUrlBtn').addEventListener('click', () => copyOfficialUrl().catch(alert));
$('#saveSiteBtn').addEventListener('click', saveEditor);
$('#clientForm').addEventListener('submit', (event) => createClient(event).catch(alert));
$('#clientList').addEventListener('click', (event) => clientAction(event).catch(alert));
$('#loadVersionsBtn').addEventListener('click', () => openVersions().catch(alert));
$('#versionsList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-rollback]');
  if (button) rollbackVersion(button.dataset.rollback).catch(alert);
});
$('#optimizeAssetsBtn').addEventListener('click', () => optimizeAssets().catch(alert));
$('#siteGrid').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  siteAction(button.dataset.action, button.dataset.id).catch(alert);
});
$('#siteType').addEventListener('change', () => {
  if (!state.editingSite) $('#siteCode').value = defaultTemplate($('#siteType').value);
});
$('#deployMethod').addEventListener('change', toggleGithubFields);
$('#closeLogsBtn').addEventListener('click', () => {
  state.liveLogSite = null;
  $('#logsModal').close();
});
$('#generateBannerBtn').addEventListener('click', () => generateBanner().catch(alert));
$('#copyGenerateBtn').addEventListener('click', () => generateCopy().catch(alert));
$('#qrGenerateBtn').addEventListener('click', () => generateQr().catch(alert));
$('#downloadPngBtn').addEventListener('click', () => downloadCanvas('png'));
$('#downloadJpgBtn').addEventListener('click', () => downloadCanvas('jpg'));
$('#seoGenerateBtn').addEventListener('click', () => generateSeo().catch(alert));
$('#seoPingBtn').addEventListener('click', () => pingSeo().catch(alert));
$('#applyPopupBtn').addEventListener('click', () => applyPopup().catch(alert));
$('#loadAnalyticsBtn').addEventListener('click', () => loadAnalytics().catch(alert));
$('#loadDatabaseBtn').addEventListener('click', () => loadDatabase().catch(alert));
$('#saveDatabaseBtn').addEventListener('click', () => saveDatabase().catch(alert));
$('#domainChecklistBtn').addEventListener('click', generateDomainChecklist);

$$('.nav-btn').forEach((button) => {
  button.addEventListener('click', () => {
    switchView(button.dataset.view);
  });
});

drawBanner();
connectLogs();
loadPublicConfig().catch(() => updateChromeStatus());
setInterval(() => loadSites().catch(() => {}), 5000);
setInterval(loadMetrics, 2500);

api('/api/session')
  .then(async (data) => {
    state.user = data.user;
    showApp();
    await loadSites();
    await loadMetrics();
  })
  .catch(showLogin);
