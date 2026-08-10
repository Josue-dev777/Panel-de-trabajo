const { EventEmitter } = require('events');

class LogHub extends EventEmitter {
  emitLine(siteId, line) {
    this.emit('line', { siteId, line, at: new Date().toISOString() });
  }
}

module.exports = new LogHub();
