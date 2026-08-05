const {
  app, BrowserWindow, shell, session, Menu, Tray, Notification,
  globalShortcut, ipcMain,
} = require('electron');
const fs = require('fs');
const path = require('path');
const { createPlayIcon, createPauseIcon } = require('./icon');
const settings = require('./settings');
const logger = require('./logger');
const { autoUpdater } = require('electron-updater');

let updateReady = false;

const TARGET_URL = 'https://music.youtube.com/';

/* ---------- Identitas & stealth (Fase 1-2) ---------- */
if (process.platform === 'win32') {
  app.setAppUserModelId('com.zenelectron.ytmusicdesktop');
}

const chromeVersion = process.versions.chrome || '126.0.0.0';
const chromeMajor = chromeVersion.split('.')[0];

const PLATFORM_INFO = (() => {
  switch (process.platform) {
    case 'win32':
      return { ua: 'Windows NT 10.0; Win64; x64', ch: 'Windows', chv: '15.0.0' };
    case 'darwin':
      return { ua: 'Macintosh; Intel Mac OS X 10_15_7', ch: 'macOS', chv: '14.6.1' };
    default:
      return { ua: 'X11; Linux x86_64', ch: 'Linux', chv: '6.5.0' };
  }
})();

const CHROME_UA =
  `Mozilla/5.0 (${PLATFORM_INFO.ua}) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`;
const SEC_CH_UA =
  `"Google Chrome";v="${chromeMajor}", "Chromium";v="${chromeMajor}", "Not_A Brand";v="24"`;
const SEC_CH_UA_FULL =
  `"Google Chrome";v="${chromeVersion}", "Chromium";v="${chromeVersion}", "Not_A Brand";v="24.0.0.0"`;

app.commandLine.appendSwitch('disable-features', 'CrossOriginOpenerPolicy');
app.commandLine.appendSwitch('disable-site-isolation-trials');

const allowedNavigationPrefixes = [
  'https://music.youtube.com',
  'https://www.youtube.com',
  'https://youtube.com',
  'https://accounts.google.com',
  'https://consent.google.com',
];

function isAllowedNavigation(url) {
  return allowedNavigationPrefixes.some((prefix) => url.startsWith(prefix));
}

/* ---------- Window state (Fase 2) ---------- */
const windowStateFile = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    const data = JSON.parse(fs.readFileSync(windowStateFile, 'utf8'));
    return {
      width: data.width || 1280,
      height: data.height || 800,
      x: data.x,
      y: data.y,
      isMaximized: data.isMaximized || false,
    };
  } catch (e) {
    return { width: 1280, height: 800, isMaximized: false };
  }
}

function saveWindowState(win) {
  const state = { isMaximized: win.isMaximized() };
  if (!state.isMaximized) Object.assign(state, win.getBounds());
  try {
    fs.writeFileSync(windowStateFile, JSON.stringify(state));
  } catch (e) { /* ignore */ }
}

/* ---------- Custom CSS (polish UI) ---------- */
const CUSTOM_CSS = `
  ::-webkit-scrollbar { width: 8px; }
  ::-webkit-scrollbar-thumb { background: #3f3f3f; border-radius: 4px; }
  ::-webkit-scrollbar-thumb:hover { background: #555; }
  ::-webkit-scrollbar-track { background: transparent; }
  html, body { background: #030303 !important; }
`;

let cssKey = null;

async function applyCustomCss() {
  if (!mainWindow) return;
  try {
    if (settings.get('customCss')) {
      if (!cssKey) cssKey = await mainWindow.webContents.insertCSS(CUSTOM_CSS);
    } else if (cssKey) {
      await mainWindow.webContents.removeInsertedCSS(cssKey);
      cssKey = null;
    }
  } catch (e) {
    logger.warn('Gagal apply custom CSS:', e.message);
  }
}

/* ---------- State global ---------- */
let mainWindow = null;
let tray = null;
let icons = null;
let currentTrack = null;
let isQuitting = false;
let startHidden = false;
let loadFailed = false;
let retryCount = 0;

/* ---------- Helper kontrol player ---------- */
function sendCommand(command) {
  if (mainWindow) mainWindow.webContents.send('player:command', command);
}

function adjustVolume(delta) {
  if (!mainWindow) return;
  mainWindow.webContents.executeJavaScript(`
    (() => {
      const v = document.querySelector('video');
      if (v) v.volume = Math.min(1, Math.max(0, v.volume + (${delta})));
      return v ? v.volume : null;
    })()
  `).catch(() => {});
}

function toggleMute() {
  if (!mainWindow) return;
  mainWindow.webContents.setAudioMuted(!mainWindow.webContents.isAudioMuted());
  buildTrayMenu();
}

