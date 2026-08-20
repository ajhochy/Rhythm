import http from 'http';
import path from 'path';
import { config as loadDotenv } from 'dotenv';
import { Agent as UndiciAgent, setGlobalDispatcher } from 'undici';
import { opencodeClient } from './services/opencode_engine';
import { managedChromeService } from './services/managed_chrome_service';
import { MobilePtyProxy } from './services/mobile_pty_proxy';
import { runAdvisoryCheck, formatStartupWarning } from './security/security_advisories';
import { env } from './config/env';
import { validateHumanApprovalConfiguration } from './security/human_approval_security';

// Load .env before deriving the AgentRunner transport guard below.
// CI writes OAuth secrets here before bundling into the .app.
loadDotenv({ path: path.join(__dirname, '..', '.env') });

// #1039 Cause B / R4 — Node's built-in fetch (undici) aborts any request whose
// response HEADERS haven't arrived within ~300s (UND_ERR_HEADERS_TIMEOUT).
// The headless AgentRunner path issues ONE synchronous session.prompt HTTP
// call that blocks server-side for the WHOLE model turn. Keep this transport
// guard five minutes beyond the configured hard ceiling so it can never
// preempt AgentRunner's progress-aware policy. It remains finite.
const configuredAgentRunHardTimeoutMs = Number(
  process.env.AGENT_RUN_HARD_TIMEOUT_MS ?? 3_600_000,
);
const agentRunHardTimeoutMs =
  Number.isFinite(configuredAgentRunHardTimeoutMs) &&
  configuredAgentRunHardTimeoutMs > 0
    ? configuredAgentRunHardTimeoutMs
    : 3_600_000;
const agentRunTransportTimeoutMs = agentRunHardTimeoutMs + 300_000;
setGlobalDispatcher(
  new UndiciAgent({
    headersTimeout: agentRunTransportTimeoutMs,
    bodyTimeout: agentRunTransportTimeoutMs,
  }),
);

