import { normalizeRemoteProductionApiBase } from '../../shared/production-api-base.mjs';

const DEFAULT_API_URL = 'http://127.0.0.1:4001';
const DEFAULT_ENGINE_URL = 'http://127.0.0.1:4096';
const DEFAULT_PRODUCTION_API_URL = 'https://api.vcrcapps.com';

function loopbackBase(name: string, value: string): string {
  const url = new URL(value);
  const port = Number(url.port);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || port < 1024 || port > 65535 || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be plain http://127.0.0.1:<unprivileged-port>`);
  }
  return `http://127.0.0.1:${port}`;
}

function productionBase(value: string): string {
  try {
    return normalizeRemoteProductionApiBase(value);
  } catch {
    throw new Error('RHYTHM_LIVE_PRODUCTION_API_URL must be remote HTTPS without credentials, query, or fragment');
  }
}

export function liveEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const apiBase = loopbackBase('RHYTHM_LIVE_API_URL', env.RHYTHM_LIVE_API_URL ?? DEFAULT_API_URL);
  const engineBase = loopbackBase('RHYTHM_LIVE_ENGINE_URL', env.RHYTHM_LIVE_ENGINE_URL ?? DEFAULT_ENGINE_URL);
  if (apiBase === engineBase) throw new Error('RHYTHM live API and engine ports must be distinct');
  return {
    apiBase,
    engineBase,
    productionApiBase: productionBase(env.RHYTHM_LIVE_PRODUCTION_API_URL ?? DEFAULT_PRODUCTION_API_URL),
    wsBase: apiBase.replace(/^http:/, 'ws:'),
  };
}
