import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb } from '../database/db';
import { runMigrations } from '../database/migrations';
import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';
import { ProjectsRepository } from '../repositories/projects_repository';
import { UsersRepository } from '../repositories/users_repository';
import { MobileOpenCodeProxy } from '../services/mobile_opencode_proxy';
import type {
  MobileOpenCodeOwnershipStore,
} from '../repositories/mobile_opencode_ownership_repository';

/**
 * #1379 — the phone reads sessions, archived sessions, transcripts, and
 * children from api_server's SQLite mirror instead of live-proxying to the
 * engine on :4096.
 *
 * The load-bearing properties, all pinned below:
 *   1. A mirrored read reaches the engine ZERO times.
 *   2. The response keeps the engine's shape (served behind the existing
 *      engine-shaped operationIds, so the pinned contractFingerprint and every
 *      paired phone are untouched).
 *   3. Anything the mirror cannot answer authoritatively falls through live
 *      rather than serving a partial or reconstructed answer.
 *   4. Ownership and redaction are re-applied on every mirror-served read.
 */

const PROJECT_ROOT = '/private/tmp/rhythm-1379-project';

let db: Database.Database;
let projectId: string;
let OWNER: number;
let OTHER_OWNER: number;
let sessions: AgentSessionsRepository;
let messages: AgentSessionMessagesRepository;

/** Denies every ownership row, so nothing is served by the engine fast path. */
const denyingOwnership: MobileOpenCodeOwnershipStore = {
  isResourceOwnedBy: () => false,
  isResourceExplicitlyOwnedBy: () => false,
  claimResource: () => false,
  releaseResource: () => false,
};

function project() {
  return { id: projectId, root: PROJECT_ROOT };
}

/** A fetch that fails the test if the engine is contacted at all. */
function forbiddenFetch() {
  return vi.fn(async () => {
    throw new Error('the mirror path must not contact the engine');
  });
}

function makeSession(input: {
  sdkSessionId: string;
  name: string;
  ownerUserId?: number;
  projectId?: string | null;
  parentSessionId?: string;
}) {
  const session = sessions.insert({
    agentKind: 'claude-code',
    cwd: PROJECT_ROOT,
    name: input.name,
    ownerUserId: input.ownerUserId ?? OWNER,
    projectId: input.projectId === undefined ? projectId : input.projectId,
    taskId: null,
    taskTitle: null,
    ...(input.parentSessionId
      ? { parentSessionId: input.parentSessionId }
      : {}),
  });
  sessions.setSdkSessionId(session.id, input.sdkSessionId);
  return sessions.findById(session.id)!;
}

/** Persist one message the way the stream bridge does, info_json included. */
function mirrorMessage(
  localSessionId: string,
  info: Record<string, unknown>,
  parts: Array<Record<string, unknown>>,
) {
  for (const part of parts) {
    messages.upsertPart(localSessionId, info.id as string, part);
  }
  messages.upsertMessageInfo(
    localSessionId,
    info.id as string,
    info.role === 'assistant' ? 'output' : 'input',
    null,
    null,
    JSON.stringify(info),
  );
}

function assistantInfo(id: string, sdkSessionId: string) {
  return {
    id,
    sessionID: sdkSessionId,
    role: 'assistant',
    modelID: 'claude-opus-5',
    providerID: 'anthropic',
    // Only info_json carries these; a reconstruction from role/tokens/cost
    // would silently drop them and the phone renders both.
    summary: false,
    error: { name: 'ProviderError', data: { message: 'rate limited' } },
    time: { created: 1_754_000_000_000, completed: 1_754_000_001_000 },
    tokens: { input: 12, output: 34 },
    cost: 0.42,
  };
}

async function forward(
  proxy: MobileOpenCodeProxy,
  path: string,
  query: Record<string, string> = {},
  extra: Record<string, unknown> = {},
) {
  const result = await proxy.forward({
    method: 'GET',
    path,
    query: new URLSearchParams(query),
    project: project(),
    userId: OWNER,
    ...extra,
  });
  return {
    result,
    json: JSON.parse(Buffer.from(result.body).toString('utf8')) as unknown,
  };
}

