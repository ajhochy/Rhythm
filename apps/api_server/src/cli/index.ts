#!/usr/bin/env node
/**
 * #871/#872/#879 — `rhythm` CLI entry point. This module deliberately does
 * NOT import `server.ts` or bootstrap the Express app — subcommands (doctor,
 * setup) each only pull in the standalone check/wizard modules they need.
 */

async function main(): Promise<void> {
  // Load .env from cwd (the same location write_env_config.ts's
  // defaultEnvPath() writes to) into process.env BEFORE dispatching to any
  // subcommand. This is what lets `rhythm setup`'s final `rhythm doctor`
  // verification step see a key just written in the SAME process — without
  // it, `checkApiKeys` would only see values already present in the shell's
  // environment, not ones this run just persisted to disk. Mirrors
  // server.ts's own `loadDotenv` call; done here (not at module load) so
  // importing doctor.ts/setup.ts for tests stays side-effect-free.
  const { config: loadDotenv } = await import('dotenv');
  loadDotenv();

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