function toggleWindow() {
  if (!mainWindow) return;
  if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
    mainWindow.hide();
  } else {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

function quitApp() {
  isQuitting = true;
  app.quit();
}

/* ---------- Tray ---------- */
function buildTrayMenu() {
  if (!tray) return;
  const trackLabel = currentTrack
    ? `${currentTrack.title} — ${currentTrack.artist}`
    : `YouTube Music Desktop v${app.getVersion()}`;

  const template = [
    { label: trackLabel.substring(0, 60), enabled: false },
    { type: 'separator' },
    {
      label: mainWindow && mainWindow.isVisible() ? 'Sembunyikan' : 'Tampilkan',
      click: () => toggleWindow(),
    },
    { label: 'Play / Pause', click: () => sendCommand('play-pause') },
    { label: 'Next', click: () => sendCommand('next') },
    { label: 'Previous', click: () => sendCommand('prev') },
    { type: 'separator' },
    {
      label: mainWindow && mainWindow.webContents.isAudioMuted() ? 'Unmute' : 'Mute',
      click: () => toggleMute(),
    },
    { label: 'Volume +', click: () => adjustVolume(+0.1) },
    { label: 'Volume -', click: () => adjustVolume(-0.1) },
    { type: 'separator' },
    {
      label: 'Pengaturan',
      submenu: [
        {
          label: 'Close to Tray',
          type: 'checkbox',
          checked: settings.get('closeToTray'),
          click: (item) => settings.set('closeToTray', item.checked),
        },
        {
          label: 'Start Minimized',
          type: 'checkbox',
          checked: settings.get('startMinimized'),
          click: (item) => settings.set('startMinimized', item.checked),
        },
        {
          label: 'Notifikasi Track',
          type: 'checkbox',
          checked: settings.get('showNotifications'),
          click: (item) => settings.set('showNotifications', item.checked),
        },
        {
          label: 'Start on Login',
          type: 'checkbox',
          checked: settings.get('startOnLogin'),
          click: (item) => {
            settings.set('startOnLogin', item.checked);
            app.setLoginItemSettings({ openAtLogin: item.checked });
          },
        },
        {
          label: 'Custom CSS',
          type: 'checkbox',
          checked: settings.get('customCss'),
          click: (item) => {
            settings.set('customCss', item.checked);
            applyCustomCss();
          },
        },
            {
      label: 'Buka Folder Log',
      click: () => shell.openPath(path.join(app.getPath('userData'), 'logs')),
    },
      ],
    },
    { label: 'Reload', click: () => mainWindow && mainWindow.reload() },
        {
      label: updateReady ? 'Restart & Pasang Update' : 'Periksa Update…',
      click: () => {
        if (updateReady) autoUpdater.quitAndInstall();
        else checkForUpdatesManual();
      },
    },
    { type: 'separator' },
    { label: 'Quit YouTube Music', click: () => quitApp() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  icons = icons || { play: createPlayIcon(), pause: createPauseIcon() };
  tray = new Tray(icons.play);
  tray.setToolTip('YouTube Music Desktop');
  tray.on('click', () => toggleWindow());
  buildTrayMenu();
}

function showTrackNotification(meta) {
  if (!settings.get('showNotifications')) return;
  if (!Notification.isSupported()) return;
  if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized() && mainWindow.isFocused()) return;

  const notification = new Notification({
    title: meta.title || 'YouTube Music',
    body: meta.artist || '',
    silent: true,
  });
  notification.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  notification.show();
}

/* ---------- Window ---------- */
function createMainWindow() {
  const windowState = loadWindowState();

  mainWindow = new BrowserWindow({
    x: windowState.x,
    y: windowState.y,
    width: windowState.width,
    height: windowState.height,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#030303',
    title: 'YouTube Music Desktop',
    icon: icons ? icons.play : undefined,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });

  if (windowState.isMaximized) mainWindow.maximize();
  if (icons) mainWindow.setIcon(icons.play);

  const reapplyIcon = () => {
    if (mainWindow && icons) mainWindow.setIcon(icons.play);
  };
  mainWindow.on('show', reapplyIcon);
  mainWindow.on('restore', reapplyIcon);

  mainWindow.on('resize', () => saveWindowState(mainWindow));
  mainWindow.on('move', () => saveWindowState(mainWindow));

  mainWindow.on('close', (event) => {
    if (settings.get('closeToTray') && !isQuitting) {
      event.preventDefault();
      saveWindowState(mainWindow);
      mainWindow.hide();
    } else {
      saveWindowState(mainWindow);
      session.defaultSession.cookies.flushStore();
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow.show();
  });

  /* Sukses load → reset retry & pasang CSS */
  mainWindow.webContents.on('did-finish-load', () => {
    const url = mainWindow.webContents.getURL();
    if (url.includes('music.youtube.com')) {
      retryCount = 0;
      loadFailed = false;
      cssKey = null;
      applyCustomCss();
    }
  });

  /* Gagal load → retry bertahap, lalu error page */
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame) return;
    logger.error(`Gagal load: ${errorDescription} (${errorCode})`);
    if (retryCount < 3) {
      retryCount += 1;
      setTimeout(() => {
        if (mainWindow && !isQuitting) mainWindow.loadURL(TARGET_URL);
      }, 2000 * retryCount);
    } else {
      loadFailed = true;
      mainWindow.loadFile(path.join(__dirname, 'error.html'));
    }
  });

  /* Crash recovery */
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    logger.error('Renderer process gone:', details.reason);
    if (mainWindow && !isQuitting) {
      mainWindow.reload();
    }
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.includes('accounts.google.com') ||
      url.includes('consent.google.com') ||
      url.includes('accounts.youtube.com') ||
      url.includes('myaccount.google.com')
    ) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 800,
          height: 800,
          title: 'Google Sign In',
          webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    if (isAllowedNavigation(url)) {
      mainWindow.loadURL(url);
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(TARGET_URL);
}

