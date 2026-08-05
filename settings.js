const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const defaults = {
  closeToTray: true,
  startMinimized: false,
  showNotifications: true,
  startOnLogin: false,
  customCss: true,
};

let settings = { ...defaults };

function filePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function load() {
  try {
    settings = { ...defaults, ...JSON.parse(fs.readFileSync(filePath(), 'utf8')) };
  } catch (e) {
    settings = { ...defaults };
  }
  return settings;
}

function save() {
  try {
    fs.writeFileSync(filePath(), JSON.stringify(settings, null, 2));
  } catch (e) { /* ignore */ }
}

module.exports = {
  load,
  get: (key) => settings[key],
  set(key, value) {
    settings[key] = value;
    save();
  },
};