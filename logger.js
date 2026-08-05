const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const logDir = path.join(app.getPath('userData'), 'logs');
try {
  fs.mkdirSync(logDir, { recursive: true });
} catch (e) { /* ignore */ }

const logFile = path.join(logDir, 'app.log');

function write(level, args) {
  const text = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ');
  const line = `[${new Date().toISOString()}] [${level}] ${text}`;
  console.log(line);
  fs.appendFile(logFile, line + '\n', () => {});
}

module.exports = {
  info: (...a) => write('INFO', a),
  warn: (...a) => write('WARN', a),
  error: (...a) => write('ERROR', a),
};