/* ---------- Auto Update ---------- */
function setupAutoUpdater() {
  if (!app.isPackaged) {
    logger.info('Auto-update nonaktif di mode development');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => logger.info('Memeriksa update...'));
  autoUpdater.on('update-available', (info) => logger.info('Update tersedia: v' + info.version));
  autoUpdater.on('update-not-available', () => logger.info('Sudah versi terbaru'));
  autoUpdater.on('error', (err) => logger.error('Auto-update error:', (err && err.message) || err));
  autoUpdater.on('update-downloaded', (info) => {
    updateReady = true;
    logger.info('Update terunduh: v' + info.version);
    buildTrayMenu();
    if (Notification.isSupported()) {
      const n = new Notification({
        title: 'Update siap dipasang',
        body: `Versi ${info.version} terunduh. Klik untuk restart & pasang.`,
        silent: true,
      });
      n.on('click', () => autoUpdater.quitAndInstall());
      n.show();
    }
  });

  // Cek 5 detik setelah start, lalu tiap 6 jam
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => logger.error('checkForUpdates:', e.message));
  }, 5000);
  setInterval(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 6 * 60 * 60 * 1000);
}

function checkForUpdatesManual() {
  if (!app.isPackaged) {
    // Di mode dev, arahkan ke halaman release
    shell.openExternal('https://github.com/USERNAME_GITHUB_KAMU/zen-electron/releases');
    return;
  }
  autoUpdater.checkForUpdates().catch((e) => logger.error('checkForUpdates:', e.message));
}

/* ---------- Bootstrap ---------- */
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    settings.load();
    logger.info('Aplikasi dimulai');

    // Sinkronkan setting start-on-login dengan OS
    app.setLoginItemSettings({ openAtLogin: settings.get('startOnLogin') });

    // Mulai tersembunyi jika setting aktif atau dibuka otomatis saat login OS
    const launchedAtLogin = app.getLoginItemSettings().wasOpenedAtLogin;
    startHidden = settings.get('startMinimized') || launchedAtLogin;

    Menu.setApplicationMenu(null);

    session.defaultSession.setUserAgent(CHROME_UA, 'en-US,en;q=0.9');
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = details.requestHeaders;
      headers['User-Agent'] = CHROME_UA;
      headers['Sec-CH-UA'] = SEC_CH_UA;
      headers['Sec-CH-UA-Mobile'] = '?0';
      headers['Sec-CH-UA-Platform'] = `"${PLATFORM_INFO.ch}"`;
      if ('Sec-CH-UA-Full-Version-List' in headers) headers['Sec-CH-UA-Full-Version-List'] = SEC_CH_UA_FULL;
      if ('Sec-CH-UA-Platform-Version' in headers) headers['Sec-CH-UA-Platform-Version'] = `"${PLATFORM_INFO.chv}"`;
      if ('Sec-CH-UA-Arch' in headers) headers['Sec-CH-UA-Arch'] = '"x86"';
      if ('Sec-CH-UA-Bitness' in headers) headers['Sec-CH-UA-Bitness'] = '"64"';
      callback({ requestHeaders: headers });
    });

    icons = { play: createPlayIcon(), pause: createPauseIcon() };

    ipcMain.on('player:metadata', (event, meta) => {
      currentTrack = meta;
      logger.info(`🎵 ${meta.title} — ${meta.artist}`);
      if (tray) {
        tray.setToolTip(`${meta.title} — ${meta.artist}`);
        buildTrayMenu();
      }
      showTrackNotification(meta);
    });

    ipcMain.on('player:state', (event, state) => {
      logger.info(`⏯️ ${state}`);
      if (tray && icons) {
        tray.setImage(state === 'playing' ? icons.pause : icons.play);
      }
    });

    createMainWindow();
    createTray();
    setupAutoUpdater();

    const mediaShortcuts = ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop'];
    mediaShortcuts.forEach((shortcut) => {
      globalShortcut.register(shortcut, () => {
        if (shortcut === 'MediaPlayPause') sendCommand('play-pause');
        else if (shortcut === 'MediaNextTrack') sendCommand('next');
        else if (shortcut === 'MediaPreviousTrack') sendCommand('prev');
        else if (shortcut === 'MediaStop') sendCommand('pause');
      });
    });

    // Auto-recovery saat internet kembali
    app.on('online', () => {
      logger.info('Koneksi online terdeteksi');
      if (loadFailed && mainWindow) {
        retryCount = 0;
        loadFailed = false;
        mainWindow.loadURL(TARGET_URL);
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  }).catch((err) => {
    logger.error('Gagal saat inisialisasi:', err);
  });

  app.on('before-quit', () => {
    isQuitting = true;
    session.defaultSession.cookies.flushStore();
    globalShortcut.unregisterAll();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}