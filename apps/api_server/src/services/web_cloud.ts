import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { User } from '../models/user';

interface Credential { productionApiBase: string; userId: number; sessionToken: string }
let credential: Credential | null = null;
const inside = (root: string, file: string) => file === root || file.startsWith(`${root}${path.sep}`);

// ponytail: startup-only snapshot. Re-export/restart after handoff or renewal;
// never re-read on a browser request or silently bind/backfill a local identity.
export async function initializeWebCloud(owner: User, distDir: string): Promise<void> {
  credential = null;
  let fd: number | undefined;
  try {
    const file = process.env.RHYTHM_WEB_CLOUD_CREDENTIAL_PATH;
    if (!file || !path.isAbsolute(file) || process.getuid === undefined) return;
    const parent = path.dirname(file);
    const parentStat = fs.lstatSync(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || parentStat.uid !== process.getuid() || (parentStat.mode & 0o022) !== 0) return;
    const real = fs.realpathSync(file);
    const repoRoot = fs.realpathSync(path.resolve(__dirname, '../../../..'));
    if (inside(repoRoot, real) || inside(fs.realpathSync(distDir), real)) return;
    if (fs.lstatSync(file).isSymbolicLink()) return;
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o7777) !== 0o600 || stat.nlink !== 1 || stat.size > 64 * 1024) return;
    const record: Credential = JSON.parse(fs.readFileSync(fd, 'utf8'));
    const configuredBase = (process.env.RHYTHM_CLOUD_API_URL ?? process.env.PROD_API_URL ?? 'https://api.vcrcapps.com').replace(/\/$/, '');
    const url = new URL(configuredBase);
    // Same server-side cloud knob as MobileCloudIdentityService. HTTP only for
    // explicit loopback fixtures; ordinary destinations still require HTTPS.
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) || url.username || url.password || url.search || url.hash) return;
    if (record.productionApiBase !== configuredBase || !Number.isSafeInteger(record.userId) || record.userId <= 0 || typeof record.sessionToken !== 'string' || !record.sessionToken.trim() || /[\r\n]/.test(record.sessionToken)) return;
    if (!owner.googleSub || !owner.email) return;
    const response = await fetch(`${configuredBase}/auth/me`, {
      headers: { Authorization: `Bearer ${record.sessionToken}`, Accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return;
    const { user } = await response.json() as { user?: User };
    // Numeric IDs are independent between databases. Existing subject + email
    // binding is authoritative (mobile_cloud_identity_service.ts:109–134).
    if (user?.id !== record.userId || user.googleSub !== owner.googleSub || typeof user.email !== 'string' || user.email.toLowerCase() !== owner.email.toLowerCase()) return;
    credential = record;
  } catch {
    // No paths, parse errors, fetch errors or credential values enter logs.
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export const webCloudAvailable = () => credential !== null;

export function createWebCloudRouter() {
  const router = express.Router();
  const fail = (res: express.Response, status: number, code: string) => res.status(status).json({ error: { code } });
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    try {
      // Inspect the raw request before URL normalization. Reject nested encoding,
      // escaped separators and dot segments, not just URL()'s normalized path.
      const raw = req.originalUrl.slice('/cloud'.length).split('?')[0];
      const decoded = decodeURIComponent(raw);
      if (!raw.startsWith('/') || raw.startsWith('//') || /%25|%2f|%5c/i.test(raw) || decoded.includes('\\') || decoded.includes('://') || decoded.split('/').some(part => part === '..' || part === '.') || /[\x00-\x20\x7f]/.test(decoded)) return fail(res, 400, 'INVALID_CLOUD_PATH');
    } catch { return fail(res, 400, 'INVALID_CLOUD_PATH'); }
    if (!['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return fail(res, 405, 'METHOD_NOT_ALLOWED');
    if (!credential) return fail(res, 503, 'CLOUD_ACCOUNT_DISCONNECTED');
    if (req.headers['content-length'] !== undefined && Number(req.headers['content-length']) > 1024 * 1024) return fail(res, 413, 'CLOUD_BODY_TOO_LARGE');
    if (req.headers['transfer-encoding'] || Number(req.headers['content-length']) > 0) {
      if (!req.is('application/json')) return fail(res, 415, 'CLOUD_JSON_REQUIRED');
    }
    next();
  });
  router.use(express.json({ limit: '1mb' }));
  router.use(async (req, res) => {
    const current = credential;
    if (!current) return fail(res, 503, 'CLOUD_ACCOUNT_DISCONNECTED');
    try {
      const hasBody = Boolean(req.headers['transfer-encoding']) || Number(req.headers['content-length']) > 0;
      // Allowlist rather than copying browser headers (including Connection's
      // dynamically named fields). The browser cannot choose a host or bearer.
      const upstream = await fetch(`${current.productionApiBase}${req.url}`, {
        method: req.method, redirect: 'manual', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${current.sessionToken}`, Accept: 'application/json', ...(hasBody ? { 'Content-Type': 'application/json' } : {}) },
        ...(!hasBody || ['GET', 'HEAD'].includes(req.method) ? {} : { body: JSON.stringify(req.body) }),
      });
      if (upstream.status >= 300 && upstream.status < 400) { await upstream.body?.cancel(); return fail(res, 502, 'CLOUD_REDIRECT_REFUSED'); }
      if (upstream.status === 401 || upstream.status === 403) {
        credential = null; await upstream.body?.cancel();
        return fail(res, 401, 'CLOUD_ACCOUNT_DISCONNECTED');
      }
      // Buffer a bounded response so an upstream diagnostic cannot echo the
      // attached credential into browser headers/body before we can reject it.
      const chunks: Buffer[] = []; let size = 0;
      if (upstream.body) for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) throw new Error('response limit');
        chunks.push(Buffer.from(chunk));
      }
      const bytes = Buffer.concat(chunks);
      if ([current.sessionToken, encodeURIComponent(current.sessionToken), JSON.stringify(current.sessionToken).slice(1, -1)].some(secret => bytes.includes(secret))) return fail(res, 502, 'CLOUD_RESPONSE_REFUSED');
      // Only content type survives: no Set-Cookie, Location, hop-by-hop headers,
      // arbitrary reflected headers, or stale Content-Length/encoding.
      const type = upstream.headers.get('content-type');
      if (type && !type.includes(current.sessionToken)) res.setHeader('Content-Type', type);
      return res.status(upstream.status).send(bytes);
    } catch { return fail(res, 502, 'CLOUD_UNAVAILABLE'); }
  });
  router.use((err: { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    return fail(res, err.type === 'entity.too.large' ? 413 : 400, err.type === 'entity.too.large' ? 'CLOUD_BODY_TOO_LARGE' : 'CLOUD_INVALID_JSON');
  });
  return router;
}
