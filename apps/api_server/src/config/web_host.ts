import path from 'node:path';

export function resolveWebHostConfig(source: NodeJS.ProcessEnv = process.env) {
  if (!source.RHYTHM_WEB_HOST || source.RHYTHM_WEB_HOST === '0') return null;
  if (source.RHYTHM_WEB_HOST !== '1' || source.RHYTHM_ROLE !== 'local' || source.AGENT_LOCAL !== 'true') {
    throw new Error('RHYTHM_WEB_HOST=1 requires RHYTHM_ROLE=local and AGENT_LOCAL=true');
  }
  const origins = (source.RHYTHM_WEB_PUBLIC_ORIGIN ?? '').split(',');
  if (!origins.length || origins.some(value => {
    try {
      const url = new URL(value);
      return !['http:', 'https:'].includes(url.protocol) || url.origin !== value || Boolean(url.username || url.password);
    } catch { return true; }
  })) throw new Error('RHYTHM_WEB_PUBLIC_ORIGIN requires exact HTTP(S) origins');
  const owner = source.RHYTHM_WEB_OWNER_USER_ID ?? '';
  if (!/^[1-9]\d*$/.test(owner) || !Number.isSafeInteger(Number(owner))) {
    throw new Error('RHYTHM_WEB_OWNER_USER_ID requires an existing positive user ID');
  }
  const distDir = source.RHYTHM_WEB_DIST_DIR ?? '';
  if (!path.isAbsolute(distDir)) throw new Error('RHYTHM_WEB_DIST_DIR must be absolute');
  return { origins, hosts: origins.map(value => new URL(value).host), ownerUserId: Number(owner), distDir };
}

export const webHostConfig = resolveWebHostConfig();
