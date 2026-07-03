import type { DoctorReport } from '../doctor';
import { runDoctor as realRunDoctor } from '../doctor';
import {
  DEFAULT_DETECT_DEPS,
  detectExistingConfig,
  type DetectExistingConfigDeps,
} from './detect_existing_config';
import { runFullMode } from './full_mode';
import type { PromptIO } from './prompts';
import { runQuickMode } from './quick_mode';
import { defaultEnvPath, defaultWriteEnvConfigDeps, writeEnvConfig as realWriteEnvConfig } from './write_env_config';

export type SetupMode = 'quick' | 'full';

export interface RunSetupOptions {
  mode: SetupMode;
  io: PromptIO;
  detectDeps?: DetectExistingConfigDeps;
  writeEnvConfig?: typeof realWriteEnvConfig;
  runDoctor?: typeof realRunDoctor;
}

export interface RunSetupResult {
  mode: SetupMode;
  valuesWritten: Record<string, string>;
  doctorReport?: DoctorReport;
}

/**
 * #872 — orchestrates the full `rhythm setup` flow:
 *   1. Detect existing config (env / .env / opencode.json) so nothing already
 *      set is re-asked.
 *   2. Run the selected mode's interactive collection (Quick or Full).
 *   3. Write ONLY the newly-collected values to `.env` (0600 perms, atomic
 *      write — see write_env_config.ts). Skipped entirely when there is
 *      nothing new — the acceptance criterion "partial progress is not
 *      written until a step completes cleanly" means the wizard never
 *      writes until collection has FULLY succeeded; if collection throws
 *      (Ctrl+C) this function propagates the throw and `writeEnvConfig` is
 *      never called, leaving any existing `.env` byte-for-byte unchanged.
 *   4. Run `rhythm doctor` as the final verification step.
 */
export async function runSetup(options: RunSetupOptions): Promise<RunSetupResult> {
  const { mode, io } = options;
  const detectDeps: DetectExistingConfigDeps = options.detectDeps ?? {
    env: process.env,
    ...DEFAULT_DETECT_DEPS,
  };
  const writeEnvConfigFn = options.writeEnvConfig ?? realWriteEnvConfig;
  const runDoctorFn = options.runDoctor ?? realRunDoctor;

  const detected = detectExistingConfig(detectDeps);

  // Collection happens FIRST and entirely in-memory. If this throws (e.g. the
  // scripted/real IO layer surfaces a SIGINT as a rejected promise), nothing
  // below runs — no write, no doctor — satisfying "Ctrl+C does not corrupt
  // config" by construction rather than via a try/catch that swallows it.
  const { values } = mode === 'quick' ? await runQuickMode({ io, detected }) : await runFullMode({ io, detected });

  if (Object.keys(values).length > 0) {
    const path = defaultEnvPath();
    await writeEnvConfigFn(values, defaultWriteEnvConfigDeps(path));
  }

  const doctorReport = await runDoctorFn();

  return { mode, valuesWritten: values, doctorReport };
}
