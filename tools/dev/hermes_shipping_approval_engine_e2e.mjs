import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';

// External acceptance client. Only the upstream provider is synthetic.
describe('shipping Hermes MCP authenticated approval / real signed fork gate',
  { skip: process.env.RHYTHM_LIVE_E2E !== '1', concurrency: false }, () => {
    let h;
    before(async () => {
      const { setup } = await import('./hermes_shipping_approval_engine_fixture/harness.mjs');
      h = await setup();
    }, { timeout: 180_000 });
    after(async () => { if (h) await h.close(); });

    it('AC1 exact owner card approve audits Hermes assurance; concurrent signed consumption creates ONE task', async () => {
      const f = h.seed('approved');
      const foreign = h.seed('foreign', 2);
      const unowned = h.seed('unowned', null);
      const tools = (await h.owner.listTools()).tools.map(t => t.name);
      assert.equal(tools.length, 114);
      assert.equal(new Set(tools).size, 114);
      for (const name of ['rhythm_list_pending_approvals', 'rhythm_get_pending_approval', 'rhythm_decide_approval', 'rhythm_create_task', 'rhythm_subscribe_updates', 'rhythm_unsubscribe_updates']) assert.ok(tools.includes(name));
      h.evidence.inventory = { actual: tools.length, baseline: 109, approvals: 3, subscriptions: 2, additive: 5, total: 114, names: tools };
      const cards = await h.call(h.owner, 'rhythm_list_pending_approvals');
      assert.deepEqual(cards.map(c => c.id).sort(), [f.id]);
      assert.ok(!cards.some(c => [foreign.id, unowned.id].includes(c.id)));
      const card = await h.get(f);
      assert.equal(card.action, 'Authorize task.create');
      assert.equal(card.preview, JSON.stringify(f.payload));
      assert.equal(card.consequence, 'Only one safe task in the isolated synthetic database');
      assert.match(card.cardHash, /^[a-f0-9]{64}$/);
      assert.match(card.revision, /^[a-f0-9]{64}$/);
      assert.ok(!('decisionNonce' in card));
      const receipt = await h.decide(f, 'approved', card);
      assert.equal(receipt.status, 'approved');
      assert.deepEqual(receipt.audit, { kind: 'hermes-chat-decision-v1', ownerUserId: 1,
        ownerName: 'Synthetic Admin', displayIdentity: 'Synthetic Admin via Hermes', source: 'hermes',
        assurance: 'relay-attested', attestation: 'owner_chose_in_chat', decision: 'approved',
        revision: card.revision, cardHash: card.cardHash });
      assert.deepEqual(JSON.parse(h.row(f).actor), receipt.audit);
      const results = await h.prompt([h.args(f), h.args(f)]);
      assert.equal(h.count(f), 1, 'AC1 real approved concurrent calls must create exactly one task');
      assert.ok(h.row(f).consumed_at);
      assert.equal(results.filter(r => r.success).length, 1);
      assert.equal(results.filter(r => !r.success).length, 1);
      assert.match(results.find(r => !r.success).output, /already been consumed/);
      h.evidence.approved = { receipt, tasks: h.count(f), consumptions: 1, results };
    }, { timeout: 60_000 });

    it('AC2 explicit reject yields zero tasks and no consumption through real signed calls', async () => {
      const f = h.seed('rejected');
      const receipt = await h.decide(f, 'rejected');
      assert.equal(receipt.audit.decision, 'rejected');
      assert.equal(receipt.audit.ownerUserId, 1);
      assert.deepEqual(JSON.parse(h.row(f).actor), receipt.audit);
      const results = await h.prompt([h.args(f)]);
      assert.equal(results.length, 1);
      assert.match(results[0].output, /not been approved/);
      assert.equal(h.count(f), 0);
      assert.equal(h.row(f).consumed_at, null);
      h.evidence.rejected = { tasks: 0, consumed: false, results };
    }, { timeout: 60_000 });

    it('AC3 changed payload/cardhash/revision/expiry/replay yield zero additional tasks', async () => {
      const mismatch = h.seed('payload-mismatch');
      await h.decide(mismatch, 'approved');
      const altered = { ...h.args(mismatch), title: `${mismatch.title} altered` };
      const mr = await h.prompt([altered]);
      assert.match(mr[0].output, /exact outbound action and payload/);
      assert.equal(h.countTitle(altered.title), 0);
      assert.equal(h.count(mismatch), 0);
      assert.equal(h.row(mismatch).consumed_at, null);

      const changed = h.seed('card-changed');
      await h.decide(changed, 'approved');
      h.db.prepare('UPDATE agent_approvals SET preview = ? WHERE id = ?').run('Changed after approval', changed.id);
      const cr = await h.prompt([h.args(changed)]);
      assert.match(cr[0].output, /no longer matches the relay-attested card/);
      assert.equal(h.count(changed), 0);
      assert.equal(h.row(changed).consumed_at, null);

      const stale = h.seed('stale-card');
      const card = await h.get(stale);
      for (const patch of [{ cardHash: '0'.repeat(64) }, { revision: '0'.repeat(64) }]) {
        assert.equal((await h.rawDecision(h.owner, card, 'approved', patch)).isError, true);
      }
      const sr = await h.prompt([h.args(stale)]);
      assert.match(sr[0].output, /not been approved/);
      assert.equal(h.count(stale), 0);

      const expired = h.seed('expired');
      await h.decide(expired, 'approved');
      h.db.prepare('UPDATE agent_approvals SET expires_at = ? WHERE id = ?').run(new Date(0).toISOString(), expired.id);
      const er = await h.prompt([h.args(expired)]);
      assert.match(er[0].output, /expired/);
      assert.equal(h.count(expired), 0);
      assert.equal(h.row(expired).consumed_at, null);

      const approvedId = h.evidence.approved?.receipt.id;
      assert.ok(approvedId, 'AC1 must have actually consumed a task approval before replay');
      const replay = h.fixtures.get(approvedId);
      const rr = await h.prompt([h.args(replay)]);
      assert.match(rr[0].output, /already been consumed/);
      assert.equal(h.count(replay), 1);
      assert.equal((await h.rawDecision(h.owner, h.evidence.approved.receipt.audit, 'approved', { approvalId: approvedId })).isError, true);
      h.evidence.negatives = { payloadMismatch: mr, changedCard: cr, staleHashRevision: sr, expired: er, replay: rr, additionalTasks: 0 };
    }, { timeout: 90_000 });

    it('AC4 owner mismatch/bad credential/no engine context cannot decide or execute an external direct task', async () => {
      const f = h.seed('external-denial');
      const card = await h.get(f);
      assert.equal((await h.other.callTool({ name: 'rhythm_get_pending_approval', arguments: { approvalId: f.id } })).isError, true);
      assert.equal((await h.rawDecision(h.other, card, 'approved')).isError, true);
      assert.equal((await h.bad.callTool({ name: 'rhythm_list_pending_approvals', arguments: {} })).isError, true);
      assert.equal((await h.rawDecision(h.bad, card, 'approved')).isError, true);
      const approved = await h.decide(f, 'approved', card);
      for (const client of [h.owner, h.other, h.bad]) {
        const denied = await client.callTool({ name: 'rhythm_create_task', arguments: h.args(f) });
        assert.equal(denied.isError, true);
        assert.match(denied.content[0].text, /trusted Rhythm session\/turn metadata is unavailable/);
      }
      assert.equal(h.count(f), 0);
      assert.equal(h.row(f).consumed_at, null);
      assert.equal(approved.audit.assurance, 'relay-attested');
      h.evidence.external = { ownerMismatch: 'DENIED', badCredential: 'DENIED', noEngineContext: 'DENIED', tasks: 0, consumed: false };
    }, { timeout: 30_000 });
  });
