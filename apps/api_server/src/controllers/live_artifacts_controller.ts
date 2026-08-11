import { randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors/app_error';
import type { LiveArtifact, LiveArtifactVisibility } from '../models/live_artifact';
import { LiveArtifactsRepository } from '../repositories/live_artifacts_repository';
import { LiveArtifactStorage } from '../services/live_artifact_storage';

const repo = new LiveArtifactsRepository();
const storage = new LiveArtifactStorage();
const capabilities = ['pco.services.read'];
const visibility = (value: unknown): LiveArtifactVisibility => {
  if (value === 'private' || value === 'shared' || value === 'organization') return value;
  throw AppError.badRequest('visibility must be private, shared, or organization');
};
const integer = (value: unknown, name: string) => { if (!Number.isInteger(value) || (value as number) < 1) throw AppError.badRequest(`${name} must be a positive integer`); return value as number; };
const safeId = (id: string) => { if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw AppError.notFound('Live artifact'); return id; };
const publicArtifact = ({ updatedByUserId: _updatedByUserId, ...artifact }: LiveArtifact) => artifact;

export class LiveArtifactsController {
  private async readable(req: Request) {
    const artifact = await repo.find(safeId(req.params.id));
    if (!artifact || !(await repo.canRead(artifact, req.auth!.user.id))) throw AppError.notFound('Live artifact');
    return artifact;
  }
  private async owner(req: Request) { const artifact = await this.readable(req); if (artifact.ownerUserId !== req.auth!.user.id || artifact.deletedAt) throw AppError.notFound('Live artifact'); return artifact; }
  private tombstone(res: Response) { res.status(410).json({ error: { code: 'artifact_deleted', message: 'Artifact deleted' } }); }
  async list(req: Request, res: Response, next: NextFunction) { try { if (req.query.type !== undefined && req.query.type !== 'html') throw AppError.badRequest('type must be html'); res.json((await repo.list(req.auth!.user.id, typeof req.query.search === 'string' ? req.query.search : undefined)).map(publicArtifact)); } catch (error) { next(error); } }
  async create(req: Request, res: Response, next: NextFunction) { try {
    if (req.body?.type !== 'html' || typeof req.body?.title !== 'string' || !req.body.title.trim()) throw AppError.badRequest('type html and title are required');
    const workspaceId = integer(req.body.workspaceId, 'workspaceId'); const actor = req.auth!.user.id;
    if (!await repo.isWorkspaceMember(workspaceId, actor)) throw AppError.notFound('Workspace');
    const collaborators = req.body.collaborators ?? [];
    if (!Array.isArray(collaborators) || collaborators.some((userId) => !Number.isInteger(userId) || userId < 1)) throw AppError.badRequest('collaborators must contain positive integer user IDs');
    const collaboratorIds = [...new Set(collaborators)] as number[];
    if (!(await Promise.all(collaboratorIds.map((userId) => repo.isWorkspaceMember(workspaceId, userId)))).every(Boolean)) throw AppError.badRequest('collaborator must be a workspace member');
    const bundle = storage.validateBundle(req.body.bundle); const state = storage.validateState(req.body.state); const bundleHash = storage.bundleHash(bundle); const stateHash = storage.stateHash(state);
    const declared = req.body.declaredCapabilities ?? []; if (!Array.isArray(declared) || declared.some((item) => !capabilities.includes(item))) throw AppError.badRequest('unsupported capability');
    const id = repo.newId();
    try {
      await storage.publishBundle(id, bundleHash, bundle); await storage.publishState(id, stateHash, state);
      res.status(201).json(publicArtifact(await repo.create({ id, type: 'html', title: req.body.title.trim(), ownerUserId: actor, workspaceId, visibility: req.body.visibility === undefined ? 'private' : visibility(req.body.visibility), currentBundleRevision: 1, currentBundleHash: bundleHash, currentStateRevision: 1, currentStateHash: stateHash, declaredCapabilities: declared, updatedByUserId: actor, updatedByDisplayName: null }, collaboratorIds)));
    } catch (error) { await storage.removeArtifact(id).catch(() => undefined); throw error; }
  } catch (error) { next(error); } }
  async get(req: Request, res: Response, next: NextFunction) { try { const artifact = await this.readable(req); if (artifact.deletedAt) return this.tombstone(res); res.json({ ...publicArtifact(artifact), state: await storage.readState(artifact.id, artifact.currentStateHash) }); } catch (error) { next(error); } }
  async render(req: Request, res: Response, next: NextFunction) {
    try {
      const artifact = await this.readable(req);
      if (artifact.deletedAt) return this.tombstone(res);
      const bundle = await storage.readBundle(artifact.id, artifact.currentBundleHash);
      const nonce = randomBytes(16).toString('base64');
      const css = bundle.css.replace(/<\/style/gi, '\\3c /style');
      const js = bundle.js.replace(/<\/script/gi, '<\\/script');
      const html = bundle.html.replace(/<meta\b[^>]*\bhttp-equiv\s*=\s*(?:"refresh"|'refresh'|refresh)[^>]*>/gi, '');
      const bootstrap = `(()=>{const n=${JSON.stringify(nonce)},p=new Map;let i=0;const rhythm=Object.freeze({request:(method,params)=>new Promise((resolve,reject)=>{const id=String(++i);p.set(id,{resolve,reject});RhythmBridge.postMessage(JSON.stringify({id,method,params,nonce:n}));})});const blocked=r=>rhythm.request("host.blocked",r);addEventListener("submit",()=>blocked("form"),true);addEventListener("click",e=>{const t=e.target;if(t?.matches?.('input[type=file]'))blocked("file");if(t?.closest?.('a[download]'))blocked("download");},true);Object.defineProperty(window,"rhythm",{value:rhythm,writable:false,configurable:false});Object.defineProperty(window,"__rhythmHostResponse",{value:function(x){if(!x||x.n!==n||typeof x.id!=="string")return;const q=p.get(x.id);if(!q)return;p.delete(x.id);x.ok?q.resolve(x.data):q.reject(x.error);},writable:false,configurable:false});})();`;
      const documentPolicy = "default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; style-src 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; font-src https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com data:; img-src data: blob: https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; media-src data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'";
      const head = `<meta http-equiv="Content-Security-Policy" content="${documentPolicy}">${/<meta\s+charset\b/i.test(html) ? '' : '<meta charset="utf-8">'}<script>${bootstrap}</script>${css ? `<style>${css}</style>` : ''}`;
      const scripts = js ? `<script>${js}</script>` : '';
      const appendScripts = (value: string) => /<\/body\s*>/i.test(value) ? value.replace(/<\/body\s*>/i, `${scripts}</body>`) : `${value}${scripts}`;
      const document = /^\s*(?:<!doctype\b|<html\b)/i.test(html)
        ? /<head\b[^>]*>/i.test(html)
          ? appendScripts(html.replace(/<head\b[^>]*>/i, `$&${head}`))
          : appendScripts(html.replace(/<html\b[^>]*>/i, `$&<head>${head}</head>`))
        : `<!doctype html><html><head>${head}</head><body>${html}${scripts}</body></html>`;
      res.set({
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `sandbox allow-scripts; ${documentPolicy}; frame-ancestors 'none'`,
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      res.send(document);
    } catch (error) { next(error); }
  }
  async patch(req: Request, res: Response, next: NextFunction) { try { const artifact = await this.owner(req); const title = req.body?.title; if (title !== undefined && (typeof title !== 'string' || !title.trim())) throw AppError.badRequest('title must be non-empty'); const declared = req.body?.declaredCapabilities; if (declared !== undefined && (!Array.isArray(declared) || declared.some((item) => !capabilities.includes(item)))) throw AppError.badRequest('unsupported capability'); res.json(publicArtifact(await repo.metadata(artifact.id, title?.trim(), req.body?.visibility === undefined ? undefined : visibility(req.body.visibility), declared, req.auth!.user.id))); } catch (error) { next(error); } }
  async getCollaborators(req: Request, res: Response, next: NextFunction) { try { const artifact = await this.owner(req); res.json((await repo.collaborators(artifact.id)).map((userId) => ({ userId }))); } catch (error) { next(error); } }
  async addCollaborator(req: Request, res: Response, next: NextFunction) { try { const artifact = await this.owner(req); const userId = integer(req.body?.userId, 'userId'); if (!await repo.isWorkspaceMember(artifact.workspaceId, userId)) throw AppError.badRequest('collaborator must be a workspace member'); await repo.addCollaborator(artifact.id, userId, req.auth!.user.id); res.status(201).json({ userId }); } catch (error) { next(error); } }
  async deleteCollaborator(req: Request, res: Response, next: NextFunction) { try { const artifact = await this.owner(req); await repo.removeCollaborator(artifact.id, integer(Number(req.params.userId), 'userId')); res.status(204).send(); } catch (error) { next(error); } }
  async updateBundle(req: Request, res: Response, next: NextFunction) { try { const artifact = await this.readable(req); if (artifact.deletedAt) return this.tombstone(res); const expected = integer(req.body?.expectedBundleRevision, 'expectedBundleRevision'); const bundle = storage.validateBundle(req.body?.bundle); const contentHash = storage.bundleHash(bundle); await storage.publishBundle(artifact.id, contentHash, bundle); const updated = await repo.updateContent(artifact.id, 'bundle', expected, contentHash, req.auth!.user.id); if (!updated) return res.status(409).json({ error: { code: 'CONFLICT', message: 'stale bundle revision' }, currentBundleRevision: (await repo.find(artifact.id))?.currentBundleRevision }); res.json(publicArtifact(updated)); } catch (error) { next(error); } }
  async updateState(req: Request, res: Response, next: NextFunction) { try { const artifact = await this.readable(req); if (artifact.deletedAt) return this.tombstone(res); const expected = integer(req.body?.expectedStateRevision, 'expectedStateRevision'); const state = storage.validateState(req.body?.state); const contentHash = storage.stateHash(state); await storage.publishState(artifact.id, contentHash, state); const updated = await repo.updateContent(artifact.id, 'state', expected, contentHash, req.auth!.user.id); if (!updated) return res.status(409).json({ error: { code: 'CONFLICT', message: 'stale state revision' }, currentStateRevision: (await repo.find(artifact.id))?.currentStateRevision }); res.json(publicArtifact(updated)); } catch (error) { next(error); } }
  async remove(req: Request, res: Response, next: NextFunction) { try { const artifact = await this.owner(req); await repo.softDelete(artifact.id, req.auth!.user.id); res.status(204).send(); } catch (error) { next(error); } }
}
