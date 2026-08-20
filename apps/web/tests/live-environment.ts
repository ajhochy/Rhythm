const DEFAULT_API_URL = 'http://127.0.0.1:4098';
const DEFAULT_ENGINE_URL = 'http://127.0.0.1:4097';

function loopbackBase(name: string, value: string): string {
  const url = new URL(value);
  const port = Number(url.port);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || port < 1024 || port > 65535 || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${name} must be plain http://127.0.0.1:<unprivileged-port>`);
  }
  return `http://127.0.0.1:${port}`;
}

function productionBase(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('RHYTHM_LIVE_PRODUCTION_API_URL must be HTTP(S) without credentials, query, or fragment');
  }
  return url.toString().replace(/\/$/, '');
}

export function liveEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const apiBase = loopbackBase('RHYTHM_LIVE_API_URL', env.RHYTHM_LIVE_API_URL ?? DEFAULT_API_URL);
  const engineBase = loopbackBase('RHYTHM_LIVE_ENGINE_URL', env.RHYTHM_LIVE_ENGINE_URL ?? DEFAULT_ENGINE_URL);
  if (apiBase === engineBase) throw new Error('RHYTHM live API and engine ports must be distinct');
  return {
    apiBase,
    engineBase,
    productionApiBase: productionBase(env.RHYTHM_LIVE_PRODUCTION_API_URL ?? apiBase),
    wsBase: apiBase.replace(/^http:/, 'ws:'),
  };
}
