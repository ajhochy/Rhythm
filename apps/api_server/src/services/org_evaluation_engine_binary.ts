import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/** Same pinned bundle locations used by normal engine startup. Evaluation
 * never falls back to a potentially unpatched global executable on PATH. */
export function resolveEvaluationEngineBinary(options: {
  servicesDirectory?: string;
  environment?: NodeJS.ProcessEnv;
} = {}): string {
  const environment = options.environment ?? process.env;
  const services = options.servicesDirectory ?? __dirname;
  const explicitBinary = environment.RHYTHM_OPENCODE_BIN?.trim();
  const explicitDirectory = environment.RHYTHM_OPENCODE_BIN_DIR?.trim();
  const candidates = explicitBinary ? [explicitBinary] : explicitDirectory
    ? [join(explicitDirectory, 'opencode')]
    : [join(services, '..', '..', '..', 'opencode_bin', 'opencode'),
      join(services, '..', '..', 'opencode_bin', 'opencode')];
  for (const candidate of candidates) {
    try {
      if (!isAbsolute(candidate)) continue;
      const binary = realpathSync(candidate);
      if (!statSync(binary).isFile()) continue;
      accessSync(binary, constants.X_OK);
      return binary;
    } catch { /* no stock PATH fallback */ }
  }
  throw new Error('Bounded evaluation requires an executable pinned OpenCode fork binary in the app bundle or RHYTHM_OPENCODE_BIN[_DIR]');
}
