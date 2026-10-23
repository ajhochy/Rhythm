import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentOrgProposal } from '../../models/agent_org_proposal';
import { applyVettedToolInstallAsync, inspectActivatedManagedToolAsync } from '../tool_install_apply';
import { invokeManagedToolDockerAsync, validateManagedToolArguments } from '../managed_tool_execution';
import { validateImmutableLocalTarballBytes } from '../tool_install_artifact';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function entry(name: string, body: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name); header.write('0000644', 100); header.write('0000000', 108); header.write('0000000', 116);
  header.write(Buffer.byteLength(body).toString(8).padStart(11, '0') + '\0', 124);
  header.write('00000000000\0', 136); header[156] = 48; header.write('ustar\0', 257);
  header.fill(32, 148, 156);
  header.write(header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([header, Buffer.from(body), Buffer.alloc((512 - Buffer.byteLength(body) % 512) % 512)]);
}

function fixture() {
  const root = mkdtempSync('/private/tmp/rhythm-managed-invocation-'); roots.push(root);
  const artifactRoot = join(root, 'artifacts'), managedRoot = join(root, 'managed'); mkdirSync(artifactRoot);
  const bytes = gzipSync(Buffer.concat([
    entry('package/package.json', JSON.stringify({ name: 'fixture-tool', version: '1.0.0', bin: { 'fixture-tool': 'index.js' } })),
    entry('package/index.js', '#!/usr/bin/env node\nlet input="";process.stdin.on("data",b=>input+=b);process.stdin.on("end",()=>console.log(JSON.stringify({args:process.argv.slice(2),input,home:process.env.HOME,secret:process.env.MANAGED_HOST_SECRET??null})))\n'),
    Buffer.alloc(1024),
  ]));
  const digest = createHash('sha256').update(bytes).digest('hex'); writeFileSync(join(artifactRoot, `${digest}.tgz`), bytes);
  const proposal = { id: 'owned-install', kind: 'tool-install', status: 'applied', changeJson: JSON.stringify({
    toolName: 'fixture-tool', packageSource: `local-tarball:sha256:${digest}`, installMethod: 'local-tarball',
    agentConfigId: 'owned-profile', testPrompts: ['version-check', 'help-check'],
  }) } as AgentOrgProposal;
  return { root, artifactRoot, managedRoot, proposal, digest };
}

