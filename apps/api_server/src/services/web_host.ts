import fs from 'node:fs';
import path from 'node:path';
import express, { type RequestHandler } from 'express';
import { webHostConfig } from '../config/web_host';
import type { User } from '../models/user';
import { UsersRepository } from '../repositories/users_repository';
import { initializeWebCloud, webCloudAvailable } from './web_cloud';

let owner: User | null = null;
let distRoot: string | null = null;

// Run after DB initialization, before any listener or engine is started.
export async function initializeWebHost(): Promise<void> {
  if (!webHostConfig) return;
  const validatedOwner = await new UsersRepository().findByIdAsync(webHostConfig.ownerUserId);
  const root = fs.realpathSync(webHostConfig.distDir);
  if (!fs.statSync(root).isDirectory() || !fs.statSync(path.join(root, 'index.html')).isFile()) {
    throw new Error('RHYTHM_WEB_DIST_DIR must contain the built web index.html');
  }
  if (!fs.realpathSync(path.join(root, 'index.html')).startsWith(`${root}${path.sep}`)) {
    throw new Error('Web index must remain inside dist');
  }
  owner = validatedOwner;
  distRoot = root;
  await initializeWebCloud(validatedOwner, root);
}

export function webHostOwner(): User | null {
  if (!webHostConfig) return null;
  if (!owner) throw new Error('Web owner has not been validated');
  return owner;
}

export const webHostOwnerContext: RequestHandler = (req, _res, next) => {
  const user = webHostOwner();
  // No bearer is manufactured. Empty sessionToken denotes tokenless host context.
  if (user && req.headers.authorization === undefined) req.auth = { user, sessionToken: '' };
  next();
};

export function createWebHostRouter() {
  if (!webHostConfig || !distRoot) throw new Error('Web host has not been initialized');
  const root = distRoot;
  const router = express.Router();
  router.get('/web/bootstrap', (_req, res) => {
    const user = webHostOwner()!;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ mode: 'web', owner: { id: user.id, displayName: user.name, role: user.role },
      capabilities: { localAgents: true, cloud: webCloudAvailable(), approvals: true, mobileAccess: false } });
  });
  // Hash navigation needs only index.html at /. Never rewrite API misses to HTML.
  const serve = express.static(root, { dotfiles: 'deny', fallthrough: true, redirect: false });
  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    try {
      const decoded = decodeURIComponent(req.path);
      if (decoded.includes('\\') || decoded.split('/').includes('..')) return res.status(404).json({ error: { code: 'NOT_FOUND' } });
      const target = path.resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
      if (!target.startsWith(`${root}${path.sep}`)) return next();
      // express.static follows symlinks; verify the real target before handing it off.
      if (!fs.existsSync(target) || !fs.realpathSync(target).startsWith(`${root}${path.sep}`)) return next();
      if (target === path.join(root, 'index.html')) {
        const sources = ["'self'", ...webHostConfig!.origins.flatMap(origin => [origin, origin.replace(/^http/, 'ws')])];
        const html = fs.readFileSync(target, 'utf8').replace(/connect-src [^;"\n]+/, `connect-src ${sources.join(' ')}`);
        res.setHeader('Cache-Control', 'no-store');
        return res.type('html').send(html);
      }
      return serve(req, res, next);
    } catch { return res.status(404).json({ error: { code: 'NOT_FOUND' } }); }
  });
  return router;
}
