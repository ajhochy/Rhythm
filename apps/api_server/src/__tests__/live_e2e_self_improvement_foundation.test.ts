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
 *   • one `agent_run_feedback_events` row with `source='inferred'` — the
 *     feedback route hard-codes `source: 'explicit_user'`, and the only
 *     inferred writer is W6, which has not landed. Everything the test then
 *     asserts is read back through `GET /agent-run-outcomes/:sessionId`.
 *
 * Every test cleans up what it seeded and is safe to run twice in a row: all
 * fixture ids are freshly randomized per run, and optimizer output is deleted
 * by the `audit_run_id` the run itself reports.
 *
 * ── Known limits, stated plainly ────────────────────────────────────────────
 * As committed, this suite has NEVER BEEN EXECUTED — not one case, including
 * the six that shipped before W7-2 and W7-7 were unskipped. Every author so far
 * has worked under a hard no-server constraint, so fixture shapes are validated
 * against the producer/validator source only, never against a running backend.
 *
 * That is not a theoretical caveat. Two defects of exactly this kind were found
 * by reading source and are fixed here: every `POST /agent-sessions` assertion
 * expected 200 where the controller returns 201 (so the case died on its first
 * HTTP call), and W7-8 drove its "real production trigger" through
 * `/agent-sessions/:id/resume`, which rejects a non-resumable session and never
 * prompts even when it succeeds — its central assertion was vacuous. Assume the
 * same class of defect remains until a run proves otherwise.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
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

/**
 * Every profile's scope column, keyed by profile id — the exact bytes W7-2
 * compares before and after a shadow run. Read from `agent_configs` rather than
 * from `/agent-configs` because the column IS the authority: a route could
 * normalise, reorder or re-serialize on the way out and hide a real write.
 */
function allScopeBytes(): Record<string, string | null> {
  const rows = db
    .prepare(`SELECT id, allowed_mcps_json AS v FROM agent_configs ORDER BY id`)
    .all() as Array<{ id: string; v: string | null }>;
  return Object.fromEntries(rows.map((row) => [row.id, row.v]));
}

function allProposalStatuses(): Record<string, string> {
  const rows = db
    .prepare(`SELECT id, status FROM agent_org_proposals ORDER BY id`)
    .all() as Array<{ id: string; status: string }>;
  return Object.fromEntries(rows.map((row) => [row.id, row.status]));
}

/**
 * Poll until `predicate` holds, or fail with a message naming what never
 * happened. Used only where the production path is deliberately
 * fire-and-forget (the W4 terminal hook) and there is nothing to await.
 */
async function waitFor(
  label: string,
  timeoutMs: number,
  predicate: () => boolean,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) {
      throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
    }
    await new Promise((wait) => setTimeout(wait, 500));
  }
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
  /** W5 — the mode the run actually operated under, as the run itself reports it. */
  mode: string;
  proposalsCreated: number;
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
  const result = (await response.json()) as {
    auditRunId?: string;
    mode?: string;
    proposalsCreated?: number;
    skipped?: boolean;
    skippedReason?: string;
  };
  expect(
    result.skipped ?? false,
    `optimizer refused to run: ${result.skippedReason ?? '(no reason given)'} — ` +
      'the engine cold-start window must have elapsed before this gate runs',
  ).toBe(false);
  expect(typeof result.auditRunId).toBe('string');
  return {
    auditRunId: result.auditRunId as string,
    mode: String(result.mode),
    proposalsCreated: Number(result.proposalsCreated ?? 0),
  };
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
async function liveMcpServerNames(): Promise<string[]> {
  const response = await api('/opencode/mcp');
  expect(response.status).toBe(200);
  const body = (await response.json()) as unknown;
  return Array.isArray(body)
    ? body
        .map((entry) => (entry && typeof entry === 'object' ? (entry as { name?: unknown }).name : null))
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
    : Object.keys((body ?? {}) as Record<string, unknown>);
}

