/**
 * electron-main.js — MultiChat Desktop App
 */

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const { fork } = require('child_process');

const SETTINGS_PATH = path.join(app.getPath('userData'), 'multichat-settings.json');
const APP_VERSION   = app.getVersion();

let mainWindow  = null;
let setupWindow = null;
let tray        = null;
let bridgeProc  = null;
let isQuitting  = false;

// ── Settings helpers ──────────────────────────────────────────────────────────
function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return null;
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch(e) { return null; }
}

function writeSettings(data) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

function isSetupComplete() {
  const s = readSettings();
  if (!s || !s._setupDone || !s.BRAND_NAME || s.BRAND_NAME === 'MultiChat') return false;
  const savedMajor   = (s._appVersion || '0').split('.')[0];
  const currentMajor = APP_VERSION.split('.')[0];
  if (savedMajor !== currentMajor) return false;
  return true;
}

// ── IPC: settings ─────────────────────────────────────────────────────────────
ipcMain.handle('get-settings', () => readSettings());

ipcMain.handle('save-settings', (_, data) => {
  data._setupDone  = true;
  data._appVersion = APP_VERSION;
  writeSettings(data);
  return true;
});

ipcMain.handle('open-main-app', () => {
  if (setupWindow) setupWindow.close();
  startBridge();
  createMainWindow();
  createTray();
});

ipcMain.handle('reopen-setup', () => {
  if (mainWindow) mainWindow.hide();
  createSetupWindow();
});

ipcMain.handle('reset-settings', () => {
  if (fs.existsSync(SETTINGS_PATH)) fs.unlinkSync(SETTINGS_PATH);
  return true;
});

// ── IPC: generate OBS overlay ─────────────────────────────────────────────────
// Reads multichat.html, replaces the CONFIG block between the sentinel markers,
// and writes a ready-to-use overlay file to the user's Desktop.
ipcMain.handle('generate-overlay', (_, settings) => {
  return generateOverlayFile(settings);
});

function generateOverlayFile(settings) {
  try {
    const templatePath = path.join(__dirname, 'multichat.html');
    if (!fs.existsSync(templatePath)) {
      console.error('[Overlay] multichat.html not found');
      return null;
    }

    let html = fs.readFileSync(templatePath, 'utf8');

    // Build the overlay CONFIG — no Electron bridge, no server-side keys
    const overlayConfig = {
      TWITCH_CHANNEL:     settings.TWITCH_CHANNEL     || '',
      YOUTUBE_PROXY_URL:  settings.YOUTUBE_PROXY_URL  || '',
      YOUTUBE_API_KEY:    '',   // never bake API keys into HTML files
      YOUTUBE_CHANNEL_ID: settings.YOUTUBE_CHANNEL_ID || '',
      YOUTUBE_POLL_MS:    settings.YOUTUBE_POLL_MS    || 8000,
      KICK_CHANNEL:       settings.KICK_CHANNEL       || '',
      KICK_CHATROOM_ID:   settings.KICK_CHATROOM_ID   || 0,
      ABS_WS_URL:         settings.ABS_WS_URL         || '',
      DISCORD_WS_URL:     settings.DISCORD_WS_URL     || '',
      BRAND_NAME:         settings.BRAND_NAME         || 'MultiChat',
      CHANNELS:           settings.CHANNELS           || {},
      DEFAULTS:           settings.DEFAULTS           || { bgColor: { r:14, g:14, b:16 }, bgAlpha: 1, fontScale: 1 },
    };

    const configBlock = `<!-- MULTICHAT_CONFIG_START -->\n<script>\nconst CONFIG = ${JSON.stringify(overlayConfig, null, 2)};\n<\/script>\n<!-- MULTICHAT_CONFIG_END -->`;

    const replaced = html.replace(
      /<!-- MULTICHAT_CONFIG_START -->[\s\S]*?<!-- MULTICHAT_CONFIG_END -->/,
      configBlock
    );

    if (replaced === html) {
      console.error('[Overlay] CONFIG markers not found in multichat.html');
      return null;
    }

    const name       = (settings.BRAND_NAME || 'multichat').toLowerCase().replace(/[^a-z0-9]/g, '-');
    const outputPath = path.join(app.getPath('desktop'), `${name}-multichat-overlay.html`);
    fs.writeFileSync(outputPath, replaced, 'utf8');
    console.log(`[Overlay] Written to ${outputPath}`);
    return outputPath;

  } catch(e) {
    console.error('[Overlay] Failed:', e.message);
    return null;
  }
}

// ── IPC: show file in OS file manager ─────────────────────────────────────────
ipcMain.handle('show-in-folder', (_, filePath) => {
  if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
});

