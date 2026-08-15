/**
 * W7 — integrated live behavioural gate for the self-improvement engine
 * foundation (docs/ai/plans/2026-08-14-self-improvement-engine-foundation.md,
 * work package W7 steps 2–9).
 *
 * This suite drives the RUNNING sandbox api_server over real HTTP. Nothing in
 * it is mocked: proposals are reverted through `POST /agent-org-proposals/:id/
 * revert`, profiles are created/edited through `/agent-configs`, and scope
 * classification is exercised by a real `POST /agent-org-optimizer/run`. Every
 * assertion is on an OBSERVABLE outcome — HTTP status, the persisted scope
 * bytes, the proposal rows a run actually produced — never on "a function was
 * called" (AGENTS.md "Behavioral verification gate", rule 3).
 *
 * ── Running it ──────────────────────────────────────────────────────────────
 * It is inert in a normal `vitest run`: without RHYTHM_LIVE_E2E=1 the whole
 * describe block is skipped. Bring the sandbox up ONLY through
 * `tools/dev/sandbox.sh up --foreground` — never by hand. An api_server started
 * without RHYTHM_OPENCODE_ENGINE_PORT defaults its engine port to 4096, the
 * desktop app's LIVE engine, and its stale-port reclamation SIGKILLs whatever
 * holds that port.
 *
 *   RHYTHM_LIVE_E2E=1 \
 *   RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4098 \
 *   DB_PATH=/tmp/rhythm-dev-sandbox/rhythm.db \
 *   RHYTHM_LIVE_DB_PATH=/tmp/rhythm-dev-sandbox/rhythm.db \
 *     npx vitest run --reporter=verbose \
 *       src/__tests__/live_e2e_self_improvement_foundation.test.ts
 *
 * ── Fixture policy ──────────────────────────────────────────────────────────
 * Everything that HAS a real API surface is seeded through it: profiles and
 * their scope bytes go through `/agent-configs`. Direct SQLite writes against
 * RHYTHM_LIVE_DB_PATH are used ONLY where no API can create the fixture, and
 * each such write says why inline. Those are:
 *   • `agent_org_proposals` rows — there is no POST route that creates a
 *     proposal in a chosen lifecycle state; the optimizer is the only writer.
 *   • `agent_sessions` / `agent_session_messages` telemetry — the only
 *     producer is the live engine's stream bridge, and the observation floors
 *     (>= 10 executed sessions, >= 7 days of profile age) cannot be reached by
 *     a test running against a freshly created profile.
 *
 * Every test cleans up what it seeded and is safe to run twice in a row: all
 * fixture ids are freshly randomized per run, and optimizer output is deleted
 * by the `audit_run_id` the run itself reports.
 *
 * ── Known limits, stated plainly ────────────────────────────────────────────
 * As committed, this suite has NEVER BEEN EXECUTED. It was written under a
 * hard no-server constraint, so its fixture shapes are validated only against
 * the producer/validator source, not against a running backend.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { createScopeDeltaV2Snapshot } from '../services/scope_mutation_contract';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = enabled ? describe : describe.skip;

/** Wide: a full optimizer pass audits, runs every generator, and sweeps. */
const OPTIMIZER_RUN_TIMEOUT_MS = 900_000;

