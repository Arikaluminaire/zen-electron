const { ipcRenderer } = require('electron');

/* =========================================================
   HELPER
   ========================================================= */
function getPlayerElement() {
  // YouTube Music memakai tag <video> untuk memutar audio
  return document.querySelector('video');
}

/* =========================================================
   METADATA — dibaca langsung (bukan di-hook),
   karena getter mediaSession bekerja lintas world
   ========================================================= */
let lastMetadataKey = '';

function readMetadataFromMediaSession() {
  if (!('mediaSession' in navigator)) return null;
  const m = navigator.mediaSession.metadata;
  if (!m || !m.title) return null;
  return {
    title: m.title || '',
    artist: m.artist || '',
    album: m.album || '',
    artwork: m.artwork && m.artwork.length > 0 ? m.artwork[0].src : null,
  };
}

// Fallback: baca dari player bar jika mediaSession belum terisi
function readMetadataFromDOM() {
  const bar = document.querySelector('ytmusic-player-bar');
  if (!bar) return null;
  const title = bar.querySelector('.title')?.textContent?.trim() || '';
  const artist = bar.querySelector('.byline a')?.textContent?.trim() || '';
  if (!title) return null;
  return { title, artist, album: '', artwork: null };
}

function readAndSendMetadata() {
  try {
    const meta = readMetadataFromMediaSession() || readMetadataFromDOM();
    if (!meta) return;

    // Kirim hanya jika lagu benar-benar berubah
    const key = `${meta.title}||${meta.artist}||${meta.album}`;
    if (key === lastMetadataKey) return;
    lastMetadataKey = key;

    ipcRenderer.send('player:metadata', meta);
  } catch (err) {
    // Jangan biarkan error menghentikan polling
  }
}

function setupMetadataPolling() {
  readAndSendMetadata();
  setInterval(readAndSendMetadata, 1000);
}

/* =========================================================
   PLAYBACK STATE (event DOM bekerja lintas world)
   ========================================================= */
function monitorPlaybackState() {
  const player = getPlayerElement();
  if (!player) return false;

  player.addEventListener('play', () => {
    ipcRenderer.send('player:state', 'playing');
    readAndSendMetadata(); // refresh metadata saat lagu mulai
  });
  player.addEventListener('pause', () => ipcRenderer.send('player:state', 'paused'));
  player.addEventListener('ended', () => ipcRenderer.send('player:state', 'ended'));
  return true;
}

/* =========================================================
   MEDIA SESSION HANDLERS (tombol media OS / keyboard)
   Terdaftar di level browser, jadi bekerja lintas world
   ========================================================= */
function setupMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) return;

  const handlers = {
    play: () => getPlayerElement()?.play(),
    pause: () => getPlayerElement()?.pause(),
    nexttrack: () => document.querySelector('.next-button')?.click(),
    previoustrack: () => document.querySelector('.previous-button')?.click(),
  };

  Object.entries(handlers).forEach(([action, fn]) => {
    try {
      navigator.mediaSession.setActionHandler(action, fn);
    } catch (e) { /* ignore */ }
  });
}

/* =========================================================
   PERINTAH DARI MAIN PROCESS (untuk tray/menu di Fase 4)
   ========================================================= */
ipcRenderer.on('player:command', (event, command) => {
  const player = getPlayerElement();
  if (!player) return;

  switch (command) {
    case 'play-pause':
      player.paused ? player.play() : player.pause();
      break;
    case 'play': player.play(); break;
    case 'pause': player.pause(); break;
    case 'next': document.querySelector('.next-button')?.click(); break;
    case 'prev': document.querySelector('.previous-button')?.click(); break;
  }
});

/* =========================================================
   INIT (dengan retry, karena elemen <video> kadang
   muncul beberapa saat setelah DOM ready)
   ========================================================= */
function init() {
  setupMediaSessionHandlers();
  setupMetadataPolling();

  let attempts = 0;
  const tryMonitor = () => {
    if (monitorPlaybackState()) return;
    attempts += 1;
    if (attempts < 10) setTimeout(tryMonitor, 1000);
  };
  tryMonitor();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}