// ── Discord bridge ────────────────────────────────────────────────────────────
function startBridge() {
  const bridgePath = path.join(__dirname, 'discord-bridge.js');
  if (!fs.existsSync(bridgePath)) return;

  const settings = readSettings();
  // Bridge runs even without Discord if YouTube proxy is needed
  const hasDiscord = settings?.DISCORD_BOT_TOKEN &&
                     settings.DISCORD_BOT_TOKEN !== 'YOUR_DISCORD_BOT_TOKEN';
  const hasYouTube = !!(process.env.YOUTUBE_API_KEY);

  if (!hasDiscord && !hasYouTube) {
    console.log('[Bridge] No Discord token and no YOUTUBE_API_KEY — bridge not started');
    return;
  }

  bridgeProc = fork(bridgePath, [], {
    cwd: __dirname,
    silent: true,
    env: {
      ...process.env,
      DISCORD_BOT_TOKEN:      settings?.DISCORD_BOT_TOKEN  || '',
      DISCORD_CHANNEL_ID:     settings?.DISCORD_CHANNEL_ID || '',
      DISCORD_BRIDGE_WS_PORT: '8081',
      HTTP_PORT:              '8082',
    }
  });

  bridgeProc.stdout.on('data', d => process.stdout.write(`[Bridge] ${d}`));
  bridgeProc.stderr.on('data', d => process.stderr.write(`[Bridge] ${d}`));
  bridgeProc.on('exit', code => {
    if (!isQuitting) {
      console.log(`[Bridge] Exited (${code}) — restarting in 3s`);
      setTimeout(startBridge, 3000);
    }
  });
  console.log('[Bridge] Started');
}

// ── Setup window ──────────────────────────────────────────────────────────────
function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width:  560,
    height: 860,
    resizable: false,
    title: 'MultiChat — Setup',
    backgroundColor: '#0e0e10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    autoHideMenuBar: true,
  });
  setupWindow.loadFile('setup.html');
  setupWindow.once('ready-to-show', () => setupWindow.show());
  setupWindow.on('closed', () => { setupWindow = null; });
}

// ── Main chat window ──────────────────────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width:  420,
    height: 900,
    minWidth:  320,
    minHeight: 400,
    title: 'MultiChat',
    backgroundColor: '#0e0e10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
    autoHideMenuBar: true,
  });
  mainWindow.loadFile('multichat.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url); return { action: 'deny' };
  });
  mainWindow.on('close', e => {
    if (!isQuitting) { e.preventDefault(); mainWindow.hide(); }
  });
}

// ── System tray ───────────────────────────────────────────────────────────────
function createTray() {
  if (tray) return;
  const iconFile = process.platform === 'darwin' ? 'icon.png'
                 : process.platform === 'win32'  ? 'icon.ico'
                 : 'icon.png';
  const iconPath = path.join(__dirname, 'assets', iconFile);
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createEmpty();

  tray = new Tray(icon);
  tray.setToolTip('MultiChat');

  const menu = Menu.buildFromTemplate([
    { label: 'Show MultiChat', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: 'Settings', click: () => createSetupWindow() },
    {
      label: 'Regenerate OBS Overlay',
      click: () => {
        const settings = readSettings();
        if (!settings) {
          dialog.showMessageBox({ message: 'No settings found. Run Setup first.', buttons: ['OK'] });
          return;
        }
        const outPath = generateOverlayFile(settings);
        if (outPath) {
          dialog.showMessageBox({
            type: 'info',
            title: 'Overlay Generated',
            message: `Overlay saved to Desktop:\n${path.basename(outPath)}`,
            buttons: ['Open Folder', 'OK']
          }).then(({ response }) => {
            if (response === 0) shell.showItemInFolder(outPath);
          });
        } else {
          dialog.showMessageBox({ message: 'Could not generate overlay. Check console for details.', buttons: ['OK'] });
        }
      }
    },
    {
      label: 'Reset & Clear Data',
      click: () => {
        dialog.showMessageBox({
          type: 'question',
          buttons: ['Delete & Restart Setup', 'Cancel'],
          defaultId: 1,
          title: 'Reset MultiChat',
          message: 'Delete all saved settings?',
          detail: 'This will remove your configuration. The setup wizard will reopen.'
        }).then(({ response }) => {
          if (response === 0) {
            if (fs.existsSync(SETTINGS_PATH)) fs.unlinkSync(SETTINGS_PATH);
            if (bridgeProc) { bridgeProc.kill(); bridgeProc = null; }
            if (mainWindow) { mainWindow.destroy(); mainWindow = null; }
            createSetupWindow();
          }
        });
      }
    },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(menu);
  if (process.platform === 'darwin') {
    tray.on('click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  } else {
    tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } });
  }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.hide();
    const macMenu = Menu.buildFromTemplate([
      { label: app.name, submenu: [{ role: 'hide' }, { role: 'quit' }] },
      { label: 'Edit', submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]}
    ]);
    Menu.setApplicationMenu(macMenu);
  } else {
    Menu.setApplicationMenu(null);
  }

  if (isSetupComplete()) {
    startBridge();
    createMainWindow();
    createTray();
  } else {
    createSetupWindow();
  }
});

app.on('window-all-closed', e => e.preventDefault());
app.on('before-quit', () => { isQuitting = true; if (bridgeProc) bridgeProc.kill(); });
app.on('activate', () => { if (mainWindow) mainWindow.show(); });
