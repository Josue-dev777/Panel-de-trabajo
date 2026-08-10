const path = require('path');
require('dotenv').config();

const root = path.resolve(__dirname, '..');

module.exports = {
  root,
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET || 'dev_only_replace_me',
  sessionTtl: process.env.SESSION_TTL || '12h',
  adminUser: process.env.ADMIN_USER || 'josue_dev',
  adminPassword: process.env.ADMIN_PASSWORD || 'kaled_deverloper777',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '$2a$12$LeUcq5pHRwaABPd18SdrfO8Zzf1gvj8PihbR751chG8fxosycUvjC',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  sitePortStart: Number(process.env.SITE_PORT_START || 4100),
  sitePortEnd: Number(process.env.SITE_PORT_END || 4999),
  paths: {
    data: path.join(root, 'data'),
    sites: path.join(root, 'sites'),
    logs: path.join(root, 'logs'),
    versions: path.join(root, 'data', 'versions'),
    backups: path.join(root, 'backups'),
    public: path.join(root, 'public')
  }
};