async function liveMcpServerIds(): Promise<string[]> {
  const names = await liveMcpServerNames();
  const preferred = ['gitnexus', 'pco-services'].filter((id) => names.includes(id));
  return preferred.length > 0 ? preferred : names;
}

/**
 * WHICH servers the live engine has — the observable that changes if anything
 * were installed or removed. Deliberately the id set and nothing else: the same
 * payload also carries each server's live CONNECTION state (`connected`,
 * `needs_auth`, …), which flips on its own as the engine connects, so a
 * byte-for-byte diff of the whole response would report a colour change as an
 * installation.
 */
async function mcpCatalogFingerprint(): Promise<string> {
  return JSON.stringify((await liveMcpServerNames()).slice().sort());
}

// ── W4 run-outcome ledger observation ──────────────────────────────────────

/** A real turn against the live engine, generously. */
const TURN_TIMEOUT_MS = 180_000;

function outcomeRows(rootSessionId: string): Array<Record<string, unknown>> {
  return db
    .prepare(`SELECT * FROM agent_run_outcomes WHERE root_session_id = ? ORDER BY id`)
    .all(rootSessionId) as Array<Record<string, unknown>>;
}

function feedbackRows(rootSessionId: string): Array<{ id: string; source: string; verdict: string }> {
  return db
    .prepare(
      `SELECT id, source, verdict FROM agent_run_feedback_events
        WHERE root_session_id = ? ORDER BY seq, created_at, id`,
    )
    .all(rootSessionId) as Array<{ id: string; source: string; verdict: string }>;
}

/**
 * Terminal turn boundaries seen on the socket, per local session id.
 *
 * The witness is `{type:'session.status', working:false}`, which the bridge
 * broadcasts at the TOP of its `session.idle` case — unconditionally, before
 * the DB status check, so an errored turn emits it too (the engine still goes
 * idle; only the status WRITE is suppressed). It is the one frame that marks a
 * real turn boundary and nothing else: ws_gateway's own `catch` sends a
 * `type:'error'` frame when the prompt never reaches the engine, which is NOT a
 * terminal event, so error frames are deliberately not counted.
 *
 * A persisted message row is NOT a usable witness: upsertPart INSERTs the
 * role='output' row when the FIRST streamed part arrives — the START of the
 * response — and the session.idle append only runs for legacy sessions with no
 * structured messages. Counting rows returns mid-turn.
 */
const turnBoundaries = new Map<string, number>();

function boundaryCount(sessionId: string): number {
  return turnBoundaries.get(sessionId) ?? 0;
}

async function openAgentSocket(): Promise<WebSocket> {
  const socket = new WebSocket(`${baseUrl().replace(/^http/, 'ws')}/ws/agents`);
  socket.on('message', (raw) => {
    let frame: { type?: unknown; id?: unknown; working?: unknown };
    try {
      frame = JSON.parse(raw.toString()) as typeof frame;
    } catch {
      return;
    }
    if (frame.type === 'session.status' && frame.working === false && typeof frame.id === 'string') {
      turnBoundaries.set(frame.id, boundaryCount(frame.id) + 1);
    }
  });
  await new Promise<void>((ready, fail) => {
    socket.once('open', () => ready());
    socket.once('error', (err) => fail(err));
  });
  return socket;
}

/**
 * One real interactive turn: the exact `session.input` frame the Flutter
 * composer sends, through the WS gateway, into the engine. This is the only
 * production entry point that drives a session to a terminal state — there is
 * no HTTP prompt route, and `/agent-sessions/:id/resume` rejects anything not
 * already `resumable` with a live session token (and re-attaches rather than
 * prompting even then).
 */
async function driveTurn(socket: WebSocket, sessionId: string, text: string): Promise<void> {
  const before = boundaryCount(sessionId);
  socket.send(JSON.stringify({ v: 1, type: 'session.input', id: sessionId, data: text }));
  await waitFor(
    `session ${sessionId} to reach a terminal turn boundary`,
    TURN_TIMEOUT_MS,
    () => boundaryCount(sessionId) > before,
  );
}

