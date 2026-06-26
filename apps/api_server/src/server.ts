import http from 'http';
import path from 'path';
import { config as loadDotenv } from 'dotenv';
import { opencodeClient } from './services/opencode_engine';

// Load .env from the api_server root (one level above dist/).
// CI writes OAuth secrets here before bundling into the .app.
loadDotenv({ path: path.join(__dirname, '..', '.env') });

async function main() {
  const [
    { createApp },
    { initDb },
    { startRecurrenceGenerationJob },
    { startSyncOrchestratorJob },
    { logger },
    { attachWsGateway },
    { startAgentSchedulerJob },
    { agentMemoryService },
  ] = await Promise.all([
    import('./app'),
    import('./database/db'),
    import('./jobs/recurrence_generation_job'),
    import('./jobs/sync_orchestrator_job'),
    import('./utils/logger'),
    import('./services/ws_gateway'),
    import('./services/agentSchedulerService'),
    import('./services/agentMemoryService'),
  ]);

  const port = Number(process.env.PORT ?? 4000);

  await initDb();
  logger.info('Database initialized');

  const recurrenceJob = startRecurrenceGenerationJob();
  const syncJob = startSyncOrchestratorJob();

  // Agent subsystem: scheduler + memory consolidation seed
  const agentSchedulerJob = startAgentSchedulerJob();
  agentMemoryService.seedConsolidationTask().catch((err) => {
    logger.warn(`[server] Memory consolidation seed failed (non-fatal): ${String(err)}`);
  });

  // One-time seed of vetted agent-stack skills into agent_skills (local SQLite
  // only). Guarded by a zero-count check on source='agent-stack-seed' so it
  // never re-imports. Non-fatal — a seed failure must never block startup.
  try {
    const { AgentSkillsRepository } = await import(
      './repositories/agent_skills_repository'
    );
    const { seedAgentStackSkills, SEED_SOURCE } = await import(
      './services/skill_seed_importer'
    );
    const skillsRepo = new AgentSkillsRepository();
    const alreadySeeded = skillsRepo
      .list()
      .some((s) => s.source === SEED_SOURCE);
    if (!alreadySeeded) {
      const result = seedAgentStackSkills(skillsRepo);
      logger.info(
        `[server] agent-stack skill seed: discovered=${result.discovered} imported=${result.imported} skipped=${result.skipped}`,
      );
    }
  } catch (err) {
    logger.warn(`[server] agent-stack skill seed failed (non-fatal): ${String(err)}`);
  }

  const app = createApp();

  const httpServer = http.createServer(app);
  const wss = attachWsGateway(httpServer);

  // Make sure the community auth plugins are listed in opencode.json before
  // we spawn the SDK subprocess. The plugins extend the provider catalog
  // so direct routing to anthropic / google works once the user has
  // authed via the corresponding flow.
  try {
    const { ensureRequiredPlugins } = await import(
      './services/opencode_plugin_config'
    );
    ensureRequiredPlugins();
  } catch (err) {
    console.warn(
      '[Opencode] Plugin config update failed (non-fatal):',
      err,
    );
  }

  // Initialize Opencode SDK (non-blocking — logs on failure, never prevents startup)
  opencodeClient
    .initialize()
    .then(async () => {
      // #746 — Notify the skill curator that the engine is ready so it can
      // begin deferring extraction work until the cold-start window passes.
      // Non-fatal: if notifyEngineReady throws for any reason, swallow and log.
      try {
        const readyAt = opencodeClient.engineReadyAt ?? Date.now();
        const { notifyEngineReady } = await import('./services/skill_extractor');
        notifyEngineReady(readyAt);
        logger.info('[server] skill curator cold-start window started');
      } catch (e) {
        logger.warn(`[server] notifyEngineReady failed (non-fatal): ${String(e)}`);
      }

      // #658: auto-bridge Claude Code credentials on launch so the user never
      // has to click "Reconnect" after a normal start. force:true re-reads the
      // keychain fresh; a successful bridge starts the 15-min refresh loop that
      // keeps opencode's token in sync as Claude Code rotates it. No-op when
      // Claude Code isn't installed/signed-in.
      try {
        const { credentialsBridge } = await import('./routes/opencode_auth_routes');
        if (!credentialsBridge.hasClaudeCode()) {
          logger.info('[server] Claude auto-bridge: no Claude Code creds — skipping');
          return;
        }
        const result = await credentialsBridge.bridgeAnthropic(opencodeClient, {
          force: true,
        });
        logger.info(
          `[server] Claude auto-bridge: ${
            result.success ? 'ok' : `failed (${result.reason})`
          }`,
        );
      } catch (e) {
        logger.warn(`[server] Claude auto-bridge errored (non-fatal): ${String(e)}`);
      }
    })
    .catch((err) => {
      console.warn('[Opencode] SDK init failed (non-fatal):', err);
    });

  httpServer.listen(port, () => {
    logger.info(`Rhythm API listening on port ${port}`);
  });

  // #614 — Clean shutdown handler.
  // Registered once here so it applies to both SIGTERM (Flutter kill) and
  // SIGINT (Ctrl-C in dev). The handler is idempotent via the `shuttingDown`
  // guard so double-signals don't race.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[server] ${signal} received — starting clean shutdown`);

    // Mark the opencode engine as intentionally shutting down so its
    // ensureReady() does not attempt to re-initialize during teardown.
    (opencodeClient as unknown as Record<string, unknown>)['_shuttingDown'] = true;

    // 1. Stop cron jobs so no new work is kicked off.
    try { recurrenceJob?.stop(); } catch (_) { /* ignore */ }
    try { syncJob?.stop(); } catch (_) { /* ignore */ }
    try { agentSchedulerJob?.stop(); } catch (_) { /* ignore */ }

    // 2. Dispose the Opencode SDK subprocess.
    try { opencodeClient.dispose(); } catch (_) { /* ignore */ }

    // 3. Close the WebSocket server (no new connections).
    wss.close(() => {
      // 4. Close the HTTP server; fall back to force-exit after 1 s.
      const forceExit = setTimeout(() => {
        logger.info('[server] HTTP close timeout — forcing exit');
        process.exit(0);
      }, 1000);
      // Allow the timeout to be garbage-collected if the server closes cleanly.
      if (forceExit.unref) forceExit.unref();

      httpServer.close(() => {
        logger.info('[server] clean shutdown complete');
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // #614b — Parent-PID watchdog. macOS Cmd+Q routes through NSApp.terminate,
  // which kills the Flutter engine before Dart cleanup can SIGTERM us. The
  // child is then reparented to launchd (ppid=1) and orphans, holding :4001
  // and the opencode subprocess on :4096 indefinitely.
  //
  // Defense-in-depth: ApiServerService passes --parent-pid=<flutter-pid> at
  // spawn time. We probe that PID with signal 0 every 2 s; ESRCH means the
  // root Flutter ancestor is gone regardless of process-chain depth. This
  // fixes the dev-mode gap where Flutter → npx → tsx → Node means process.ppid
  // never becomes 1 from the Node process's perspective. Falls back to the
  // legacy ppid===1 heuristic when the flag is absent (older launcher).
  const parentPidArg = process.argv.find((a) => a.startsWith('--parent-pid='));
  const trackedRootPid = parentPidArg
    ? parseInt(parentPidArg.split('=')[1], 10)
    : process.ppid;
  logger.info(
    `[server] watchdog: ppid=${process.ppid} trackedRootPid=${trackedRootPid} (AGENT_LOCAL=${process.env.AGENT_LOCAL ?? '(unset)'})`,
  );
  const watchdog = setInterval(() => {
    if (trackedRootPid === 1) return; // started as orphan — never self-shutdown
    if (parentPidArg) {
      // --parent-pid path: signal-0 liveness probe
      try {
        process.kill(trackedRootPid, 0);
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code === 'ESRCH') {
          logger.info(
            `[server] tracked parent ${trackedRootPid} is gone (ESRCH) — self-shutdown (watchdog)`,
          );
          shutdown('PARENT_GONE');
        }
        // EPERM: process exists, no permission to signal — treat as alive
      }
    } else {
      // Legacy ppid===1 path (no --parent-pid flag, e.g. older launcher)
      if (process.ppid === 1) {
        logger.info(
          `[server] ppid became 1 (orphaned to launchd) — self-shutdown (watchdog)`,
        );
        shutdown('PARENT_GONE');
      }
    }
  }, 2000);
  if (typeof watchdog.unref === 'function') watchdog.unref();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
