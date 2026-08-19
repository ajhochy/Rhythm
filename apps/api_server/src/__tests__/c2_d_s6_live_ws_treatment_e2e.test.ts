/**
 * C2-D (S6) / #1448 — live isolated WebSocket E2E test (the C2 ship gate).
 *
 * Drives a REAL baseline run and a REAL candidate run through the ACTUAL
 * interactive WS path (S4's `handleInputFrame` wiring) against the isolated
 * dev sandbox (`tools/dev/sandbox.sh`), for a declared `system-prompt-v1`
 * experiment, and proves:
 *
 *   (a) both runs get distinct effective system prompts;
 *   (b) both produce finalized treatment receipts with distinct effective
 *       hashes;
 *   (c) durable AgentConfig target bytes are unchanged after both runs.
 *
 * ── Running it ──────────────────────────────────────────────────────────────
 * Inert in a normal `vitest run`: without RHYTHM_LIVE_E2E=1 the whole
 * describe block is skipped. Bring the sandbox up ONLY through
 * `tools/dev/sandbox.sh up` — never by hand.
 *
 *   RHYTHM_SANDBOX_DIR=/tmp/rhythm-sandbox-c2d-s6 \
 *   RHYTHM_SANDBOX_API_PORT=4198 \
 *   RHYTHM_SANDBOX_ENGINE_PORT=4197 \
 *   RHYTHM_SANDBOX_GATEWAY_PORT=4199 \
 *     tools/dev/sandbox.sh up
 *
 *   cd apps/api_server
 *   RHYTHM_LIVE_E2E=1 \
 *   RHYTHM_LIVE_E2E_ISOLATED=1 \
 *   RHYTHM_LIVE_URL=http://127.0.0.1:4198 \
 *   DB_PATH=/tmp/rhythm-sandbox-c2d-s6/rhythm.db \
 *   RHYTHM_LIVE_DB_PATH=/tmp/rhythm-sandbox-c2d-s6/rhythm.db \
 *     npx vitest run --reporter=verbose \
 *       src/__tests__/c2_d_s6_live_ws_treatment_e2e.test.ts
 *
 * ── Fixture policy (matches live_e2e_self_improvement_foundation.test.ts) ───
 * Everything with a real API surface is seeded through it: the profile via
 * `POST /agent-configs`, and the experiment declaration via the REAL
 * `POST /agent-org-proposals/:id/experiment` route (org_proposals_controller.
 * declareExperiment). Direct SQLite is used ONLY for the `agent_org_proposals`
 * row itself — there is no POST route that creates a proposal in a chosen
 * lifecycle state (same documented gap the W7 live suite and
 * c2_a_reserved_treatment_dispatch.test.ts's fixtures rely on); this test
 * seeds the minimal columns the real `declareExperiment` route and the real
 * treatment adapter require, using the exact same shape those tests use.
 *
 * ── What is real vs. synthetic ───────────────────────────────────────────────
 * REAL: profile creation (HTTP), experiment declaration (HTTP), two real
 * `agent_sessions` rows (HTTP), two real interactive turns driven through the
 * actual `ws_gateway.ts` `session.input` WS path into the REAL fork engine and
 * a REAL configured model provider, and every enrollment/receipt/AgentConfig
 * read-back from the sandbox's own SQLite file after real dispatch completes.
 * SYNTHETIC: only the `agent_org_proposals` row (direct SQL — no HTTP route
 * exists to create one in an active lifecycle state; documented above).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import WebSocket from 'ws';
import { randomUUID, createHash } from 'node:crypto';

import { assertLiveE2EIsolation } from './_live_e2e_guard';
import { assignCohort } from '../services/org_proposal_experiment_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../models/proposal_evidence_bundle';

const enabled = process.env.RHYTHM_LIVE_E2E === '1';
const describeLive = enabled ? describe : describe.skip;

const TURN_TIMEOUT_MS = 180_000;

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

const PROFILE_ID = `c2d-s6-${randomUUID().replace(/-/g, '').slice(0, 10)}`;
const BASELINE_PROMPT = 'You are the C2-D S6 live baseline assistant. Reply with exactly: BASELINE_OK';
const CANDIDATE_PROMPT = 'You are the C2-D S6 live candidate assistant. Reply with exactly: CANDIDATE_OK';
const TARGET_REF = `agent_config:${PROFILE_ID}`;
const ASSIGNMENT_KEY = `c2d-s6-key-${randomUUID()}`;

// Mirrors org_proposal_experiment_service.ts's canonicalizeForHash /
// buildProfileRevisionFingerprint EXACTLY — the server-side hash this test's
// fixture must reproduce so the declared experiment's evidenceTarget.hash
// matches what the REAL server computes when it reserves/prepares the
// treatment.
function canonicalizeForHash(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(canonicalizeForHash).join(',')}]`;
  if (input && typeof input === 'object') {
    const entries = Object.keys(input as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeForHash((input as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(input);
}

function fingerprint(profile: { id: string; revision: number; systemPrompt: string | null }): string {
  return `sha256:${createHash('sha256')
    .update(
      canonicalizeForHash({
        id: profile.id,
        revision: profile.revision,
        systemPrompt: profile.systemPrompt ?? '__system-prompt-null__',
      }),
    )
    .digest('hex')}`;
}

function spec(candidateValue: string, hash: string): Record<string, unknown> {
  return {
    agentConfigId: PROFILE_ID,
    field: 'system_prompt',
    priorValue: BASELINE_PROMPT,
    currentValue: BASELINE_PROMPT,
    candidateValue,
    evidenceTarget: { ref: TARGET_REF, hash },
  };
}

function bundle(hash: string): Record<string, unknown> {
  return {
    version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
    sourceEvidence: { sessionIds: ['seed'], eventIds: ['seed'] },
    counterEvidenceSearch: { query: 'q', searchedAt: new Date().toISOString(), contradictingCount: 0 },
    target: { ref: TARGET_REF, hash },
    expectedOutcome: 'success',
    primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
    guardrails: ['none'],
    experimentAdapter: 'paired-cohort-outcome',
    rollbackRule: 'revert',
    generatorVersion: 'c2d-s6-live-v1',
    confidenceCalibrationVersion: 'v1',
  };
}

/** Direct SQLite: no HTTP route creates an agent_org_proposals row (documented
 *  gap; same one live_e2e_self_improvement_foundation.test.ts and
 *  c2_a_reserved_treatment_dispatch.test.ts rely on). */
