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
  ] = await Promise.all([
    import('./app'),
    import('./database/db'),
    import('./jobs/recurrence_generation_job'),
    import('./jobs/sync_orchestrator_job'),
    import('./utils/logger'),
    import('./services/ws_gateway'),
  ]);

  const port = Number(process.env.PORT ?? 4000);

  await initDb();
  logger.info('Database initialized');

  const recurrenceJob = startRecurrenceGenerationJob();
  const syncJob = startSyncOrchestratorJob();

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
  opencodeClient.initialize().catch((err) => {
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

    // 1. Stop cron jobs so no new work is kicked off.
    try { recurrenceJob?.stop(); } catch (_) { /* ignore */ }
    try { syncJob?.stop(); } catch (_) { /* ignore */ }

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
  // Defense-in-depth: poll our own ppid; if it becomes 1 after starting with
  // a non-1 parent, run the clean shutdown sequence. This works no matter
  // how the parent dies (Cmd+Q, force-quit, crash) and is independent of any
  // platform-specific window-manager hook.
  const originalParentPid = process.ppid;
  const watchdog = setInterval(() => {
    if (originalParentPid !== 1 && process.ppid === 1) {
      logger.info(
        `[server] parent ${originalParentPid} died (now orphaned to launchd) — self-shutdown`,
      );
      shutdown('PARENT_GONE');
    }
  }, 2000);
  if (typeof watchdog.unref === 'function') watchdog.unref();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
