import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';

import type { AuthContext } from '../middleware/auth_middleware';
import { installCoordinatorConversationSchema } from '../database/coordinator_conversation_schema';
import { CoordinatorConversationsRepository } from '../repositories/coordinator_conversations_repository';
import { coordinatorConversationResponseStatus } from '../controllers/coordinator_conversations_controller';
import {
  CoordinatorConversationService,
  type CoordinatorConversationServiceDependencies,
} from '../services/coordinator_conversation_service';

const now = new Date('2026-10-05T12:00:00.000Z');
const auth = { sessionToken: 'desktop-auth', user: { id: 7 } } as AuthContext;

function database(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE agent_sessions (
    id TEXT PRIMARY KEY,
    owner_user_id INTEGER,
    project_id TEXT,
    parent_session_id TEXT,
    is_system INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT 'chat',
    archived_at TEXT,
    sdk_session_id TEXT,
    profile_id TEXT,
    permission_mode TEXT NOT NULL DEFAULT 'default',
    approval_bypass_explicit INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE agent_session_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    stripped_text TEXT NOT NULL
  )`);
  const insert = db.prepare(`INSERT INTO agent_sessions
    (id, owner_user_id, project_id, parent_session_id, is_system, category, archived_at, sdk_session_id, profile_id, permission_mode, approval_bypass_explicit, created_at, updated_at)
    VALUES (?, ?, ?, NULL, 0, 'chat', NULL, ?, 'profile-a', 'default', 0, ?, ?)`);
  insert.run('chat-a', 7, 'project-a', 'sdk-a', now.toISOString(), now.toISOString());
  insert.run('chat-b', 7, 'project-b', 'sdk-b', now.toISOString(), now.toISOString());
  insert.run('chat-foreign', 8, 'project-foreign', 'sdk-foreign', now.toISOString(), now.toISOString());
  installCoordinatorConversationSchema(db);
  return db;
}

function service(
  repository: CoordinatorConversationsRepository,
  db: Database.Database,
  allowed: Map<number, Set<string>>,
  extras: Partial<Pick<CoordinatorConversationServiceDependencies, 'foreground' | 'messages' | 'context' | 'projects' | 'projectSetup' | 'configs'>> = {},
) {
  const sessions = new Map<string, Record<string, unknown>>([
    ['chat-a', { id: 'chat-a', ownerUserId: 7, projectId: 'project-a', parentSessionId: null, isSystem: false, category: 'chat', sdkSessionId: 'sdk-a', profileId: 'profile-a', providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed', permissionMode: 'default', approvalBypassExplicit: false }],
    ['chat-b', { id: 'chat-b', ownerUserId: 7, projectId: 'project-b', parentSessionId: null, isSystem: false, category: 'chat', sdkSessionId: 'sdk-b', profileId: 'profile-a', providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed', permissionMode: 'default', approvalBypassExplicit: false }],
    ['chat-foreign', { id: 'chat-foreign', ownerUserId: 8, projectId: 'project-foreign', parentSessionId: null, isSystem: false, category: 'chat', sdkSessionId: 'sdk-foreign', profileId: 'profile-a', providerId: 'provider-a', modelId: 'model-a', modelMode: 'fixed', permissionMode: 'default', approvalBypassExplicit: false }],
  ]);
  let sequence = 0;
  return new CoordinatorConversationService({
    repository,
    context: extras.context ?? {} as never,
    sessions: {
      findById: (id) => {
        const known = sessions.get(id);
        if (known) return known as never;
        const row = db.prepare(`SELECT id, owner_user_id, project_id, profile_id, permission_mode, approval_bypass_explicit
          FROM agent_sessions WHERE id=?`).get(id) as {
            id: string; owner_user_id: number; project_id: string; profile_id: string | null;
            permission_mode: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'; approval_bypass_explicit: number;
          } | undefined;
        if (!row || !row.profile_id) return null;
        const restored = {
          id: row.id,
          ownerUserId: row.owner_user_id,
          projectId: row.project_id,
          parentSessionId: null,
          isSystem: false,
          category: 'chat',
          sdkSessionId: null,
          profileId: row.profile_id,
          providerId: null,
          modelId: null,
          modelMode: 'auto',
          permissionMode: row.permission_mode,
          approvalBypassExplicit: row.approval_bypass_explicit === 1,
        };
        sessions.set(id, restored);
        return restored as never;
      },
      insert: (input) => {
        sequence += 1;
        const id = `rhythm-coordinator-root-${sequence}`;
        const session = {
          id,
          ownerUserId: input.ownerUserId,
          projectId: input.projectId,
          parentSessionId: null,
          isSystem: false,
          category: 'chat',
          sdkSessionId: null,
          profileId: input.profileId,
          providerId: null,
          modelId: null,
          modelMode: input.modelMode,
          permissionMode: 'plan',
          approvalBypassExplicit: false,
        };
        sessions.set(id, session);
        db.prepare(`INSERT INTO agent_sessions
          (id, owner_user_id, project_id, parent_session_id, is_system, category, archived_at, sdk_session_id, profile_id, permission_mode, approval_bypass_explicit, created_at, updated_at)
          VALUES (?, ?, ?, NULL, 0, 'chat', NULL, NULL, ?, 'plan', 0, ?, ?)`)
          .run(id, input.ownerUserId, input.projectId, input.profileId, now.toISOString(), now.toISOString());
        return session as never;
      },
    },
    configs: extras.configs ?? {
      getById: (id: string) => id === 'profile-a' ? {
        id, enabled: true, isAgent: true, locked: false, modelProvider: 'provider-a', modelId: 'model-a', revision: 3,
      } as never : null,
      listEnabled: () => [{
        id: 'profile-a', enabled: true, isAgent: true, locked: false, modelProvider: 'provider-a', modelId: 'model-a', revision: 3,
      }] as never,
    },
    projects: extras.projects ?? {
      findById: (id: string) => ['project-a', 'project-b', 'project-foreign'].includes(id)
        ? { id, cwd: `/safe/${id}`, archivedAt: null }
        : null,
    } as never,
    projectAccess: {
      canAccess: ({ actor, projectId }) => allowed.get(actor.user.id)?.has(projectId) === true,
    },
    projectSetup: extras.projectSetup,
    foreground: extras.foreground,
    messages: extras.messages,
    enabled: () => true,
    now: () => now,
  });
}

describe('dedicated primary Rhythm conversation resolution', () => {
  let db: Database.Database | null = null;
  afterEach(() => { db?.close(); db = null; });

  it('keeps the closed setup profile-choice response actionable at the authenticated API boundary', () => {
    expect(coordinatorConversationResponseStatus('setup_profile_choice_required')).toBe(200);
  });

  it('creates one inert dedicated owner root, never adopts an older general chat, survives reopen, and ignores later project hints', () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a', 'project-b'])]]);
    const firstRepository = new CoordinatorConversationsRepository(db, () => now);
    const firstService = service(firstRepository, db, allowed);
    const first = firstService.resolvePrimary(auth, { projectId: 'project-a' });
    expect(first).toMatchObject({ kind: 'resolved', created: true, sessionId: 'rhythm-coordinator-root-1', projectId: 'project-a', conversation: { primaryOwnerRoot: true, controlRevision: 1 } });
    const laterHint = firstService.resolvePrimary(auth, { projectId: 'project-b' });
    expect(laterHint).toMatchObject({ kind: 'resolved', created: false, sessionId: 'rhythm-coordinator-root-1', projectId: 'project-a' });

    const afterRestart = service(new CoordinatorConversationsRepository(db, () => now), db, allowed).resolvePrimary(auth, {});
    expect(afterRestart).toMatchObject({ kind: 'resolved', created: false, sessionId: 'rhythm-coordinator-root-1', projectId: 'project-a' });
    expect(db.prepare('SELECT sdk_session_id, coordinator_conversation_json FROM agent_sessions WHERE id=?').get('chat-a'))
      .toMatchObject({ sdk_session_id: 'sdk-a', coordinator_conversation_json: null });
    expect(db.prepare('SELECT sdk_session_id, coordinator_conversation_json FROM agent_sessions WHERE id=?').get('rhythm-coordinator-root-1'))
      .toMatchObject({ sdk_session_id: null });
  });

  it('uses the durable transaction as the root idempotency boundary and fails closed when current project access is revoked', () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])], [8, new Set(['project-foreign'])]]);
    const first = service(new CoordinatorConversationsRepository(db, () => now), db, allowed);
    const second = service(new CoordinatorConversationsRepository(db, () => now), db, allowed);
    expect(first.resolvePrimary(auth, { projectId: 'project-a' })).toMatchObject({ kind: 'resolved', created: true, sessionId: 'rhythm-coordinator-root-1' });
    expect(second.resolvePrimary(auth, { projectId: 'project-a' })).toMatchObject({ kind: 'resolved', created: false, sessionId: 'rhythm-coordinator-root-1' });
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_sessions WHERE id LIKE 'rhythm-coordinator-root-%'").get())
      .toMatchObject({ count: 1 });

    const foreign = first.resolvePrimary({ sessionToken: 'foreign-auth', user: { id: 8 } } as AuthContext, { projectId: 'project-foreign' });
    expect(foreign).toMatchObject({ kind: 'resolved', sessionId: 'rhythm-coordinator-root-2', projectId: 'project-foreign' });
    expect(JSON.stringify(foreign)).not.toContain('project-a');

    allowed.set(7, new Set());
    expect(first.resolvePrimary(auth, {})).toEqual({ kind: 'setup_unavailable' });
  });

  it('creates a fresh authenticated setup root without adopting a catalog project or prior general chat', async () => {
    db = database();
    const fresh = {
      id: 'fresh-owned-project', cwd: '/server-owned/coordinator-workspace', archivedAt: null,
      coordinatorOwnerUserId: 7,
      coordinatorSetupKey: 'fresh-setup-command',
      coordinatorSetupProvenance: 'c2_fresh_owned_workspace_v1',
      coordinatorWorkspaceGeneration: 1,
      coordinatorProfileId: 'profile-a',
    } as never;
    const allowed = new Map([[7, new Set(['fresh-owned-project'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    let setupCalls = 0;
    const coordinator = service(repository, db, allowed, {
      projects: { findById: (id: string) => id === 'fresh-owned-project' ? fresh : null } as never,
      projectSetup: {
        create: async ({ actor, commandKey, profileId }) => {
          setupCalls += 1;
          expect({ owner: actor.user.id, commandKey, profileId }).toEqual({
            owner: 7, commandKey: 'fresh-setup-command', profileId: 'profile-a',
          });
          return { kind: 'ready', project: fresh, created: setupCalls === 1 };
        },
      },
    });
    expect(await coordinator.setupPrimary(auth, { commandKey: 'fresh-setup-command', profileId: 'profile-a' }))
      .toMatchObject({
        kind: 'setup_created', projectId: 'fresh-owned-project', profileId: 'profile-a', workspaceGeneration: 1,
        conversation: { primaryOwnerRoot: true },
      });
    expect(await coordinator.setupPrimary(auth, { commandKey: 'fresh-setup-command', profileId: 'profile-a' }))
      .toMatchObject({ kind: 'setup_replay', projectId: 'fresh-owned-project' });
    expect(setupCalls).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_sessions WHERE project_id='fresh-owned-project'").get())
      .toEqual({ count: 1 });
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_sessions WHERE id IN ('chat-a','chat-b')").get())
      .toEqual({ count: 2 });
    expect(db.prepare("SELECT sdk_session_id FROM agent_sessions WHERE project_id='fresh-owned-project'").get())
      .toEqual({ sdk_session_id: null });
  });

  it('returns only current opaque profile choices when fresh setup is ambiguous, without creating a root or SDK work', async () => {
    db = database();
    const allowed = new Map([[7, new Set<string>()]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    let setupCalls = 0;
    const coordinator = service(repository, db, allowed, {
      configs: {
        getById: () => null,
        listEnabled: () => [
          { id: 'profile-a', label: 'Profile A', enabled: true, isAgent: true, locked: false, modelProvider: 'provider-a', modelId: 'model-a' },
          { id: 'profile-b', label: 'Profile B', enabled: true, isAgent: true, locked: false, modelProvider: 'provider-b', modelId: 'model-b' },
        ] as never,
      },
      projectSetup: {
        create: async ({ actor, commandKey, profileId }) => {
          setupCalls += 1;
          expect({ owner: actor.user.id, commandKey, profileId }).toEqual({
            owner: 7, commandKey: 'ambiguous-stock-command', profileId: undefined,
          });
          return {
            kind: 'choice_required',
            profileChoices: [
              { id: 'profile-a', label: 'Profile A' },
              { id: 'profile-b', label: 'Profile B' },
            ],
          };
        },
      },
    });

    expect(await coordinator.setupPrimary(auth, { commandKey: 'ambiguous-stock-command' })).toEqual({
      kind: 'setup_profile_choice_required',
      profileChoices: [
        { id: 'profile-a', label: 'Profile A' },
        { id: 'profile-b', label: 'Profile B' },
      ],
    });
    expect(setupCalls).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_sessions WHERE id LIKE 'rhythm-coordinator-root-%'").get())
      .toEqual({ count: 0 });
  });

  it('withholds a profile-choice response whose current eligibility changed while setup awaited', async () => {
    db = database();
    const allowed = new Map([[7, new Set<string>()]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    const profileA = { id: 'profile-a', label: 'Profile A', enabled: true, isAgent: true, locked: false, modelProvider: 'provider-a', modelId: 'model-a' };
    const profileB = { id: 'profile-b', label: 'Profile B', enabled: true, isAgent: true, locked: false, modelProvider: 'provider-b', modelId: 'model-b' };
    let profiles = [profileA, profileB];
    const coordinator = service(repository, db, allowed, {
      configs: {
        getById: () => null,
        listEnabled: () => profiles as never,
      },
      projectSetup: {
        create: async () => {
          profiles = [profileA];
          return {
            kind: 'choice_required',
            profileChoices: [
              { id: 'profile-a', label: 'Profile A' },
              { id: 'profile-b', label: 'Profile B' },
            ],
          };
        },
      },
    });

    expect(await coordinator.setupPrimary(auth, { commandKey: 'changed-profile-choice' }))
      .toEqual({ kind: 'setup_unavailable' });
    expect(db.prepare("SELECT COUNT(*) AS count FROM agent_sessions WHERE id LIKE 'rhythm-coordinator-root-%'").get())
      .toEqual({ count: 0 });
  });

  it('reserves an ordinary foreground turn once, never turns its acknowledgement into a transcript bubble, and withholds an ambiguous send', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found', conversation: { primaryOwnerRoot: true, controlRevision: 1 } });
    let calls = 0;
    const coordinator = service(repository, db, allowed, {
      foreground: {
        send: async (input) => {
          calls += 1;
          expect(input).toMatchObject({
            localSessionId: 'chat-a', sdkSessionId: 'sdk-a', projectId: 'project-a',
            profileId: 'profile-a', providerId: 'provider-a', modelId: 'model-a',
          });
          return { kind: 'unavailable' };
        },
      },
    });
    const input = {
      sessionId: 'chat-a', projectId: 'project-a', expectedControlRevision: 1,
      commandKey: 'ordinary-one', message: 'Please explain why this dashboard is stale.',
    };
    expect(await coordinator.receiveMessage(auth, input)).toMatchObject({ kind: 'foreground_uncertain' });
    expect(await coordinator.receiveMessage(auth, input)).toMatchObject({ kind: 'foreground_uncertain' });
    expect(calls).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM agent_session_messages WHERE session_id=?').get('chat-a'))
      .toEqual({ count: 0 });
  });

  it('returns only the existing local canonical history page after current owner/project authorization', () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found', conversation: { primaryOwnerRoot: true } });
    let reads = 0;
    const coordinator = service(repository, db, allowed, {
      messages: {
        listBySessionStructuredPage: (sessionId, limit, beforeId) => {
          reads += 1;
          expect({ sessionId, limit, beforeId }).toEqual({ sessionId: 'chat-a', limit: 20, beforeId: undefined });
          return {
            messages: [{ id: 41, role: 'assistant', text: 'persisted only' }] as never,
            nextCursor: null,
            hasMore: false,
          };
        },
      },
    });
    expect(coordinator.history(auth, { sessionId: 'chat-a', projectId: 'project-a', limit: 20, beforeId: undefined }))
      .toMatchObject({ kind: 'history', messages: [{ id: 41, text: 'persisted only' }], nextCursor: null, hasMore: false });
    expect(reads).toBe(1);
    allowed.set(7, new Set());
    expect(coordinator.history(auth, { sessionId: 'chat-a', projectId: 'project-a', limit: 20, beforeId: undefined }))
      .toEqual({ kind: 'history_unavailable' });
    expect(reads).toBe(1);
  });

  it('withholds every scoped CRUD/context path after current project revocation or archive, without appending a goal', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found' });
    const coordinator = service(repository, db, allowed);
    const request = { sessionId: 'chat-a', projectId: 'project-a' };
    expect(coordinator.open(auth, request)).toMatchObject({ kind: 'replay' });
    allowed.set(7, new Set());
    expect(coordinator.open(auth, request)).toEqual({ kind: 'not_found' });
    expect(await coordinator.status(auth, request)).toEqual({ kind: 'not_found' });
    expect(await coordinator.receiveMessage(auth, {
      ...request, expectedControlRevision: 1, commandKey: 'revoked-message', message: 'Add a workstream: must not persist',
    })).toEqual({ kind: 'not_found' });
    expect(coordinator.addGoal(auth, {
      ...request, expectedControlRevision: 1, commandKey: 'revoked-goal', objective: 'must not persist',
    })).toEqual({ kind: 'not_found' });
    expect(repository.get({ ownerUserId: 7, ...request })).toMatchObject({
      kind: 'found', conversation: { goals: [] },
    });
  });

  it('rechecks project authority after context assembly before exposing any status projection', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found' });
    const coordinator = service(repository, db, allowed, {
      context: {
        assemble: async () => {
          allowed.set(7, new Set());
          return {} as never;
        },
      } as never,
    });
    expect(await coordinator.status(auth, { sessionId: 'chat-a', projectId: 'project-a' }))
      .toEqual({ kind: 'not_found' });
  });

  it('treats an archived known project as non-disclosing for open, status, message, and goals', async () => {
    db = database();
    const allowed = new Map([[7, new Set(['project-a'])]]);
    const repository = new CoordinatorConversationsRepository(db, () => now);
    expect(repository.designatePrimaryOwnerRoot({ ownerUserId: 7, projectId: 'project-a', sessionId: 'chat-a' }))
      .toMatchObject({ kind: 'found' });
    let archived = false;
    const coordinator = service(repository, db, allowed, {
      projects: {
        findById: (id: string) => id === 'project-a'
          ? { id, cwd: '/safe/project-a', archivedAt: archived ? now.toISOString() : null }
          : null,
      } as never,
    });
    archived = true;
    const request = { sessionId: 'chat-a', projectId: 'project-a' };
    expect(coordinator.open(auth, request)).toEqual({ kind: 'not_found' });
    expect(await coordinator.status(auth, request)).toEqual({ kind: 'not_found' });
    expect(await coordinator.receiveMessage(auth, {
      ...request, expectedControlRevision: 1, commandKey: 'archived-message', message: 'Add a workstream: archive must hold',
    })).toEqual({ kind: 'not_found' });
    expect(coordinator.addGoal(auth, {
      ...request, expectedControlRevision: 1, commandKey: 'archived-goal', objective: 'archive must hold',
    })).toEqual({ kind: 'not_found' });
    expect(repository.get({ ownerUserId: 7, ...request })).toMatchObject({ kind: 'found', conversation: { goals: [] } });
  });
});