function baseUrl(): string {
  return (process.env.RHYTHM_LIVE_URL ?? '').replace(/\/$/, '');
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

let db: Database.Database;

/** A slug id the `/agent-configs` POST route accepts (^[a-z0-9]+(-[a-z0-9]+)*$). */
function profileSlug(role: string): string {
  return `w7live-${role}-${randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/** The authoritative scope bytes: the column the CAS/inverse machinery reads. */
function scopeBytes(profileId: string): string | null {
  const row = db
    .prepare(`SELECT allowed_mcps_json AS v FROM agent_configs WHERE id = ?`)
    .get(profileId) as { v: string | null } | undefined;
  if (!row) throw new Error(`profile ${profileId} vanished`);
  return row.v;
}

function proposalStatus(id: string): string | null {
  const row = db
    .prepare(`SELECT status FROM agent_org_proposals WHERE id = ?`)
    .get(id) as { status: string } | undefined;
  return row?.status ?? null;
}

async function createProfile(role: string, allowedMcpsJson: string): Promise<string> {
  const id = profileSlug(role);
  const created = await api('/agent-configs', {
    method: 'POST',
    body: JSON.stringify({
      id,
      label: `W7 live ${role}`,
      icon: '',
      command: '',
      allowedMcpsJson,
      sessionSelectable: false,
      schedulable: false,
    }),
  });
  expect(created.status).toBe(200);
  return id;
}

async function deleteProfile(id: string): Promise<void> {
  await api(`/agent-configs/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => undefined);
}

/**
 * Seed an `agent_org_proposals` row directly.
 *
 * Direct SQLite: there is no create route for proposals, and no route can put
 * one into `status='active'` — which is the ONLY status the revert endpoint
 * accepts (org_proposals_controller.revert).
 */
