import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(
  new URL('../../providers/opencode-provider-utils.ts', import.meta.url),
  'utf8',
);
const output = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const providerUtils = await import(
  `data:text/javascript,${encodeURIComponent(output)}`
);

test('issue-1-c4: existing session hydration overrides global chat preferences', () => {
  // Regression caught: opening an existing Coding Workflow session keeps the
  // last global AI Researcher profile/model/reasoning/approval selection.
  assert.equal(typeof providerUtils.hydratePreferencesFromSession, 'function');
  const hydrated = providerUtils.hydratePreferencesFromSession(
    {
      profileId: 'profile-coding-workflow',
      opencodeAgentId: 'build',
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      thinkingBudget: 8192,
      permissionMode: 'plan',
      profileAvailability: 'available',
    },
    {
      mode: 'research',
      providerId: 'openai',
      modelId: 'openai/gpt-5.6-terra',
      reasoning: 'low',
      autoApprove: true,
    },
  );
  assert.deepEqual(
    {
      profileId: hydrated.profileId,
      mode: hydrated.mode,
      providerId: hydrated.providerId,
      modelId: hydrated.modelId,
      reasoning: hydrated.reasoning,
      autoApprove: hydrated.autoApprove,
    },
    {
      profileId: 'profile-coding-workflow',
      mode: 'build',
      providerId: 'anthropic',
      modelId: 'anthropic/claude-sonnet-4-5',
      reasoning: 'high',
      autoApprove: false,
    },
  );
});

test('issue-1-c7: unknown legacy profile mapping is unavailable rather than Secretary', () => {
  // Regression caught: an unknown engine agent falls through to the first
  // catalog row, historically Secretary, and is displayed/sent as that role.
  assert.equal(typeof providerUtils.resolveSessionProfileDisplay, 'function');
  const display = providerUtils.resolveSessionProfileDisplay(
    {
      profileId: null,
      opencodeAgentId: 'legacy-unknown-agent',
      profileAvailability: 'unavailable',
    },
    [{
      profileId: 'secretary',
      opencodeAgentId: 'secretary',
      name: 'Secretary',
    }],
  );
  assert.deepEqual(display, {
    profileId: null,
    name: 'Unassigned',
    availability: 'unavailable',
  });
});