function seedProposal(id: string, changeJson: string): void {
  db.prepare(
    `INSERT INTO agent_org_proposals (id, kind, risk, status, title, target_ref, change_json)
     VALUES (?, 'refine-config', 'low', 'active', ?, ?, ?)`,
  ).run(id, 'c2d-s6 live refine prompt', TARGET_REF, changeJson);
}

function agentConfigRow(id: string): { systemPrompt: string | null; revision: number } | null {
  const row = db
    .prepare(`SELECT system_prompt AS systemPrompt, revision FROM agent_configs WHERE id = ?`)
    .get(id) as { systemPrompt: string | null; revision: number } | undefined;
  return row ?? null;
}

function enrollmentRow(runEpisodeId: string): { state: string; cohort: string } | null {
  const row = db
    .prepare(`SELECT state, cohort FROM agent_org_experiment_enrollments WHERE run_episode_id = ?`)
    .get(runEpisodeId) as { state: string; cohort: string } | undefined;
  return row ?? null;
}

function receiptRow(
  runEpisodeId: string,
): { cohort: string; effectivePromptHash: string } | null {
  const row = db
    .prepare(
      `SELECT cohort, effective_prompt_hash AS effectivePromptHash
         FROM agent_org_experiment_treatment_receipts WHERE run_episode_id = ?`,
    )
    .get(runEpisodeId) as { cohort: string; effectivePromptHash: string } | undefined;
  return row ?? null;
}

async function waitFor(label: string, timeoutMs: number, predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
    await new Promise((wait) => setTimeout(wait, 500));
  }
}

// Same witness technique as live_e2e_self_improvement_foundation.test.ts:
// `{type:'session.status', working:false}` marks a real terminal turn
// boundary; gateway `error` frames are tracked separately so a refusal fails
// fast with the server's own words instead of burning the full timeout.
const turnBoundaries = new Map<string, number>();
const turnErrors = new Map<string, string>();
function boundaryCount(sessionId: string): number {
  return turnBoundaries.get(sessionId) ?? 0;
}

async function openAgentSocket(): Promise<WebSocket> {
  const socket = new WebSocket(`${baseUrl().replace(/^http/, 'ws')}/ws/agents`);
  socket.on('message', (raw) => {
    let frame: { type?: unknown; id?: unknown; working?: unknown; message?: unknown };
    try {
      frame = JSON.parse(raw.toString()) as typeof frame;
    } catch {
      return;
    }
    if (frame.type === 'session.status' && frame.working === false && typeof frame.id === 'string') {
      turnBoundaries.set(frame.id, boundaryCount(frame.id) + 1);
    }
    if (frame.type === 'error' && typeof frame.id === 'string' && typeof frame.message === 'string') {
      turnErrors.set(frame.id, frame.message);
    }
  });
  await new Promise<void>((ready, fail) => {
    socket.once('open', () => ready());
    socket.once('error', (err) => fail(err));
  });
  return socket;
}

