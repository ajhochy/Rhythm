import { exec } from 'child_process';
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth_middleware';
import { env } from '../config/env';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { shlexSplit } from '../services/pty_runner';

export const agentsCapabilitiesRouter = Router();

if (!env.agentLocal) agentsCapabilitiesRouter.use(requireAuth);

function detectBinary(name: string): Promise<boolean> {
  return new Promise((resolve) => {
    exec(`/bin/zsh -l -c "which ${name}"`, (error, stdout) => {
      if (error || !stdout.trim()) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

async function probeConfigs(): Promise<Record<string, boolean>> {
  const repo = new AgentConfigsRepository();
  const configs = repo.listEnabled();

  const results = await Promise.all(
    configs.map(async (config) => {
      const parts = shlexSplit(config.command);
      const binaryName = parts[0] ?? '';
      if (!binaryName) return { id: config.id, available: false };
      const available = await detectBinary(binaryName);
      return { id: config.id, available };
    }),
  );

  return Object.fromEntries(results.map(({ id, available }) => [id, available]));
}

agentsCapabilitiesRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const capabilities = await probeConfigs();
    res.json(capabilities);
  } catch (err) {
    console.error('[agents/capabilities] Unexpected error during detection:', err);
    res.json({});
  }
});

agentsCapabilitiesRouter.post('/refresh', async (_req: Request, res: Response) => {
  try {
    const capabilities = await probeConfigs();
    res.json(capabilities);
  } catch (err) {
    console.error('[agents/capabilities] Unexpected error during refresh:', err);
    res.json({});
  }
});
