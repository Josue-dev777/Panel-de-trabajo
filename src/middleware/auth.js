const jwt = require('jsonwebtoken');
const config = require('../config');
const userManager = require('../services/userManager');

function signSession(user) {
  const payload = typeof user === 'string'
    ? { sub: user, role: 'super-admin', siteId: null }
    : { sub: user.username, role: user.role, siteId: user.siteId || null };
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.sessionTtl
  });
}

function verifySessionToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = req.cookies.session || header.replace(/^Bearer\s+/i, '');

  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  try {
    const session = verifySessionToken(token);
    const liveUser = userManager.publicByUsername(session.sub);
    if (!liveUser) return res.status(401).json({ error: 'Sesion revocada o usuario inactivo' });
    req.user = { ...session, ...liveUser };
    return next();
  } catch {
    return res.status(401).json({ error: 'Sesion invalida o expirada' });
  }
}

module.exports = { signSession, verifySessionToken, authRequired };