/** One real interactive turn, with C2-D's runEpisodeId frame field (S3/S4). */
async function driveTurn(
  socket: WebSocket,
  sessionId: string,
  text: string,
  runEpisodeId: string,
): Promise<void> {
  const before = boundaryCount(sessionId);
  turnErrors.delete(sessionId);
  socket.send(JSON.stringify({ v: 1, type: 'session.input', id: sessionId, data: text, runEpisodeId }));
  await waitFor(`session ${sessionId} to reach a terminal turn boundary`, TURN_TIMEOUT_MS, () => {
    const refusal = turnErrors.get(sessionId);
    if (refusal !== undefined && boundaryCount(sessionId) === before) {
      throw new Error(`the gateway refused the turn for ${sessionId}: ${refusal}`);
    }
    return boundaryCount(sessionId) > before;
  });
}

describeLive('C2-D (S6) — live WS treatment E2E: baseline vs. candidate through the real interactive path', () => {
  let baselineRunEpisodeId: string;
  let candidateRunEpisodeId: string;
  let initialProfileRevision: number;

  beforeAll(async () => {
    assertLiveE2EIsolation();

    const url = baseUrl();
    if (!url) throw new Error('RHYTHM_LIVE_URL is required');
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
      throw new Error(`RHYTHM_LIVE_URL must target localhost, got ${parsed.hostname}`);
    }
    if (parsed.port === '4001' || parsed.port === '4000' || parsed.port === '') {
      throw new Error(`RHYTHM_LIVE_URL must use a non-default sandbox port, got ${parsed.port || '(default)'}`);
    }

    const dbPath = process.env.DB_PATH;
    const declaredLiveDb = process.env.RHYTHM_LIVE_DB_PATH;
    if (!dbPath || !declaredLiveDb || dbPath !== declaredLiveDb) {
      throw new Error('DB_PATH and RHYTHM_LIVE_DB_PATH must name the same sandbox DB');
    }
    db = new Database(dbPath);

    const health = await fetch(`${url}/health`);
    if (!health.ok) throw new Error(`sandbox api_server health failed: ${health.status}`);

    // 1. REAL profile creation through POST /agent-configs.
    const created = await api('/agent-configs', {
      method: 'POST',
      body: JSON.stringify({
        id: PROFILE_ID,
        label: `C2-D S6 live ${PROFILE_ID}`,
        icon: 'x',
        command: '',
        systemPrompt: BASELINE_PROMPT,
        sessionSelectable: false,
        schedulable: false,
        modelProvider: process.env.RHYTHM_LIVE_E2E_PROVIDER ?? 'openrouter',
      }),
    });
    expect(created.status).toBe(201);
    const profile = (await created.json()) as { id: string; revision: number; systemPrompt: string | null };
    initialProfileRevision = profile.revision;
    const hash = fingerprint(profile);

    // 2. Proposal row (direct SQL — no create route exists; documented above).
    const proposalId = `${PROFILE_ID}-proposal`;
    seedProposal(
      proposalId,
      JSON.stringify({
        configPatch: { agentConfigId: PROFILE_ID, field: 'system_prompt', value: CANDIDATE_PROMPT },
      }),
    );

    // 3. REAL experiment declaration through POST /agent-org-proposals/:id/experiment.
    const declared = await api(`/agent-org-proposals/${encodeURIComponent(proposalId)}/experiment`, {
      method: 'POST',
      body: JSON.stringify({
        evidenceBundle: bundle(hash),
        baselineSpec: spec(BASELINE_PROMPT, hash),
        candidateSpec: spec(CANDIDATE_PROMPT, hash),
        assignmentKey: ASSIGNMENT_KEY,
        stoppingRule: { minSamplesPerCohort: 1, minEffect: 0.1 },
        maxExposure: 100,
      }),
    });
    expect(declared.status).toBe(201);

    // 4. Deterministically find one baseline-assigned and one
    // candidate-assigned runEpisodeId using the REAL assignCohort function —
    // not a hand-picked pair.
    let foundBaseline: string | null = null;
    let foundCandidate: string | null = null;
    // Episode ID candidates are namespaced under this run's own PROFILE_ID
    // (already randomized per module load) — the sandbox DB persists across
    // repeated live-test invocations, and run_episode_id is UNIQUE, so a
    // fixed/non-randomized candidate string would collide with a PRIOR run's
    // enrollment (bound to a DIFFERENT profile) and fail closed with
    // RunEnrollmentProfileCollisionError instead of testing anything new.
    for (let i = 0; i < 500 && (!foundBaseline || !foundCandidate); i += 1) {
      const candidateId = `${PROFILE_ID}-episode-${i}`;
      const cohort = assignCohort(ASSIGNMENT_KEY, candidateId);
      if (cohort === 'baseline' && !foundBaseline) foundBaseline = candidateId;
      if (cohort === 'candidate' && !foundCandidate) foundCandidate = candidateId;
    }
    if (!foundBaseline || !foundCandidate) throw new Error('could not find both cohort assignments');
    baselineRunEpisodeId = foundBaseline;
    candidateRunEpisodeId = foundCandidate;
  }, 60_000);

  afterAll(async () => {
    await api(`/agent-configs/${encodeURIComponent(PROFILE_ID)}`, { method: 'DELETE' }).catch(() => undefined);
    db?.close();
  });

  it(
    'a real baseline run and a real candidate run through the actual WS path receive distinct effective system prompts, finalize receipts with distinct effective hashes, and leave the durable AgentConfig unchanged',
    async () => {
      async function runOneTurn(runEpisodeId: string, label: string): Promise<void> {
        const create = await api('/agent-sessions', {
          method: 'POST',
          body: JSON.stringify({ profileId: PROFILE_ID, cwd: '/tmp', name: `C2-D S6 live ${label}` }),
        });
        expect(create.status).toBe(201);
        const sessionId = ((await create.json()) as { id: string }).id;

        const socket = await openAgentSocket();
        try {
          await driveTurn(socket, sessionId, 'Please respond as instructed.', runEpisodeId);
        } finally {
          socket.close();
        }
      }

      await runOneTurn(baselineRunEpisodeId, 'baseline');
      await runOneTurn(candidateRunEpisodeId, 'candidate');

      // (b) both produce finalized treatment receipts with distinct effective hashes.
      // A fully successful live turn's fire-and-forget terminal-outcome hook
      // (recordTerminalOutcome -> markRunEnrollmentTerminalized) can race this
      // read-back, so the enrollment may already show 'terminalized' rather
      // than 'dispatched' by the time we get here — both prove the reserved
      // treatment WAS dispatched (only 'reserved'/'treatment_failed' would
      // mean dispatch never happened). Same caveat as
      // c2_a_reserved_treatment_dispatch.test.ts's dual-cohort case.
      const baselineEnrollment = enrollmentRow(baselineRunEpisodeId);
      const candidateEnrollment = enrollmentRow(candidateRunEpisodeId);
      expect(['dispatched', 'terminalized']).toContain(baselineEnrollment?.state);
      expect(baselineEnrollment?.cohort).toBe('baseline');
      expect(['dispatched', 'terminalized']).toContain(candidateEnrollment?.state);
      expect(candidateEnrollment?.cohort).toBe('candidate');

      const baselineReceipt = receiptRow(baselineRunEpisodeId);
      const candidateReceipt = receiptRow(candidateRunEpisodeId);
      expect(baselineReceipt).not.toBeNull();
      expect(candidateReceipt).not.toBeNull();
      expect(baselineReceipt?.cohort).toBe('baseline');
      expect(candidateReceipt?.cohort).toBe('candidate');

      // (a) distinct effective system prompts — proven by the receipt's own
      // definition (sha256 of the exact override string actually handed to
      // the real promptAsync dispatch boundary).
      const expectedBaselineHash = createHash('sha256').update(BASELINE_PROMPT).digest('hex');
      const expectedCandidateHash = createHash('sha256').update(CANDIDATE_PROMPT).digest('hex');
      expect(baselineReceipt?.effectivePromptHash).toBe(expectedBaselineHash);
      expect(candidateReceipt?.effectivePromptHash).toBe(expectedCandidateHash);
      expect(baselineReceipt?.effectivePromptHash).not.toBe(candidateReceipt?.effectivePromptHash);

      // (c) durable AgentConfig target bytes are unchanged after both runs.
      const finalProfile = agentConfigRow(PROFILE_ID);
      expect(finalProfile?.systemPrompt).toBe(BASELINE_PROMPT);
      expect(finalProfile?.revision).toBe(initialProfileRevision);
    },
    TURN_TIMEOUT_MS * 2 + 30_000,
  );
});
