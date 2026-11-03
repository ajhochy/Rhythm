/**
 * Dayflow provider admission (C2 API half): authenticated router + real SQLite
 * receiving/provenance records + the pinned C0 frame DTO. The owned-engine
 * frame/enrollment routes are a disclosed stand-in (see the harness); nothing
 * here is cross-process or live proof.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PROVIDER_ADMISSION_BOUNDS,
  parseEnrollmentResponse,
  parseProviderAdmissionRequest,
  parseProviderFrameExport,
  parseSourceAnchorQuery,
  providerBasisDigest,
  sha256Hex,
  validateProviderAdmissionResponse,
} from '../contracts/dayflow_provider_admission_contract';
import {
  AGENT, DIGEST_COMPACTION, DIGEST_LOOP, OLD_ASSISTANT, OLD_USER, OWNER, PROJECT, ROOT, SDK, USER_1,
  buildHarness, candidate, nonce, request, type Harness,
} from './helpers/dayflow_provider_harness';

// ── The frozen C0 fixture (sha 2c273791…c6) is read from its pinned location ──
const FIXTURE_PATH = process.env.RHYTHM_C0_FIXTURE ??
  '/Users/ajhochhalter/Documents/Codex/2026-10-01/task-11/rhythm-dayflow-provider-api-c2-20261006/inputs/core-dayflow-native-api-contract-fixtures.json';
const FIXTURE_SHA = '2c273791cb9c51e3fefa7cd267f5d9d1d4c3d68959e43208ca0f1dc480ddcfc6';
const fixtureBytes = existsSync(FIXTURE_PATH) ? readFileSync(FIXTURE_PATH) : null;
const fixture = fixtureBytes ? JSON.parse(fixtureBytes.toString('utf8')) as {
  bounds: Record<string, number>;
  examples: { requests: Record<string, any>; exports: Record<string, any>; responses: Record<string, any>; enrollmentResponse: any };
} : null;

describe.skipIf(!fixture)('pinned C0 DTO (parsers and validators) against the frozen fixture', () => {
  const ex = () => fixture!.examples;

  it('the fixture is exactly the pinned bytes and its bounds equal ours', () => {
    expect(createHash('sha256').update(fixtureBytes!).digest('hex')).toBe(FIXTURE_SHA);
    expect(fixture!.bounds).toMatchObject({
      requestUtf8Bytes: PROVIDER_ADMISSION_BOUNDS.requestBytes, responseUtf8Bytes: PROVIDER_ADMISSION_BOUNDS.responseBytes,
      exportUtf8Bytes: PROVIDER_ADMISSION_BOUNDS.exportBytes, overlayUtf8Bytes: PROVIDER_ADMISSION_BOUNDS.overlayBytes,
      sourceAnchors: PROVIDER_ADMISSION_BOUNDS.sourceAnchors, derivedSummaryIdsTotal: PROVIDER_ADMISSION_BOUNDS.derivedSummaryIds,
      references: PROVIDER_ADMISSION_BOUNDS.references, exchangeDeadlineMs: PROVIDER_ADMISSION_BOUNDS.exchangeDeadlineMs,
    });
  });

  it('accepts every fixture request, export, response and the exact enrollment reply', () => {
    for (const value of Object.values(ex().requests)) expect(parseProviderAdmissionRequest(value).ok).toBe(true);
    for (const value of Object.values(ex().exports)) expect(parseProviderFrameExport(value).ok, JSON.stringify(value)).toBe(true);
    const requestFor: Record<string, string> = {
      ordinary: 'ordinary', allowWithCurrentOverlay: 'answer', projectWithCurrentOverlay: 'toolLoop',
      historyOnlyAfterRootChange: 'answer', compactionProjection: 'compaction', unavailableFrameHold: 'answer',
      ambiguousHistoryHold: 'compaction',
    };
    for (const [name, response] of Object.entries(ex().responses)) {
      expect(validateProviderAdmissionResponse(response, ex().requests[requestFor[name]]).ok, name).toBe(true);
      if (response.overlay) expect(sha256Hex(response.overlay.text)).toBe(response.overlay.sha256);
    }
    expect(parseEnrollmentResponse(ex().enrollmentResponse, ex().enrollmentResponse.sdkSessionId).ok).toBe(true);
  });

  it('rejects extra keys, bad enums/bounds, wrong echo, overlay digest and cross-field violations', () => {
    const base = ex().requests.answer;
    for (const bad of [
      { ...base, extra: 1 }, { ...base, schemaVersion: 2 }, { ...base, requestNonce: 'short' }, { ...base, attempt: 101 },
      { ...base, attempt: -1 }, { ...base, attempt: 1.5 }, { ...base, purpose: 'title' }, { ...base, inputDigest: 'A'.repeat(64) },
      { ...base, sdkSessionId: '' }, { ...base, userMessageId: 'u'.repeat(201) }, { ...base, engineGeneration: 'g'.repeat(129) },
    ]) expect(parseProviderAdmissionRequest(bad).ok).toBe(false);
    expect(parseProviderAdmissionRequest(null).ok).toBe(false);
    const response = ex().responses.allowWithCurrentOverlay;
    const check = (patch: Record<string, unknown>) => validateProviderAdmissionResponse({ ...response, ...patch }, base).ok;
    expect(check({})).toBe(true);
    expect(check({ extra: 1 })).toBe(false);
    expect(check({ request: { ...base, requestNonce: 'ZZZZZZZZZZZZZZZZZZZZZZZZ' } })).toBe(false);
    expect(check({ overlay: { text: 'other', sha256: response.overlay.sha256 } })).toBe(false);
    expect(check({ overlay: { text: 'x'.repeat(3801), sha256: sha256Hex('x'.repeat(3801)) } })).toBe(false);
    expect(check({ projection: { fromUserMessageId: 'a', sourceAnchorIds: ['a'] } })).toBe(false);
    expect(check({ rawHistoryReusable: false })).toBe(false);
    expect(check({ guardRegistrationVersion: 2 })).toBe(false);
    expect(check({ basisDigest: 'ZZ' })).toBe(false);
    expect(check({ decision: 'hold', rawHistoryReusable: false, reason: 'none', overlay: null })).toBe(false);
    expect(check({ decision: 'hold', rawHistoryReusable: false, reason: 'proof_unavailable' })).toBe(false); // overlay present
    expect(check({ decision: 'project', rawHistoryReusable: false, reason: 'source_changed', projection: null })).toBe(false);
    expect(check({ decision: 'project', rawHistoryReusable: false, reason: 'history_ambiguous', projection: { fromUserMessageId: 'a', sourceAnchorIds: ['a'] } })).toBe(false);
    expect(check({ decision: 'project', rawHistoryReusable: false, reason: 'source_changed', projection: { fromUserMessageId: 'z', sourceAnchorIds: ['a'] } })).toBe(false);
    expect(check({ decision: 'ordinary', overlay: null, reason: 'source_changed' })).toBe(false);
  });

  it('parses the export strictly: unavailable exports carry no invented fields; proofs and query are bounded', () => {
    const answer = ex().exports.answer;
    expect(parseProviderFrameExport({ ...ex().exports.cancelled, request: ex().requests.answer }).ok).toBe(false);
    expect(parseProviderFrameExport({ ...answer, extra: 1 }).ok).toBe(false);
    expect(parseProviderFrameExport({ ...answer, originCoverage: 'partial' }).ok).toBe(false);
    expect(parseProviderFrameExport({ ...answer, sourceProofs: [{ ...answer.sourceProofs[0], relation: 'later' }] }).ok).toBe(false);
    expect(parseProviderFrameExport({ ...answer, sourceProofs: Array.from({ length: 65 }, (_, i) => ({ sourceAnchorId: `m${i}`, stored: true, visible: true, relation: 'current', derivedSummaryIds: [] })) }).ok).toBe(false);
    expect(parseProviderFrameExport({ ...answer, sourceProofs: [{ ...answer.sourceProofs[0], derivedSummaryIds: Array.from({ length: 65 }, (_, i) => `s${i}`) }] }).ok).toBe(false);
    expect(parseSourceAnchorQuery(JSON.stringify(['a', 'b']))).toEqual({ ok: true, value: ['a', 'b'] });
    expect(parseSourceAnchorQuery(JSON.stringify(['a', 'a'])).ok).toBe(false);
    expect(parseSourceAnchorQuery(JSON.stringify(Array.from({ length: 65 }, (_, i) => `a${i}`))).ok).toBe(false);
    expect(parseSourceAnchorQuery('nope').ok).toBe(false);
    expect(parseEnrollmentResponse({ schemaVersion: 1, sdkSessionId: 'other', engineGeneration: 'e', guarded: true }, 'ses').ok).toBe(false);
    expect(parseEnrollmentResponse({ schemaVersion: 1, sdkSessionId: 'ses', engineGeneration: 'e', guarded: false }, 'ses').ok).toBe(false);
  });
});

describe('basis material', () => {
  it('is order-independent over sources and changes with any receiver/witness/source difference', () => {
    const material = {
      version: 2 as const,
      receiver: { ownerUserId: 7, projectId: 'p', sessionId: 's', sdkSessionId: 'k', agent: 'a', receiverKind: 'foreground' as const, consentGeneration: 'c', configurationGeneration: 'g', overlayEligible: true },
      witnesses: [{ dispatchId: 'd', kind: 'v2_native_user' as const, anchor: 'm', sources: ['b', 'a'] }],
      decision: 'allow' as const, reason: 'none' as const, rawHistoryReusable: true, projection: null, overlaySha256: null,
    };
    const digest = providerBasisDigest(material);
    expect(providerBasisDigest({ ...material, witnesses: [{ ...material.witnesses[0], sources: ['a', 'b'] }] })).toBe(digest);
    expect(providerBasisDigest({ ...material, witnesses: [{ ...material.witnesses[0], sources: ['a', 'c'] }] })).not.toBe(digest);
    expect(providerBasisDigest({ ...material, receiver: { ...material.receiver, agent: 'b' } })).not.toBe(digest);
    expect(providerBasisDigest({ ...material, witnesses: [] })).not.toBe(digest);
  });
});

describe('POST /dayflow-agent/provider-admission', () => {
  let h: Harness;
  beforeEach(async () => { h = await buildHarness(); });
  afterEach(async () => { await h.close(); vi.restoreAllMocks(); });

  it('requires the existing authentication and refuses anything but the exact request DTO', async () => {
    const req = request();
    const anonymous = await fetch(`${h.baseUrl}/dayflow-agent/provider-admission`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req),
    });
    expect(anonymous.status).toBe(401);
    for (const body of [
      {}, { ...req, extra: true }, { ...req, ownerUserId: OWNER }, { ...req, projectId: PROJECT },
      { ...req, mode: 'allow' }, { ...req, schemaVersion: 2 }, { ...req, purpose: 'title' },
      { ...req, inputDigest: 'f'.repeat(63) }, [req],
    ]) {
      const result = await h.post(body);
      expect(result.status).toBe(400);
      expect(JSON.stringify(result.body)).not.toContain('Synthetic');
    }
    // nothing was read, enrolled or written for any of them
    expect(h.engine.events).toEqual([]);
    expect(h.manifest()).toBeNull();
  });

  it('releases a current overlay only after enrollment and a durable V2 exposure, then stays stable across an unchanged tool loop', async () => {
    const snapshots: Array<[string, boolean]> = [];
    h.engine.onEnroll = () => snapshots.push(['enroll', !!h.manifest()?.userExposure]);
    h.engine.onFrame = () => snapshots.push(['frame', !!h.manifest()?.userExposure]);
    const first = await h.admit();
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      schemaVersion: 1, decision: 'allow', rawHistoryReusable: true, guardRegistrationVersion: 1,
      projection: null, reason: 'none', request: first.req,
    });
    expect(first.body.overlay.text).toContain('Synthetic useful handoff detail.');
    expect(first.body.overlay.text).toContain('<<<UNTRUSTED_EXTERNAL_CONTENT>>>');
    expect(first.body.overlay.sha256).toBe(sha256Hex(first.body.overlay.text));
    expect(Buffer.byteLength(first.body.overlay.text, 'utf8')).toBeLessThanOrEqual(3800);
    expect(validateProviderAdmissionResponse(first.body, first.req).ok).toBe(true);
    // Order: initial frame proof (nothing durable) → canonical read → ENROLLMENT (nothing durable yet)
    // → exposure persisted → live frame proof (exposure already durable) → response.
    expect(snapshots).toEqual([['frame', false], ['enroll', false], ['frame', true]]);
    expect(h.engine.events.indexOf('resolve')).toBeLessThan(h.engine.events.indexOf('enroll'));
    // The V2 exposure is bound to the native user message, with no invented tool turn.
    const manifest = h.manifest()!;
    expect(manifest._version).toBe(1);
    expect(manifest._turn).toBeNull();
    expect(manifest.candidates).toEqual([]);
    expect(manifest.userExposure).toMatchObject({ userMessageId: USER_1 });
    expect(manifest.userExposure.candidates).toHaveLength(1);

    // Same state, new attempt/nonce/digest → the same basis (no nonce/attempt/digest dependence).
    const second = await h.admit({ attempt: 1, inputDigest: DIGEST_LOOP });
    expect(second.body.decision).toBe('allow');
    expect(second.body.basisDigest).toBe(first.body.basisDigest);
    expect(second.body.overlay).toEqual(first.body.overlay);
    expect(h.manifest()!.userExposure.candidates).toHaveLength(1); // idempotent, not duplicated
  });

  it('keeps the V2 exposure inside the raw-history revalidation (it is a dependency too)', async () => {
    await h.admit();
    const history = h.records.listSdkHistory(SDK);
    expect(history).toHaveLength(1);
    expect(history![0].binding.sdkTurnId).toBe('');
    expect(history![0].candidates).toEqual([candidate(1)]);
  });

  it('holds with proof_unavailable, no enrollment and no exposure when the frame is not exactly this pending attempt', async () => {
    for (const status of ['cancelled', 'replaced'] as const) {
      const result = await h.admit({}, { status });
      expect(result.body).toMatchObject({ decision: 'hold', reason: 'proof_unavailable', overlay: null, projection: null, rawHistoryReusable: false });
    }
    expect((await h.post(request())).body).toMatchObject({ decision: 'hold', reason: 'proof_unavailable' }); // never installed → not_pending
    h.engine.frameFailure = true;
    expect((await h.admit()).body).toMatchObject({ decision: 'hold', reason: 'proof_unavailable' });
    h.engine.frameFailure = false;
    for (const patch of [
      { requestNonce: nonce() }, { inputDigest: 'e'.repeat(64) }, { engineGeneration: 'engine_other' },
      { runnerGeneration: 'runner_other' }, { attempt: 3 }, { userMessageId: 'msg_other' }, { purpose: 'compaction' as const },
      { sdkSessionId: 'sdk:other' },
    ]) {
      const req = request();
      h.engine.frames.set(req.requestNonce, {
        request: { ...req, ...patch }, agentName: AGENT, userKind: 'authored', initiating: null, groupCount: 3,
        coverage: 'complete', status: 'pending',
      });
      expect((await h.post(req)).body, JSON.stringify(patch)).toMatchObject({ decision: 'hold', overlay: null });
    }
    expect(h.engine.enrolled.size).toBe(0);
    expect(h.manifest()).toBeNull();
  });

  it('holds when the frame is replaced between the first proof and the live proof, leaving no text', async () => {
    const req = request();
    h.engine.install(req);
    let seen = 0;
    h.engine.onFrame = (key) => { seen += 1; if (key === req.requestNonce && seen === 2) h.engine.frames.get(key)!.status = 'replaced'; };
    const result = await h.post(req);
    expect(result.body).toMatchObject({ decision: 'hold', overlay: null });
    expect(['proof_unavailable', 'source_changed']).toContain(result.body.reason);
    expect(JSON.stringify(result.body)).not.toContain('Synthetic useful');
  });

  it('requires ownership: another user, an unknown SDK with dependencies, or an archived root', async () => {
    const stranger = await h.token(8);
    expect((await h.admit({}, {}, stranger)).body).toMatchObject({ decision: 'hold', reason: 'receiver_changed' });
    expect(h.manifest()).toBeNull();
    // unknown SDK, zero dependencies → authoritative ordinary (no overlay, no enrollment)
    const unknown = await h.admit({ sdkSessionId: 'sdk:unknown', userMessageId: 'msg_u' });
    expect(unknown.body).toMatchObject({ decision: 'ordinary', rawHistoryReusable: true, overlay: null, projection: null, reason: 'none' });
    expect(h.engine.enrolled.size).toBe(0);
    // an exposure exists, then the root is archived → held, never ordinary
    await h.admit();
    h.db.prepare('UPDATE agent_sessions SET archived_at=? WHERE id=?').run('2026-10-06T00:00:00.000Z', ROOT);
    expect((await h.admit()).body).toMatchObject({ decision: 'hold', reason: 'receiver_changed' });
  });

  it('never gives a standalone/no-dependency, non-eligible SDK anything but ordinary', async () => {
    h.makeSession('session:plain', { sdk_session_id: 'sdk:plain', profile_id: null });
    const result = await h.admit({ sdkSessionId: 'sdk:plain', userMessageId: 'msg_plain' });
    expect(result.body).toMatchObject({ decision: 'ordinary', overlay: null });
    expect(h.engine.enrolled.size).toBe(0);
    expect(h.resolved).toEqual([]);
  });

  describe('receiver binding is the real native user message, never a guess', () => {
    it('no overlay without a durable dispatch for exactly this native user message', async () => {
      const result = await h.admit({ userMessageId: 'msg_unbound' });
      expect(result.body).toMatchObject({ decision: 'ordinary', overlay: null });
      expect(h.resolved).toEqual([]);
      expect(h.manifest('msg_unbound')).toBeNull();
    });

    it.each([
      ['an ordinary route-authenticated chat dispatch (not the C2 foreground)', { origin: 'ws_input', requestedSource: 'session', routeAuthed: true, reasonCode: null }],
      ['a foreground-shaped dispatch that was not route-authenticated', { origin: 'prompt_api', requestedSource: 'session', routeAuthed: false, reasonCode: 'c2_foreground' }],
      ['an approval wake', { origin: 'approval_continuation', requestedSource: 'agent_config', routeAuthed: null, reasonCode: null }],
    ])('does not accept %s as the receiver', async (_name, shape) => {
      h.db.prepare('DELETE FROM agent_turn_dispatches').run();
      const row = h.provenance.insert({ sessionId: ROOT, sdkSessionId: SDK, sdkUserMessageId: USER_1, ...shape } as never);
      h.provenance.setOutcome(row.id, 'accepted');
      const result = await h.admit();
      expect(result.body).toMatchObject({ decision: 'ordinary', overlay: null });
      expect(h.resolved).toEqual([]);
    });

    it('does not accept a rejected dispatch, but does accept a pending exact foreground dispatch', async () => {
      h.db.prepare(`UPDATE agent_turn_dispatches SET outcome='rejected'`).run();
      expect((await h.admit()).body).toMatchObject({ decision: 'ordinary', overlay: null });
      h.db.prepare(`UPDATE agent_turn_dispatches SET outcome='pending'`).run();
      expect((await h.admit()).body).toMatchObject({ decision: 'allow' });
    });

    it('requires the current primary root, the selected Secretary agent and the active consent for any overlay', async () => {
      expect((await h.admit({}, { agentName: 'some-other-agent' })).body).toMatchObject({ decision: 'ordinary', overlay: null });
      h.db.prepare('UPDATE agent_sessions SET coordinator_conversation_json=NULL WHERE id=?').run(ROOT);
      expect((await h.admit()).body).toMatchObject({ decision: 'ordinary', overlay: null });
      expect(h.resolved).toEqual([]);
      expect(h.manifest()).toBeNull();
    });

    it('gives no overlay without current consent', async () => {
      h.consent.revoke();
      expect((await h.admit()).body).toMatchObject({ decision: 'ordinary', overlay: null });
      expect(h.resolved).toEqual([]);
    });

    it('compaction and summary are history-only: no overlay, no enrollment, no new exposure', async () => {
      for (const purpose of ['compaction', 'summary'] as const) {
        const result = await h.admit({ purpose, userMessageId: 'msg_control', inputDigest: DIGEST_COMPACTION },
          { agentName: 'compaction', userKind: 'control', initiating: USER_1, groupCount: 2 });
        expect(result.body).toMatchObject({ decision: 'ordinary', overlay: null });
      }
      expect(h.resolved).toEqual([]);
      expect(h.manifest()).toBeNull();
      expect(h.engine.enrolled.size).toBe(0);
    });
  });

  describe('exact durable null-auth goal/delegation callback', () => {
    const CALLBACK_USER = 'msg_callback_user';
    function seedCallback(options: { command?: boolean; delegation?: boolean; marker?: string } = {}): string {
      const scope = { ownerUserId: OWNER, projectId: PROJECT, sessionId: ROOT };
      const goal = h.conversations.addGoal({ ...scope, expectedControlRevision: 1, commandKey: 'goal-1', objective: 'Fix the login bug' });
      const goalId = (goal as { goal: { id: string } }).goal.id;
      h.makeSession('child:1', { parent_session_id: ROOT, sdk_session_id: 'sdk:child' });
      if (options.command !== false) {
        expect(h.conversations.reserveGoalDelegation({ ...scope, expectedControlRevision: 2, commandKey: 'delegate-1', goalId, parentSdkSessionId: SDK }).kind).toBe('reserved');
        expect(h.conversations.settleGoalDelegation({ ...scope, expectedControlRevision: 3, commandKey: 'delegate-1', goalId, outcome: 'dispatched', delegationId: 'dg-1', childSessionId: 'child:1' }).kind).toBe('dispatched');
      }
      if (options.delegation !== false) {
        h.db.prepare(`INSERT INTO agent_async_delegations (id, parent_session_id, child_session_id, target_agent_config_id, status, completion_text, completed_at, created_at, updated_at)
          VALUES ('dg-1', ?, 'child:1', 'workflow-orchestrator', 'waking', 'child result', ?, ?, ?)`).run(ROOT, h_now(), h_now(), h_now());
      }
      const row = h.provenance.insert({
        sessionId: ROOT, sdkSessionId: SDK, sdkUserMessageId: CALLBACK_USER, origin: 'delegation_completion',
        requestedSource: 'agent_config', routeAuthed: null, reasonCode: options.marker ?? 'c2_goal_callback:dg-1',
      });
      h.provenance.setOutcome(row.id, 'accepted');
      h.engine.stored.push(CALLBACK_USER);
      return row.id;
    }
    const h_now = () => '2026-10-06T12:00:00.000Z';

    it('gets the same overlay path under its own durable binding, with the null-auth dispatch unchanged', async () => {
      const dispatchId = seedCallback();
      const result = await h.admit({ userMessageId: CALLBACK_USER });
      expect(result.body).toMatchObject({ decision: 'allow', rawHistoryReusable: true });
      expect(result.body.overlay.text).toContain('Synthetic useful handoff detail.');
      expect(h.manifest(dispatchId)!.userExposure.userMessageId).toBe(CALLBACK_USER);
      expect(h.db.prepare('SELECT route_authed, origin FROM agent_turn_dispatches WHERE id=?').get(dispatchId)).toEqual({ route_authed: null, origin: 'delegation_completion' });
      expect((h.db.prepare('SELECT COUNT(*) AS n FROM agent_async_delegations').get() as { n: number }).n).toBe(1); // starts nothing
    });

    it.each([
      ['no durable delegate command', { command: false }],
      ['no delegation row', { delegation: false }],
      ['a forged marker for another delegation', { marker: 'c2_goal_callback:dg-other' }],
      ['a marker-shaped but unparseable code', { marker: 'c2_goal_callback' }],
    ])('refuses an overlay for %s', async (_name, options) => {
      seedCallback(options);
      const result = await h.admit({ userMessageId: CALLBACK_USER });
      expect(result.body).toMatchObject({ decision: 'ordinary', overlay: null });
      expect(h.resolved).toEqual([]);
      expect(h.manifest()).toBeNull();
    });
  });

  describe('fail-closed persistence, enrollment and source races', () => {
    it('holds with no text and no exposure when enrollment fails', async () => {
      h.engine.enrollFailure = true;
      const result = await h.admit();
      expect(result.body).toMatchObject({ decision: 'hold', reason: 'proof_unavailable', overlay: null });
      expect(h.manifest()).toBeNull();
      expect(JSON.stringify(result.body)).not.toContain('Synthetic useful');
    });

    it('holds when the durable exposure cannot be written (append-before-overlay)', async () => {
      vi.spyOn(h.records, 'appendProviderExposure').mockReturnValue(false);
      const result = await h.admit();
      expect(result.body).toMatchObject({ decision: 'hold', reason: 'proof_unavailable', overlay: null });
      expect(JSON.stringify(result.body)).not.toContain('Synthetic useful');
    });

    it('holds on a corrupt retained manifest instead of treating it as empty', async () => {
      await h.admit();
      h.db.prepare(`UPDATE agent_turn_dispatches SET dayflow_context_manifest_json='{"schemaVersion":1,"candidates":"x"}' WHERE sdk_user_message_id=?`).run(USER_1);
      expect((await h.admit()).body).toMatchObject({ decision: 'hold', reason: 'history_ambiguous', overlay: null });
    });

    it('holds when the source changes after the exposure was persisted and before the text', async () => {
      const req = request();
      h.engine.install(req);
      h.engine.onFrame = (key) => { if (key === req.requestNonce && h.manifest()?.userExposure) h.reader.candidates = [candidate(2)]; };
      const result = await h.post(req);
      expect(result.body).toMatchObject({ decision: 'hold', overlay: null });
      expect(JSON.stringify(result.body)).not.toContain('Synthetic useful');
      // the persisted exposure stays: dependency history is additive and never rolled back
      expect(h.manifest()!.userExposure.candidates).toHaveLength(1);
    });

    it('excludes a deleted/revoked canonical note and keeps the valid partial evidence', async () => {
      h.reader.candidates = [candidate(1), candidate(2)];
      const canonical = (h.evidence as unknown as { canonical: { resolve: (i: { candidate: { reference: { canonicalId: string } } }) => Promise<{ content: string } | null> } }).canonical;
      vi.spyOn(canonical, 'resolve').mockImplementation(async (input) =>
        input.candidate.reference.canonicalId.endsWith('1') ? null : { content: 'Valid partial detail.' });
      const result = await h.admit();
      expect(result.body.decision).toBe('allow');
      expect(result.body.overlay.text).toContain('Valid partial detail.');
      expect(h.manifest()!.userExposure.candidates.map((c: { reference: { canonicalId: string } }) => c.reference.canonicalId))
        .toEqual([candidate(2).reference.canonicalId]);
    });

    it('releases nothing and persists nothing when every canonical note is gone', async () => {
      const canonical = (h.evidence as unknown as { canonical: { resolve: () => Promise<null> } }).canonical;
      vi.spyOn(canonical, 'resolve').mockResolvedValue(null);
      expect((await h.admit()).body).toMatchObject({ decision: 'ordinary', overlay: null });
      expect(h.manifest()).toBeNull();
    });
  });

  describe('retained dependencies: renewal, revocation, markers and projection', () => {
    async function exposeOld() {
      h.foregroundDispatch(OLD_USER);
      h.engine.stored = [OLD_USER, OLD_ASSISTANT, USER_1];
      return h.admit({ userMessageId: OLD_USER });
    }
    const oldRow = () => (h.db.prepare('SELECT id FROM agent_turn_dispatches WHERE sdk_user_message_id=?').get(OLD_USER) as { id: string }).id;

    it('retains the old exposure on renewal, projects from it and still releases the renewed overlay', async () => {
      expect((await exposeOld()).body.decision).toBe('allow');
      // Renewal: same canonical content, new reference version; the old receipt no longer qualifies.
      h.reader.candidates = [candidate(1, { expiresAt: '2031-10-05T01:00:00.000Z' })];
      const result = await h.admit();
      expect(result.body).toMatchObject({
        decision: 'project', rawHistoryReusable: false, reason: 'source_changed',
        projection: { fromUserMessageId: OLD_USER, sourceAnchorIds: [OLD_USER] },
      });
      expect(result.body.overlay.text).toContain('Synthetic useful handoff detail.');
      // Neither exposure was overwritten: the old one keeps its original version.
      expect(h.manifest(oldRow())!.userExposure.candidates[0].reference.expiresAt).toBe(candidate(1).reference.expiresAt);
      expect(h.manifest()!.userExposure.candidates[0].reference.expiresAt).toBe('2031-10-05T01:00:00.000Z');
    });

    it('projects from the earliest invalid anchor when its evidence is revoked, and holds when it cannot prove that anchor', async () => {
      await exposeOld();
      h.reader.candidates = [];
      const projected = await h.admit();
      expect(projected.body).toMatchObject({ decision: 'project', reason: 'source_changed', overlay: null });
      expect(projected.body.projection).toEqual({ fromUserMessageId: OLD_USER, sourceAnchorIds: [OLD_USER] });
      // The original anchor is not stored natively any more → unprovable → hold, never a guess.
      h.engine.stored = [USER_1];
      expect((await h.admit()).body).toMatchObject({ decision: 'hold', reason: 'history_ambiguous' });
    });

    it('holds a projection that needs ambiguous origin coverage', async () => {
      await exposeOld();
      h.reader.candidates = [];
      expect((await h.admit({}, { coverage: 'ambiguous' })).body).toMatchObject({ decision: 'hold', reason: 'history_ambiguous' });
    });

    it('turns revoked consent on retained history into a receiver-change projection, with no new body', async () => {
      await exposeOld();
      h.consent.revoke();
      h.reader.status = 'not_configured';
      h.reader.candidates = [];
      expect((await h.admit()).body).toMatchObject({ decision: 'project', reason: 'receiver_changed', overlay: null });
    });

    it('lets a sticky unsafe marker coexist only with a proved projection, and holds a marker with no readable exposure', async () => {
      await exposeOld();
      h.records.markSdkUnsafe(SDK, 'dayflow_dependency_revalidation_failed');
      const projected = await h.admit();
      expect(projected.body).toMatchObject({ decision: 'project', rawHistoryReusable: false });
      expect(h.db.prepare('SELECT dayflow_context_nonreuse_code AS code FROM agent_sessions WHERE id=?').get(ROOT))
        .toEqual({ code: 'dayflow_dependency_revalidation_failed' });
      h.db.prepare(`UPDATE agent_turn_dispatches SET dayflow_context_schema_version=NULL, dayflow_context_manifest_json=NULL,
        dayflow_context_manifest_revision=NULL, dayflow_context_owner_user_id=NULL, dayflow_context_project_id=NULL,
        dayflow_context_sdk_session_id=NULL, dayflow_context_sdk_turn_id=NULL`).run();
      expect((await h.admit()).body).toMatchObject({ decision: 'hold', reason: 'history_ambiguous' });
    });

    it('keeps the history-only decision for a different selected agent: valid history unchanged, no new overlay', async () => {
      await exposeOld();
      expect((await h.admit({}, { agentName: 'another-agent' })).body)
        .toMatchObject({ decision: 'allow', rawHistoryReusable: true, overlay: null, reason: 'none' });
    });

    it('compaction projects invalid retained history from its proved anchor and never adds an overlay', async () => {
      await exposeOld();
      h.reader.candidates = [];
      h.engine.stored = [OLD_USER, OLD_ASSISTANT, USER_1, 'msg_control']; // the control message is natively stored too
      const result = await h.admit(
        { purpose: 'compaction', userMessageId: 'msg_control', inputDigest: DIGEST_COMPACTION },
        { agentName: 'compaction', userKind: 'control', initiating: USER_1, groupCount: 2 },
      );
      expect(result.body).toMatchObject({ decision: 'project', reason: 'source_changed', overlay: null });
    });

    it('does not order anchors it cannot compare', async () => {
      h.foregroundDispatch('opaque-user-id');
      h.engine.stored = ['opaque-user-id', USER_1];
      await h.admit({ userMessageId: 'opaque-user-id' });
      h.reader.candidates = [];
      expect((await h.admit()).body).toMatchObject({ decision: 'hold', reason: 'history_ambiguous' });
    });
  });

  describe('early boundary correction E1: authoritative zero-dependency non-root sessions', () => {
    const CHILD_SDK = 'sdk:child-zero';

    it('gives an ordinary child session unchanged ordinary admission (no overlay, no enrollment, no exposure)', async () => {
      h.makeSession('child:zero', { parent_session_id: ROOT, sdk_session_id: CHILD_SDK });
      h.engine.stored = [...h.engine.stored, 'msg_child_user'];
      const result = await h.admit({ sdkSessionId: CHILD_SDK, userMessageId: 'msg_child_user' });
      expect(result.body).toMatchObject({
        decision: 'ordinary', rawHistoryReusable: true, overlay: null, projection: null, reason: 'none',
      });
      expect(h.engine.enrolled.size).toBe(0);
      expect(h.resolved).toEqual([]);
      expect(h.db.prepare('SELECT COUNT(*) AS n FROM agent_turn_dispatches WHERE dayflow_context_manifest_json IS NOT NULL').get())
        .toEqual({ n: 0 });
    });

    it('still holds a non-root session that retains dependencies, and never gives it an overlay', async () => {
      expect((await h.admit()).body.decision).toBe('allow'); // exposure retained on the root
      h.db.prepare('UPDATE agent_sessions SET parent_session_id=? WHERE id=?').run('session:elsewhere', ROOT);
      const result = await h.admit();
      expect(result.body).toMatchObject({ decision: 'hold', reason: 'receiver_changed', overlay: null });
    });
  });

  describe('early boundary correction E2: final synchronous revalidation after the last await', () => {
    const noText = (body: Record<string, any>) => expect(JSON.stringify(body)).not.toContain('Synthetic useful');

    it('unchanged useful path keeps its overlay and exact decision (positive control)', async () => {
      let fired = 0;
      h.reader.onHistoryRead = () => { fired += 1; };
      const result = await h.admit();
      expect(fired).toBe(1); // the awaited retained-history read really happened
      expect(h.reader.plainReads).toBe(3); // and it is the last read of the admission
      expect(result.body).toMatchObject({ decision: 'allow', reason: 'none', rawHistoryReusable: true });
      expect(result.body.overlay.text).toContain('Synthetic useful handoff detail.');
    });

    it('omits the overlay and projects when the source is revoked during the history await', async () => {
      h.reader.onHistoryRead = () => { h.reader.candidates = []; };
      const result = await h.admit();
      expect(result.body.overlay).toBeNull();
      expect(result.body).toMatchObject({ decision: 'project', reason: 'source_changed', rawHistoryReusable: false });
      noText(result.body);
      // the already-persisted exposure is untouched: history only, no rollback
      expect(h.manifest()!.userExposure.candidates).toHaveLength(1);
    });

    it('omits the overlay and projects when the source is renewed during the history await', async () => {
      h.reader.onHistoryRead = () => { h.reader.candidates = [candidate(1, { expiresAt: '2031-10-05T01:00:00.000Z' })]; };
      const result = await h.admit();
      expect(result.body.overlay).toBeNull();
      expect(result.body).toMatchObject({ decision: 'project', reason: 'source_changed' });
      noText(result.body);
    });

    it.each([
      ['the selected agent changes', () => h.db.prepare(`UPDATE agent_configs SET oc_agent='renamed' WHERE id='secretary'`).run()],
      ['the selected profile is disabled', () => h.db.prepare(`UPDATE agent_configs SET enabled=0 WHERE id='secretary'`).run()],
      ['the root stops being the primary root', () => h.db.prepare('UPDATE agent_sessions SET coordinator_conversation_json=NULL WHERE id=?').run(ROOT)],
      ['the typed receiver dispatch is rejected', () => h.db.prepare(`UPDATE agent_turn_dispatches SET outcome='rejected' WHERE sdk_user_message_id=?`).run(USER_1)],
      ['consent is revoked', () => h.consent.revoke()],
    ])('omits the overlay (history policy still applies) when %s during the history await', async (_name, mutate) => {
      h.reader.onHistoryRead = () => { mutate(); };
      const result = await h.admit();
      expect(result.body.overlay).toBeNull();
      noText(result.body);
      expect(result.body.decision === 'allow' || result.body.decision === 'project' || result.body.decision === 'hold').toBe(true);
      expect(result.body.rawHistoryReusable).toBe(result.body.decision !== 'project' && result.body.decision !== 'hold');
    });

    it('does not claim overlay eligibility in the basis once the overlay was omitted', async () => {
      const released = await h.admit();
      expect(released.body.overlay).not.toBeNull();
      // Same retained state, but the receiver is lost inside the final await.
      h.reader.plainReads = 0;
      h.reader.onHistoryRead = () => { h.db.prepare(`UPDATE agent_configs SET enabled=0 WHERE id='secretary'`).run(); };
      const omitted = await h.admit();
      expect(omitted.body.overlay).toBeNull();
      // a later, quiet admission under the same lost receiver agrees with the omitted basis
      h.reader.onHistoryRead = undefined;
      const quiet = await h.admit({}, {}, undefined);
      expect(quiet.body.overlay).toBeNull();
      expect(omitted.body.basisDigest).toBe(quiet.body.basisDigest);
      expect(omitted.body.basisDigest).not.toBe(released.body.basisDigest);
    });
  });
});
