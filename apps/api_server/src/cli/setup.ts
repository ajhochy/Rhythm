import { formatDoctorReport } from './doctor';
import { createReadlinePromptIO, type PromptIO } from './setup/prompts';
import { runSetup, type SetupMode } from './setup/run_setup';

/** Parses `rhythm setup [--quick|--full|--blank-slate]`. */
export function parseSetupArgs(args: string[]): { mode: SetupMode | 'blank-slate' | null } {
  if (args.includes('--blank-slate')) return { mode: 'blank-slate' };
  if (args.includes('--quick')) return { mode: 'quick' };
  if (args.includes('--full')) return { mode: 'full' };
  return { mode: null };
}

async function chooseMode(io: PromptIO): Promise<SetupMode | 'blank-slate'> {
  io.info('How would you like to set up Rhythm?');
  io.info('  1) Quick  — fastest path, sensible defaults (recommended)');
  io.info('  2) Full   — walk through every integration');
  io.info('  3) Blank Slate — minimal, fully-controlled deployment (#879)');
  const answer = await io.ask('Enter 1, 2, or 3:');
  if (answer.trim() === '2') return 'full';
  if (answer.trim() === '3') return 'blank-slate';
  return 'quick';
}

/** CLI entry point for `rhythm setup`. */
export async function runSetupCli(args: string[]): Promise<void> {
  const { mode: flagMode } = parseSetupArgs(args);
  const io = createReadlinePromptIO();

  try {
    const mode = flagMode ?? (await chooseMode(io));

    if (mode === 'blank-slate') {
      const { runBlankSlateCli } = await import('./setup/blank_slate_mode');
      await runBlankSlateCli(io);
      return;
    }

    const result = await runSetup({ mode, io });

    if (result.doctorReport) {
      io.info('');
      io.info('Running `rhythm doctor` to confirm everything is working...');
      io.info(formatDoctorReport(result.doctorReport));
      process.exitCode = result.doctorReport.exitCode;
    }
  } finally {
    io.close();
  }
}