/**
 * Direct SQLite: the ONLY inferred-feedback writer is W6, which does not exist
 * yet, and `POST /agent-run-outcomes/:id/feedback` hard-codes
 * `source: 'explicit_user'` (run_outcome_routes.ts) — so no HTTP surface on
 * this branch can append an inferred verdict. The row is written exactly as
 * AgentRunOutcomesRepository.appendFeedbackAsync writes one, including its
 * derived `seq`, so the read model under test sees nothing unusual.
 */
function seedInferredFeedback(rootSessionId: string, verdict: string): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO agent_run_feedback_events
       (id, root_session_id, seq, source, verdict, confidence, actor, reason, created_at)
     VALUES (?, ?,
       (SELECT COALESCE(MAX(f.seq), 0) + 1 FROM agent_run_feedback_events f
         WHERE f.root_session_id = ?),
       'inferred', ?, 0.5, 'w7-live-inference', NULL, ?)`,
  ).run(id, rootSessionId, rootSessionId, verdict, new Date().toISOString());
  return id;
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
  it('W7-2: a shadow optimizer run creates proposals without changing target config, installing tools, or changing proposal target state', async () => {
    const servers = await liveMcpServerIds();
    expect(
      servers.length,
      'the sandbox engine reports no MCP servers; there is no grant for scope hygiene to find',
    ).toBeGreaterThan(0);
    const server = servers[0];

    // A profile that HAS a grant and demonstrably never used it, so the
    // deterministic scope-hygiene lane has something to propose. Without a
    // guaranteed candidate, `proposalsCreated > 0` would be a coin flip and the
    // three "nothing changed" assertions below would be vacuous — a run that
    // generated nothing trivially mutates nothing.
    const unusedId = await createProfile('shadow', JSON.stringify([server]));
    let auditRunId: string | null = null;

    try {
      backdateProfile(unusedId, OBSERVED_PROFILE_AGE_DAYS);
      const start = Date.now() - 3_600_000;
      for (let i = 0; i < OBSERVED_SESSION_COUNT; i++) {
        seedSession(unusedId, [
          { tool: 'read', status: 'completed', startedAt: start + i * 1_000, durationMs: 10, input: { i } },
        ]);
      }

      const scopeBefore = allScopeBytes();
      const statusBefore = allProposalStatuses();
      const catalogBefore = await mcpCatalogFingerprint();

      const run = await runOptimizer();
      auditRunId = run.auditRunId;

      // The precondition, asserted rather than assumed: with RHYTHM_OPTIMIZER_MODE
      // unset the policy resolves to `shadow`, and only a shadow run is evidence
      // for the shadow gate. Under `auto` the same three assertions would be
      // testing the wrong lane, so this must fail loudly instead.
      expect(
        run.mode,
        'this gate observes the SHADOW lane; the sandbox api_server must not run with RHYTHM_OPTIMIZER_MODE=auto/human_only',
      ).toBe('shadow');

      // (a) The run really generated.
      expect(
        run.proposalsCreated,
        'a shadow run that generated nothing proves nothing about the shadow gate',
      ).toBeGreaterThan(0);
      const created = proposalsFromRun(auditRunId);
      expect(created.length).toBeGreaterThan(0);

      // (b) Not one profile's scope bytes moved — including the profile this
      // run just proposed to tighten.
      expect(allScopeBytes()).toEqual(scopeBefore);

      // (c) No proposal changed lifecycle state. Shadow runs no lifecycle
      // writer at all, so the strict form is the honest one: every pre-existing
      // row is byte-identical, and every row this run created is still awaiting
      // a human in 'proposed'.
      const statusAfter = allProposalStatuses();
      for (const [id, status] of Object.entries(statusBefore)) {
        expect(statusAfter[id], `proposal ${id} changed state during a shadow run`).toBe(status);
      }
      expect(
        created.filter((row) => proposalStatus(row.id) !== 'proposed').map((row) => row.id),
      ).toEqual([]);

      // (d) Nothing was installed into the live engine.
      //
      // Cheap smoke, NOT load-bearing, and the comment says so on purpose: no
      // optimizer lane installs an MCP server under any mode. External
      // adoption is classified HIGH risk and stays human-gated, and the
      // auto-apply lane only ever touches risk==='low'. This would go red only
      // if a future generator learned to install — which is precisely the
      // change worth catching, so it stays.
      expect(await mcpCatalogFingerprint()).toBe(catalogBefore);
    } finally {
      if (auditRunId) deleteRunProposals(auditRunId);
      deleteSeededSessions();
      await deleteProfile(unusedId);
    }
  }, OPTIMIZER_RUN_TIMEOUT_MS);

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
  it('W7-7: a completed user session yields exactly one terminal outcome plus append-only feedback events', async () => {
    const profileId = await createProfile('outcome', '[]');
    let sessionId: string | null = null;
    let socket: WebSocket | null = null;

    try {
      const create = await api('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          profileId,
          cwd: '/tmp',
          name: `W7 live outcome ${profileId}`,
        }),
      });
      // 201 — agent_sessions_controller.create ends in res.status(201).
      expect(create.status).toBe(201);
      sessionId = ((await create.json()) as { id: string }).id;
      // A freshly created session has no parent, so it IS its own root run —
      // which is what makes `root_session_id = sessionId` the right key below.
      const rootSessionId = sessionId;

      socket = await openAgentSocket();

      // ── Terminal event #1 ────────────────────────────────────────────────
      await driveTurn(socket, sessionId, 'Reply with the single word: done.');
      await waitFor(
        `the W4 terminal hook to finalize an outcome for ${rootSessionId}`,
        60_000,
        () => outcomeRows(rootSessionId).length > 0,
      );
      const afterFirst = outcomeRows(rootSessionId);
      expect(afterFirst.length).toBe(1);

      // ── Terminal event #2, same run ──────────────────────────────────────
      // A second turn ends at the same production hook with the same root run
      // id. That is the duplicate terminal event: it must find the ledger row
      // already there and neither add a second nor rewrite the first.
      //
      // Read this pair for exactly what it is: an end-to-end confirmation that
      // a SCHEMA guarantee survives the real path. `root_session_id UNIQUE` and
      // the BEFORE UPDATE immutability trigger (migrations.ts) are what enforce
      // it, and recordTerminalOutcome swallows every error it meets, so no
      // application-layer mutation can turn these two assertions red — deleting
      // `ON CONFLICT DO NOTHING` makes the insert throw and be swallowed, and
      // the test stays green. Only dropping the unique index reddens it. The
      // idempotency of finalizeAsync itself is a unit-test job, not this one's.
      await driveTurn(socket, sessionId, 'Reply with the single word: again.');
      const afterSecond = outcomeRows(rootSessionId);
      expect(
        afterSecond.length,
        'a second terminal event on the same run minted a second outcome row',
      ).toBe(1);
      expect(afterSecond).toEqual(afterFirst);

      // ── Feedback: explicit first, contradicting inference after ──────────
      const explicit = await api(
        `/agent-run-outcomes/${encodeURIComponent(sessionId)}/feedback`,
        {
          method: 'POST',
          body: JSON.stringify({
            verdict: 'success',
            reason: 'operator confirmed the run did what was asked',
            actor: 'w7-live-operator',
          }),
        },
      );
      expect(explicit.status).toBe(201);
      const explicitEvent = (await explicit.json()) as { id: string };

      const inferredId = seedInferredFeedback(rootSessionId, 'failure');

      const view = await api(`/agent-run-outcomes/${encodeURIComponent(sessionId)}`);
      expect(view.status).toBe(200);
      const body = (await view.json()) as {
        explicitUserVerdict: string | null;
        inferredVerdict: string | null;
        authoritativeVerdict: string;
        feedback: Array<{ id: string; source: string; verdict: string }>;
      };

      // BOTH events are readable — neither writer clobbered the other.
      expect(body.feedback.map((event) => event.id)).toEqual(
        expect.arrayContaining([explicitEvent.id, inferredId]),
      );
      expect(body.feedback.find((event) => event.id === explicitEvent.id)).toMatchObject({
        source: 'explicit_user',
        verdict: 'success',
      });
      expect(body.feedback.find((event) => event.id === inferredId)).toMatchObject({
        source: 'inferred',
        verdict: 'failure',
      });
      expect(feedbackRows(rootSessionId).map((row) => row.id)).toEqual(
        expect.arrayContaining([explicitEvent.id, inferredId]),
      );

      // …and the human still wins, even though the inference arrived last.
      expect(body.explicitUserVerdict).toBe('success');
      expect(body.inferredVerdict).toBe('failure');
      expect(body.authoritativeVerdict).toBe('success');

      // Neither verdict edited the objective record.
      expect(outcomeRows(rootSessionId)).toEqual(afterFirst);
    } finally {
      socket?.close();
      if (sessionId) {
        db.prepare(`DELETE FROM agent_session_messages WHERE session_id = ?`).run(sessionId);
        db.prepare(`DELETE FROM agent_sessions WHERE id = ?`).run(sessionId);
      }
      await deleteProfile(profileId);
      // The ledger rows are deliberately NOT cleaned up: both tables carry
      // BEFORE DELETE triggers (migrations.ts) precisely so history cannot be
      // erased, and a test that could delete them would be evidence the
      // append-only guarantee is broken. Ids are fresh per run, so the leftover
      // rows never collide with a re-run.
    }
  }, 600_000);

  // ── Plan step 8 ──────────────────────────────────────────────────────────
  it('W7-8: a self-improvement session that clears every other harvest gate still produces no harvested skill', async () => {
    const profileId = await createProfile('harvest', '[]');
    let sessionId: string | null = null;
    let socket: WebSocket | null = null;

    try {
      const create = await api('/agent-sessions', {
        method: 'POST',
        body: JSON.stringify({
          profileId,
          cwd: '/tmp',
          name: `W7 live harvest ${profileId}`,
        }),
      });
      // 201 — agent_sessions_controller.create ends in res.status(201).
      expect(create.status).toBe(201);
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

      // Drive the REAL production trigger: a completed interactive turn ends by
      // calling the extraction queue (opencode_stream_bridge's session.idle
      // handler). If the W3 eligibility gate were removed, this is where a
      // self-improvement session would feed itself back into the harvester.
      //
      // NOT `/agent-sessions/:id/resume`: it rejects anything whose status is
      // not already 'resumable' with a live session token, and even then it
      // re-attaches and streams rather than prompting — it never reads the
      // `message` body field. A resume-driven version of this test never ran a
      // turn, so its "nothing was harvested" assertion was vacuous.
      socket = await openAgentSocket();
      await driveTurn(socket, sessionId, 'Summarize what we just did in one sentence.');

      // Harvesting is fire-and-forget; give it room to have happened.
      await new Promise((wait) => setTimeout(wait, 30_000));

      const skillsAfter = (
        db.prepare(`SELECT COUNT(*) AS n FROM agent_skills WHERE source = 'harvested'`).get() as { n: number }
      ).n;
      expect(skillsAfter).toBe(skillsBefore);
    } finally {
      socket?.close();
      if (sessionId) {
        db.prepare(`DELETE FROM agent_session_messages WHERE session_id = ?`).run(sessionId);
        db.prepare(`DELETE FROM agent_sessions WHERE id = ?`).run(sessionId);
      }
      await deleteProfile(profileId);
    }
    // Room for a real turn (TURN_TIMEOUT_MS) plus the 30s harvest window.
  }, 600_000);

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
