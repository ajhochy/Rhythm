import { exec } from 'child_process';
import { Router, Request, Response } from 'express';

export const agentsCapabilitiesRouter = Router();

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

agentsCapabilitiesRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const [claude, codex] = await Promise.all([
      detectBinary('claude'),
      detectBinary('codex'),
    ]);
    res.json({ claude, codex });
  } catch (err) {
    console.error('[agents/capabilities] Unexpected error during detection:', err);
    res.json({ claude: false, codex: false });
  }
});
