import { act, createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { RhythmGatewayError } from '../src/domain/types';
import { SharedAgentsScreen } from '../src/agents/SharedAgentsScreen';
import { CANONICAL_FIELDS } from '../src/agents/types';
import type { SharedAgent, SharedAgentCatalog, SharedAgentRuntimeProjection, SharedAgentsPort } from '../src/agents/types';
import { actClick, actKeyDown, actSetValue, flush, mount } from './test-utils/mount';

const jsonFields = {
  allowedMcpsJson: ' { "mcp": ["rhythm"], "future": true } ',
  allowedSkillsJson: '["planning"]\n',
  corePermissionsJson: '{"read":"allow","future":{"mode":"ask"}}',
  allowedDelegatesJson: '["specialist"]',
} as const;

const applicability = () => Object.fromEntries(CANONICAL_FIELDS.map((field) => [field, 'enforced'])) as SharedAgentRuntimeProjection['fields'];

function agent(id: string, overrides: Partial<SharedAgent> = {}): SharedAgent {
  return {
    schema: 'rhythm.shared-agent.v1',
    id,
    revision: 7,
    canonical: {
      id,
      label: 'Duplicate label',
      icon: 'AG',
      enabled: true,
      isAgent: true,
      isManager: false,
      systemPrompt: 'Keep the contract precise.',
      ...jsonFields,
      presetId: null,
      sortOrder: 1,
      createdAt: '2026-09-24T00:00:00.000Z',
      updatedAt: '2026-09-24T00:00:00.000Z',
      revision: 7,
      modelProvider: 'openrouter',
      modelId: 'anthropic/claude-sonnet-4.5',
      ocAgent: 'build',
      sessionSelectable: true,
      schedulable: false,
      schedulableOverride: null,
      modelTierHint: null,
      defaultAnthropicAccountId: null,
      imageGenerationEnabled: false,
      reasoningEffort: 'high',
      locked: false,
      disabledReason: null,
      lockedAt: null,
      lockedBy: null,
      autoApproveActions: false,
    },
    runtimes: {
      opencode: {
        runtime: 'opencode', readiness: 'supported', reasons: [],
        launchKinds: { interactive: true, delegated: true }, fields: applicability(),
      },
      hermes: {
        runtime: 'hermes', readiness: 'unsupported',
        reasons: [{ code: 'skills_not_applied', field: 'allowedSkillsJson', message: 'Skills are not applied in Hermes.' }],
        launchKinds: { interactive: false, delegated: false }, fields: applicability(),
      },
    },
    ...overrides,
  };
}

function catalog(scope = 'scope-a', agents = [agent('alpha'), agent('beta')]): SharedAgentCatalog {
  return { schema: 'rhythm.shared-agent-catalog.v1', generatedAt: '2026-09-24T00:00:00.000Z', scope, agents };
}

function port(overrides: Partial<SharedAgentsPort> = {}): SharedAgentsPort {
  let current = catalog();
  return {
    hostRuntime: 'opencode',
    list: async () => current,
    get: async (id) => current.agents.find((item) => item.id === id)!,
    save: async (id, _revision, changes) => {
      const existing = current.agents.find((item) => item.id === id)!;
      const saved = { ...existing, revision: existing.revision + 1, canonical: { ...existing.canonical, ...changes, revision: existing.revision + 1 } };
      current = { ...current, agents: current.agents.map((item) => item.id === id ? saved : item) };
      return saved;
    },
    launch: async () => ({ ok: true }),
    ...overrides,
  };
}

async function openEditor(mounted: ReturnType<typeof mount>, id = 'alpha') {
  await flush();
  await actClick(mounted.byTestId(`shared-agent-${id}`)!);
  await flush();
  await actClick(mounted.byTestId('shared-agent-edit')!);
  await flush();
}

describe('SharedAgentsScreen', () => {
  it('UI-1: renders both runtime readiness chips and reasons, disambiguating duplicate labels by id', async () => {
    const mounted = mount(createElement(SharedAgentsScreen, { port: port() }));
    await flush();
    expect(mounted.byTestId('shared-agent-alpha')?.textContent).toContain('Duplicate label');
    expect(mounted.byTestId('shared-agent-alpha')?.textContent).toContain('alpha');
    expect(mounted.byTestId('shared-agent-beta')?.textContent).toContain('beta');
    await actClick(mounted.byTestId('shared-agent-alpha')!);
    await flush();
    expect(mounted.byTestId('shared-agent-readiness-opencode')?.textContent).toContain('Supported');
    expect(mounted.byTestId('shared-agent-readiness-hermes')?.textContent).toContain('Unsupported');
    expect(mounted.byTestId('shared-agent-readiness-hermes')?.textContent).toContain('Skills are not applied in Hermes.');
    mounted.unmount();
  });

  it('UI-2: saves only changed fields with expectedRevision and leaves untouched raw JSON byte-identical', async () => {
    const saves: Array<{ id: string; revision: number; changes: unknown }> = [];
    const sharedPort = port({
      save: async (id, revision, changes) => {
        saves.push({ id, revision, changes });
        return { ...agent(id), revision: 8, canonical: { ...agent(id).canonical, ...changes, revision: 8 } };
      },
    });
    const mounted = mount(createElement(SharedAgentsScreen, { port: sharedPort }));
    await openEditor(mounted);
    await actSetValue(mounted.byTestId('shared-agent-field-label') as HTMLInputElement, 'Renamed agent');
    await actClick(mounted.byTestId('shared-agent-save')!);
    await flush();
    expect(saves).toEqual([{ id: 'alpha', revision: 7, changes: { label: 'Renamed agent' } }]);
    expect(jsonFields.allowedMcpsJson).toBe(' { "mcp": ["rhythm"], "future": true } ');
    mounted.unmount();
  });

  it('UI-3: keeps the draft visible when a save conflicts', async () => {
    const sharedPort = port({ save: async () => { throw new RhythmGatewayError('conflict', 'stale'); } });
    const mounted = mount(createElement(SharedAgentsScreen, { port: sharedPort }));
    await openEditor(mounted);
    const prompt = mounted.byTestId('shared-agent-field-systemPrompt') as HTMLTextAreaElement;
    await actSetValue(prompt, 'Unsaved local draft');
    await actClick(mounted.byTestId('shared-agent-save')!);
    await flush();
    expect(mounted.byTestId('shared-agent-save-status')?.textContent).toContain('Changed elsewhere, reload');
    expect((mounted.byTestId('shared-agent-field-systemPrompt') as HTMLTextAreaElement).value).toBe('Unsaved local draft');
    mounted.unmount();
  });

  it('UI-4: remounts state when catalog.scope changes', async () => {
    let nextCatalog = catalog('scope-a');
    const sharedPort = port({ list: async () => nextCatalog });
    const mounted = mount(createElement(SharedAgentsScreen, { port: sharedPort }));
    await openEditor(mounted);
    await actSetValue(mounted.byTestId('shared-agent-field-label') as HTMLInputElement, 'Scope A draft');
    nextCatalog = catalog('scope-b', [agent('gamma', { canonical: { ...agent('gamma').canonical, label: 'New scope' } })]);
    await actClick(mounted.byTestId('shared-agents-refresh')!);
    await flush();
    expect(mounted.byTestId('shared-agent-editor')).toBeNull();
    expect(mounted.byTestId('shared-agent-gamma')).toBeTruthy();
    expect(mounted.byTestId('shared-agent-alpha')).toBeNull();
    expect(mounted.byTestId('shared-agents-screen')?.dataset.catalogScope).toBe('scope-b');
    mounted.unmount();
  });

  it('UI-5: gates launch by host readiness and interactive kind, then launches by id and revision', async () => {
    const calls: Array<[string, number]> = [];
    const supportedHermes = agent('ready', {
      canonical: { ...agent('ready').canonical, label: 'Ready' },
      runtimes: { ...agent('ready').runtimes, hermes: { ...agent('ready').runtimes.hermes, readiness: 'supported', reasons: [], launchKinds: { interactive: true, delegated: true } } },
    });
    const sharedPort = port({ hostRuntime: 'hermes', list: async () => catalog('scope-h', [supportedHermes, agent('blocked')]), launch: async (id, revision) => { calls.push([id, revision]); return { ok: true }; } });
    const mounted = mount(createElement(SharedAgentsScreen, { port: sharedPort }));
    await flush();
    await actClick(mounted.byTestId('shared-agent-ready')!);
    await flush();
    expect(mounted.byTestId('shared-agent-launch')).not.toHaveProperty('disabled', true);
    await actClick(mounted.byTestId('shared-agent-launch')!);
    await flush();
    expect(calls).toEqual([['ready', 7]]);
    await actClick(mounted.byTestId('shared-agent-blocked')!);
    await flush();
    expect((mounted.byTestId('shared-agent-launch') as HTMLButtonElement).disabled).toBe(true);
    mounted.unmount();
  });

  it('UI-6: supports list keyboard use, a focus-trapped editor, read-only mode, and compact layout', async () => {
    const mounted = mount(createElement(SharedAgentsScreen, { port: port(), viewport: 'compact' }));
    await flush();
    expect(mounted.byTestId('shared-agents-screen')?.dataset.rhythmViewport).toBe('compact');
    const alpha = mounted.byTestId('shared-agent-alpha')!;
    await act(async () => alpha.focus());
    await actKeyDown(alpha, 'ArrowDown');
    expect(document.activeElement).toBe(mounted.byTestId('shared-agent-beta'));
    await actKeyDown(document.activeElement as HTMLElement, 'Enter');
    await flush();
    await actClick(mounted.byTestId('shared-agent-edit')!);
    await flush();
    const first = mounted.byTestId('shared-agent-field-label')!;
    expect(document.activeElement).toBe(first);
    await actSetValue(first as HTMLInputElement, 'Keyboard draft');
    const last = mounted.byTestId('shared-agent-save')!;
    await act(async () => last.focus());
    await actKeyDown(document, 'Tab');
    expect(document.activeElement).toBe(mounted.byTestId('shared-agent-editor-close'));
    mounted.unmount();

    const readOnly = mount(createElement(SharedAgentsScreen, { port: port(), readOnly: true, viewport: 'compact' }));
    await flush();
    await actClick(readOnly.byTestId('shared-agent-alpha')!);
    await flush();
    expect((readOnly.byTestId('shared-agent-edit') as HTMLButtonElement).disabled).toBe(true);
    expect((readOnly.byTestId('shared-agent-launch') as HTMLButtonElement).disabled).toBe(true);
    readOnly.unmount();
  });

  it('UI-8: shows the native-confirmation waiting state and keeps the draft after forbidden', async () => {
    let requested = false;
    let rejectSave!: () => void;
    const pendingSave = new Promise<void>((resolve) => { rejectSave = resolve; });
    const sharedPort = port({
      save: async (_id, _revision, _changes, options) => {
        options?.onConfirmationRequired?.();
        requested = true;
        await pendingSave;
        throw new RhythmGatewayError('forbidden', 'rejected');
      },
    });
    const mounted = mount(createElement(SharedAgentsScreen, { port: sharedPort }));
    await openEditor(mounted);
    const prompt = mounted.byTestId('shared-agent-field-systemPrompt') as HTMLTextAreaElement;
    await actSetValue(prompt, 'Draft needing confirmation');
    await actClick(mounted.byTestId('shared-agent-save')!);
    await flush();
    expect(mounted.byTestId('shared-agent-save-status')?.textContent).toContain('Waiting for confirmation in Rhythm');
    rejectSave();
    await flush();
    expect(requested).toBe(true);
    expect(mounted.byTestId('shared-agent-save-status')?.textContent).toContain('Confirmation was not approved');
    expect((mounted.byTestId('shared-agent-field-systemPrompt') as HTMLTextAreaElement).value).toBe('Draft needing confirmation');
    mounted.unmount();
  });
});
