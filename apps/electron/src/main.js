const { app, BrowserWindow } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const http = require('http');

const isDev = !app.isPackaged;

let serverProcess = null;
let mainWindow = null;

function findNode() {
  try {
    return execSync('/bin/zsh -l -c "which node"', { encoding: 'utf8' }).trim();
  } catch {
    return 'node';
  }
}

function getServerScript() {
  if (isDev) {
    // Walk up from the exe to find apps/api_server
    let dir = __dirname;
    while (dir !== path.dirname(dir)) {
      const candidate = path.join(dir, 'apps', 'api_server', 'dist', 'server.js');
      if (require('fs').existsSync(candidate)) return candidate;
      dir = path.dirname(dir);
    }
    throw new Error('Could not find api_server/dist/server.js in dev mode');
  }
  // Production: bundled as an extraResource
  return path.join(process.resourcesPath, 'api_server', 'dist', 'server.js');
}

function startApiServer() {
  const nodeBin = findNode();
  const serverScript = getServerScript();
  serverProcess = spawn(nodeBin, [serverScript], {
    stdio: 'inherit',
    env: { ...process.env },
  });
  serverProcess.on('error', (err) => {
    console.error('Failed to start api_server:', err);
  });
}

function pollHealth(callback, retries = 30, delay = 500) {
  http.get('http://localhost:4000/health', (res) => {
    if (res.statusCode === 200) {
      callback();
    } else {
      retry();
    }
  }).on('error', () => {
    retry();
  });

  function retry() {
    if (retries <= 0) {
      callback(new Error('api_server did not start in time'));
      return;
    }
    setTimeout(() => pollHealth(callback, retries - 1, delay), delay);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(process.resourcesPath, 'web', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startApiServer();
  pollHealth((err) => {
    if (err) {
      console.error(err);
      app.quit();
      return;
    }
    createWindow();
  });
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
