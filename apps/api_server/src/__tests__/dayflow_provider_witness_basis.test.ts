/**
 * The admission basisDigest is derived from persisted witnesses and receiver
 * facts only. A REAL V1 body read (real receiver authority + real SQLite
 * dispatch row) must persist a witness and move the basis; an unchanged loop
 * must not.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DIGEST_LOOP, OWNER, buildHarness, candidate, nonce, type Harness } from './helpers/dayflow_provider_harness';

const USER_2 = 'msg_user_2';
const auth = { sessionToken: 'signed', user: { id: OWNER } } as never;

describe('provider admission basis', () => {
  let h: Harness;
  beforeEach(async () => {
    h = await buildHarness();
    h.foregroundDispatch(USER_2);
    h.engine.stored = [...h.engine.stored, USER_2];
    h.engine.visible.add(USER_2);
  });
  afterEach(async () => { await h.close(); });

  // Another selected agent: history-only decision, so no V2 overlay is added by the probe itself.
  const probe = (over: Parameters<Harness['admit']>[0] = {}, agentName = 'another-agent') =>
    h.admit({ userMessageId: USER_2, ...over }, { agentName });

  it('is stable across nonce, attempt and input digest while nothing durable changes', async () => {
    const a = await probe();
    const b = await probe({ attempt: 2, inputDigest: DIGEST_LOOP, requestNonce: nonce() });
    expect(a.body.decision).toBe('ordinary');
    expect(b.body.basisDigest).toBe(a.body.basisDigest);
  });

  it('moves when a real V1 body reader persists a witness, after enrolling first', async () => {
    const before = await probe();
    const turnsAtEnroll: number[] = [];
    h.engine.onEnroll = () => turnsAtEnroll.push(h.manifest()?.candidates?.length ?? 0);

    const body = await h.evidence.search(auth, { trustedCall: {} });
    expect(body).toMatchObject({ status: 'available', blocked: false });
    expect(turnsAtEnroll).toEqual([0]); // enrolled before anything durable existed
    expect(h.manifest()!.candidates).toHaveLength(1);

    const after = await probe();
    expect(after.body.decision).toBe('allow'); // valid retained exposure, raw history reusable
    expect(after.body.basisDigest).not.toBe(before.body.basisDigest);

    // unchanged loop keeps the new basis
    expect((await probe({ attempt: 1, inputDigest: DIGEST_LOOP })).body.basisDigest).toBe(after.body.basisDigest);

    // a second real V1 read that exposes a different reference moves it again
    h.reader.candidates = [candidate(2), candidate(1)];
    await h.evidence.search(auth, { trustedCall: {} });
    expect(h.manifest()!.candidates).toHaveLength(2);
    const later = await probe();
    expect(later.body.decision).toBe('allow');
    expect(later.body.basisDigest).not.toBe(after.body.basisDigest);
  });

  it('moves with the V2 exposure, the selected agent and the consent generation', async () => {
    const plain = await probe();
    const ordinaryAgent = await probe({}, 'agent-b');
    expect(ordinaryAgent.body.basisDigest).not.toBe(plain.body.basisDigest);

    const fresh = await h.admit({ userMessageId: USER_2 }); // Secretary: V2 exposure on USER_2
    expect(fresh.body.decision).toBe('allow');
    expect(fresh.body.basisDigest).not.toBe(plain.body.basisDigest);
    const again = await h.admit({ userMessageId: USER_2, attempt: 1 });
    expect(again.body.basisDigest).toBe(fresh.body.basisDigest);

    h.consent.revoke();
    h.reader.status = 'not_configured';
    h.reader.candidates = [];
    expect((await probe()).body.basisDigest).not.toBe(plain.body.basisDigest);
  });
});
