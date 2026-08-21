import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RhythmsScreen } from '../src/screens/RhythmsScreen';
import { RhythmGatewayError } from '../src/domain/types';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway, fixtureRhythmsGateway, failingRhythmsGateway, emptyRhythmsGateway } from './test-utils/fixtures';
import { mount, flush, actClick, actSetValue, actKeyDown } from './test-utils/mount';

function buildHost(overrides: Record<string, unknown> = {}) {
  return { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { id: 'workspace-user-1', displayName: 'AJ Hochhalter', initials: 'AH', collaborationCapability: 'write' as const, capabilities: ['rhythms.write'] as const }, ...overrides };
}

function mountRhythms(gatewayOverrides: Partial<ReturnType<typeof fixtureDomainGateway>> = {}, hostOverrides: Record<string, unknown> = {}) {
  const gateway = { ...fixtureDomainGateway(), ...gatewayOverrides };
  return mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(hostOverrides), children: createElement(RhythmsScreen) }));
}

describe('RhythmsScreen', () => {
  it('ignores a deferred rhythms load after the rhythms gateway is replaced or the screen unmounts', async () => {
    const old = fixtureRhythmsGateway();
    let releaseOld!: (value: Awaited<ReturnType<typeof old.list>>) => void;
    const stale = { ...old, list: () => new Promise<Awaited<ReturnType<typeof old.list>>>((resolve) => { releaseOld = resolve; }) };
    const fresh = fixtureRhythmsGateway();
    const gateway = { ...fixtureDomainGateway(), rhythms: stale };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(), children: createElement(RhythmsScreen) }));
    mounted.rerender(createElement(RhythmWorkspaceProvider, { gateway: { ...gateway, rhythms: fresh }, host: buildHost(), children: createElement(RhythmsScreen) }));
    await flush();
    expect(mounted.container.textContent).toContain('Weekend service cadence');
    mounted.unmount();
    releaseOld([]);
    await flush();
  });
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({ Screen: RhythmsScreen, screenName: 'Rhythms', testId: 'rhythm-rhythms-screen', gateway: fixtureDomainGateway() });
  });

  it('loads real rhythm rules with cadence/progress richness from the injected gateway', async () => {
    const mounted = mountRhythms();
    await flush();
    expect(mounted.byTestId('rhythm-card-rhythm-weekend-service')?.textContent).toContain('Weekend service cadence');
    expect(mounted.byTestId('rhythm-pattern-rhythm-weekend-service')?.textContent).toContain('Every Sunday');
    expect(mounted.byTestId('rhythm-pattern-rhythm-monthly-care')?.textContent).toContain('Monthly on the 15th');
    expect(mounted.byTestId('rhythm-status-rhythm-weekend-service')?.textContent).toContain('Enabled');
    expect(mounted.byTestId('rhythm-status-rhythm-monthly-care')?.textContent).toContain('Paused');
    expect(mounted.byTestId('rhythms-visible-count')?.textContent).toContain('2');
    mounted.unmount();
  });

  it('shows the loading state panel before the gateway resolves, then ready content', async () => {
    const mounted = mountRhythms();
    expect(mounted.byTestId('page-state-loading')).toBeTruthy();
    await flush();
    expect(mounted.byTestId('page-state-loading')).toBeNull();
    expect(mounted.byTestId('rhythms-list')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the empty state when the gateway returns no rhythms', async () => {
    const mounted = mountRhythms({ rhythms: emptyRhythmsGateway() });
    await flush();
    expect(mounted.byTestId('page-state-empty')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the forbidden state when the gateway rejects with a forbidden error', async () => {
    const mounted = mountRhythms({ rhythms: failingRhythmsGateway('forbidden') });
    await flush();
    expect(mounted.byTestId('page-state-forbidden')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the unavailable state when the gateway rejects with not_found/unavailable', async () => {
    const mounted = mountRhythms({ rhythms: failingRhythmsGateway('unavailable') });
    await flush();
    expect(mounted.byTestId('page-state-unavailable')).toBeTruthy();
    mounted.unmount();
  });

  it('shows a retryable server-error state', async () => {
    const mounted = mountRhythms({ rhythms: failingRhythmsGateway('server_error') });
    await flush();
    expect(mounted.byTestId('page-state-server-error')).toBeTruthy();
    mounted.unmount();
  });

  it('opens the inspector for a rhythm and shows its owner, generated/completed/remaining counts, and waiting-on', async () => {
    const mounted = mountRhythms();
    await flush();
    await actClick(mounted.byTestId('rhythm-inspect-rhythm-weekend-service')!);
    await flush();
    expect(mounted.byTestId('rhythm-detail')).toBeTruthy();
    expect(mounted.byTestId('rhythm-owner')?.textContent).toBe('AJ Hochhalter');
    expect(mounted.byTestId('rhythm-generated-count')?.textContent).toContain('4');
    expect(mounted.byTestId('rhythm-completed-count')?.textContent).toContain('3');
    expect(mounted.byTestId('rhythm-remaining-count')?.textContent).toContain('1');
    expect(mounted.byTestId('rhythm-waiting-on')?.textContent).toContain('Morgan Lee');
    mounted.unmount();
  });

  it('closes the inspector', async () => {
    const mounted = mountRhythms();
    await flush();
    await actClick(mounted.byTestId('rhythm-inspect-rhythm-weekend-service')!);
    await flush();
    await actClick(mounted.byTestId('rhythm-detail-close')!);
    await flush();
    expect(mounted.byTestId('rhythm-detail')).toBeNull();
    mounted.unmount();
  });

  it('toggles a rhythm enabled/paused through the gateway', async () => {
    const rhythmsGateway = fixtureRhythmsGateway();
    const mounted = mountRhythms({ rhythms: rhythmsGateway });
    await flush();
    await actClick(mounted.byTestId('rhythm-enabled-rhythm-monthly-care')!);
    await flush();
    await actClick(mounted.byTestId('rhythm-operation-confirm')!);
    await flush();
    const persisted = await rhythmsGateway.list();
    expect(persisted.find((rule) => rule.id === 'rhythm-monthly-care')?.enabled).toBe(true);
    mounted.unmount();
  });

  it('requires one exact host confirmation before a permitted rule update and never writes when cancelled', async () => {
    const rhythmsGateway = fixtureRhythmsGateway();
    const update = vi.fn(rhythmsGateway.update);
    const confirmWorkspaceOperation = vi.fn(async () => false);
    const mounted = mountRhythms({ rhythms: { ...rhythmsGateway, update } }, { currentUser: { id: 'workspace-user-1', displayName: 'AJ', initials: 'AH', capabilities: ['rhythms.update-rule'] }, confirmWorkspaceOperation });
    await flush();
    await actClick(mounted.byTestId('rhythm-enabled-rhythm-monthly-care')!);
    await flush();
    expect(mounted.byTestId('rhythm-operation-confirmation')).toBeTruthy();
    await actClick(mounted.byTestId('rhythm-operation-confirm')!);
    await flush();
    expect(confirmWorkspaceOperation).toHaveBeenCalledOnce();
    expect(confirmWorkspaceOperation).toHaveBeenCalledWith(expect.objectContaining({ operation: 'rhythms.update-rule', entityId: 'rhythm-monthly-care', payload: { enabled: true }, generation: expect.any(String) }));
    expect(update).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it('keeps a deferred confirmation single-flight and invalidates it when the user rehomes the selection', async () => {
    const rhythmsGateway = fixtureRhythmsGateway();
    const update = vi.fn(rhythmsGateway.update);
    let releaseConfirmation!: (value: boolean) => void;
    const confirmWorkspaceOperation = vi.fn(() => new Promise<boolean>((resolve) => { releaseConfirmation = resolve; }));
    const mounted = mountRhythms({ rhythms: { ...rhythmsGateway, update } }, { confirmWorkspaceOperation });
    await flush();
    await actClick(mounted.byTestId('rhythm-enabled-rhythm-monthly-care')!);
    await flush();
    await actClick(mounted.byTestId('rhythm-operation-confirm')!);
    await actClick(mounted.byTestId('rhythm-operation-confirm')!);
    expect(confirmWorkspaceOperation).toHaveBeenCalledOnce();
    await actClick(mounted.byTestId('rhythm-inspect-rhythm-weekend-service')!);
    releaseConfirmation(true);
    await flush();
    expect(update).not.toHaveBeenCalled();
    mounted.unmount();
  });

  it('keeps conflict context for reload or a fresh retry without reporting success', async () => {
    const rhythmsGateway = fixtureRhythmsGateway();
    const update = vi.fn(async () => { throw new RhythmGatewayError('conflict', 'stale'); });
    const generations: string[] = [];
    const confirmWorkspaceOperation = vi.fn(async (confirmation: { generation: string }) => { generations.push(confirmation.generation); return true; });
    const mounted = mountRhythms({ rhythms: { ...rhythmsGateway, update } }, { confirmWorkspaceOperation });
    await flush();
    await actClick(mounted.byTestId('rhythm-enabled-rhythm-monthly-care')!);
    await flush();
    await actClick(mounted.byTestId('rhythm-operation-confirm')!);
    await flush();
    expect(mounted.byTestId('rhythm-operation-outcome')?.textContent).toContain('changed elsewhere');
    expect(mounted.byTestId('rhythm-operation-confirmation')).toBeTruthy();
    const firstGeneration = generations[0]!;
    await actClick(mounted.byTestId('rhythm-operation-retry')!);
    await flush();
    await actClick(mounted.byTestId('rhythm-operation-confirm')!);
    await flush();
    expect(generations[1]).not.toBe(firstGeneration);
    expect(update).toHaveBeenCalledTimes(2);
    mounted.unmount();
  });

  it('honors narrow Rhythm capabilities only for their named rule and step operations', async () => {
    const mounted = mountRhythms({}, { currentUser: { id: 'workspace-user-1', displayName: 'AJ', initials: 'AH', capabilities: ['rhythms.create-step'] } });
    await flush();
    expect((mounted.byTestId('rhythms-new-rule') as HTMLButtonElement).disabled).toBe(true);
    expect((mounted.byTestId('rhythm-enabled-rhythm-monthly-care') as HTMLInputElement).disabled).toBe(true);
    await actClick(mounted.byTestId('rhythm-inspect-rhythm-weekend-service')!);
    await flush();
    expect((mounted.byTestId('rhythm-add-step-title') as HTMLInputElement).disabled).toBe(false);
    expect((mounted.byTestId('rhythm-add-collaborator') as HTMLButtonElement).disabled).toBe(true);
    expect(mounted.byTestId('rhythm-collaborator-picker')).toBeNull();
    mounted.unmount();
  });

  it('deletes a rhythm through a confirmation dialog and the gateway', async () => {
    const rhythmsGateway = fixtureRhythmsGateway();
    const mounted = mountRhythms({ rhythms: rhythmsGateway });
    await flush();
    await actClick(mounted.byTestId('rhythm-delete-rhythm-monthly-care')!);
    await flush();
    const dialog = mounted.byTestId('rhythm-operation-confirmation');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.contains(document.activeElement)).toBe(true);
    await actClick(mounted.byTestId('rhythm-operation-confirm')!);
    await flush();
    const remaining = await rhythmsGateway.list();
    expect(remaining.some((rule) => rule.id === 'rhythm-monthly-care')).toBe(false);
    mounted.unmount();
  });

  it('cancels a delete without calling the gateway', async () => {
    const rhythmsGateway = fixtureRhythmsGateway();
    const mounted = mountRhythms({ rhythms: rhythmsGateway });
    await flush();
    await actClick(mounted.byTestId('rhythm-delete-rhythm-monthly-care')!);
    await flush();
    await actClick(mounted.byTestId('rhythm-operation-cancel')!);
    await flush();
    expect(mounted.byTestId('rhythm-operation-confirmation')).toBeNull();
    const remaining = await rhythmsGateway.list();
    expect(remaining.some((rule) => rule.id === 'rhythm-monthly-care')).toBe(true);
    mounted.unmount();
  });

  it('never exposes collaborator/member writes, including for the general legacy Rhythms capability', async () => {
    const rhythmsGateway = fixtureRhythmsGateway();
    const mounted = mountRhythms({ rhythms: rhythmsGateway });
    await flush();
    await actClick(mounted.byTestId('rhythm-inspect-rhythm-weekend-service')!);
    await flush();
    expect((mounted.byTestId('rhythm-add-collaborator') as HTMLButtonElement).disabled).toBe(true);
    expect((mounted.byTestId('rhythm-remove-collaborator-workspace-user-3') as HTMLButtonElement).disabled).toBe(true);
    expect(mounted.byTestId('rhythm-collaborator-picker')).toBeNull();
    mounted.unmount();
  });

  it('shows weekly schedule fields by default and switches to monthly/annual schedule fields when frequency changes, in the create dialog', async () => {
    const mounted = mountRhythms();
    await flush();
    await actClick(mounted.byTestId('rhythms-new-rule')!);
    await flush();
    expect(mounted.byTestId('rhythm-create-day-of-week')).toBeTruthy();
    expect(mounted.byTestId('rhythm-create-day-of-month')).toBeNull();
    await actSetValue(mounted.byTestId('rhythm-create-frequency') as HTMLSelectElement, 'monthly');
    await flush();
    expect(mounted.byTestId('rhythm-create-day-of-week')).toBeNull();
    expect(mounted.byTestId('rhythm-create-day-of-month')).toBeTruthy();
    expect(mounted.byTestId('rhythm-create-month')).toBeNull();
    await actSetValue(mounted.byTestId('rhythm-create-frequency') as HTMLSelectElement, 'annual');
    await flush();
    expect(mounted.byTestId('rhythm-create-day-of-month')).toBeTruthy();
    expect(mounted.byTestId('rhythm-create-month')).toBeTruthy();
    mounted.unmount();
  });

  it('creates a rhythm with workflow steps through the create dialog and the gateway', async () => {
    const rhythmsGateway = fixtureRhythmsGateway();
    const mounted = mountRhythms({ rhythms: rhythmsGateway });
    await flush();
    await actClick(mounted.byTestId('rhythms-new-rule')!);
    await flush();
    await actSetValue(mounted.byTestId('rhythm-create-title') as HTMLInputElement, 'Volunteer follow-through');
    await actClick(mounted.byTestId('rhythm-create-add-step')!);
    await flush();
    await actSetValue(mounted.byTestId('rhythm-create-step-title-0') as HTMLInputElement, 'Send thank-you note');
    await actClick(mounted.byTestId('rhythm-create-submit')!);
    await flush();
    await actClick(mounted.byTestId('rhythm-operation-confirm')!);
    await flush();
    const created = await rhythmsGateway.list();
    const rule = created.find((item) => item.title === 'Volunteer follow-through');
    expect(rule).toBeTruthy();
    mounted.unmount();
  });

  it('replaces, edits, and removes selected rhythm workflow steps through the edit form round trip', async () => {
    const rhythmsGateway = fixtureRhythmsGateway();
    const mounted = mountRhythms({ rhythms: rhythmsGateway });
    await flush();
    await actClick(mounted.byTestId('rhythm-inspect-rhythm-weekend-service')!);
    await flush();
    const titleInput = mounted.byTestId('rhythm-edit-title') as HTMLInputElement;
    expect(titleInput.value).toBe('Weekend service cadence');
    await actSetValue(titleInput, 'Weekend service cadence (updated)');
    await actSetValue(mounted.byTestId('rhythm-edit-step-title-0') as HTMLInputElement, 'Prepare the updated handoff');
    await actClick(mounted.byTestId('rhythm-edit-add-step')!);
    await flush();
    await actSetValue(mounted.byTestId('rhythm-edit-step-title-1') as HTMLInputElement, 'Send the final reminder');
    await actClick(mounted.byTestId('rhythm-edit-submit')!);
    await flush();
    await actClick(mounted.byTestId('rhythm-operation-confirm')!);
    await flush();
    const updated = await rhythmsGateway.list();
    const rule = updated.find((item) => item.id === 'rhythm-weekend-service');
    expect(rule?.title).toBe('Weekend service cadence (updated)');
    expect(rule?.steps.map((step) => step.title)).toEqual(['Prepare the updated handoff', 'Send the final reminder']);
    await actClick(mounted.byTestId('rhythm-edit-remove-step-1')!);
    await actClick(mounted.byTestId('rhythm-edit-submit')!);
    await flush();
    await actClick(mounted.byTestId('rhythm-operation-confirm')!);
    await flush();
    expect((await rhythmsGateway.list()).find((item) => item.id === 'rhythm-weekend-service')?.steps.map((step) => step.title)).toEqual(['Prepare the updated handoff']);
    mounted.unmount();
  });

  it('adds a workflow step to a selected rhythm through the gateway', async () => {
    const rhythmsGateway = fixtureRhythmsGateway();
    const mounted = mountRhythms({ rhythms: rhythmsGateway });
    await flush();
    await actClick(mounted.byTestId('rhythm-inspect-rhythm-monthly-care')!);
    await flush();
    await actSetValue(mounted.byTestId('rhythm-add-step-title') as HTMLInputElement, 'Confirm follow-up call');
    await actClick(mounted.byTestId('rhythm-add-step-submit')!);
    await flush();
    await actClick(mounted.byTestId('rhythm-operation-confirm')!);
    await flush();
    const updated = await rhythmsGateway.list();
    expect(updated.find((rule) => rule.id === 'rhythm-monthly-care')?.steps.some((step) => step.title === 'Confirm follow-up call')).toBe(true);
    mounted.unmount();
  });

  it('closes the delete dialog on Escape and restores focus to the trigger', async () => {
    const mounted = mountRhythms();
    await flush();
    const trigger = mounted.byTestId('rhythm-delete-rhythm-monthly-care') as HTMLButtonElement;
    trigger.focus();
    await actClick(trigger);
    await flush();
    await actKeyDown(document, 'Escape');
    await flush();
    expect(mounted.byTestId('rhythm-operation-confirmation')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    mounted.unmount();
  });

  it('fails closed when collaboration capability is omitted: rhythm controls and mutation handlers stay inert', async () => {
    const rhythmsGateway = fixtureRhythmsGateway();
    const mutations = {
      create: vi.fn(rhythmsGateway.create), update: vi.fn(rhythmsGateway.update), delete: vi.fn(rhythmsGateway.delete), addStep: vi.fn(rhythmsGateway.addStep), replaceSteps: vi.fn(rhythmsGateway.replaceSteps), addCollaborator: vi.fn(rhythmsGateway.addCollaborator), removeCollaborator: vi.fn(rhythmsGateway.removeCollaborator),
    };
    const mounted = mountRhythms({ rhythms: { ...rhythmsGateway, ...mutations } }, { currentUser: { id: 'workspace-user-1', displayName: 'AJ', initials: 'AH' } });
    await flush();
    await actClick(mounted.byTestId('rhythm-inspect-rhythm-weekend-service')!);
    await flush();
    expect(mounted.byTestId('rhythm-detail')?.textContent).toContain('Weekend service cadence');
    const enabled = mounted.byTestId('rhythm-enabled-rhythm-weekend-service') as HTMLInputElement;
    expect(enabled.disabled).toBe(true);
    expect(enabled.title).toContain('inspection only');
    await actClick(enabled);
    for (const control of ['rhythm-edit-title', 'rhythm-edit-submit', 'rhythm-add-step-title', 'rhythm-add-step-submit', 'rhythm-add-collaborator']) {
      expect((mounted.byTestId(control) as HTMLButtonElement).disabled).toBe(true);
      await actClick(mounted.byTestId(control)!);
    }
    expect((mounted.byTestId('rhythms-new-rule') as HTMLButtonElement).disabled).toBe(true);
    for (const mutation of Object.values(mutations)) expect(mutation).not.toHaveBeenCalled();
    mounted.unmount();
  });
});
