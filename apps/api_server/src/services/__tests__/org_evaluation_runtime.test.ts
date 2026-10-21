import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ORG_EVALUATION_PROPOSAL_KINDS } from '../../models/org_evaluation';
import {
  assertEvaluationWorkerInput,
  requiredEffectEvidence,
  verifyObservedEffects,
  prepareEvaluationWorkerFilesystem,
  buildEvaluationWorkerEnvironment,
  evaluationSandboxPolicy,
} from '../org_evaluation_runtime';
import { readEvaluationEffectiveManifest } from '../org_evaluation_worker';

const base = {
  candidateId: 'candidate-1',
  kind: 'refine-config' as const,
  targetRef: 'agent_config:fixture-agent',
  fixtureRoot: '/private/tmp/evaluation-fixture',
  fixtureDb: '/private/tmp/evaluation-fixture/rhythm.db',
  fixtureConfig: '/private/tmp/evaluation-fixture/opencode-config',
  workerRoot: '/private/tmp/evaluation-worker-1',
  enginePort: 4797,
  providerRelayUrl: 'http://127.0.0.1:4796/agent-org-proposals/evaluations/provider/lease_1/v1',
};

describe('isolated org evaluation runtime contract', () => {
  it('rejects live paths, host endpoints and engine port before worker launch', () => {
    expect(() => assertEvaluationWorkerInput({ ...base, fixtureDb: '/Users/user/.config/rhythm/rhythm.db' })).toThrow();
    expect(() => assertEvaluationWorkerInput({ ...base, workerRoot: '/Users/user/Documents/Rhythm' })).toThrow();
    expect(() => assertEvaluationWorkerInput({ ...base, providerRelayUrl: 'https://api.openai.com' })).toThrow();
    expect(() => assertEvaluationWorkerInput({ ...base, enginePort: 4096 })).toThrow();
    expect(() => assertEvaluationWorkerInput(base)).not.toThrow();
  });

  it('requires an actual observable effect for every proposal kind', () => {
    for (const kind of ORG_EVALUATION_PROPOSAL_KINDS) {
      expect(requiredEffectEvidence(kind).length, kind).toBeGreaterThan(0);
      expect(verifyObservedEffects(kind, [])).toEqual({ verified: false, missing: requiredEffectEvidence(kind) });
    }
  });

  it('never treats a written permission map or installed tool metadata as behavioral proof', () => {
    expect(verifyObservedEffects('refine-scope', ['profile-projected'])).toMatchObject({ verified: false });
    expect(verifyObservedEffects('tool-install', ['tool-installed'])).toMatchObject({ verified: false });
    expect(verifyObservedEffects('refine-config', ['profile-projected', 'agent-output'])).toEqual({ verified: true, missing: [] });
  });

  it('copies only an approved read-only fixture into a private worker root', () => {
    const root = mkdtempSync('/private/tmp/rhythm-eval-test-');
    const fixtureRoot = join(root, 'fixture');
    const workerRoot = join(root, 'worker');
    const fixtureConfig = join(fixtureRoot, 'opencode-config');
    const fixtureDb = join(fixtureRoot, 'rhythm.db');
    try {
      mkdirSync(fixtureConfig, { recursive: true });
      writeFileSync(fixtureDb, 'fixture-database');
      writeFileSync(join(fixtureConfig, 'opencode.json'), JSON.stringify({ mcp: { safe: { type: 'local', command: ['true'] } } }));
      chmodSync(fixtureDb, 0o400);
      chmodSync(join(fixtureConfig, 'opencode.json'), 0o400);
      const prepared = prepareEvaluationWorkerFilesystem({ ...base, fixtureRoot, fixtureDb, fixtureConfig, workerRoot });
      expect(readFileSync(prepared.dbPath, 'utf8')).toBe('fixture-database');
      expect(existsSync(join(prepared.homePath, '.config', 'opencode', 'opencode.json'))).toBe(true);
      expect(prepared.dbPath).toContain(workerRoot);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('refuses a symlink to live files inside an otherwise approved fixture', () => {
    const root = mkdtempSync('/private/tmp/rhythm-eval-test-');
    const fixtureRoot = join(root, 'fixture');
    const workerRoot = join(root, 'worker');
    const fixtureConfig = join(fixtureRoot, 'opencode-config');
    const fixtureDb = join(fixtureRoot, 'rhythm.db');
    try {
      mkdirSync(fixtureConfig, { recursive: true });
      writeFileSync(fixtureDb, 'fixture-database');
      symlinkSync('/Users/user/.config/opencode/opencode.json', join(fixtureConfig, 'opencode.json'));
      chmodSync(fixtureDb, 0o400);
      expect(() => prepareEvaluationWorkerFilesystem({ ...base, fixtureRoot, fixtureDb, fixtureConfig, workerRoot })).toThrow();
      expect(existsSync(workerRoot)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes only worker paths and a local relay to the child engine', () => {
    const environment = buildEvaluationWorkerEnvironment(base, {
      homePath: '/private/tmp/evaluation-worker-1/home',
      dbPath: '/private/tmp/evaluation-worker-1/rhythm.db',
      configPath: '/private/tmp/evaluation-worker-1/home/.config/opencode',
      workspacePath: '/private/tmp/evaluation-worker-1/workspace',
    }, '/private/tmp/evaluation-engine/opencode', 'ephemeral-relay-token');
    expect(environment.HOME).toBe('/private/tmp/evaluation-worker-1/home');
    expect(environment.DB_CLIENT).toBe('sqlite');
    expect(environment.DB_PATH).toBe('/private/tmp/evaluation-worker-1/rhythm.db');
    expect(environment.RHYTHM_OPENCODE_ENGINE_PORT).toBe('4797');
    expect(environment.PROD_API_URL).toBeUndefined();
    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(environment.RHYTHM_EVALUATION_PROVIDER_RELAY_URL).toBe('http://127.0.0.1:4796/agent-org-proposals/evaluations/provider/lease_1/v1');
  });

  it('denies cross-process signals and local IPC in the worker policy', () => {
    const root = mkdtempSync('/private/tmp/rhythm-eval-policy-');
    try {
      const policy = evaluationSandboxPolicy({ workerRoot: root,
        programRoots: ['/usr/local/bin/node'], enginePort: 49011, relayPort: 49012 });
      expect(policy).toContain('(deny process-info*)');
      expect(policy).toContain('(allow process-info* (target self))');
      expect(policy).toContain('(allow process-info* (target children))');
      expect(policy).toContain('(deny signal)');
      expect(policy).toContain('(deny mach-lookup)');
      expect(policy).toContain('(deny appleevent-send)');
      expect(policy).toContain('(allow signal (target self))');
      expect(policy).toContain('(allow signal (target children))');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('binds generated creation rows by logical identity while retaining behavioral fields', () => {
    const home = mkdtempSync('/private/tmp/rhythm-eval-manifest-');
    const left = new Database(':memory:');
    const right = new Database(':memory:');
    const model = { providerID: 'anthropic' as const, modelID: 'claude-sonnet-4-5' };
    try {
      for (const db of [left, right]) db.exec(`
        CREATE TABLE agent_cookbook (id TEXT, title TEXT, steps_json TEXT, bound_config_id TEXT);
        CREATE TABLE agent_webhook_endpoints (id TEXT, name TEXT, secret TEXT, target_prompt TEXT);
      `);
      left.prepare('INSERT INTO agent_cookbook VALUES (?,?,?,?)')
        .run('11111111-1111-4111-8111-111111111111', 'Launch', '["step"]', 'agent-1');
      right.prepare('INSERT INTO agent_cookbook VALUES (?,?,?,?)')
        .run('22222222-2222-4222-8222-222222222222', 'Launch', '["step"]', 'agent-1');
      const recipeTarget = { kind: 'create-recipe' as const, targetRef: 'recipe:Launch' };
      expect(readEvaluationEffectiveManifest(left, home, model, recipeTarget).manifestHash)
        .toBe(readEvaluationEffectiveManifest(right, home, model, recipeTarget).manifestHash);
      right.prepare('UPDATE agent_cookbook SET steps_json=?').run('["different"]');
      expect(readEvaluationEffectiveManifest(left, home, model, recipeTarget).manifestHash)
        .not.toBe(readEvaluationEffectiveManifest(right, home, model, recipeTarget).manifestHash);
      left.prepare('DELETE FROM agent_cookbook').run();
      right.prepare('DELETE FROM agent_cookbook').run();
      left.prepare('INSERT INTO agent_webhook_endpoints VALUES (?,?,?,?)')
        .run('33333333-3333-4333-8333-333333333333', 'Launch hook', 'a'.repeat(32), 'Run task');
      right.prepare('INSERT INTO agent_webhook_endpoints VALUES (?,?,?,?)')
        .run('44444444-4444-4444-8444-444444444444', 'Launch hook', 'b'.repeat(32), 'Run task');
      const webhookTarget = { kind: 'webhook-wiring' as const, targetRef: 'webhook:Launch hook' };
      expect(readEvaluationEffectiveManifest(left, home, model, webhookTarget).manifestHash)
        .toBe(readEvaluationEffectiveManifest(right, home, model, webhookTarget).manifestHash);
      right.prepare('UPDATE agent_webhook_endpoints SET target_prompt=?').run('Different task');
      expect(readEvaluationEffectiveManifest(left, home, model, webhookTarget).manifestHash)
        .not.toBe(readEvaluationEffectiveManifest(right, home, model, webhookTarget).manifestHash);
    } finally {
      left.close(); right.close(); rmSync(home, { recursive: true, force: true });
    }
  });
});
