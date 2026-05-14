import { Router, Request, Response } from 'express';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { opencodeClient } from '../services/opencode_engine';
import { CredentialsBridgeService } from '../services/credentials_bridge_service';

export const opencodeAuthRouter = Router();

const credentialsBridge = new CredentialsBridgeService();
export { credentialsBridge };

// GET / — List connected provider IDs
opencodeAuthRouter.get('/', async (_req: Request, res: Response) => {
  if (!opencodeClient.isReady) {
    res.json({ providers: [], ready: false });
    return;
  }
  const providers = await opencodeClient.listAuthedProviders();
  res.json({ providers, ready: true });
});

// GET /auth/:provider/authorize — Start OAuth flow (return auth URL)
opencodeAuthRouter.get('/:provider/authorize', async (req: Request, res: Response) => {
  const { provider } = req.params;

  if (!opencodeClient.isReady) {
    res.status(503).json({ error: 'Opencode engine not ready' });
    return;
  }

  const oauthResult = await opencodeClient.getOAuthUrl(provider, 0);
  if (!oauthResult) {
    res.status(500).json({ error: `Failed to get OAuth URL for ${provider}` });
    return;
  }

  // getOAuthUrl returns { error } when the SDK throws (e.g. provider not found,
  // OAuth not supported for this provider, SDK not ready yet)
  if ('error' in oauthResult) {
    res.status(500).json({ error: oauthResult.error });
    return;
  }

  res.json({
    provider,
    authUrl: oauthResult.url,
    method: oauthResult.method,
    instructions: oauthResult.instructions,
    message: `Open this URL in your browser to authorize ${provider}`,
  });
});

// GET /auth/:provider/callback — Handle OAuth callback
opencodeAuthRouter.get('/:provider/callback', async (req: Request, res: Response) => {
  const { provider } = req.params;
  const code = req.query.code as string | undefined;

  if (!code) {
    res.status(400).json({ error: 'OAuth authorization code is required' });
    return;
  }

  if (!opencodeClient.isReady) {
    res.status(503).json({ error: 'Opencode engine not ready' });
    return;
  }

  const success = await opencodeClient.handleOAuthCallback(provider, code);
  if (success) {
    res.json({ success: true, provider, message: 'Provider authorized successfully' });
  } else {
    res.status(500).json({ error: 'Failed to complete OAuth authorization' });
  }
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

// GET /sources — Report whether Claude Code or Codex credentials are available
opencodeAuthRouter.get('/sources', (_req: Request, res: Response) => {
  res.json({
    claudeCode: credentialsBridge.hasClaudeCode(),
    codex: existsSync(join(homedir(), '.codex', 'auth.json')),
  });
});

// POST /anthropic/bridge — Bridge Claude Code OAuth tokens into the SDK
opencodeAuthRouter.post('/anthropic/bridge', async (_req: Request, res: Response) => {
  if (!opencodeClient.isReady) {
    res.status(503).json({ success: false, reason: 'sdk_not_ready' });
    return;
  }
  const result = await credentialsBridge.bridgeAnthropic(opencodeClient);
  if (result.success) {
    res.json(result);
    return;
  }
  const status =
    result.reason === 'keychain_denied'
      ? 401
      : result.reason === 'sdk_not_ready'
        ? 503
        : 500;
  res.status(status).json(result);
});
