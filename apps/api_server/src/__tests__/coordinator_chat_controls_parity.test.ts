/**
 * Chat-controls parity — the actual C2 coordinator foreground dispatch honors
 * the authorized SESSION model (fixed or Auto), the persisted reasoning budget
 * and the explicit Fast flag through the ordinary resolver and the ordinary
 * `reasoningConfig`/`fastMode` request shape, while the selected Secretary
 * profile's prompt/tool/grant scope stays independent of the model choice.
 *
 * Real: CoordinatorConversationService + repository, real
 * `createCoordinatorForegroundSender`, real AgentSessions/AgentConfigs
 * repositories on a migrated SQLite, real `resolveModelForSessionTurn`, real
 * OpencodeClientService.promptAsync (foreground gates + provenance). Stand-ins:
 * the SDK transport (`session.promptAsync`, whose serialized body is asserted),
 * the fork's native-message-id mint, the profile-scope resolver (returns a
 * fixed Secretary scope) and the stream bridge. No real model, provider, or
 * engine is contacted; this proves the request we hand the SDK, not the served
 * model/tier.
 */
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CoordinatorContextRead } from '../contracts/coordinator_conversation_contract';
import type { AuthContext } from '../middleware/auth_middleware';
import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';

const { sdkPromptAsync } = vi.hoisted(() => ({ sdkPromptAsync: vi.fn() }));

vi.mock('../services/opencode_engine', async () => {
  const { OpencodeClientService } = await vi.importActual<typeof import('../services/opencode_client_service')>(
    '../services/opencode_client_service',
  );
  const svc = new OpencodeClientService();
  (svc as unknown as { client: unknown }).client = { session: { promptAsync: sdkPromptAsync } };
  (svc as unknown as { status: string }).status = 'ready';
  (svc as unknown as { server: unknown }).server = { url: 'http://engine.test', close() {} };
  (svc as unknown as { listAuthedProviders: unknown }).listAuthedProviders = async () => ['provider-default'];
  return { opencodeClient: svc, opencodeSessionMap: new Map<string, string>() };
});

import { opencodeClient } from '../services/opencode_engine';
import { AgentConfigsRepository } from '../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { resolveModelForSessionTurn } from '../services/agent_model_resolver';
import { CoordinatorConversationContextAssembler } from '../services/coordinator_conversation_context';
import {
  CoordinatorConversationService,
  createCoordinatorForegroundSender,
} from '../services/coordinator_conversation_service';

const OWNER = 7;
const PROJECT = 'project-primary';
const SDK = 'ses_primary';
const NOW = new Date('2026-10-06T12:00:00.000Z');
const NATIVE = 'msg_native_c2_1';
const auth = { sessionToken: 'desktop-auth', user: { id: OWNER } } as AuthContext;
const MCP = { role: 'secretary', mcpServers: { rhythm: { allowedTools: ['rhythm_get_coordinator_status'] } }, allowedToolsJson: '[]' };

const available = <T>(items: T[]): CoordinatorContextRead<T> => ({
  availability: 'available', reason: null, complete: true, authoritative: true,
  observedAt: NOW.toISOString(), sourceVersion: 'snapshot-1', items,
});

