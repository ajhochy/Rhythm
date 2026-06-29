import http from 'http';
import path from 'path';
import { config as loadDotenv } from 'dotenv';
import { opencodeClient } from './services/opencode_engine';
import { managedChromeService } from './services/managed_chrome_service';

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
    { startMemoryVaultSyncJob },
  ] = await Promise.all([
    import('./app'),
    import('./database/db'),
    import('./jobs/recurrence_generation_job'),
    import('./jobs/sync_orchestrator_job'),
    import('./utils/logger'),
    import('./services/ws_gateway'),
    import('./services/agentSchedulerService'),
    import('./services/agentMemoryService'),
    import('./jobs/memory_vault_sync_job'),
  ]);

  const port = Number(process.env.PORT ?? 4000);

  await initDb();
  logger.info('Database initialized');

  const recurrenceJob = startRecurrenceGenerationJob();
  const syncJob = startSyncOrchestratorJob();

  // #755 — gate all agent-EXECUTION startup (scheduler, opencode SDK, managed
  // Chrome, WS gateway, skill/memory seeds, plugin config) behind the
  // deployment role. The 'cloud' role omits this entire block so a hosted
  // production API never attempts `spawn opencode`, never ticks the scheduler,
  // and never attaches the WS gateway. The DEFAULT ('all') preserves today's
  // behavior. `agentSchedulerJob`/`wss` stay declared (nullable / no-op WSS)
  // so the single shutdown handler below remains valid in every role.
  const { env } = await import('./config/env');
  let agentSchedulerJob: { stop: () => void } | null = null;
  // Issue #770 WI6: the Memory-Vault mirror-sync writes into agent_memory, so it
  // is an agent-execution surface and is gated with the rest. Declared nullable
  // here so the shutdown handler's `memoryVaultSyncJob?.stop()` stays valid in
  // the 'cloud' role where the job is never started.
  let memoryVaultSyncJob: { stop: () => void } | null = null;

  if (env.agentExecutionEnabled) {
    // Issue #805: rebuild the DERIVED memory index from the vault ONCE on
    // startup so a fresh boot has a correct, search-ready index without waiting
    // for the first cron tick. The vault (not this SQLite store) is the source
    // of truth; the index is disposable and fully reproducible from a scan.
    // No-op when the vault is absent. Non-fatal — a rebuild failure must never
    // block startup. (SQLite-only; rebuildIndexFromVault is a no-op on Postgres.)
    try {
      const { MemoryIndexService } = await import('./services/memory_index_service');
      const summary = await new MemoryIndexService().rebuildIndexFromVault();
      logger.info(`[server] memory index rebuilt on startup: indexed=${summary.indexed}`);
    } catch (err) {
      logger.warn(`[server] memory index startup rebuild failed (non-fatal): ${String(err)}`);
    }

    // Issue #770 WI6: mirror the dedicated Memory-Vault into agent_memory so the
    // Rhythm Brain panel displays vault contents. No-op when the vault is absent.
    // The */10min cron also keeps the derived index fresh as users edit notes in
    // Obsidian (vault→index re-index pass — #805 AC3/AC4).
    memoryVaultSyncJob = startMemoryVaultSyncJob();

    // Agent subsystem: scheduler + memory consolidation seed
    agentSchedulerJob = startAgentSchedulerJob();
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
  } else {
    logger.info(
      `[server] RHYTHM_ROLE=${env.role} — agent execution disabled (no scheduler, opencode, WS gateway, or managed Chrome)`,
    );
  }

  const app = createApp();

  const httpServer = http.createServer(app);
  // WS gateway is an agent-execution surface (#755). In the 'cloud' role we
  // create a no-op WSS so `wss.close()` in the shutdown handler is still valid,
  // but never attach the upgrade/connection handlers.
  const wss = env.agentExecutionEnabled
    ? attachWsGateway(httpServer)
    : new (await import('ws')).WebSocketServer({ noServer: true });

  if (env.agentExecutionEnabled) {
    // Make sure the community auth plugins are listed in opencode.json before
    // we spawn the SDK subprocess. The plugins extend the provider catalog
    // so direct routing to anthropic / google works once the user has
    // authed via the corresponding flow.
    try {
      const { ensureRequiredPlugins } = await import(
        './services/opencode_plugin_config'
      );
      ensureRequiredPlugins();
      // Unify-2 — register the Rhythm-managed skills dir in opencode.json
      // (additive) so the fork scans it. Done before spawn so it is live
      // without a runtime reload; runtime writes use reloadSkills().
      const { ensureManagedSkillsDirRegistered } = await import(
        './services/rhythm_managed_skills'
      );
      ensureManagedSkillsDirRegistered();
    } catch (err) {
      console.warn(
        '[Opencode] Plugin config update failed (non-fatal):',
        err,
      );
    }

    // #748 — Start managed headless Chrome on :9222 (non-blocking, failure-tolerant).
    // Controlled by RHYTHM_MANAGED_CHROME env var: set to "0" or "false" to disable.
    const chromeManagementEnabled =
      process.env.RHYTHM_MANAGED_CHROME !== '0' &&
      process.env.RHYTHM_MANAGED_CHROME !== 'false';
    if (chromeManagementEnabled) {
      managedChromeService.ensureReady()
        .then(() => {
          if (managedChromeService.isReady) {
            // Set env vars on the process so any subsequently spawned subprocesses
            // (including the opencode engine and its bash tool) inherit them.
            managedChromeService.setProcessEnvVars();
            logger.info('[server] Managed Chrome ready — CDP env vars set on process.env');
          }
        })
        .catch((err) => {
          logger.warn(`[server] Managed Chrome startup failed (non-fatal): ${String(err)}`);
        });
    } else {
      logger.info('[server] RHYTHM_MANAGED_CHROME=0 — skipping managed Chrome');
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
  }

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
    try { memoryVaultSyncJob?.stop(); } catch (_) { /* ignore */ }
    try { agentSchedulerJob?.stop(); } catch (_) { /* ignore */ }

    // 2. Dispose the Opencode SDK subprocess.
    try { opencodeClient.dispose(); } catch (_) { /* ignore */ }

    // 2b. Shut down managed Chrome (no-op if Chrome was reused / not spawned).
    try { managedChromeService.shutdown(); } catch (_) { /* ignore */ }

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
