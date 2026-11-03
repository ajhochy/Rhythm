/** Real Docker and copied-state integration; the signer and active callback are test doubles.
 * This does not qualify the private engine-signed evaluation path. */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { runMigrations } from '../../database/migrations';
import { setDb } from '../../database/db';
import { AgentConfigsRepository } from '../../repositories/agent_configs_repository';
import { AgentSessionsRepository } from '../../repositories/agent_sessions_repository';
import { AgentOrgProposalsRepository } from '../../repositories/agent_org_proposals_repository';
import { ToolSafetyReportsRepository } from '../../repositories/tool_safety_reports_repository';
import { buildProfileRevisionFingerprint } from '../org_proposal_experiment_service';
import { PROPOSAL_EVIDENCE_BUNDLE_VERSION } from '../../models/proposal_evidence_bundle';
import { GUARDRAIL_NAMES } from '../../models/guardrail_registry';
import { asOpenCodeAgentId, asRhythmProfileId } from '../../models/agent_session';
import { buildToolInstallProposalFingerprint } from '../tool_install_safety_policy';
import { approveVettedToolInstallProposalAsync } from '../tool_install_proposal_lifecycle';
import { applyVettedToolInstallAsync, inspectActivatedManagedToolAsync } from '../tool_install_apply';
import { ManagedToolsService, MANAGED_TOOLS_LIST, MANAGED_TOOLS_RUN } from '../managed_tools_service';
import { createIsolatedTrustedMcpVerifier } from '../../security/trusted_mcp_call';
import { createTrustedMcpTestSigner } from '../../__tests__/helpers/trusted_mcp_test_proof';
import { startPrivateManagedToolReceiverAsync } from '../org_evaluation_managed_receiver';
import { handleManagedMcpRequest } from '../org_evaluation_managed_mcp_shim';

function tarEntry(name: string, body: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name); header.write('0000755', 100); header.write('0000000', 108);
  header.write('0000000', 116); header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136); header[156] = '0'.charCodeAt(0);
  header.write('ustar\0', 257); header.fill(0x20, 148, 156);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, Buffer.from(body), Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

