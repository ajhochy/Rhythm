/**
 * CONTRACT TEST for #1485 slice S1b — strict v1 recipe-workflow contract and
 * validator (apps/api_server/src/contracts/recipe_workflow_contract.ts).
 *
 * One RED test per rule, each asserting a stable {path, code, message}
 * diagnostic shape. See docs/ai/current-plan-recipes-1485.md "Minimal schema
 * and one-level fan-out" for the design this fixture and validator encode.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateRecipeWorkflowV1 } from '../../contracts/recipe_workflow_contract';

const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'recipe_workflow', 'target_workflow_v1.json');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadFixture(): any {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
}

/** Deep clone via JSON round-trip — every value here is JSON-safe. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function stageById(def: any, id: string): any {
  for (const stage of def.stages) {
    if (stage.id === id) return stage;
    if (stage.kind === 'fanOut') {
      for (const child of stage.stages) {
        if (child.id === id) return child;
      }
    }
  }
  throw new Error(`fixture stage "${id}" not found`);
}

describe('#1485 S1b — target workflow fixture validates cleanly', () => {
  it('recipe_workflow_s1b:0 — the 11-stage target workflow has zero diagnostics', () => {
    const result = validateRecipeWorkflowV1(loadFixture());
    expect(result.diagnostics).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe('#1485 S1b — one RED test per validation rule', () => {
  it('recipe_workflow_s1b:unknown_field — rejects an undeclared field on a stage', () => {
    const def = loadFixture();
    (stageById(def, 'planning') as Record<string, unknown>).bogusField = 'nope';
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ path: '$.stages[0].bogusField', code: 'unknown_field' }),
    );
  });

  it('recipe_workflow_s1b:duplicate_stage_id — rejects two stages sharing an id', () => {
    const def = loadFixture();
    stageById(def, 'coder_repair').id = 'coder';
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'duplicate_stage_id' }));
  });

  it('recipe_workflow_s1b:unreachable_stage — rejects a declared stage nothing transitions into', () => {
    const def = loadFixture();
    def.stages.push({
      id: 'orphan_stage',
      kind: 'agent',
      profileId: 'coding-agent',
      terminal: true,
      inputs: {},
      output: { fields: { status: 'string' } },
    });
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unreachable_stage', message: expect.stringContaining('orphan_stage') }),
    );
  });

  it('recipe_workflow_s1b:missing_target — a gate missing branches.fail is invalid', () => {
    const def = loadFixture();
    delete stageById(def, 'review_verdict_gate').branches.fail;
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ path: expect.stringContaining('branches.fail'), code: 'missing_target' }),
    );
  });

  it('recipe_workflow_s1b:gate_without_on_invalid — a gate with no onInvalid field at all is invalid', () => {
    const def = loadFixture();
    delete stageById(def, 'review_verdict_gate').onInvalid;
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ path: expect.stringContaining('onInvalid'), code: 'missing_target' }),
    );
  });

  it('recipe_workflow_s1b:binding_type_mismatch — a binding whose declared type disagrees with the producer field type is invalid', () => {
    const def = loadFixture();
    stageById(def, 'adjust_plan').inputs.plan.type = 'number';
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'binding_type_mismatch' }));
  });

  it('recipe_workflow_s1b:unavailable_producer — a stageOutput binding to an undeclared stage is invalid', () => {
    const def = loadFixture();
    stageById(def, 'coder').inputs.contractText.stageId = 'does_not_exist';
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'unavailable_producer' }));
  });

  it('recipe_workflow_s1b:nested_fan_out — a fanOut inside a fanOut is invalid', () => {
    const def = loadFixture();
    const fanOut = def.stages.find((s: any) => s.kind === 'fanOut');
    fanOut.stages.push({
      id: 'nested_fan_out_stage',
      kind: 'fanOut',
      itemsFrom: { stageId: 'issue_writer' },
      itemKey: 'nested',
      entryStageId: 'coder',
      join: 'all',
      next: 'coder',
      stages: [],
    });
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'nested_fan_out' }));
  });

  it('recipe_workflow_s1b:empty_item_key — a fanOut with an empty itemKey is invalid', () => {
    const def = loadFixture();
    def.stages.find((s: any) => s.kind === 'fanOut').itemKey = '';
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'empty_item_key' }));
  });

  it('recipe_workflow_s1b:duplicate_item_key — two fanOut stages sharing an itemKey are invalid', () => {
    // Minimal, purpose-built definition (not the big fixture) to isolate this
    // single rule from unrelated reachability/binding diagnostics.
    const def = {
      schemaVersion: 1,
      entryStageId: 'producer',
      budgets: { maxCostUsd: 1, maxTokens: 1000, maxWallTimeMs: 1000, maxStageExecutions: 10 },
      stages: [
        {
          id: 'producer', kind: 'agent', profileId: 'issue-writer', inputs: {},
          output: { fields: {}, items: { keyField: 'id', fields: { id: 'string' } } },
          next: 'fan_a',
        },
        {
          id: 'fan_a', kind: 'fanOut', itemsFrom: { stageId: 'producer' }, itemKey: 'dup',
          entryStageId: 'child_a', join: 'all', next: 'fan_b',
          stages: [{ id: 'child_a', kind: 'agent', profileId: 'coding-agent', terminal: true, inputs: {}, output: { fields: {} } }],
        },
        {
          id: 'fan_b', kind: 'fanOut', itemsFrom: { stageId: 'producer' }, itemKey: 'dup',
          entryStageId: 'child_b', join: 'all', next: 'done',
          stages: [{ id: 'child_b', kind: 'agent', profileId: 'coding-agent', terminal: true, inputs: {}, output: { fields: {} } }],
        },
        { id: 'done', kind: 'agent', profileId: 'coding-agent', terminal: true, inputs: {}, output: { fields: {} } },
      ],
    };
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'duplicate_item_key' }));
  });

  it('recipe_workflow_s1b:loop_missing_caps — a loop missing one of its four caps is invalid', () => {
    const def = loadFixture();
    delete stageById(def, 'review_verdict_gate').loop.maxTokens;
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ path: expect.stringContaining('maxTokens'), code: 'loop_missing_caps' }),
    );
  });

  it('recipe_workflow_s1b:invalid_provider_pair — differentProviderFromStageId without an explicit provider on both sides is invalid', () => {
    const def = loadFixture();
    delete stageById(def, 'coder').provider;
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid_provider_pair' }));
  });

  it('recipe_workflow_s1b:invalid_provider_pair — differentProviderFromStageId with the same provider on both sides is invalid', () => {
    const def = loadFixture();
    stageById(def, 'review').provider.providerId = stageById(def, 'coder').provider.providerId;
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'invalid_provider_pair' }));
  });

  it('recipe_workflow_s1b:blocked_verdict_outcome — a "blocked" branch key is always invalid', () => {
    const def = loadFixture();
    stageById(def, 'review_verdict_gate').branches.blocked = 'issue_blocked';
    const result = validateRecipeWorkflowV1(def);
    expect(result.valid).toBe(false);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'blocked_verdict_outcome' }));
  });
});

describe('#1485 S1b — no new validation dependency', () => {
  it('recipe_workflow_s1b:no_new_dependency — package.json is unchanged by this slice', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const validationLibraries = ['zod', 'ajv', 'yup', 'joi', 'superstruct', 'io-ts'];
    for (const lib of validationLibraries) {
      expect(allDeps[lib], `unexpected new validation dependency "${lib}"`).toBeUndefined();
    }
  });
});
