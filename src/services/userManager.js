const bcrypt = require('bcryptjs');
const config = require('../config');
const { readJson, writeJson, ensureDir } = require('../utils/fs-store');
const path = require('path');

class UserManager {
  constructor() {
    this.file = path.join(config.paths.data, 'users.json');
    this.users = [];
  }

  async init() {
    await ensureDir(config.paths.data);
    this.users = await readJson(this.file, []);
    if (!this.users.some((user) => user.username === config.adminUser)) {
      this.users.unshift({
        id: config.adminUser,
        username: config.adminUser,
        role: 'super-admin',
        passwordHash: config.adminPasswordHash,
        siteId: null,
        active: true,
        createdAt: new Date().toISOString()
      });
      await this.save();
    }
  }

  async save() {
    await writeJson(this.file, this.users);
  }

  publicUser(user) {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      siteId: user.siteId || null,
      active: user.active !== false,
      createdAt: user.createdAt
    };
  }

  listClients() {
    return this.users.filter((user) => user.role === 'client').map((user) => this.publicUser(user));
  }

  publicByUsername(username) {
    const user = this.users.find((item) => item.username === username && item.active !== false);
    return user ? this.publicUser(user) : null;
  }

  async validate(username, password) {
    const user = this.users.find((item) => item.username === username && item.active !== false);
    if (!user) return null;
    const valid = await bcrypt.compare(password || '', user.passwordHash)
      || (username === config.adminUser && process.env.ADMIN_PASSWORD && password === config.adminPassword);
    return valid ? this.publicUser(user) : null;
  }

  canAccessSite(user, siteId) {
    if (!user) return false;
    const liveUser = this.publicByUsername(user.sub || user.username);
    if (!liveUser) return false;
    user = { ...user, ...liveUser };
    if (user.role === 'super-admin') return true;
    return user.role === 'client' && user.siteId === siteId;
  }

  requireAdmin(user) {
    if (user?.role !== 'super-admin') {
      const error = new Error('Solo el super-admin puede realizar esta accion');
      error.status = 403;
      throw error;
    }
  }

  async createClient({ username, password, siteId }) {
    username = String(username || '').trim();
    password = String(password || '');
    siteId = String(siteId || '').trim();
    if (!username || !password || !siteId) {
      const error = new Error('Usuario, contrasena y sitio son requeridos');
      error.status = 400;
      throw error;
    }
    if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
      const error = new Error('El usuario solo puede usar letras, numeros, punto, guion y guion bajo');
      error.status = 400;
      throw error;
    }
    if (password.length < 10) {
      const error = new Error('La contrasena del cliente debe tener minimo 10 caracteres');
      error.status = 400;
      throw error;
    }
    if (this.users.some((user) => user.username === username)) {
      const error = new Error('Ese usuario ya existe');
      error.status = 409;
      throw error;
    }
    const now = new Date().toISOString();
    const user = {
      id: username,
      username,
      role: 'client',
      siteId,
      active: true,
      passwordHash: await bcrypt.hash(password, 12),
      createdAt: now
    };
    this.users.push(user);
    await this.save();
    return this.publicUser(user);
  }

  async updateClient(username, patch) {
    const user = this.users.find((item) => item.username === username && item.role === 'client');
    if (!user) {
      const error = new Error('Cliente no encontrado');
      error.status = 404;
      throw error;
    }
    if (patch.siteId !== undefined) user.siteId = patch.siteId;
    if (patch.active !== undefined) user.active = Boolean(patch.active);
    if (patch.password) {
      if (String(patch.password).length < 10) {
        const error = new Error('La contrasena del cliente debe tener minimo 10 caracteres');
        error.status = 400;
        throw error;
      }
      user.passwordHash = await bcrypt.hash(String(patch.password), 12);
    }
    await this.save();
    return this.publicUser(user);
  }

  async deleteClient(username) {
    const before = this.users.length;
    this.users = this.users.filter((user) => !(user.username === username && user.role === 'client'));
    if (this.users.length === before) {
      const error = new Error('Cliente no encontrado');
      error.status = 404;
      throw error;
    }
    await this.save();
  }
}

module.exports = new UserManager();
