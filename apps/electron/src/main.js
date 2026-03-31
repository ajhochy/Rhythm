const { app, BrowserWindow } = require('electron');
const { execSync, spawn } = require('child_process');
const path = require('path');
const http = require('http');
const os = require('os');
const fs = require('fs');

let apiServer = null;

function findNodeBinary() {
  try {
    return execSync('/bin/zsh -l -c \'which node\'', { encoding: 'utf8' }).trim();
  } catch (err) {
    console.error('Could not find node binary:', err);
    return 'node';
  }
}

function spawnApiServer(nodePath) {
  const serverScript = path.join(__dirname, '../../api_server/dist/server.js');
  const dbPath = path.join(os.homedir(), 'Library/Application Support/Rhythm/rhythm.db');

  apiServer = spawn(nodePath, [serverScript], {
    env: {
      ...process.env,
      PORT: '4000',
      DB_PATH: dbPath,
    },
    stdio: 'inherit',
  });

  apiServer.on('error', (err) => {
    console.error('API server failed to start:', err);
  });

  apiServer.on('exit', (code) => {
    console.log(`API server exited with code ${code}`);
  });
}

function pollHealth(timeout, interval, resolve, reject, elapsed) {
  elapsed = elapsed || 0;
  if (elapsed > timeout) {
    reject(new Error('API server health check timed out'));
    return;
  }

  http.get('http://localhost:4000/health', (res) => {
    if (res.statusCode === 200) {
      resolve();
    } else {
      setTimeout(() => pollHealth(timeout, interval, resolve, reject, elapsed + interval), interval);
    }
  }).on('error', () => {
    setTimeout(() => pollHealth(timeout, interval, resolve, reject, elapsed + interval), interval);
  });
}

function waitForApi() {
  return new Promise((resolve, reject) => {
    pollHealth(30000, 500, resolve, reject, 0);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
    },
  });

  const prodDistPath = path.join(__dirname, '../../web/dist/index.html');
  const isProd = fs.existsSync(prodDistPath);

  if (isProd) {
    win.loadFile(prodDistPath);
  } else {
    win.loadURL('http://localhost:5173');
  }
}

app.whenReady().then(async () => {
  const nodePath = findNodeBinary();
  spawnApiServer(nodePath);

  try {
    await waitForApi();
    createWindow();
  } catch (err) {
    console.error('Failed to connect to API server:', err.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (apiServer) {
    apiServer.kill();
  }
  app.quit();
});