describe('approved managed-tool discovery and confinement', () => {
  it('discovers only an activated install bound to the approved agent and exact immutable bytes', async () => {
    const f = fixture();
    expect(await inspectActivatedManagedToolAsync(f.proposal, 'owned-profile', { managedRoot: f.managedRoot })).toBeNull();
    expect(await applyVettedToolInstallAsync(f.proposal, undefined, { managedRoot: f.managedRoot, artifactRoot: f.artifactRoot,
      skipSafetyRecheck: true, runner: async (_argv, cwd) => {
        mkdirSync(join(cwd, 'node_modules', 'fixture-tool'), { recursive: true });
        writeFileSync(join(cwd, 'node_modules', 'fixture-tool', 'package.json'), '{"name":"fixture-tool"}');
      } })).toEqual({ applied: true, reason: null });
    const installed = await inspectActivatedManagedToolAsync(f.proposal, 'owned-profile', { managedRoot: f.managedRoot });
    expect(installed).toMatchObject({ toolName: 'fixture-tool', artifactDigest: f.digest, proposalId: f.proposal.id });
    expect(await inspectActivatedManagedToolAsync(f.proposal, 'another-profile', { managedRoot: f.managedRoot })).toBeNull();
    const rebound = { ...f.proposal, changeJson: JSON.stringify({ ...JSON.parse(f.proposal.changeJson!), agentConfigId: 'another-profile' }) };
    expect(await inspectActivatedManagedToolAsync(rebound, 'another-profile', { managedRoot: f.managedRoot })).toBeNull();
    writeFileSync(installed!.artifactPath, 'changed');
    expect(await inspectActivatedManagedToolAsync(f.proposal, 'owned-profile', { managedRoot: f.managedRoot })).toBeNull();
  });

  it('refuses legacy unbound receipts and a symlink replacing the installed archive', async () => {
    const f = fixture();
    await applyVettedToolInstallAsync(f.proposal, undefined, { managedRoot: f.managedRoot, artifactRoot: f.artifactRoot,
      skipSafetyRecheck: true, runner: async (_argv, cwd) => {
        mkdirSync(join(cwd, 'node_modules', 'fixture-tool'), { recursive: true });
        writeFileSync(join(cwd, 'node_modules', 'fixture-tool', 'package.json'), '{"name":"fixture-tool"}');
      } });
    const installed = await inspectActivatedManagedToolAsync(f.proposal, 'owned-profile', { managedRoot: f.managedRoot });
    const receiptPath = join(f.managedRoot, 'tools', `fixture-tool-${f.digest.slice(0,16)}`, '.rhythm-managed-install.json');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')); delete receipt.agentConfigId;
    writeFileSync(receiptPath, JSON.stringify(receipt));
    expect(await inspectActivatedManagedToolAsync(f.proposal, 'owned-profile', { managedRoot: f.managedRoot })).toBeNull();
    receipt.agentConfigId = 'owned-profile'; writeFileSync(receiptPath, JSON.stringify(receipt));
    rmSync(installed!.artifactPath); symlinkSync(join(f.artifactRoot, `${f.digest}.tgz`), installed!.artifactPath);
    expect(await inspectActivatedManagedToolAsync(f.proposal, 'owned-profile', { managedRoot: f.managedRoot })).toBeNull();
  });

  it('bounds argv/stdin and preserves shell-looking arguments as data', () => {
    expect(validateManagedToolArguments({ argv: ['--query', '$(touch /host); x'], stdin: 'input' }))
      .toEqual({ argv: ['--query', '$(touch /host); x'], stdin: 'input' });
    for (const input of [{ argv: ['x\0y'] }, { argv: Array(33).fill('x') }, { argv: ['x'.repeat(8193)] },
      { argv: [], stdin: 'x'.repeat(32769) }, { argv: [], env: { SECRET: 'no' } }])
      expect(() => validateManagedToolArguments(input)).toThrow();
  });
  it('refuses a tiny compressed archive that expands beyond the managed-tool limit', () => {
    const bytes = gzipSync(Buffer.concat([
      entry('package/package.json', '{"name":"fixture-tool","version":"1.0.0"}'),
      entry('package/large.bin', 'x'.repeat(21 * 1024 * 1024)), Buffer.alloc(1024),
    ]));
    expect(bytes.length).toBeLessThan(100_000);
    expect(validateImmutableLocalTarballBytes(bytes, createHash('sha256').update(bytes).digest('hex'), 'fixture-tool')).toBeNull();
  });
});

describe.skipIf(process.env.RHYTHM_EVAL_TOOL_DOCKER !== '1')('real approved managed-tool execution', () => {
  it('installs real pinned bytes, executes real argv/stdin offline, and does not inherit host secrets', async () => {
    const f = fixture();
    expect(await applyVettedToolInstallAsync(f.proposal, undefined, { managedRoot: f.managedRoot, artifactRoot: f.artifactRoot,
      skipSafetyRecheck: true })).toEqual({ applied: true, reason: null });
    const installed = await inspectActivatedManagedToolAsync(f.proposal, 'owned-profile', { managedRoot: f.managedRoot });
    expect(installed).not.toBeNull();
    process.env.MANAGED_HOST_SECRET = 'must-not-leave-host';
    try {
      const result = await invokeManagedToolDockerAsync(installed!, { argv: ['--query', '$(touch /host); x'], stdin: 'known-input' });
      expect(JSON.parse(result.output.trim())).toEqual({ args: ['--query', '$(touch /host); x'], input: 'known-input', home: '/tmp', secret: null });
      expect(result).toMatchObject({ artifactDigest: f.digest, networkMode: 'none', forbiddenArtifactWriteDenied: true });
    } finally { delete process.env.MANAGED_HOST_SECRET; }
  }, 90_000);
});