describe('coordinator foreground honors the session model, reasoning and Fast', () => {
  let db: Database.Database;
  let access: { value: boolean };
  let service: CoordinatorConversationService;
  let allowlist: ReturnType<typeof vi.fn>;
  let hooks: { allowlist?: () => void; mint?: () => void; stream?: () => void };
  let scopeModel: { providerID: string; modelID: string };
  let sequence = 0;

  const bodyOf = (call = 0) => (sdkPromptAsync.mock.calls[call][0] as { body: Record<string, unknown> }).body;
  const setSession = (columns: Record<string, unknown>, id = 'primary') => {
    for (const [column, value] of Object.entries(columns)) {
      db.prepare(`UPDATE agent_sessions SET ${column}=? WHERE id=?`).run(value, id);
    }
  };
  const setProfile = (columns: Record<string, unknown>) => {
    for (const [column, value] of Object.entries(columns)) {
      db.prepare(`UPDATE agent_configs SET ${column}=? WHERE id='secretary'`).run(value);
    }
  };
  const send = (message = 'Please explain why this dashboard is stale.') => {
    sequence += 1;
    return service.receiveMessage(auth, {
      sessionId: 'primary', projectId: PROJECT, expectedControlRevision: 1,
      commandKey: `ordinary-${sequence}`, message,
    });
  };

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db);
    db.pragma('foreign_keys = OFF');
    setDb(db);
    sdkPromptAsync.mockReset().mockResolvedValue({ response: { status: 204 } });
    sequence = 0;
    access = { value: true };
    hooks = {};
    scopeModel = { providerID: 'provider-default', modelID: 'model-default' };
    db.prepare(`INSERT OR IGNORE INTO agent_configs (id, label, icon, command, enabled, is_agent)
      VALUES ('secretary', 'Secretary', 'x', 'synthetic', 1, 1)`).run();
    setProfile({ oc_agent: 'secretary', session_selectable: 1, model_provider: 'provider-default', model_id: 'model-default', system_prompt: 'You are the Secretary.' });
    new AgentSessionsRepository().insert({ agentKind: 'librarian', taskId: null, cwd: '/tmp', name: 'primary', profileId: 'secretary' } as never);
    const created = db.prepare('SELECT id FROM agent_sessions ORDER BY rowid DESC LIMIT 1').get() as { id: string };
    db.prepare('UPDATE agent_sessions SET id=? WHERE id=?').run('primary', created.id);
    setSession({
      owner_user_id: OWNER, project_id: PROJECT, status: 'idle', permission_mode: 'plan', sdk_session_id: SDK,
      provider_id: 'provider-pick', model_id: 'model-pick', model_mode: 'fixed',
    });
    const repo = new CoordinatorConversationsRepository(db, () => NOW);
    expect(repo.designatePrimaryOwnerRoot({ ownerUserId: OWNER, projectId: PROJECT, sessionId: 'primary' }).kind).toBe('found');
    const assembler = new CoordinatorConversationContextAssembler({
      tasks: { read: async () => available([]) }, schedules: { read: async () => available([]) },
      rhythms: { read: async () => available([]) }, workstreams: { read: async () => available([]) },
      receipts: { read: async () => available([]) },
    });
    (opencodeClient as unknown as { mintPromptAnchor: unknown }).mintPromptAnchor = async () => {
      hooks.mint?.();
      return NATIVE;
    };
    (opencodeClient as unknown as { setDayflowSdkHistoryGuard(g: unknown): void }).setDayflowSdkHistoryGuard({
      shouldBindPrompt: async () => false,
      revalidateBeforeSdk: async () => true,
    });
    allowlist = vi.fn(async () => { hooks.allowlist?.(); return true; });
    const sessions = new AgentSessionsRepository();
    const configs = new AgentConfigsRepository();
    service = new CoordinatorConversationService({
      repository: repo,
      context: { assemble: async (input: Parameters<typeof assembler.assemble>[0]) => assembler.assemble(input) } as never,
      sessions,
      configs,
      projects: { findById: () => ({ id: PROJECT, archivedAt: null }) } as never,
      projectAccess: { canAccess: () => access.value, canOwnerAccess: () => access.value },
      foreground: {
        send: createCoordinatorForegroundSender({
          sessions,
          configs,
          ownerProjectAccess: () => access.value,
          resolveProfileScope: async () => ({
            model: scopeModel, mcpRoleConfig: MCP, allowedSkillsJson: null,
            systemPrompt: 'You are the Secretary.', ocAgent: 'secretary', modelTierHint: null,
          }),
          resolveSessionModel: resolveModelForSessionTurn,
          profileAllowsRhythmTool: (scope, tool) => scope.mcpRoleConfig === null ||
            (scope.mcpRoleConfig.mcpServers.rhythm as { allowedTools: string[] } | undefined)?.allowedTools.includes(tool) === true,
          client: {
            updateSessionAllowlist: allowlist as never,
            promptAsync: ((...args: Parameters<typeof opencodeClient.promptAsync>) => opencodeClient.promptAsync(...args)) as never,
          },
          streamSession: async () => { hooks.stream?.(); },
          skills: { enabled: () => false, build: () => ({ text: '' }) },
          memory: async () => null,
        }),
      },
      enabled: () => true,
      now: () => NOW,
    } as never);
  });

  it('sends a fixed session model that differs from the profile default, with the profile scope intact', async () => {
    expect(await send()).toMatchObject({ kind: 'foreground_accepted' });
    expect(sdkPromptAsync).toHaveBeenCalledTimes(1);
    expect(bodyOf().model).toEqual({ providerID: 'provider-pick', modelID: 'model-pick' });
    // Secretary role/tool/grant scope is selected by the profile, not the model.
    expect(bodyOf().agent).toBe('secretary');
    expect(allowlist).toHaveBeenCalledWith(SDK, MCP, 'provider-pick');
    expect(String(bodyOf().system)).toContain('rhythm_get_coordinator_status');
    expect(String(bodyOf().system)).toContain('No signed coordinator goal-action control');
    expect(db.prepare('SELECT profile_id FROM agent_sessions WHERE id=?').get('primary')).toEqual({ profile_id: 'secretary' });
  });

  it('keeps the profile default when the session model equals it (unchanged ordinary behavior)', async () => {
    setSession({ provider_id: 'provider-default', model_id: 'model-default' });
    expect(await send()).toMatchObject({ kind: 'foreground_accepted' });
    expect(bodyOf().model).toEqual({ providerID: 'provider-default', modelID: 'model-default' });
  });

  it('serializes the persisted reasoning budget through the ordinary reasoningConfig shape, and omits it when unset', async () => {
    setSession({ thinking_budget: 8192 });
    expect(await send()).toMatchObject({ kind: 'foreground_accepted' });
    expect(bodyOf().reasoningConfig).toEqual({ type: 'enabled', budgetTokens: 8192 });
    sdkPromptAsync.mockClear();
    setSession({ thinking_budget: null });
    expect(await send()).toMatchObject({ kind: 'foreground_accepted' });
    expect(bodyOf()).not.toHaveProperty('reasoningConfig');
  });

  it('forwards Fast only when the session explicitly has it on and never adds a tier on its own', async () => {
    expect(await send()).toMatchObject({ kind: 'foreground_accepted' });
    expect(bodyOf()).not.toHaveProperty('fastMode');
    sdkPromptAsync.mockClear();
    setSession({ fast_mode: 1 });
    expect(await send()).toMatchObject({ kind: 'foreground_accepted' });
    expect(bodyOf().fastMode).toBe(true);
    sdkPromptAsync.mockClear();
    setSession({ fast_mode: 0 });
    expect(await send()).toMatchObject({ kind: 'foreground_accepted' });
    expect(bodyOf()).not.toHaveProperty('fastMode');
  });

  it('Auto with a stored session model uses that model; Auto without one uses the profile model; neither uses the router', async () => {
    setSession({ model_mode: 'auto' });
    expect(await send()).toMatchObject({ kind: 'foreground_accepted' });
    expect(bodyOf().model).toEqual({ providerID: 'provider-pick', modelID: 'model-pick' });
    sdkPromptAsync.mockClear();
    setSession({ provider_id: null, model_id: null });
    expect(await send()).toMatchObject({ kind: 'foreground_accepted' });
    expect(bodyOf().model).toEqual({ providerID: 'provider-default', modelID: 'model-default' });
    expect(db.prepare('SELECT router_decided_at FROM agent_sessions WHERE id=?').get('primary')).toEqual({ router_decided_at: null });
  });

  it('records the ordinary session provenance for the exact native message', async () => {
    expect(await send()).toMatchObject({ kind: 'foreground_accepted' });
    expect(db.prepare(`SELECT origin, requested_source, final_provider_id, final_model_id, sdk_user_message_id, outcome
      FROM agent_turn_dispatches WHERE session_id='primary'`).all()).toEqual([{
      origin: 'prompt_api', requested_source: 'session', final_provider_id: 'provider-pick',
      final_model_id: 'model-pick', sdk_user_message_id: NATIVE, outcome: 'accepted',
    }]);
  });

  it('opening, resolving and reading status never create a turn, SDK request, or setting change', async () => {
    setSession({ fast_mode: 1, thinking_budget: 2048 });
    const before = db.prepare('SELECT * FROM agent_sessions WHERE id=?').get('primary');
    const request = { sessionId: 'primary', projectId: PROJECT };
    service.open(auth, request);
    service.resolvePrimary(auth, { projectId: PROJECT } as never);
    await service.status(auth, request);
    expect(sdkPromptAsync).not.toHaveBeenCalled();
    expect(allowlist).not.toHaveBeenCalled();
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_turn_dispatches').get()).toEqual({ n: 0 });
    const after = db.prepare('SELECT * FROM agent_sessions WHERE id=?').get('primary') as Record<string, unknown>;
    expect({ ...after, updated_at: null }).toEqual({ ...(before as Record<string, unknown>), updated_at: null });
  });

  it('holds (no SDK) when the ordinary resolution disagrees with the selected session model', async () => {
    const sender = createCoordinatorForegroundSender({
      sessions: new AgentSessionsRepository(), configs: new AgentConfigsRepository(),
      ownerProjectAccess: () => true,
      resolveProfileScope: async () => ({
        model: scopeModel, mcpRoleConfig: MCP, allowedSkillsJson: null, systemPrompt: null, ocAgent: 'secretary', modelTierHint: null,
      }),
      resolveSessionModel: async () => ({ providerID: 'provider-other', modelID: 'model-other' }),
      profileAllowsRhythmTool: () => true,
      client: { updateSessionAllowlist: allowlist as never, promptAsync: vi.fn() as never },
      streamSession: async () => undefined,
      skills: { enabled: () => false, build: () => ({ text: '' }) },
      memory: async () => null,
    });
    const result = await sender({
      actor: auth, localSessionId: 'primary', sdkSessionId: SDK, projectId: PROJECT, profileId: 'secretary',
      providerId: 'provider-pick', modelId: 'model-pick', thinkingBudget: null, fastMode: false, cwd: '/tmp',
      message: 'hello', commandKey: 'k', controlRevision: 1, reservationCurrent: () => true,
      system: 'contract', contextCurrent: async () => true,
    });
    expect(result).toEqual({ kind: 'unavailable' });
    expect(sdkPromptAsync).not.toHaveBeenCalled();
  });

  describe.each([
    ['the profile scope refresh', 'allowlist' as const],
    ['the native message mint', 'mint' as const],
    ['the stream bridge attach', 'stream' as const],
  ])('a change during %s withholds the SDK request', (_name, hook) => {
    it.each([
      ['session model changed', () => setSession({ provider_id: 'provider-late', model_id: 'model-late' })],
      ['session mode changed to auto', () => setSession({ model_mode: 'auto' })],
      ['reasoning budget changed', () => setSession({ thinking_budget: 4096 })],
      ['Fast toggled', () => setSession({ fast_mode: 1 })],
      ['profile switched', () => setSession({ profile_id: 'other-profile' })],
      ['profile disabled', () => setProfile({ enabled: 0 })],
      ['project access revoked', () => { access.value = false; }],
      ['root archived', () => setSession({ archived_at: NOW.toISOString() })],
      ['root moved to another owner', () => setSession({ owner_user_id: OWNER + 1 })],
      ['root moved to another project', () => setSession({ project_id: 'project-late' })],
      ['root designation removed', () => setSession({ coordinator_conversation_json: null })],
    ])('%s', async (_change, mutate) => {
      hooks[hook] = mutate;
      // A vanished/moved root is settled as not_found; every other drift as uncertain. Neither exposes the SDK.
      expect(['foreground_uncertain', 'not_found']).toContain((await send()).kind);
      expect(sdkPromptAsync).not.toHaveBeenCalled();
      expect(db.prepare(`SELECT COUNT(*) AS n FROM agent_turn_dispatches WHERE outcome='accepted'`).get()).toEqual({ n: 0 });
    });
  });
});
