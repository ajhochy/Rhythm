import { Router, type RequestHandler } from 'express';
import { opencodeClient } from '../services/opencode_engine';
import { CustomProviderError, CustomProviderService, type CustomProviderRuntime } from '../services/custom_provider_service';

export function createOpencodeProvidersRouter(runtime: CustomProviderRuntime = opencodeClient): Router {
  const router = Router();
  const service = new CustomProviderService(runtime);

  const handle = (operation: 'test' | 'save'): RequestHandler => async (req, res) => {
    try {
      const result = await service[operation](req.body);
      res.status('pending' in result && result.pending ? 202 : 200).json(result);
    } catch (error) {
      if (error instanceof CustomProviderError) {
        res.status(error.status).json({ error: error.code, message: error.message });
        return;
      }
      res.status(500).json({ error: 'provider_save_failed', message: 'The provider could not be saved safely.' });
    }
  };

  router.post('/test', handle('test'));
  router.put('/', handle('save'));
  return router;
}

export const opencodeProvidersRouter = createOpencodeProvidersRouter();