/**
 * Assert the read fell through to the live engine. What the engine then answers
 * is its own business — an unauthorized id legitimately 404s — so the outcome
 * is swallowed and only the fall-through itself is pinned.
 */
async function expectFellThroughLive(
  fetchFn: ReturnType<typeof vi.fn>,
  attempt: Promise<unknown>,
  because: string,
) {
  await attempt.catch(() => undefined);
  expect(fetchFn, because).toHaveBeenCalled();
}

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db);
  setDb(db);
  sessions = new AgentSessionsRepository();
  messages = new AgentSessionMessagesRepository();
  const users = new UsersRepository();
  OWNER = users.create({ email: 'owner@rhythm.test', name: 'Owner' }).id;
  OTHER_OWNER = users.create({
    email: 'other@rhythm.test',
    name: 'Other',
  }).id;
  projectId = new ProjectsRepository().insert({
    cwd: PROJECT_ROOT,
    icon: null,
    name: 'Rhythm 1379',
    vcs: {
      vcsRoot: null,
      vcsBranch: null,
      vcsDirty: false,
      vcsCheckedAt: null,
    },
  }).id;
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
});

describe('#1379 mirror-served session list', () => {
  it('serves the project-scoped list without touching the engine', async () => {
    makeSession({ sdkSessionId: 'ses_a', name: 'First chat' });
    makeSession({ sdkSessionId: 'ses_b', name: 'Second chat' });
    const fetchFn = forbiddenFetch();
    const proxy = new MobileOpenCodeProxy({
      fetchFn,
      ownershipRepository: denyingOwnership,
    });

    const { result, json } = await forward(proxy, '/experimental/session');

    expect(result.status).toBe(200);
    expect(fetchFn).not.toHaveBeenCalled();
    const items = json as Array<Record<string, unknown>>;
    expect(items.map((item) => item.id).sort()).toEqual(['ses_a', 'ses_b']);
    // Engine session shape: id / title / time.{created,updated}.
    for (const item of items) {
      expect(typeof item.id).toBe('string');
      expect(typeof item.title).toBe('string');
      expect(item.time).toMatchObject({
        created: expect.any(Number),
        updated: expect.any(Number),
      });
    }
  });

  it('never leaks another user\'s sessions', async () => {
    makeSession({ sdkSessionId: 'ses_mine', name: 'Mine' });
    makeSession({
      sdkSessionId: 'ses_theirs',
      name: 'Theirs',
      ownerUserId: OTHER_OWNER,
    });
    const proxy = new MobileOpenCodeProxy({
      fetchFn: forbiddenFetch(),
      ownershipRepository: denyingOwnership,
    });

    const { json } = await forward(proxy, '/experimental/session');

    expect((json as Array<{ id: string }>).map((item) => item.id)).toEqual([
      'ses_mine',
    ]);
  });

  it('never leaks another project\'s sessions', async () => {
    makeSession({ sdkSessionId: 'ses_here', name: 'Here' });
    const otherProjectId = new ProjectsRepository().insert({
      cwd: '/private/tmp/rhythm-1379-other',
      icon: null,
      name: 'Other project',
      vcs: {
        vcsRoot: null,
        vcsBranch: null,
        vcsDirty: false,
        vcsCheckedAt: null,
      },
    }).id;
    makeSession({
      sdkSessionId: 'ses_elsewhere',
      name: 'Elsewhere',
      projectId: otherProjectId,
    });
    const proxy = new MobileOpenCodeProxy({
      fetchFn: forbiddenFetch(),
      ownershipRepository: denyingOwnership,
    });

    const { json } = await forward(proxy, '/experimental/session');

    expect((json as Array<{ id: string }>).map((item) => item.id)).toEqual([
      'ses_here',
    ]);
  });

  it('serves the archived list from the mirror archived_at column', async () => {
    const active = makeSession({ sdkSessionId: 'ses_active', name: 'Active' });
    const archived = makeSession({
      sdkSessionId: 'ses_archived',
      name: 'Archived',
    });
    sessions.setArchived(archived.id, true);
    expect(active.id).not.toBe(archived.id);
    const proxy = new MobileOpenCodeProxy({
      fetchFn: forbiddenFetch(),
      ownershipRepository: denyingOwnership,
    });

    const live = await forward(proxy, '/experimental/session', {
      archived: 'false',
    });
    const gone = await forward(proxy, '/experimental/session', {
      archived: 'true',
    });

    expect((live.json as Array<{ id: string }>).map((i) => i.id)).toEqual([
      'ses_active',
    ]);
    const archivedItems = gone.json as Array<Record<string, unknown>>;
    expect(archivedItems.map((i) => i.id)).toEqual(['ses_archived']);
    expect(
      (archivedItems[0].time as Record<string, number>).archived,
    ).toBeGreaterThan(0);
  });

  it('falls through to the engine when the mirror knows no session for the project', async () => {
    const fetchFn = vi.fn(async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const proxy = new MobileOpenCodeProxy({
      fetchFn,
      ownershipRepository: denyingOwnership,
    });

    await expectFellThroughLive(
      fetchFn,
      forward(proxy, '/experimental/session'),
      'an empty mirror must not be mistaken for an empty project',
    );
  });

  it('falls through to the engine when an exact-session lookup misses', async () => {
    makeSession({ sdkSessionId: 'ses_known', name: 'Known' });
    const fetchFn = vi.fn(async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const proxy = new MobileOpenCodeProxy({
      fetchFn,
      ownershipRepository: denyingOwnership,
    });

    await expectFellThroughLive(
      fetchFn,
      forward(proxy, '/experimental/session', { search: 'ses_unknown' }),
      'exact-session pinning must never false-negative from the mirror',
    );
  });

  it('paginates with the engine x-next-cursor header contract', async () => {
    for (let index = 0; index < 3; index += 1) {
      makeSession({ sdkSessionId: `ses_${index}`, name: `Chat ${index}` });
    }
    const proxy = new MobileOpenCodeProxy({
      fetchFn: forbiddenFetch(),
      ownershipRepository: denyingOwnership,
    });

    const first = await forward(proxy, '/experimental/session', {
      limit: '2',
      cursor: '0',
    });
    expect((first.json as unknown[]).length).toBe(2);
    expect(first.result.headers?.['x-next-cursor']).toBe('2');

    const second = await forward(proxy, '/experimental/session', {
      limit: '2',
      cursor: '2',
    });
    expect((second.json as unknown[]).length).toBe(1);
    expect(second.result.headers?.['x-next-cursor']).toBeUndefined();
  });
});

describe('#1379 mirror-served transcript', () => {
  it('returns the engine {info, parts} shape verbatim, engine untouched', async () => {
    const session = makeSession({ sdkSessionId: 'ses_t', name: 'Transcript' });
    const info = assistantInfo('msg_1', 'ses_t');
    mirrorMessage(session.id, info, [
      { id: 'prt_1', type: 'text', text: 'hello from the mirror' },
    ]);
    const fetchFn = forbiddenFetch();
    const proxy = new MobileOpenCodeProxy({
      fetchFn,
      ownershipRepository: denyingOwnership,
    });

    const { result, json } = await forward(proxy, '/session/ses_t/message');

    expect(result.status).toBe(200);
    expect(fetchFn).not.toHaveBeenCalled();
    const records = json as Array<{
      info: Record<string, unknown>;
      parts: Array<Record<string, unknown>>;
    }>;
    expect(records).toHaveLength(1);
    // The fields only info_json can carry — a reconstruction would drop these.
    expect(records[0].info.id).toBe('msg_1');
    expect(records[0].info.role).toBe('assistant');
    expect(records[0].info.modelID).toBe('claude-opus-5');
    expect(records[0].info.summary).toBe(false);
    expect(records[0].info.error).toMatchObject({ name: 'ProviderError' });
    expect(records[0].info.time).toMatchObject({ completed: 1_754_000_001_000 });
    expect(records[0].parts[0]).toMatchObject({
      type: 'text',
      text: 'hello from the mirror',
    });
  });

  it('orders the page oldest-first and honours the before cursor', async () => {
    const session = makeSession({ sdkSessionId: 'ses_p', name: 'Paged' });
    for (const id of ['msg_1', 'msg_2', 'msg_3']) {
      mirrorMessage(session.id, assistantInfo(id, 'ses_p'), [
        { id: `prt_${id}`, type: 'text', text: id },
      ]);
    }
    const proxy = new MobileOpenCodeProxy({
      fetchFn: forbiddenFetch(),
      ownershipRepository: denyingOwnership,
    });

    const all = await forward(proxy, '/session/ses_p/message');
    expect(
      (all.json as Array<{ info: { id: string } }>).map((m) => m.info.id),
    ).toEqual(['msg_1', 'msg_2', 'msg_3']);

    // `before` is exclusive, matching the engine's cursor contract.
    const older = await forward(proxy, '/session/ses_p/message', {
      before: 'msg_3',
    });
    expect(
      (older.json as Array<{ info: { id: string } }>).map((m) => m.info.id),
    ).toEqual(['msg_1', 'msg_2']);
  });

  it('scrubs host paths out of mirror-served parts', async () => {
    const session = makeSession({ sdkSessionId: 'ses_s', name: 'Scrub' });
    mirrorMessage(session.id, assistantInfo('msg_1', 'ses_s'), [
      {
        id: 'prt_1',
        type: 'tool',
        callID: 'call_1',
        tool: 'read',
        state: {
          status: 'completed',
          input: { filePath: `${PROJECT_ROOT}/secret/notes.md` },
        },
      },
    ]);
    const proxy = new MobileOpenCodeProxy({
      fetchFn: forbiddenFetch(),
      ownershipRepository: denyingOwnership,
    });

    const { json } = await forward(proxy, '/session/ses_s/message');

    expect(JSON.stringify(json)).not.toContain(PROJECT_ROOT);
  });

  it('falls through live when a row predates info_json', async () => {
    const session = makeSession({ sdkSessionId: 'ses_l', name: 'Legacy' });
    // Exactly the pre-migration state: parts persisted, no engine info.
    messages.upsertPart(session.id, 'msg_legacy', {
      id: 'prt_1',
      type: 'text',
      text: 'legacy',
    });
    const fetchFn = vi.fn(async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const proxy = new MobileOpenCodeProxy({
      fetchFn,
      ownershipRepository: denyingOwnership,
    });

    await expectFellThroughLive(
      fetchFn,
      forward(proxy, '/session/ses_l/message'),
      'a partly-mirrored transcript must never be served as whole',
    );
  });

  it('falls through live for a session the mirror does not know', async () => {
    makeSession({ sdkSessionId: 'ses_known', name: 'Known' });
    const fetchFn = vi.fn(async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const proxy = new MobileOpenCodeProxy({
      fetchFn,
      ownershipRepository: denyingOwnership,
    });

    await expectFellThroughLive(
      fetchFn,
      forward(proxy, '/session/ses_unmirrored/message'),
      'an unmirrored session must reach the engine',
    );
  });

  it('refuses to serve another user\'s transcript from the mirror', async () => {
    const theirs = makeSession({
      sdkSessionId: 'ses_theirs',
      name: 'Theirs',
      ownerUserId: OTHER_OWNER,
    });
    mirrorMessage(theirs.id, assistantInfo('msg_1', 'ses_theirs'), [
      { id: 'prt_1', type: 'text', text: 'private' },
    ]);
    const fetchFn = vi.fn(async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const proxy = new MobileOpenCodeProxy({
      fetchFn,
      ownershipRepository: denyingOwnership,
    });

    // Falls through to the engine, whose own authorization decides — the
    // mirror never hands over a row it does not own.
    let leaked = '';
    await forward(proxy, '/session/ses_theirs/message')
      .then(({ json }) => { leaked = JSON.stringify(json); })
      .catch(() => undefined);

    expect(fetchFn).toHaveBeenCalled();
    expect(leaked).not.toContain('private');
  });

  it('falls through live when the paging cursor is unknown to the mirror', async () => {
    const session = makeSession({ sdkSessionId: 'ses_c', name: 'Cursor' });
    mirrorMessage(session.id, assistantInfo('msg_1', 'ses_c'), [
      { id: 'prt_1', type: 'text', text: 'one' },
    ]);
    const fetchFn = vi.fn(async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const proxy = new MobileOpenCodeProxy({
      fetchFn,
      ownershipRepository: denyingOwnership,
    });

    await expectFellThroughLive(
      fetchFn,
      forward(proxy, '/session/ses_c/message', { before: 'msg_missing' }),
      'an unknown cursor must not silently restart the page',
    );
  });
});

describe('#1379 mirror-served session children', () => {
  it('serves children from parent_session_id without touching the engine', async () => {
    const parent = makeSession({ sdkSessionId: 'ses_parent', name: 'Parent' });
    makeSession({
      sdkSessionId: 'ses_child',
      name: 'Child (@reviewer subagent)',
      parentSessionId: parent.id,
    });
    const fetchFn = forbiddenFetch();
    const proxy = new MobileOpenCodeProxy({
      fetchFn,
      ownershipRepository: denyingOwnership,
    });

    const { result, json } = await forward(
      proxy,
      '/session/ses_parent/children',
    );

    expect(result.status).toBe(200);
    expect(fetchFn).not.toHaveBeenCalled();
    const children = json as Array<Record<string, unknown>>;
    expect(children.map((child) => child.id)).toEqual(['ses_child']);
    expect(children[0].parentID).toBe('ses_parent');
  });

  it('serves an authoritative empty list for a mirrored leaf session', async () => {
    makeSession({ sdkSessionId: 'ses_leaf', name: 'Leaf' });
    const fetchFn = forbiddenFetch();
    const proxy = new MobileOpenCodeProxy({
      fetchFn,
      ownershipRepository: denyingOwnership,
    });

    const { json } = await forward(proxy, '/session/ses_leaf/children');

    expect(json).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('falls through live when the parent is not a mirror row the caller owns', async () => {
    makeSession({
      sdkSessionId: 'ses_theirs',
      name: 'Theirs',
      ownerUserId: OTHER_OWNER,
    });
    const fetchFn = vi.fn(async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const proxy = new MobileOpenCodeProxy({
      fetchFn,
      ownershipRepository: denyingOwnership,
    });

    await expectFellThroughLive(
      fetchFn,
      forward(proxy, '/session/ses_theirs/children'),
      'a parent the caller does not own must reach the engine',
    );
  });
});

describe('#1379 mirror reads never displace live paths', () => {
  it('keeps owner-unscoped discovery on its own mirror path', async () => {
    makeSession({ sdkSessionId: 'ses_x', name: 'Cross project' });
    const fetchFn = forbiddenFetch();
    const proxy = new MobileOpenCodeProxy({
      fetchFn,
      ownershipRepository: denyingOwnership,
    });

    const { json } = await forward(
      proxy,
      '/experimental/session',
      {},
      { ownerUnscopedDiscovery: true },
    );

    expect((json as Array<{ id: string }>).map((item) => item.id)).toEqual([
      'ses_x',
    ]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('still forwards working-tree reads to the engine', async () => {
    makeSession({ sdkSessionId: 'ses_w', name: 'Worktree' });
    const fetchFn = vi.fn(async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const proxy = new MobileOpenCodeProxy({
      fetchFn,
      ownershipRepository: denyingOwnership,
    });

    await expectFellThroughLive(
      fetchFn,
      forward(proxy, '/file', { path: '.' }),
      'file/vcs/find/diff reflect the live tree and must never be mirrored',
    );
  });
});
