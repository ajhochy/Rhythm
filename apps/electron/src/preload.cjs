const { contextBridge, ipcRenderer } = require('electron');

const appVersion = process.argv.find((value) => value.startsWith('--rhythm-shell-version='))?.slice(23) ?? 'unknown';
/** @param {string} name */
const runtimeValue = (name) => {
  const value = process.env[name]?.trim();
  return value || undefined;
};
const gateway = Object.freeze({
  apiBase: runtimeValue('RHYTHM_LIVE_API_URL'),
  engineBase: runtimeValue('RHYTHM_LIVE_ENGINE_URL'),
});
const auth = Object.freeze({
  signInWithGoogle: () => ipcRenderer.invoke('rhythm:auth:google-sign-in'),
});
contextBridge.exposeInMainWorld('rhythmShell', Object.freeze({
  version: 4,
  appVersion,
  platform: process.platform,
  gateway,
  auth,
}));
