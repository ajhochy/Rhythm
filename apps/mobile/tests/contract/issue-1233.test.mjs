import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const selectorSource = await readFile(
  new URL('../../providers/opencode-provider-selectors.ts', import.meta.url),
  'utf8',
);
assert.match(selectorSource, /export function selectModelPickerGroups/);
const selectorImplementation = selectorSource
  .slice(selectorSource.indexOf('export function selectModelPickerGroups'))
  .replace('export function selectModelPickerGroups', 'function selectModelPickerGroups')
  .replace(/: ModelPickerSelectionInput(?=\))/, '')
  .replace(/export type[\s\S]*$/m, '');
const selectorModule = Function(
  `${selectorImplementation}; return { selectModelPickerGroups };`,
)();

const models = [
  {
    id: 'openai/gpt-new',
    label: 'GPT New',
    providerID: 'openai',
    providerLabel: 'OpenAI',
    modelID: 'gpt-new',
    recommended: true,
  },
  {
    id: 'openai/gpt-old',
    label: 'GPT Old',
    providerID: 'openai',
    providerLabel: 'OpenAI',
    modelID: 'gpt-old',
  },
  {
    id: 'anthropic/claude',
    label: 'Claude',
    providerID: 'anthropic',
    providerLabel: 'Anthropic',
    modelID: 'claude',
    recommended: true,
  },
];

test('issue-1233-c1: disconnected providers never contribute picker models', () => {
  // Regression caught: enabled-model persistence leaks a disconnected
  // provider back into the picker. The group/model count assertion fails.
  const groups = selectorModule.selectModelPickerGroups({
    availableModels: models,
    availableProviders: [
      { id: 'openai', label: 'OpenAI', configured: true, connected: true },
      { id: 'anthropic', label: 'Anthropic', configured: true, connected: false },
    ],
    enabledModelIds: models.map((model) => model.id),
    recentModelIds: [],
  });
  assert.deepEqual(groups.map((group) => group.providerId), ['openai']);
  assert.deepEqual(groups[0].models.map((model) => model.id), [
    'openai/gpt-new',
    'openai/gpt-old',
  ]);
});

test('issue-1233-c2: models are grouped by connected provider account', () => {
  // Regression caught: the picker flattens duplicate model labels and loses
  // their provider/account ownership. The group labels assertion fails.
  const groups = selectorModule.selectModelPickerGroups({
    availableModels: models,
    availableProviders: [
      { id: 'openai', label: 'OpenAI', configured: true, connected: true, accountLabel: 'Work OpenAI' },
      { id: 'anthropic', label: 'Anthropic', configured: true, connected: true, accountLabel: 'Team Claude' },
    ],
    enabledModelIds: models.map((model) => model.id),
    recentModelIds: [],
  });
  assert.deepEqual(
    groups.map(({ providerLabel, accountLabel }) => ({ providerLabel, accountLabel })),
    [
      { providerLabel: 'Anthropic', accountLabel: 'Team Claude' },
      { providerLabel: 'OpenAI', accountLabel: 'Work OpenAI' },
    ],
  );
});

test('issue-1233-c3: current/recent models rank ahead of provider recommendations', () => {
  // Regression caught: alphabetical/default ordering buries the last-used
  // model. The first model assertion fails.
  const [group] = selectorModule.selectModelPickerGroups({
    availableModels: models,
    availableProviders: [
      { id: 'openai', label: 'OpenAI', configured: true, connected: true },
    ],
    enabledModelIds: ['openai/gpt-new', 'openai/gpt-old'],
    selectedModelId: 'openai/gpt-old',
    recentModelIds: ['openai/gpt-old'],
  });
  assert.equal(group.models[0].id, 'openai/gpt-old');
  assert.equal(group.models[0].rankLabel, 'Recent');
  assert.equal(group.models[1].rankLabel, 'Recommended');
});

test('issue-1233-c4: picker options expose provider and account context', async () => {
  // Regression caught: rows show only a model name, so identical names are
  // ambiguous. Session-scoped model selection now lives in the three-dot
  // configuration sheet, and the source-level UI contract follows it there.
  const [sheetSource, composerSource] = await Promise.all([
    readFile(
      new URL(
        '../../components/chat/session-configuration-sheet.tsx',
        import.meta.url,
      ),
      'utf8',
    ),
    readFile(
      new URL('../../components/chat/chat-composer.tsx', import.meta.url),
      'utf8',
    ),
  ]);
  assert.match(sheetSource, /selectModelPickerGroups/);
  assert.match(sheetSource, /accountLabel/);
  assert.match(sheetSource, /providerLabel/);
  assert.match(sheetSource, /<List\.Section/);
  assert.doesNotMatch(composerSource, /modelPickerGroups|onModelChange/);
});
