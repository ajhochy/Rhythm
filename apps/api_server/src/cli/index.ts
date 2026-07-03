#!/usr/bin/env node
/**
 * #871/#872/#879 — `rhythm` CLI entry point. This module deliberately does
 * NOT import `server.ts` or bootstrap the Express app — subcommands (doctor,
 * setup) each only pull in the standalone check/wizard modules they need.
 */

async function main(): Promise<void> {
  const [, , subcommand, ...rest] = process.argv;

  switch (subcommand) {
    case 'doctor': {
      const { runDoctorCli } = await import('./doctor');
      await runDoctorCli();
      return;
    }
    case 'setup': {
      const { runSetupCli } = await import('./setup');
      await runSetupCli(rest);
      return;
    }
    default: {
      // eslint-disable-next-line no-console
      console.log('Usage: rhythm <doctor|setup> [options]');
      process.exitCode = 1;
    }
  }
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