async function main() {
  const {
    apiServerLogPath,
    installPersistentConsoleLogging,
  } = await import('./utils/logger');
  installPersistentConsoleLogging();

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
    { sundayPrepService },
    { createMobileGatewayRouter },
    { createMobileGatewaySurface },
    { mobileGatewayListenPort },
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
    import('./services/sundayPrepService'),
    import('./routes/mobile_gateway_routes'),
    import('./mobile_gateway_surface'),
    import('./mobile_gateway_config'),
  ]);

  logger.info(`[server] durable log: ${apiServerLogPath()}`);

  const port = Number(process.env.PORT ?? 4000);
  // #1175 — AGENT_LOCAL bypass is safe only behind an explicit IPv4 loopback
  // bind. The config resolver already refuses a non-loopback override; this
  // startup assertion keeps that invariant adjacent to the actual listen().
  const apiBindHost = env.agentLocal ? '127.0.0.1' : env.apiBindHost;
  if (env.agentLocal && apiBindHost !== '127.0.0.1') {
    throw new Error(
      'Refusing AGENT_LOCAL startup on a non-loopback primary API bind',
    );
  }
  try {
    // Direct API development may run without a Flutter parent. Keep the API
    // healthy in that case, but leave approval GET/PATCH fail-closed with 503.
    // The shipping Flutter launcher refuses to start without both values.
    validateHumanApprovalConfiguration({
      capabilitySha256: env.humanApprovalCapabilitySha256,
      publicKey: env.humanApprovalPublicKey,
    });
  } catch (error) {
    logger.warn(
      `[server] human approval verification unavailable; approval decisions are disabled: ${String(error)}`,
    );
  }

  // #877 — supply-chain advisory scan. stdlib-only (no network request),
  // reads the already-resolved package-lock.json; a warning here is the
  // ONLY startup-banner surface until `rhythm doctor` (setup-01) ships.
  // Never blocks or fails startup — a scan failure degrades to silence.
  try {
    const matches = runAdvisoryCheck();
    const warning = formatStartupWarning(matches);
    if (warning) logger.warn(warning);
  } catch (err) {
    logger.warn(`[server] advisory check failed (non-fatal): ${String(err)}`);
  }

  await initDb();

  // #1309 — sweep expired unpinned media at boot and daily. This runs in both
  // local and cloud roles because either can own the configured durable root.
  if (process.env.VITEST !== 'true') {
    const sweepMediaArtifacts = async (): Promise<void> => {
      try {
        const { MediaArtifactStore } = await import('./services/media_artifact_store');
        const result = await new MediaArtifactStore().sweepExpiredArtifacts();
        if (result.removedMetadata > 0) {
          logger.info(
            `[server] media artifact retention: metadata=${result.removedMetadata} bytes=${result.removedBytes}`,
          );
        }
      } catch (error) {
        logger.warn(`[server] media artifact retention failed (non-fatal): ${String(error)}`);
      }
    };
    void sweepMediaArtifacts();
    const mediaRetentionTimer = setInterval(() => void sweepMediaArtifacts(), 86_400_000);
    mediaRetentionTimer.unref();
  }
  logger.info('Database initialized');
  try {
    const { recoverStaleResearchJobs } = await import('./controllers/agentResearchController');
    const recovered = await recoverStaleResearchJobs();
    if (recovered) logger.warn(`[server] marked ${recovered} interrupted research job(s) retryable`);
  } catch (err) {
    logger.warn(`[server] research-job recovery failed (non-fatal): ${String(err)}`);
  }

  const recurrenceJob = startRecurrenceGenerationJob();
  const syncJob = startSyncOrchestratorJob();

  // #755 — gate all agent-EXECUTION startup (scheduler, opencode SDK, managed
  // Chrome, WS gateway, skill/memory seeds, plugin config) behind the
  // deployment role. The 'cloud' role omits this entire block so a hosted
  // production API never attempts `spawn opencode`, never ticks the scheduler,
  // and never attaches the WS gateway. The DEFAULT ('all') preserves today's
  // behavior. `agentSchedulerJob`/`wss` stay declared (nullable / no-op WSS)
  // so the single shutdown handler below remains valid in every role.
  let agentSchedulerJob: { stop: () => void } | null = null;
  // Issue #770 WI6: the Memory-Vault mirror-sync writes into agent_memory, so it
  // is an agent-execution surface and is gated with the rest. Declared nullable
  // here so the shutdown handler's `memoryVaultSyncJob?.stop()` stays valid in
  // the 'cloud' role where the job is never started.
  let memoryVaultSyncJob: { stop: () => void } | null = null;
  // #1096 WP1 — reference to the Engraph manager singleton so the (sync)
  // shutdown handler can stop its managed child process. Nullable for the
  // 'cloud' role, where the agent runtime (and this manager) never starts.
  let engraphManagerRef: { shutdown: () => void } | null = null;
  // Issue #856: watches ~/.local/share/opencode/auth.json and bounces the
  // opencode engine on a genuine credential change (e.g. a Claude account
  // switch), so the engine re-reads fresh tokens instead of 401ing on stale
  // in-memory creds until a full app restart. Declared nullable here (like
  // the jobs above) so the shutdown handler's `?.stop()` stays valid in the
  // 'cloud' role, where the opencode engine — and therefore this watcher —
  // is never started.
  let authCredentialWatcher: { start: () => Promise<void>; stop: () => void } | null =
    null;
  // #856 (reopened, second attempt): reference to the shared credentials
  // bridge singleton, captured once it's imported below, so the shutdown
  // handler can stop the Keychain poll without an async import (the
  // shutdown handler itself is synchronous). Declared nullable here (like
  // the jobs above) so `?.stopKeychainPoll()` stays valid in the 'cloud'
  // role, where the bridge is never imported/started.
  let credentialsBridgeRef: { stopKeychainPoll: () => void } | null = null;
  // Dual-accounts Task B: reference to the accounts service so the (sync)
  // shutdown handler can stop the N-account refresh loop. Nullable for the
  // 'cloud' role where the agent runtime — and this loop — never starts.
  let anthropicAccountsServiceRef: { stopRefreshLoop: () => void } | null = null;

  if (env.agentExecutionEnabled) {
    // Seed and project Researcher before any scheduler or page-launched run can
    // request the `research` engine agent.
    try {
      const { seedResearchProfile } = await import('./services/research_profile_seed');
      seedResearchProfile();
    } catch (err) {
      logger.warn(`[server] research profile seed failed (non-fatal): ${String(err)}`);
    }

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

    // #1096 WP1 — if the user previously enabled the device-local Engraph
    // manager, resume it now. Fire-and-forget: indexing/spawn/health-gating
    // must never block server startup, and any failure just leaves memory
    // retrieval on FTS (see engraph_manager.ts / memory_retrieval.ts).
    try {
      const { engraphManager } = await import('./services/engraph_manager');
      engraphManagerRef = engraphManager;
      engraphManager.ensureStartedIfEnabled();
    } catch (err) {
      logger.warn(`[server] Engraph manager startup failed (non-fatal): ${String(err)}`);
    }

    // Agent subsystem: scheduler + memory consolidation seed
    agentSchedulerJob = startAgentSchedulerJob();
    agentMemoryService.seedConsolidationTask().catch((err) => {
      logger.warn(`[server] Memory consolidation seed failed (non-fatal): ${String(err)}`);
    });
    // Issue #859c — memory-interview bootstrap/refresh flow, seeded alongside
    // the passive consolidation task above.
    agentMemoryService.seedMemoryInterviewTask().catch((err) => {
      logger.warn(`[server] Memory interview seed failed (non-fatal): ${String(err)}`);
    });
    // #896 — Sunday prep, decomposed into 4 bounded specialist scheduled
    // tasks (staggered Saturday 10pm-10:30pm) instead of one unbounded session.
    sundayPrepService.seedSundayPrepTasks().catch((err) => {
      logger.warn(`[server] Sunday prep seed failed (non-fatal): ${String(err)}`);
    });
    // Issue #860 — single-source-of-truth memory: disable a standalone
    // `memory` knowledge-graph MCP if the user's opencode.json has one
    // registered independently of Rhythm, so it never surfaces as a second
    // memory store to an unscoped agent. Never creates a memory entry —
    // only narrows an existing one. Non-fatal — a disable failure must never
    // block startup.
    opencodeClient.disableStandaloneMemoryMcp().catch((err) => {
      logger.warn(`[server] disableStandaloneMemoryMcp failed (non-fatal): ${String(err)}`);
    });

    // #947 — ONE-TIME population of the agent-referenced workflow skills into the
    // sole managed dir (~/.config/opencode/skills). This REPLACES the old
    // recurring agent-stack DB seed: a boot mechanism that re-imported/
    // re-materialized skills from ~/.claude/skills on every start would silently
    // clobber the self-improvement engine's in-place refinements (#929/#959/#969).
    // It runs exactly ONCE — guarded by a DURABLE schema_meta marker that survives
    // skill-row/file deletion (NOT the old source-row-existence check, which
    // re-armed when rows were deleted, #957) — and copies a skill only when it is
    // ABSENT, so an already-present (possibly refined) file is never overwritten.
    // Non-fatal — a failure must never block startup and leaves the marker unset
    // so a later boot retries.
    try {
      const { populateWorkflowSkillsOnce } = await import(
        './services/skill_seed_importer'
      );
      const r = populateWorkflowSkillsOnce();
      if (!r.alreadyDone) {
        logger.info(
          `[server] workflow-skill one-time population: copied=${r.copied} alreadyPresent=${r.alreadyPresent}`,
        );
      }
    } catch (err) {
      logger.warn(`[server] workflow-skill population failed (non-fatal): ${String(err)}`);
    }

    // #977 — the boot DB→file content-materializer (#797 `backfillSkillMetadata`)
    // was retired. Files under the managed skills dir are the SOLE content source;
    // the DB no longer projects legacy `published`/`draft` row bodies into
    // SKILL.md files at boot. Lifecycle metadata attaches to the live file by name
    // via the #792 sidecar, not a content backfill.

    // One-time grant of obsidian READ/SEARCH advertise-scope to EXISTING
    // selectable agent profiles. The importer default now ships obsidian for
    // future-synced profiles, but profiles synced on an earlier boot keep their
    // old scope (e.g. ["rhythm"]) and would never advertise the knowledge vault.
    // This adds "obsidian" to array scopes (server-level) and an obsidian
    // read/search tool key to object-map scopes, preserving existing entries and
    // leaving null (unrestricted) scopes alone. Run-once guarded by a schema_meta
    // marker; re-runs are a no-op. Non-fatal — a failure must never block
    // startup and leaves the marker unwritten so a later boot retries. No-op
    // under Postgres (agent_configs MCP scopes are local-SQLite-only).
    try {
      const { backfillObsidianReadScope } = await import(
        './services/obsidian_scope_backfill'
      );
      const r = backfillObsidianReadScope();
      if (!r.alreadyDone) {
        logger.info(
          `[server] obsidian read-scope backfill: examined=${r.examined} ` +
            `arrayGranted=${r.arrayGranted} objectGranted=${r.objectGranted} skipped=${r.skipped}`,
        );
      }
    } catch (err) {
      logger.warn(
        `[server] obsidian read-scope backfill failed (non-fatal): ${String(err)}`,
      );
    }

    // Config Doctor's agent profile is seeded via a raw DB insert in
    // migrations.ts (not the normal create/patch API path), so it never
    // automatically gets its ~/.config/opencode/agents/config-doctor.md file
    // written the way profiles created through the UI/API do. Without this,
    // every session routed to it crashes with "UnknownError: UnknownError"
    // (agents.get() finds nothing) the moment you message it — exactly the
    // #900 class of bug this profile exists to catch. Ensure its file exists
    // on every boot; writeAgentProfileFile is idempotent and never throws.
    try {
      const { AgentConfigsRepository } = await import(
        './repositories/agent_configs_repository'
      );
      const { writeAgentProfileFile } = await import(
        './services/opencode_agent_writer'
      );
      for (const id of ['config-doctor', 'rhythm-setup', 'Theological-Researcher']) {
        const config = new AgentConfigsRepository().getById(id);
        if (config) writeAgentProfileFile(config);
      }
    } catch (err) {
      logger.warn(
        `[server] config-doctor agent file ensure failed (non-fatal): ${String(err)}`,
      );
    }

    // Seed the committed config assets (config-doctor tools +
    // customize-rhythm skill) from apps/api_server/config_seeds/ onto disk
    // under ~/.config/opencode/. The config-doctor runbook (seeded as the agent
    // profile above) instructs the agent to run
    // `node ~/.config/opencode/tools/classify.cjs` etc., so those tool files
    // must exist on both new and existing installs. Version-gated by a
    // schema_meta marker and force-pushing (overwrites the managed copies so a
    // shipped fix propagates — mirrors the config_doctor_prompt_vN runOnce).
    // Non-fatal — never blocks startup; no-op under Postgres.
    try {
      const { seedConfigAssets } = await import('./services/config_seeds_seeder');
      const r = seedConfigAssets();
      if (!r.alreadyDone) {
        logger.info(
          `[server] config-seeds: skillsCopied=${r.skillsCopied} ` +
            `toolsCopied=${r.toolsCopied} jsYamlProvisioned=${r.jsYamlProvisioned}`,
        );
      }
    } catch (err) {
      logger.warn(`[server] config-seeds seeding failed (non-fatal): ${String(err)}`);
    }

    // #846 — One-time seed of the three ministry recipe exemplars (Sunday
    // Service Prep / Volunteer Follow-up / Weekly Ministry Review), each a
    // scheduled task + managed skill pair bound to the correct scoped agent
    // profile (worship-planning / secretary). Idempotent by task name + skill
    // title (mirrors the seeds above). Non-fatal — a seed failure must never
    // block startup.
    try {
      const { seedMinistryRecipes } = await import('./services/ministry_recipes_seed');
      const r = await seedMinistryRecipes();
      logger.info(
        `[server] ministry recipes seed: tasksSeeded=${r.tasksSeeded} tasksSkipped=${r.tasksSkipped} ` +
          `skillsSeeded=${r.skillsSeeded} skillsSkipped=${r.skillsSkipped} ` +
          `missingRoleFiles=${r.missingRoleFiles.join(',') || 'none'} ` +
          `unresolvedRoles=${r.unresolvedRoles.join(',') || 'none'}`,
      );
    } catch (err) {
      logger.warn(`[server] ministry recipes seed failed (non-fatal): ${String(err)}`);
    }

    // #846 follow-up (agent-eval harness finding) — idempotent repair for
    // ministry-recipe scheduled tasks seeded BEFORE the resolution fix above,
    // whose agent_config_id points at a dangling role-file UUID (no matching
    // agent_configs row). Runs every boot; a no-op once every recipe task
    // resolves (the seed above already keeps new tasks correct). Non-fatal —
    // a repair failure must never block startup.
    try {
      const { repairMinistryRecipeAgentBindings } = await import('./services/ministry_recipes_seed');
      const r = await repairMinistryRecipeAgentBindings();
      if (r.repaired > 0 || r.stillUnresolved.length > 0) {
        logger.info(
          `[server] ministry recipes agent-binding repair: repaired=${r.repaired} ` +
            `stillUnresolved=${r.stillUnresolved.join(',') || 'none'}`,
        );
      }
    } catch (err) {
      logger.warn(`[server] ministry recipes agent-binding repair failed (non-fatal): ${String(err)}`);
    }

    // #830 — Wire all six org-optimizer generators' apply steps into the
    // shared org_proposal_apply_service registry ONCE at startup, then seed
    // the "Org Self-Optimizer" (daily) + "Org External Discovery" (weekly)
    // scheduled tasks. Wiring runs BEFORE seeding so a scheduled run that
    // fires immediately after boot never sees an unregistered proposal kind.
    // Non-fatal — a failure in either step must never block startup.
    try {
      const { registerAllProposalAppliers } = await import(
        './services/org_proposal_appliers_wiring'
      );
      registerAllProposalAppliers();
    } catch (err) {
      logger.warn(`[server] org-optimizer applier wiring failed (non-fatal): ${String(err)}`);
    }
    try {
      const { seedOrgOptimizerTask } = await import('./services/org_optimizer_seed');
      const r = await seedOrgOptimizerTask();
      logger.info(
        `[server] org-optimizer seed: auditTaskSeeded=${r.auditTaskSeeded}` +
          `${r.auditTaskSkippedReason ? ` (${r.auditTaskSkippedReason})` : ''} ` +
          `externalTaskSeeded=${r.externalTaskSeeded}` +
          `${r.externalTaskSkippedReason ? ` (${r.externalTaskSkippedReason})` : ''}`,
      );
    } catch (err) {
      logger.warn(`[server] org-optimizer seed failed (non-fatal): ${String(err)}`);
    }

    // Gallery is a first-run surface: seed its backing profile instead of
    // depending on a hand-authored file from one developer machine.
    try {
      const { seedCreativeMediaProfile } = await import('./services/creative_media_seed');
      const r = seedCreativeMediaProfile();
      logger.info(`[server] creative-media seed: created=${r.created}`);
    } catch (err) {
      logger.warn(`[server] creative-media seed failed (non-fatal): ${String(err)}`);
    }

    // #794 + #795 — Crash recovery for the auto-apply self-improvement loop. A
    // revision applied before a crash leaves its sidecar row at
    // `status='measuring'`; if the process died before the measure step ran,
    // the row would stay measuring forever. Defensively revert any such rows at
    // startup (fail-closed). Non-blocking + non-fatal — a failure must never
    // prevent the server from starting. No-op under Postgres / VITEST.
    void (async () => {
      try {
        const { recoverStuckMeasurements } = await import(
          './services/skill_measurement'
        );
        const reverted = await recoverStuckMeasurements();
        if (reverted > 0) {
          logger.info(
            `[server] skill measurement crash recovery: reverted ${reverted} stuck measuring row(s)`,
          );
        }
      } catch (err) {
        logger.warn(
          `[server] skill measurement crash recovery failed (non-fatal): ${String(err)}`,
        );
      }
    })();
  } else {
    logger.info(
      `[server] RHYTHM_ROLE=${env.role} — agent execution disabled (no scheduler, opencode, WS gateway, or managed Chrome)`,
    );
  }

  const mobileGatewayRouter = env.agentExecutionEnabled
    ? createMobileGatewayRouter()
    : undefined;
  const app = createApp({ mobileGatewayRouter });

  const httpServer = http.createServer(app);
  const relayUplink = env.isRelayRole
    ? (await import('./services/relay_uplink_server')).relayUplinkServer
    : null;
  if (relayUplink) {
    httpServer.on('upgrade', (request, socket, head) => {
      if (!relayUplink.handleUpgrade(request, socket, head)) socket.destroy();
    });
  }
  const mobileGatewayServer = mobileGatewayRouter
    ? http.createServer(createMobileGatewaySurface(mobileGatewayRouter))
    : null;
  const mobilePtyProxy = env.agentExecutionEnabled
    ? new MobilePtyProxy()
    : undefined;
  if (mobileGatewayServer && mobilePtyProxy) {
    mobileGatewayServer.on('upgrade', (request, socket, head) => {
      if (!mobilePtyProxy.handleUpgrade(request, socket, head)) {
        socket.destroy();
      }
    });
  }
  // WS gateway is an agent-execution surface (#755). In the 'cloud' role we
  // create a no-op WSS so `wss.close()` in the shutdown handler is still valid,
  // but never attach the upgrade/connection handlers.
  const wss = env.agentExecutionEnabled
    ? attachWsGateway(httpServer, mobilePtyProxy)
    : new (await import('ws')).WebSocketServer({ noServer: true });

  if (env.agentExecutionEnabled) {
    // Make sure the community auth plugins are listed in opencode.json before
    // we spawn the SDK subprocess. The plugins extend the provider catalog
    // so direct routing to anthropic / google works once the user has
    // authed via the corresponding flow.
    try {
      const {
        ensureRequiredPlugins,
        ensureOrgSkillIndex,
        ensureManagedDefaults,
        syncOrgInstructions,
      } = await import('./services/opencode_plugin_config');
      ensureRequiredPlugins();
      // #1054 — point skills.urls at this org's shared skill index before the
      // engine spawns, preserving any user-added entries (never touches
      // skills.paths). reloadSkills() is a documented no-op while the engine
      // isn't ready yet (see its own doc comment), so calling it here is safe
      // and is also correct for any future runtime re-ensure once the engine
      // is live. Never throws — a config-write failure must never block boot.
      ensureOrgSkillIndex();
      // #1071 (OCU-30) — managed small_model/username/reference defaults +
      // absent-only compaction/tool_output caps. Runs before spawn (like the
      // two calls above) so the freshly-written keys are present in the very
      // first config the engine reads. Never throws.
      await ensureManagedDefaults().catch((err) => {
        console.warn('[Opencode] Managed defaults update failed (non-fatal):', err);
      });
      // #1072 (OCU-31) — org instructions markdown, synced from production
      // and registered in the engine's `instructions` config. Offline/
      // unreachable prod falls back to the last cached copy (never blocks
      // boot). Re-synced daily thereafter — see the setInterval below.
      await syncOrgInstructions().catch((err) => {
        console.warn('[Opencode] Org instructions sync failed (non-fatal):', err);
      });
      setInterval(
        () => {
          syncOrgInstructions()
            .then(async (changed) => {
              if (changed) await opencodeClient.reloadConfig();
            })
            .catch((err) => console.warn('[Opencode] Daily org instructions sync failed (non-fatal):', err));
        },
        24 * 60 * 60 * 1000,
      ).unref();
      await opencodeClient.reloadSkills();
      // #947 — Rhythm manages ~/.config/opencode/skills as the SOLE skill
      // source. The engine auto-scans that config dir, so no opencode.json
      // `skills.paths` registration is needed — just make sure the dir exists
      // before spawn (the engine warn-skips a missing dir). The one-time
      // legacy→sole-source migration is gated behind RHYTHM_MIGRATE_MANAGED_SKILLS
      // (default off — folds into the #961 real-config remediation pass).
      const { ensureManagedSkillsDir, maybeMigrateLegacyManagedSkills } =
        await import('./services/rhythm_managed_skills');
      ensureManagedSkillsDir();
      maybeMigrateLegacyManagedSkills();
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
      // The initial seed can run before the engine exists, when its reload is a
      // no-op. Re-project now that reloadConfig can register `research` before
      // the first page-launched AgentRunner job.
      try {
        const { seedResearchProfile } = await import('./services/research_profile_seed');
        seedResearchProfile();
      } catch (e) {
        logger.warn(`[server] research profile engine projection failed (non-fatal): ${String(e)}`);
      }
      try {
        const { recoverInterruptedResearchProjectRuns } = await import('./controllers/agentResearchController');
        const recovered = await recoverInterruptedResearchProjectRuns();
        if (recovered) logger.warn(`[server] resumed ${recovered} interrupted research project run(s)`);
      } catch (e) {
        logger.warn(`[server] research project recovery failed (non-fatal): ${String(e)}`);
      }

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

      // OCU-04 (#1045) — on engine ready, reconcile any DB session left stuck
      // 'working'/'starting' by an event missed while the engine/api_server was
      // down. Non-fatal: a reconcile failure must never block boot.
      try {
        const { streamBridge } = await import('./services/opencode_stream_bridge');
        await streamBridge.ensureGlobalStream();
        await streamBridge.checkEngineHealthNow();
        await streamBridge.reconcileSessionStatuses();
        logger.info('[server] session status resync complete (#1045)');
      } catch (e) {
        logger.warn(`[server] session status resync failed (non-fatal): ${String(e)}`);
      }

      // #1175 — durable async delegation wakes can be left in `waking` when
      // api_server exits after OpenCode accepts the deterministic parent
      // message but before SQLite records `notified`. Reconcile only after the
      // engine and persisted session mappings are ready. The service scans a
      // bounded parent set and inspects the engine transcript before retrying,
      // so an accepted wake is never duplicated.
      try {
        const { asyncDelegationCompletionService } = await import(
          './services/async_delegation_completion_service'
        );
        const recovered =
          await asyncDelegationCompletionService.recoverAfterRestart();
        logger.info(
          `[server] async delegation recovery complete: ` +
            `parents=${recovered.parentsExamined} remaining=${recovered.claimsRemaining}`,
        );
      } catch (e) {
        logger.warn(
          `[server] async delegation recovery failed (non-fatal): ${String(e)}`,
        );
      }

      // #1392 — recover signed approval decisions committed before a crash
      // could enqueue their machine-authored continuation. Runs only after
      // engine readiness and stream/session reconciliation.
      try {
        const { agentApprovalContinuationService } = await import(
          './services/agent_approval_continuation_service'
        );
        await agentApprovalContinuationService.recoverAfterRestart();
        logger.info('[server] approval continuation recovery complete');
      } catch (e) {
        logger.warn(
          `[server] approval continuation recovery failed (non-fatal): ${String(e)}`,
        );
      }

      // Dual-accounts Task B — the Rhythm accounts store is the source of
      // truth for Claude tokens once it has accounts. Boot order:
      //   1. Store empty + Claude Code creds readable → one-time migration
      //      (imports the keychain creds as the 'default' account).
      //   2. Store has accounts → start the N-account refresh loop, push the
      //      default account into the engine, and SKIP the legacy keychain
      //      poll (retired while the store is live — the store owns rotation).
      //   3. Store still empty → legacy #658/#856 path unchanged (auto-bridge
      //      + change-gated keychain poll), so a fresh install without Claude
      //      Code and without in-app login behaves exactly as before.
      try {
        const { credentialsBridge } = await import('./routes/opencode_auth_routes');
        const { anthropicAccountsService } = await import(
          './services/anthropic_accounts_service'
        );
        credentialsBridgeRef = credentialsBridge;
        anthropicAccountsServiceRef = anthropicAccountsService;

        if (!anthropicAccountsService.hasAccounts()) {
          const creds = credentialsBridge.readClaudeCreds();
          if (creds) anthropicAccountsService.migrateFromClaudeCode(creds);
        }

        if (anthropicAccountsService.hasAccounts()) {
          anthropicAccountsService.startRefreshLoop();
          // Refresh anything near expiry NOW so the engine never gets a dead
          // token at boot (skips accounts with >20 min left — no needless
          // burn of single-use refresh tokens).
          await anthropicAccountsService.refreshAll();
          const acct = anthropicAccountsService.defaultAccount();
          if (acct && acct.status === 'ok') {
            const ok = await opencodeClient.setOAuthCredentials('anthropic', {
              access: acct.access,
              refresh: acct.refresh,
              expires: acct.expires,
            });
            logger.info(
              `[server] anthropic accounts store live (default='${acct.id}') — ` +
                `engine push ${ok ? 'ok' : 'failed'}; keychain poll skipped`,
            );
          } else {
            logger.info(
              '[server] anthropic accounts store live but default account needs re-login — engine push skipped',
            );
          }
        } else {
          // #658: auto-bridge Claude Code credentials on launch so the user
          // never has to click "Reconnect" after a normal start. force:true
          // re-reads the keychain fresh; a successful bridge starts the
          // 15-min refresh loop that keeps opencode's token in sync as
          // Claude Code rotates it. No-op when Claude Code isn't
          // installed/signed-in.
          if (!credentialsBridge.hasClaudeCode()) {
            logger.info('[server] Claude auto-bridge: no Claude Code creds — skipping');
          } else {
            const result = await credentialsBridge.bridgeAnthropic(opencodeClient, {
              force: true,
            });
            logger.info(
              `[server] Claude auto-bridge: ${
                result.success ? 'ok' : `failed (${result.reason})`
              }`,
            );
          }

          // #856 (reopened, second attempt) — start the change-gated Keychain
          // poll so a LATER `claude` re-auth (account switch / re-login, or a
          // first-time sign-in after this server was already running) is
          // picked up without an app restart. File-watching
          // ~/.claude/.credentials.json (the prior fix) doesn't work: the
          // current `claude` CLI keeps credentials in the macOS Keychain ONLY
          // and never rewrites that file on re-auth, so the watch essentially
          // never fires. Polling is change-gated on the refresh-token
          // fingerprint, so an unchanged token is a no-op every tick — only a
          // genuine re-auth (or a first sign-in) triggers a forced re-bridge.
          // Started unconditionally (even when no creds exist yet at launch)
          // so a later first-time sign-in is also picked up. See
          // CredentialsBridgeService.startKeychainPoll for the full rationale.
          credentialsBridge.startKeychainPoll(opencodeClient);
          logger.info('[server] claude keychain poll started (#856 reopen v2)');
        }
      } catch (e) {
        logger.warn(`[server] Claude auto-bridge errored (non-fatal): ${String(e)}`);
      }

      // #856/#1278 — arm the auth.json watcher only after restoreAuth and the
      // rest of boot-time credential reconciliation have finished. Those
      // server-owned writes belong to this initialization pass and must not
      // bounce the engine that was just spawned. Non-fatal: a watcher start
      // failure leaves the engine with its current credentials until restart,
      // matching the pre-#856 behavior.
      try {
        const { AuthCredentialWatcher } = await import(
          './services/auth_credential_watcher'
        );
        const { homedir } = await import('os');
        const { join } = await import('path');
        authCredentialWatcher = new AuthCredentialWatcher({
          path: join(homedir(), '.local', 'share', 'opencode', 'auth.json'),
          onReload: async () => {
            await opencodeClient.reloadCredentials();
          },
        });
        await authCredentialWatcher.start();
        logger.info('[server] auth credential watcher started (#856)');
      } catch (err) {
        logger.warn(
          `[server] auth credential watcher failed to start (non-fatal): ${String(err)}`,
        );
      }
    })
    .catch((err) => {
      console.warn('[Opencode] SDK init failed (non-fatal):', err);
    });

  }

  httpServer.listen(port, apiBindHost, () => {
    logger.info(`Rhythm API listening on ${apiBindHost}:${port}`);
  });
  if (mobileGatewayServer) {
    const mobileGatewayPort = mobileGatewayListenPort();
    mobileGatewayServer.listen(mobileGatewayPort, '127.0.0.1', () => {
      logger.info(
        `Rhythm mobile gateway listening on 127.0.0.1:${mobileGatewayPort}`,
      );
    });
  }

  // Synology relay uplink (docs/ai/plan-synology-relay.md). Only the Mac
  // dials out, and only when a relay is configured; the relay/cloud roles
  // never run this (no mobile gateway to dispatch against).
  if (env.relayUrls.length > 0 && !env.relayBearer) {
    logger.warn('[relay] uplink disabled: bearer is not configured');
  }
  if (
    env.agentExecutionEnabled &&
    mobileGatewayServer &&
    env.relayUrls.length > 0 &&
    env.relayBearer
  ) {
    const os = await import('os');
    const { RelayUplinkClient } = await import(
      './services/relay_uplink_client'
    );
    const { setRelayUplinkClient } = await import(
      './services/relay_uplink_runtime'
    );
    const { opencodeEventHub } = await import(
      './services/opencode_event_hub'
    );
    const { getDb } = await import('./database/db');
    const { findSolePairedUserId } = await import(
      './repositories/mobile_devices_repository'
    );
    const gatewayBase = `http://127.0.0.1:${mobileGatewayListenPort()}`;
    const relayClient = new RelayUplinkClient({
      urls: env.relayUrls,
      bearer: env.relayBearer,
      // Advisory only — the relay binds the uplink to the userId it resolves
      // from the bearer via /auth/me, not to this claim.
      userId: findSolePairedUserId(getDb()) ?? 0,
      machineId: os.hostname(),
      hub: opencodeEventHub,
      healthProvider: async () => {
        const response = await fetch(`${gatewayBase}/mobile-gateway/health`);
        return await response.json();
      },
      devicesProvider: async () => {
        try {
          const devices = getDb()
            .prepare('SELECT * FROM mobile_devices')
            .all() as Record<string, unknown>[];
          return { devices };
        } catch {
          return { devices: [] };
        }
      },
      dispatchBaseUrl: gatewayBase,
    });
    relayClient.start();
    setRelayUplinkClient(relayClient);
    logger.info(
      `[relay] uplink client started (${env.relayUrls.length} candidate(s))`,
    );
  }

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
    try {
      void import('./services/relay_uplink_runtime').then((runtime) => {
        void runtime.getRelayUplinkClient()?.stop();
        runtime.setRelayUplinkClient(null);
      });
    } catch (_) { /* ignore */ }
    try { recurrenceJob?.stop(); } catch (_) { /* ignore */ }
    try { syncJob?.stop(); } catch (_) { /* ignore */ }
    try { memoryVaultSyncJob?.stop(); } catch (_) { /* ignore */ }
    // #1096 WP1 — stop only the exact child process this manager spawned.
    try { engraphManagerRef?.shutdown(); } catch (_) { /* ignore */ }
    try { agentSchedulerJob?.stop(); } catch (_) { /* ignore */ }
    // #856 — stop the auth.json watcher so a credential write during
    // shutdown can't trigger a bounce of an engine we're about to dispose.
    try { authCredentialWatcher?.stop(); } catch (_) { /* ignore */ }
    // #856 (reopened, second attempt) — stop the Keychain poll, mirroring the
    // watcher lifecycle above.
    try { credentialsBridgeRef?.stopKeychainPoll(); } catch (_) { /* ignore */ }
    // Dual-accounts Task B — stop the accounts refresh loop (timer is unref'd,
    // but a refresh mid-shutdown would burn a single-use refresh token).
    try { anthropicAccountsServiceRef?.stopRefreshLoop(); } catch (_) { /* ignore */ }

    try { relayUplink?.stop(); } catch (_) { /* ignore */ }

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

      const closeHttpServer = () => {
        httpServer.close(() => {
          logger.info('[server] clean shutdown complete');
          process.exit(0);
        });
      };
      if (mobileGatewayServer) {
        mobileGatewayServer.close(closeHttpServer);
      } else {
        closeHttpServer();
      }
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
