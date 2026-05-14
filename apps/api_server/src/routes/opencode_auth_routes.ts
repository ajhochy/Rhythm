import { Router, Request, Response } from 'express';
import { opencodeClient } from '../services/opencode_engine';

export const opencodeAuthRouter = Router();

// GET / — List connected provider IDs
opencodeAuthRouter.get('/', async (_req: Request, res: Response) => {
  if (!opencodeClient.isReady) {
    res.json({ providers: [], ready: false });
    return;
  }
  const providers = await opencodeClient.listProviders();
  res.json({ providers, ready: true });
});

// GET /auth/:provider/authorize — Start OAuth flow (return auth URL)
opencodeAuthRouter.get('/:provider/authorize', (req: Request, res: Response) => {
  const { provider } = req.params;
  res.json({
    provider,
    authUrl: `https://opencode.ai/auth/${provider}`,
    message: `Open this URL in your browser to authorize ${provider}`,
  });
});

// GET /auth/:provider/callback — Handle OAuth callback
opencodeAuthRouter.get('/:provider/callback', (req: Request, res: Response) => {
  const { provider } = req.params;
  // In a full implementation, the Opencode SDK's OAuth method provides the callback URL
  res.json({ success: true, provider, message: 'Provider authorized' });
});

// POST /auth/:provider — Set API key directly
opencodeAuthRouter.post('/:provider', async (req: Request, res: Response) => {
  const { provider } = req.params;
  const { apiKey } = req.body as { apiKey?: string };

  if (!apiKey) {
    res.status(400).json({ error: 'apiKey is required' });
    return;
  }

  if (!opencodeClient.isReady) {
    res.status(503).json({ error: 'Opencode engine not ready' });
    return;
  }

  const success = await opencodeClient.setAuth(provider, apiKey);
  if (success) {
    res.json({ success: true, message: `API key stored for ${provider}` });
  } else {
    res.status(500).json({ error: 'Failed to store API key' });
  }
});