async function main(): Promise<void> {
  const root = mkdtempSync('/private/tmp/rhythm-eval-signed-tool-');
  const artifactRoot = join(root, 'artifacts'); const managedRoot = join(root, 'managed');
  mkdirSync(artifactRoot);
  const archive = gzipSync(Buffer.concat([
    tarEntry('package/package.json', JSON.stringify({ name: 'fixture-tool', version: '1.0.0', bin: { 'fixture-tool': 'index.js' } })),
    tarEntry('package/index.js', '#!/usr/bin/env node\nconsole.log("fixture-tool 1.0.0")\n'), Buffer.alloc(1024),
  ]));
  const digest = createHash('sha256').update(archive).digest('hex');
  writeFileSync(join(artifactRoot, `${digest}.tgz`), archive);
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db);
  const previous = setDb(db);
  try {
    const owner = 7; db.prepare('INSERT INTO users (id, name, email) VALUES (?, ?, ?)').run(owner, 'Private owner', 'owner@evaluation.invalid');
    const profile = new AgentConfigsRepository().insert({ label: 'Private managed profile', icon: 'tool' });
    db.prepare('UPDATE agent_configs SET allowed_mcps_json = ? WHERE id = ?').run('{"rhythm":[]}', profile.id);
    const sessions = new AgentSessionsRepository();
    const session = sessions.insert({ agentKind: 'codex', opencodeAgentId: asOpenCodeAgentId(profile.id),
      profileId: asRhythmProfileId(profile.id), taskId: null, cwd: root,
      name: 'Private signed session', ownerUserId: owner,
      mcpAllowedToolsJson: '{"rhythm":[]}' });
    sessions.setSdkSessionId(session.id, 'private-sdk'); sessions.updateStatus(session.id, 'working');
    const signer = createTrustedMcpTestSigner(); const wrongSigner = createTrustedMcpTestSigner();
    let active = true; let activeName = MANAGED_TOOLS_LIST;
    const service = new ManagedToolsService({
      active: async (sdkSessionId, turnId, toolCallId) => active ? ({ sdkSessionId,
        assistantId: turnId, toolCallId, agentName: profile.id,
        serverName: 'rhythm', toolName: activeName } as any) : null,
      inspect: (candidate, profileId) => inspectActivatedManagedToolAsync(candidate, profileId, { managedRoot }),
    });
    const receiver = await startPrivateManagedToolReceiverAsync({ token: 't'.repeat(64), ownerUserId: owner,
      expectedSessionId: () => 'private-sdk', verifier: createIsolatedTrustedMcpVerifier(signer.publicDocument), service });
    let sequence = 0;
    async function request(toolName: string, call: unknown): Promise<Response> {
      return fetch(`${receiver.baseURL}/managed-tools/${toolName === MANAGED_TOOLS_LIST ? 'list' : 'run'}`, {
        method: 'POST', headers: { Authorization: `Bearer ${'t'.repeat(64)}` },
        body: JSON.stringify({ trustedCall: call }),
      });
    }
    function signed(toolName: string, args: Record<string, unknown>, from = signer) {
      return from.signCall({ sdkSessionId: 'private-sdk', turnId: 'turn',
        agentName: profile.id, toolCallId: `call-${++sequence}` }, toolName, args);
    }
    try {
      assert.equal((await request(MANAGED_TOOLS_LIST, {})).status, 403); // no signature
      assert.equal((await request(MANAGED_TOOLS_LIST, signed(MANAGED_TOOLS_LIST, {}, wrongSigner))).status, 403);
      active = false;
      assert.equal((await request(MANAGED_TOOLS_LIST, signed(MANAGED_TOOLS_LIST, {}))).status, 403);
      active = true;
      const original = await request(MANAGED_TOOLS_LIST, signed(MANAGED_TOOLS_LIST, {}));
      assert.equal(original.status, 200); assert.deepEqual(await original.json(), { tools: [] });
      db.prepare('UPDATE agent_configs SET allowed_mcps_json = ? WHERE id = ?')
        .run('{}', profile.id);
      assert.equal((await request(MANAGED_TOOLS_LIST,
        signed(MANAGED_TOOLS_LIST, {}))).status, 403);
      db.prepare('UPDATE agent_configs SET allowed_mcps_json = ? WHERE id = ?')
        .run('{"rhythm":[]}', profile.id);
      activeName = MANAGED_TOOLS_RUN;
      assert.equal((await request(MANAGED_TOOLS_RUN,
        signed(MANAGED_TOOLS_RUN, { proposalId: 'scratch-candidate', argv: ['--version'], stdin: '' }))).status, 403);
      const proposals = new AgentOrgProposalsRepository(db); const reports = new ToolSafetyReportsRepository(db);
      const changeJson = JSON.stringify({ toolName: 'fixture-tool', packageSource: `local-tarball:sha256:${digest}`,
        installMethod: 'local-tarball', agentConfigId: profile.id,
        testPrompts: ['version-check', 'help-check'], evidenceBundle: {
          version: PROPOSAL_EVIDENCE_BUNDLE_VERSION,
          sourceEvidence: { sessionIds: ['owned-1', 'owned-2'], eventIds: [] },
          counterEvidenceSearch: { query: 'private fixture', searchedAt: '2026-10-21T00:00:00.000Z', contradictingCount: 0 },
          target: { ref: `agent_config:${profile.id}`, hash: buildProfileRevisionFingerprint(new AgentConfigsRepository().getById(profile.id)!) },
          expectedOutcome: 'Tool assists task', primaryMetric: { name: 'objective-success-rate', direction: 'increase' },
          guardrails: [...GUARDRAIL_NAMES], experimentAdapter: 'usage-count', rollbackRule: 'remove private tool',
          generatorVersion: 'scratch', confidenceCalibrationVersion: 'scratch' } });
      const proposal = await proposals.createAsync({ id: 'scratch-candidate', kind: 'tool-install', risk: 'high',
        status: 'sandbox-vetted', title: 'Scratch tool', targetRef: `agent_config:${profile.id}`,
        changeJson, ownerUserId: owner });
      const fingerprint = buildToolInstallProposalFingerprint(proposal); assert.ok(fingerprint);
      await reports.createAsync({ proposalId: proposal.id, proposalFingerprint: fingerprint,
        toolName: 'fixture-tool', packageSource: `local-tarball:sha256:${digest}`,
        installMethod: 'local-tarball', sandboxDurationMs: 1, testPromptsRunCount: 2,
        forbiddenPathViolationsJson: '[]', networkCallsObservedJson: '[]', fileSystemWritesObservedJson: '[]',
        credentialAccessAttemptsCount: 0, verdict: 'safe', evidenceJson: '{}' });
      const applied = await approveVettedToolInstallProposalAsync(proposal.id, owner, true, { proposals, reports,
        vet: async () => { throw Error('unexpected vet'); },
        installer: candidate => applyVettedToolInstallAsync(candidate, undefined, { artifactRoot, managedRoot }) });
      assert.equal(applied.status, 'applied');
      activeName = MANAGED_TOOLS_LIST;
      const listed = await request(MANAGED_TOOLS_LIST, signed(MANAGED_TOOLS_LIST, {}));
      assert.equal(listed.status, 200);
      const listedBody = await listed.json() as { tools: Array<{ proposalId: string; artifactDigest: string }> };
      assert.equal(listedBody.tools[0]?.proposalId, proposal.id);
      assert.equal(listedBody.tools[0]?.artifactDigest, digest);
      activeName = MANAGED_TOOLS_RUN;
      const runCall = signed(MANAGED_TOOLS_RUN, { proposalId: proposal.id, argv: ['--version'], stdin: '' });
      process.env.RHYTHM_EVALUATION_WORKER = '1';
      process.env.RHYTHM_EVALUATION_MANAGED_RECEIVER_URL = receiver.baseURL;
      process.env.RHYTHM_EVALUATION_MANAGED_RECEIVER_TOKEN = 't'.repeat(64);
      process.env.RHYTHM_EVALUATION_MCP_DIST = require('node:path').resolve(__dirname, '../../../../mcp_server/dist');
      const ran = await handleManagedMcpRequest({ id: 1, method: 'tools/call',
        params: { name: MANAGED_TOOLS_RUN, arguments: runCall.arguments,
          _meta: { 'com.vcrc.rhythm/security-context': { ...runCall.context, proof: runCall.proof } } } }) as {
            result?: { content?: Array<{ text?: string }>; isError?: boolean } };
      assert.equal(ran.result?.isError, undefined);
      assert.match(ran.result?.content?.[0]?.text ?? '', /fixture-tool 1\.0\.0/);
      assert.match(ran.result?.content?.[0]?.text ?? '', /<<<UNTRUSTED_EXTERNAL_CONTENT>>>/);
      assert.equal((db.prepare('SELECT COUNT(*) AS count FROM agent_external_content_events')
        .get() as { count: number }).count, 1);
      const forgedTaintCall = signed(MANAGED_TOOLS_RUN,
        { proposalId: proposal.id, argv: ['--version'], stdin: '' });
      const forgedTaint = await fetch(`${receiver.baseURL}/agent-approvals/external-content/taint`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trustedCall: forgedTaintCall,
          context: forgedTaintCall.context, source: 'managed-tool.run',
          contentDigest: createHash('sha256').update('forged output').digest('hex'),
          blocked: false, diagnostics: [] }),
      });
      assert.equal(forgedTaint.status, 403);
      assert.equal((await request(MANAGED_TOOLS_RUN, runCall)).status, 403); // replay
      active = false;
      assert.equal((await request(MANAGED_TOOLS_RUN,
        signed(MANAGED_TOOLS_RUN, { proposalId: proposal.id, argv: ['--version'], stdin: '' }))).status, 403);
      assert.equal(receiver.observations().length, 5); // absent list, denied run, installed list, run, taint
      assert.equal(receiver.observations().filter((entry) =>
        entry.denialReason === 'not-installed').length, 1);
    } finally {
      delete process.env.RHYTHM_EVALUATION_WORKER;
      delete process.env.RHYTHM_EVALUATION_MANAGED_RECEIVER_URL;
      delete process.env.RHYTHM_EVALUATION_MANAGED_RECEIVER_TOKEN;
      delete process.env.RHYTHM_EVALUATION_MCP_DIST;
      await receiver.close();
    }
  } finally { setDb(previous); db.close(); rmSync(root, { recursive: true, force: true }); }
}
const describeDocker = process.env.RHYTHM_EVAL_MANAGED_DOCKER === '1' ? describe : describe.skip;
describeDocker('private managed tool copied lifecycle (Docker, no engine)', () => {
  it('joins isolated signed calls, copied approval, offline install, Docker invocation, and production taint', async () => {
    await main();
  }, 120_000);
});
