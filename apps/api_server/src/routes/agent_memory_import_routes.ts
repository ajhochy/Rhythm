import { json, Router, type NextFunction, type Request, type Response } from 'express';
import { createObservationImportController } from '../controllers/agent_memory_import_controller';
import { MemoryCreateOnlyError } from '../services/memoryVaultWriteService';
import { env } from '../config/env';

function loopback(req: Request) { const a = req.socket.remoteAddress; return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'; }
export function createAgentMemoryImportRouter(options: { executionLocal: boolean; originGuardEnabled: boolean; importObservation?: Parameters<typeof createObservationImportController>[0] }) {
  const router = Router(); const controller = createObservationImportController(options.importObservation);
  // This is intentionally route-scoped: parent integration must mount this
  // factory before any broad JSON parser so chunked/lying Content-Length bodies
  // are bounded while the stream is read, not merely after DTO allocation.
  router.post('/import-observation', (req, res, next) => { const length = Number(req.get('content-length')); return Number.isFinite(length) && length > 16 * 1024 ? res.status(413).json({ code: 'INVALID_OBSERVATION_IMPORT' }) : next(); }, json({ limit: '16kb', strict: true }), async (req, res) => {
    if (!options.executionLocal || !options.originGuardEnabled || !loopback(req)) return res.status(403).json({ code: 'LOCAL_ONLY' });
    const host = req.get('host')?.split(':')[0]; const origin = req.get('origin'); const allowedOrigins = new Set(env.localRendererOrigins);
    const fetchSite = req.get('sec-fetch-site'); if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1' || (fetchSite && fetchSite !== 'none' && fetchSite !== 'same-origin') || (origin && !allowedOrigins.has(origin))) return res.status(403).json({ code: 'FORBIDDEN_ORIGIN' });
    try { const receipt = await controller(req.body); return res.status(receipt.disposition === 'created' ? 201 : 200).json(receipt); }
    catch (error) { if (error instanceof MemoryCreateOnlyError) return res.status(error.code === 'MEMORY_CREATE_CONFLICT' ? 409 : error.code === 'MEMORY_CREATE_UNAVAILABLE' ? 503 : 400).json({ code: error.code === 'MEMORY_CREATE_CONFLICT' ? 'OBSERVATION_IMPORT_CONFLICT' : error.code === 'MEMORY_CREATE_UNAVAILABLE' ? 'OBSERVATION_IMPORT_UNCERTAIN' : 'INVALID_OBSERVATION_IMPORT' }); return res.status(400).json({ code: 'INVALID_OBSERVATION_IMPORT' }); }
  });
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    const type = (error as { type?: string })?.type;
    if (type === 'entity.too.large') return res.status(413).json({ code: 'INVALID_OBSERVATION_IMPORT' });
    if (type === 'entity.parse.failed') return res.status(400).json({ code: 'INVALID_OBSERVATION_IMPORT' });
    return next(error);
  });
  return router;
}