function seedProposal(row: {
  id: string;
  kind: string;
  risk: string;
  status: string;
  title: string;
  targetRef: string;
  changeJson: string;
  beforeSnapshotJson: string;
  dedupKey: string;
}): void {
  db.prepare(
    `INSERT INTO agent_org_proposals
       (id, kind, risk, status, title, target_ref, change_json, before_snapshot_json, dedup_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.kind,
    row.risk,
    row.status,
    row.title,
    row.targetRef,
    row.changeJson,
    row.beforeSnapshotJson,
    row.dedupKey,
  );
}

function deleteProposal(id: string): void {
  db.prepare(`DELETE FROM agent_org_proposals WHERE id = ?`).run(id);
}

// ── Telemetry fixtures ─────────────────────────────────────────────────────
//
// Direct SQLite for everything below: the only producer of agent_sessions /
// agent_session_messages rows is the live engine's stream bridge, and the
// tighten-scope data-sufficiency floors (>= MIN_TIGHTEN_ACTIVITY_COUNT executed
// sessions AND >= MIN_TIGHTEN_OBSERVATION_DAYS of profile age) are unreachable
// for a profile a test just created through the API.

interface ToolPartSpec {
  tool: string;
  status: 'completed' | 'error';
  /** ms epoch for state.time.start; end is start + durationMs. */
  startedAt: number;
  durationMs: number;
  /** Distinguishes "same operation retried" from "different operation". */
  input: Record<string, unknown>;
}

/**
 * A `type:'tool'` part shaped exactly as the fork producer emits it
 * (opencode_fork session/message-v2.ts). Both consumers of this evidence —
 * org_exercised_tools_resolver.evaluateToolPart and
 * persisted_tool_evidence.ts — fail CLOSED on any shape deviation, so a
 * sloppy fixture would read as "unavailable/invalid telemetry" rather than
 * as the successful or failed call the test intends.
 */
function toolPart(spec: ToolPartSpec, sdkSessionId: string, sdkMessageId: string): unknown {
  const time = { start: spec.startedAt, end: spec.startedAt + spec.durationMs };
  const state =
    spec.status === 'completed'
      ? { status: 'completed', input: spec.input, output: 'ok', title: spec.tool, metadata: {}, time }
      : { status: 'error', input: spec.input, error: 'seeded failure', metadata: {}, time };
  return {
    id: `prt_${randomUUID().replace(/-/g, '')}`,
    sessionID: sdkSessionId,
    messageID: sdkMessageId,
    type: 'tool',
    callID: `call_${randomUUID().replace(/-/g, '')}`,
    tool: spec.tool,
    state,
  };
}

const seededSessionIds: string[] = [];

/**
 * One session attributed to `profileId` via the interactive `mcp_role` join
 * (scheduled_task_id stays NULL so scheduled ownership never competes), with
 * one `role='output'` message carrying `parts`.
 *
 * `partsJsonOverride` lets a caller persist a deliberately MALFORMED container
 * — the only way to reproduce genuinely unavailable telemetry
 * (`unreadable-source`) without taking the whole database offline.
 */
function seedSession(
  profileId: string,
  parts: ToolPartSpec[],
  opts: { text?: string; partsJsonOverride?: string; ageDays?: number } = {},
): string {
  const sessionId = randomUUID();
  const sdkSessionId = `ses_${randomUUID().replace(/-/g, '')}`;
  const sdkMessageId = `msg_${randomUUID().replace(/-/g, '')}`;
  const createdAt = new Date(Date.now() - (opts.ageDays ?? 2) * 86_400_000).toISOString();

  db.prepare(
    `INSERT INTO agent_sessions
       (id, agent_kind, status, cwd, name, mcp_role, sdk_session_id, created_at, updated_at)
     VALUES (?, 'w7-live', 'completed', '/tmp', ?, ?, ?, ?, ?)`,
  ).run(sessionId, `w7 live ${profileId}`, profileId, sdkSessionId, createdAt, createdAt);
  seededSessionIds.push(sessionId);

  const partsJson =
    opts.partsJsonOverride ??
    JSON.stringify(parts.map((spec) => toolPart(spec, sdkSessionId, sdkMessageId)));
  const text = opts.text ?? 'seeded output';
  db.prepare(
    `INSERT INTO agent_session_messages
       (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json, created_at)
     VALUES (?, 'output', ?, ?, ?, ?, ?)`,
  ).run(sessionId, text, text, sdkMessageId, partsJson, createdAt);

  return sessionId;
}

function deleteSeededSessions(): void {
  for (const id of seededSessionIds.splice(0)) {
    db.prepare(`DELETE FROM agent_session_messages WHERE session_id = ?`).run(id);
    db.prepare(`DELETE FROM agent_sessions WHERE id = ?`).run(id);
  }
}

/**
 * Back-date the profile so it clears MIN_TIGHTEN_OBSERVATION_DAYS. The audit
 * derives the observation window from `agent_configs.created_at` (the only
 * per-grant age proxy that exists), and no API can create a week-old profile.
 */
function backdateProfile(profileId: string, days: number): void {
  const when = new Date(Date.now() - days * 86_400_000).toISOString();
  db.prepare(`UPDATE agent_configs SET created_at = ? WHERE id = ?`).run(when, profileId);
}

/** MIN_TIGHTEN_ACTIVITY_COUNT is 10; seed comfortably past it. */
const OBSERVED_SESSION_COUNT = 12;
const OBSERVED_PROFILE_AGE_DAYS = 30;

interface OptimizerRun {
  auditRunId: string;
}

/**
 * Drive one real optimizer pass. `maxLlmCallsPerRun: 0` starves the LLM
 * diagnosis/refine lanes; the deterministic scope-hygiene and workflow-signal
 * lanes — the ones under test — do not consult a model at all. The proposal
 * cap is set high so scope hygiene (the FIRST generator) can never be cut off
 * before it reaches the seeded profiles, which would make an absence
 * assertion vacuously true.
 */
async function runOptimizer(): Promise<OptimizerRun> {
  const response = await api('/agent-org-optimizer/run', {
    method: 'POST',
    body: JSON.stringify({ maxProposalsPerRun: 500, maxLlmCallsPerRun: 0 }),
  });
  expect(response.status).toBe(200);
  const result = (await response.json()) as { auditRunId?: string; skipped?: boolean; skippedReason?: string };
  expect(
    result.skipped ?? false,
    `optimizer refused to run: ${result.skippedReason ?? '(no reason given)'} — ` +
      'the engine cold-start window must have elapsed before this gate runs',
  ).toBe(false);
  expect(typeof result.auditRunId).toBe('string');
  return { auditRunId: result.auditRunId as string };
}

/** Proposals this exact run created, read back from the durable row. */
function proposalsFromRun(auditRunId: string): Array<{
  id: string;
  kind: string;
  title: string;
  changeJson: string | null;
  targetRef: string | null;
}> {
  return db
    .prepare(
      `SELECT id, kind, title, change_json AS changeJson, target_ref AS targetRef
         FROM agent_org_proposals WHERE audit_run_id = ?`,
    )
    .all(auditRunId) as Array<{
    id: string;
    kind: string;
    title: string;
    changeJson: string | null;
    targetRef: string | null;
  }>;
}

function deleteRunProposals(auditRunId: string): void {
  db.prepare(`DELETE FROM agent_org_proposals WHERE audit_run_id = ?`).run(auditRunId);
}

function mentionsProfile(
  row: { changeJson: string | null; targetRef: string | null; title: string },
  profileId: string,
): boolean {
  return (
    (row.changeJson ?? '').includes(profileId) ||
    (row.targetRef ?? '').includes(profileId) ||
    row.title.includes(profileId)
  );
}

/**
 * A live MCP server id to build canonical `<server>_<tool>` callables from.
 * The plan names `gitnexus` and `pco-services`; both are preferred when the
 * sandbox engine actually has them, because they are the exact identities the
 * live audit found being compared against full tool names.
 */
async function liveMcpServerIds(): Promise<string[]> {
  const response = await api('/opencode/mcp');
  expect(response.status).toBe(200);
  const body = (await response.json()) as unknown;
  const names = Array.isArray(body)
    ? body
        .map((entry) => (entry && typeof entry === 'object' ? (entry as { name?: unknown }).name : null))
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
    : Object.keys((body ?? {}) as Record<string, unknown>);
  const preferred = ['gitnexus', 'pco-services'].filter((id) => names.includes(id));
  return preferred.length > 0 ? preferred : names;
}

describeLive('W7 — self-improvement engine foundation, live behaviour', () => {
  beforeAll(async () => {
    assertLiveE2EIsolation();

    const url = baseUrl();
    if (!url) throw new Error('RHYTHM_LIVE_URL is required');
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      throw new Error(`RHYTHM_LIVE_URL must target localhost, got ${parsed.hostname}`);
    }
    if (parsed.port === '4001' || parsed.port === '4000' || parsed.port === '') {
      throw new Error(
        `RHYTHM_LIVE_URL must use a non-default sandbox port, got ${parsed.port || '(default)'}`,
      );
    }

    const dbPath = process.env.DB_PATH;
    const declaredLiveDb = process.env.RHYTHM_LIVE_DB_PATH;
    if (!dbPath || !declaredLiveDb || resolve(dbPath) !== resolve(declaredLiveDb)) {
      throw new Error('DB_PATH and RHYTHM_LIVE_DB_PATH must name the same sandbox DB');
    }
    db = new Database(dbPath);

    const health = await fetch(`${url}/health`);
    if (!health.ok) throw new Error(`sandbox api_server health failed: ${health.status}`);
  });

  afterAll(() => {
    deleteSeededSessions();
    db?.close();
  });

  // ── Plan step 2 ──────────────────────────────────────────────────────────
  it.skip(
    'W7-2: a shadow optimizer run creates proposals without changing target config, installing tools, or changing proposal target state',
    async () => {
      // BLOCKED ON W5 (`self-improvement/shadow-mode-reconciler`), which
      // introduces org_optimizer_policy.ts and the shadow gate on the
      // mutation/sweep phases. On this branch `runOrgOptimizer` still enters
      // the auto-apply lane, so there is no shadow mode to observe: the
      // assertion "target config bytes are identical before and after a
      // generating run" has no shipped behaviour to bind to yet.
      //
      // Shape once W5 lands: snapshot every agent_configs scope byte string,
      // POST /agent-org-optimizer/run, then assert (a) proposalsCreated > 0,
      // (b) every scope byte string is unchanged, (c) no proposal moved out of
      // 'proposed', and (d) the live MCP catalog from GET /opencode/mcp is
      // unchanged (nothing was installed).
    },
  );

  // ── Plan step 3 ──────────────────────────────────────────────────────────
  it('W7-3: a legacy whole-field scope snapshot cannot be reverted, and the config bytes are byte-for-byte unchanged', async () => {
    const priorValue = '["alpha-server","beta-server"]';
    const profileId = await createProfile('legacy', priorValue);
    const proposalId = randomUUID();

    try {
      const changeJson = JSON.stringify({
        agentConfigId: profileId,
        field: 'allowedMcpsJson',
        remove: ['beta-server'],
      });

      seedProposal({
        id: proposalId,
        kind: 'tighten-scope',
        risk: 'high',
        status: 'active',
        title: `W7 legacy scope rollback for ${profileId}`,
        targetRef: `agent_config:${profileId}`,
        changeJson,
        // The pre-W1 shape: a whole-field replay that would clobber every
        // unrelated change made since the proposal was applied.
        beforeSnapshotJson: JSON.stringify({ allowedMcpsJson: priorValue }),
        dedupKey: `w7-live-legacy:${proposalId}`,
      });

      const before = scopeBytes(profileId);

      const response = await api(`/agent-org-proposals/${encodeURIComponent(proposalId)}/revert`, {
        method: 'POST',
        body: '{}',
      });

      expect(response.status).toBe(409);
      const body = (await response.json()) as { error?: { message?: string } };
      expect(JSON.stringify(body)).toMatch(/legacy scope snapshot|reconciliation/i);

      // The two outcomes that matter: nothing was written, and the proposal
      // did NOT get to claim it was rolled back.
      expect(scopeBytes(profileId)).toBe(before);
      expect(scopeBytes(profileId)).toBe(priorValue);
      expect(proposalStatus(proposalId)).toBe('active');
    } finally {
      deleteProposal(proposalId);
      await deleteProfile(profileId);
    }
  }, 60_000);

  // ── Plan step 4 ──────────────────────────────────────────────────────────
  it('W7-4: a canonical scope-delta-v2 revert reports conflict against a concurrent edit and never clobbers it', async () => {
    const priorValue = '["alpha-server","beta-server","gamma-server"]';
    const profileId = await createProfile('cas', priorValue);
    const proposalId = randomUUID();

    try {
      const changeJson = JSON.stringify({
        agentConfigId: profileId,
        field: 'allowedMcpsJson',
        remove: ['beta-server'],
      });

      // Built with the production constructor: the snapshot is hash-bound to
      // its own bytes, so a hand-written fixture could only ever be rejected
      // as tampered — which would prove nothing about the CAS path.
      const snapshot = createScopeDeltaV2Snapshot(
        profileId,
        'allowedMcpsJson',
        priorValue,
        ['beta-server'],
        'tighten-scope',
        changeJson,
      );

      // Put the profile into the exact post-apply state the snapshot expects.
      const applied = await api(`/agent-configs/${encodeURIComponent(profileId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ allowedMcpsJson: snapshot.expectedAppliedValue }),
      });
      expect(applied.status).toBe(200);
      expect(scopeBytes(profileId)).toBe(snapshot.expectedAppliedValue);

      seedProposal({
        id: proposalId,
        kind: 'tighten-scope',
        risk: 'high',
        status: 'active',
        title: `W7 CAS scope rollback for ${profileId}`,
        targetRef: `agent_config:${profileId}`,
        changeJson,
        beforeSnapshotJson: JSON.stringify(snapshot),
        dedupKey: `w7-live-cas:${proposalId}`,
      });

      // The concurrent operator edit, made through the real config route.
      const concurrentValue = '["alpha-server","gamma-server","delta-server"]';
      const edit = await api(`/agent-configs/${encodeURIComponent(profileId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ allowedMcpsJson: concurrentValue }),
      });
      expect(edit.status).toBe(200);
      expect(scopeBytes(profileId)).toBe(concurrentValue);

      const response = await api(`/agent-org-proposals/${encodeURIComponent(proposalId)}/revert`, {
        method: 'POST',
        body: '{}',
      });

      expect(response.status).toBe(409);

      // The edit survives verbatim — the revert did not restore priorValue
      // over it, and did not partially rewrite it either.
      expect(scopeBytes(profileId)).toBe(concurrentValue);
      expect(scopeBytes(profileId)).not.toBe(priorValue);
      expect(scopeBytes(profileId)).not.toBe(snapshot.expectedAppliedValue);
      expect(proposalStatus(proposalId)).toBe('active');
    } finally {
      deleteProposal(proposalId);
      await deleteProfile(profileId);
    }
  }, 60_000);

  // ── Plan step 5 ──────────────────────────────────────────────────────────
  it('W7-5: successful <server>_<tool> usage resolves to the SERVER id and blocks an "unused" classification', async () => {
    const servers = await liveMcpServerIds();
    expect(
      servers.length,
      'the sandbox engine reports no MCP servers; canonical scope telemetry cannot be exercised',
    ).toBeGreaterThan(0);
    const server = servers[0];

    const usedId = await createProfile('used', JSON.stringify([server]));
    const unusedId = await createProfile('unused', JSON.stringify([server]));
    let auditRunId: string | null = null;

    try {
      backdateProfile(usedId, OBSERVED_PROFILE_AGE_DAYS);
      backdateProfile(unusedId, OBSERVED_PROFILE_AGE_DAYS);

      const start = Date.now() - 3_600_000;
      for (let i = 0; i < OBSERVED_SESSION_COUNT; i++) {
        // The exact live-audit shape: a FULL tool name, never the bare server
        // id. Before W2 this was compared against the server id and missed.
        seedSession(usedId, [
          { tool: `${server}_probe`, status: 'completed', startedAt: start + i * 1_000, durationMs: 10, input: { i } },
        ]);
        // Control: readable, available telemetry that simply never touched
        // this server. Without it, an absence assertion below could pass
        // because detection never ran at all.
        seedSession(unusedId, [
          { tool: 'read', status: 'completed', startedAt: start + i * 1_000, durationMs: 10, input: { i } },
        ]);
      }

      const run = await runOptimizer();
      auditRunId = run.auditRunId;
      const created = proposalsFromRun(auditRunId);
      const removals = created.filter((row) => row.kind === 'tighten-scope' || row.kind === 'prune-scope');

      // Positive control — detection genuinely reached these profiles.
      expect(
        removals.filter((row) => mentionsProfile(row, unusedId)).length,
        'the never-used control produced no removal proposal, so this run proves nothing about the used profile',
      ).toBeGreaterThan(0);

      // The behaviour under test.
      expect(removals.filter((row) => mentionsProfile(row, usedId))).toEqual([]);
    } finally {
      if (auditRunId) deleteRunProposals(auditRunId);
      deleteSeededSessions();
      await deleteProfile(usedId);
      await deleteProfile(unusedId);
    }
  }, OPTIMIZER_RUN_TIMEOUT_MS);

  // ── Plan step 6 ──────────────────────────────────────────────────────────
  it('W7-6: unavailable telemetry authorizes no removal decision, while an observed control still produces one', async () => {
    const servers = await liveMcpServerIds();
    expect(
      servers.length,
      'the sandbox engine reports no MCP servers; canonical scope telemetry cannot be exercised',
    ).toBeGreaterThan(0);
    const server = servers[0];

    const blindId = await createProfile('blind', JSON.stringify([server]));
    const observedId = await createProfile('observed', JSON.stringify([server]));
    let auditRunId: string | null = null;

    try {
      backdateProfile(blindId, OBSERVED_PROFILE_AGE_DAYS);
      backdateProfile(observedId, OBSERVED_PROFILE_AGE_DAYS);

      const start = Date.now() - 3_600_000;
      for (let i = 0; i < OBSERVED_SESSION_COUNT; i++) {
        seedSession(observedId, [
          { tool: 'read', status: 'completed', startedAt: start + i * 1_000, durationMs: 10, input: { i } },
        ]);
        // One structurally broken container is enough: the resolver reports
        // `unreadable-source` for the whole profile, which is the point —
        // "we could not observe" must never read as "observed zero use".
        seedSession(
          blindId,
          [],
          i === 0 ? { partsJsonOverride: '{"parts":"not-an-array"}' } : {},
        );
      }

      const run = await runOptimizer();
      auditRunId = run.auditRunId;
      const created = proposalsFromRun(auditRunId);
      const removals = created.filter((row) => row.kind === 'tighten-scope' || row.kind === 'prune-scope');

      expect(
        removals.filter((row) => mentionsProfile(row, observedId)).length,
        'the observed control produced no removal proposal, so this run proves nothing about the blind profile',
      ).toBeGreaterThan(0);

      expect(removals.filter((row) => mentionsProfile(row, blindId))).toEqual([]);
    } finally {
      if (auditRunId) deleteRunProposals(auditRunId);
      deleteSeededSessions();
      await deleteProfile(blindId);
      await deleteProfile(observedId);
    }
  }, OPTIMIZER_RUN_TIMEOUT_MS);

  // ── Plan step 7 ──────────────────────────────────────────────────────────
  it.skip(
    'W7-7: a completed user session yields exactly one terminal outcome plus append-only feedback events',
    async () => {
      // BLOCKED ON W4 (`self-improvement/outcome-ledger`), which adds the
      // agent_run_outcomes table, the append-only feedback events table, and
      // the run-outcome routes. Neither the table nor the route exists on this
      // branch, so there is nothing to observe.
      //
      // Shape once W4 lands: run a real session to a terminal state, then
      // assert exactly ONE outcome row for the root run id (a duplicate
      // terminal event must not create a second), POST an explicit user
      // verdict, POST a contradicting inferred verdict, and assert BOTH
      // feedback events are readable and the explicit one still wins.
    },
  );

  // ── Plan step 8 ──────────────────────────────────────────────────────────
  it('W7-8: a self-improvement session that clears every other harvest gate still produces no harvested skill', async () => {
    const profileId = await createProfile('harvest', '[]');
    let sessionId: string | null = null;

    try {
      const create = await api('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          profileId,
          cwd: '/tmp',
          name: `W7 live harvest ${profileId}`,
        }),
      });
      expect(create.status).toBe(200);
      sessionId = ((await create.json()) as { id: string }).id;

      // Direct SQLite: no API surface sets a session's harvest-relevant
      // runtime metadata. `category='self_improvement'` + `is_system=1` is the
      // exact shape of the 11 drafts the live audit found being harvested
      // recursively out of the learner's own background work.
      db.prepare(`UPDATE agent_sessions SET category = 'self_improvement', is_system = 1 WHERE id = ?`).run(
        sessionId,
      );

      const skillsBefore = (
        db.prepare(`SELECT COUNT(*) AS n FROM agent_skills WHERE source = 'harvested'`).get() as { n: number }
      ).n;

      // Persist enough assistant rounds to clear the MIN_ROUNDS >= 2 gate, so
      // a failure to harvest cannot be blamed on "too short".
      const sdkSessionId = `ses_${randomUUID().replace(/-/g, '')}`;
      for (let round = 0; round < 3; round++) {
        const sdkMessageId = `msg_${randomUUID().replace(/-/g, '')}`;
        const text = `Round ${round}: a substantive, reusable procedure worth distilling into a skill.`;
        db.prepare(
          `INSERT INTO agent_session_messages
             (session_id, role, raw_text, stripped_text, sdk_message_id, parts_json)
           VALUES (?, 'output', ?, ?, ?, ?)`,
        ).run(
          sessionId,
          text,
          text,
          sdkMessageId,
          JSON.stringify([
            toolPart(
              { tool: 'read', status: 'completed', startedAt: Date.now() - 60_000 + round, durationMs: 5, input: { round } },
              sdkSessionId,
              sdkMessageId,
            ),
          ]),
        );
      }

      const messages = await api(`/agent-sessions/${encodeURIComponent(sessionId)}/messages`);
      expect(messages.status).toBe(200);
      const rounds = ((await messages.json()) as Array<{ role: string }>).filter(
        (message) => message.role === 'output',
      ).length;
      expect(rounds, 'the rounds gate must not be the reason nothing was harvested').toBeGreaterThanOrEqual(2);

      // Drive the REAL production trigger: a resumed turn ends by calling the
      // extraction queue. If the W3 eligibility gate were removed, this is
      // where a self-improvement session would feed itself back into the
      // harvester.
      const resume = await api(`/agent-sessions/${encodeURIComponent(sessionId)}/resume`, {
        method: 'POST',
        body: JSON.stringify({ profileId, message: 'Summarize what we just did in one sentence.' }),
      });
      expect([200, 202]).toContain(resume.status);

      // Harvesting is fire-and-forget; give it room to have happened.
      await new Promise((wait) => setTimeout(wait, 30_000));

      const skillsAfter = (
        db.prepare(`SELECT COUNT(*) AS n FROM agent_skills WHERE source = 'harvested'`).get() as { n: number }
      ).n;
      expect(skillsAfter).toBe(skillsBefore);
    } finally {
      if (sessionId) {
        db.prepare(`DELETE FROM agent_session_messages WHERE session_id = ?`).run(sessionId);
        db.prepare(`DELETE FROM agent_sessions WHERE id = ?`).run(sessionId);
      }
      await deleteProfile(profileId);
    }
  }, 180_000);

  // ── Plan step 9 ──────────────────────────────────────────────────────────
  it('W7-9: retry-policy prose creates no retry-loop proposal, while a materially repeated failed operation does', async () => {
    const proseId = await createProfile('prose', '[]');
    const failingId = await createProfile('failing', '[]');
    let auditRunId: string | null = null;

    try {
      const now = Date.now();

      // Prose profile: the text talks about retries at length; the structured
      // evidence is a single successful call. Lexical text must never be able
      // to manufacture the signal on its own.
      const proseSession = seedSession(
        proseId,
        [{ tool: 'bash', status: 'completed', startedAt: now - 600_000, durationMs: 500, input: { cmd: 'echo hi' } }],
        {
          text:
            'Our retry policy is to retry the failed step, then retry again with backoff. ' +
            'Retrying is safe here; the resume behaviour will retry from the last checkpoint. ' +
            'Attempting a retry, trying again, retry, retry, retry.',
        },
      );

      // Failing profile: the SAME tool with a MATERIALLY EQUIVALENT input,
      // twice, both terminal failures, strictly non-overlapping in time (the
      // second starts after the first has settled).
      const failStart = now - 900_000;
      const failInput = { cmd: 'npm run build' };
      const failingSession = seedSession(failingId, [
        { tool: 'bash', status: 'error', startedAt: failStart, durationMs: 1_000, input: failInput },
        { tool: 'bash', status: 'error', startedAt: failStart + 5_000, durationMs: 1_000, input: failInput },
      ]);

      const run = await runOptimizer();
      auditRunId = run.auditRunId;
      const created = proposalsFromRun(auditRunId);
      const retryProposals = created.filter((row) => /reduce retry loops/i.test(row.title));

      // Positive control — the deterministic workflow-signal lane really ran.
      expect(
        retryProposals.filter((row) => (row.changeJson ?? '').includes(`sessionId=${failingSession}`)).length,
        'no retry-loop proposal came from the genuinely repeated failed operation, so the absence below proves nothing',
      ).toBeGreaterThan(0);

      // The behaviour under test.
      expect(
        retryProposals.filter((row) => (row.changeJson ?? '').includes(`sessionId=${proseSession}`)),
      ).toEqual([]);
      expect(retryProposals.filter((row) => mentionsProfile(row, proseId))).toEqual([]);
    } finally {
      if (auditRunId) deleteRunProposals(auditRunId);
      deleteSeededSessions();
      await deleteProfile(proseId);
      await deleteProfile(failingId);
    }
  }, OPTIMIZER_RUN_TIMEOUT_MS);
});
