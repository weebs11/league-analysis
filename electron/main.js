// Electron shell for the LoL Matchup Coach.
//
// The Express server in server.js remains the whole product — it runs
// in-process here, and this file is only the chrome around it: a window on
// http://127.0.0.1:<port>, a tray icon, and error dialogs for the failure
// modes that would otherwise die silently in a GUI app. A regular browser on
// the same URL keeps working alongside the window (same server socket).
//
// IMPORTANT: server.js and src/config.js must ONLY be loaded via dynamic
// import() inside main(), never statically. Static imports hoist above the
// packaged-mode env setup below, which would freeze the config/data paths to
// the (read-only) asar before they are redirected to userData.
import { app, BrowserWindow, dialog, Menu, shell, Tray } from 'electron';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWindowState, trackWindowState } from './window-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow = null;
let tray = null;
// Closing the window hides to the tray (the app keeps watching for games);
// only the tray's Quit — or anything else that calls app.quit() — really exits.
let isQuitting = false;
let hideHintShown = false;

// Matches build.appId — keeps taskbar grouping and tray balloons attributed
// to the app on Windows.
app.setAppUserModelId('com.lolmatchupcoach.app');

if (!app.requestSingleInstanceLock()) {
  // Already running (possibly hidden to tray) — that instance gets focused
  // via the second-instance event below.
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
  app.on('before-quit', () => {
    isQuitting = true;
  });
  app.on('window-all-closed', () => app.quit());
  main();
}

async function main() {
  // Packaged app: all writable state — match archive, Data Dragon cache, and
  // config.json (which holds the API key) — goes under
  // %APPDATA%\LoL Matchup Coach. In dev (npm run app) the env stays unset, so
  // src/config.js keeps using the repo's config.json and data/ and existing
  // dev data keeps working. ??= keeps an explicitly exported override winning,
  // same contract the env vars already have.
  if (app.isPackaged) {
    const userData = app.getPath('userData');
    fs.mkdirSync(userData, { recursive: true });
    process.env.LOL_COACH_DATA_DIR ??= path.join(userData, 'data');
    process.env.LOL_COACH_CONFIG ??= path.join(userData, 'config.json');
  }

  await app.whenReady();

  // Safe to load config now that the env is settled; this shares the module
  // cache with server.js, so both see the same instance.
  const { getConfig } = await import('../src/config.js');
  const port = Number(process.env.PORT || getConfig().port || 3000);

  // server.js exits the process on EADDRINUSE when run under plain node; in
  // here that would tear down the GUI with no explanation, so check the port
  // up front and say something useful. The race between this probe and the
  // real bind is covered by the `ready` rejection below.
  if (!(await portFree(port))) {
    dialog.showErrorBox(
      'LoL Matchup Coach is already running',
      `Port ${port} is in use — most likely by another copy of this app (check the tray) ` +
        `or by "npm start".\n\nYou can open the running copy at http://localhost:${port} ` +
        `in a browser, or close it and launch again.`
    );
    app.quit();
    return;
  }

  try {
    // Top-level await inside server.js covers Data Dragon startup — on a first
    // run with no network this import rejects with a readable message.
    const server = await import('../server.js');
    await server.ready;
  } catch (err) {
    dialog.showErrorBox('LoL Matchup Coach could not start', String(err?.message || err));
    app.exit(1);
    return;
  }

  createWindow(port);
  createTray();
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

function createWindow(port) {
  const state = loadWindowState({ width: 1400, height: 900 });
  mainWindow = new BrowserWindow({
    ...state.bounds,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0a1420', // the UI's near-black — no white flash on load
    autoHideMenuBar: true, // Alt still reveals the menu (reload, DevTools)
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      sandbox: true,
      // The dashboard must keep reacting to SSE phase changes while fully
      // covered by the League window mid-game.
      backgroundThrottling: false,
    },
  });
  if (state.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // The UI is served from localhost; anything else (external guides, Riot
  // pages) belongs in the default browser.
  const isLocal = (url) => {
    const u = new URL(url);
    return (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && u.port === String(port);
  };
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !isLocal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isLocal(url)) return;
    event.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  });

  trackWindowState(mainWindow);

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
    if (!hideHintShown && tray) {
      hideHintShown = true;
      tray.displayBalloon({
        iconType: 'info',
        title: 'Still running',
        content: 'LoL Matchup Coach keeps watching for games from the tray. Right-click the tray icon to quit.',
      });
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.loadURL(`http://127.0.0.1:${port}`);
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'tray.png'));
  tray.setToolTip('LoL Matchup Coach');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open LoL Matchup Coach', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
  );
  tray.on('click', showWindow);
}
