import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { AutomationsScreen } from '../src/screens/AutomationsScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway, fixtureAutomationsGateway, failingAutomationsGateway, emptyAutomationsGateway } from './test-utils/fixtures';
import { mount, flush, actClick, actSetValue, actKeyDown } from './test-utils/mount';

function buildHost(overrides: Record<string, unknown> = {}) {
  return { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { id: 'user-aj', displayName: 'AJ Hochhalter', initials: 'AH', capabilities: ['facilities.manage', 'facilities.reserve', 'automations.write', 'integrations.write'] as const }, ...overrides };
}

function mountAutomations(gatewayOverrides: Partial<ReturnType<typeof fixtureDomainGateway>> = {}, hostOverrides: Record<string, unknown> = {}) {
  const gateway = { ...fixtureDomainGateway(), ...gatewayOverrides };
  return mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(hostOverrides), children: createElement(AutomationsScreen) }));
}

describe('AutomationsScreen', () => {
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({ Screen: AutomationsScreen, screenName: 'Automations', testId: 'rhythm-automations-screen', gateway: fixtureDomainGateway() });
  });

  it('shows the loading state, then rules grouped by source with real trigger/action summaries', async () => {
    const mounted = mountAutomations();
    expect(mounted.byTestId('page-state-loading')).toBeTruthy();
    await flush();
    expect(mounted.byTestId('page-state-loading')).toBeNull();
    expect(mounted.byTestId('automation-group-rhythm')).toBeTruthy();
    expect(mounted.byTestId('automation-rule-rule-rhythm-due-reminder')?.textContent).toContain('Task is approaching its due date');
    mounted.unmount();
  });

  it('shows the empty state when there are no automations', async () => {
    const mounted = mountAutomations({ automations: emptyAutomationsGateway() });
    await flush();
    expect(mounted.byTestId('page-state-empty')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the forbidden state on a forbidden gateway error', async () => {
    const mounted = mountAutomations({ automations: failingAutomationsGateway('forbidden') });
    await flush();
    expect(mounted.byTestId('page-state-forbidden')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the unavailable state on a not_found/unavailable gateway error', async () => {
    const mounted = mountAutomations({ automations: failingAutomationsGateway('unavailable') });
    await flush();
    expect(mounted.byTestId('page-state-unavailable')).toBeTruthy();
    mounted.unmount();
  });

  it('shows a retryable server-error state', async () => {
    const mounted = mountAutomations({ automations: failingAutomationsGateway('server_error') });
    await flush();
    expect(mounted.byTestId('page-state-server-error')).toBeTruthy();
    mounted.unmount();
  });

  it('reflects rule and enabled counts in the overview summary', async () => {
    const mounted = mountAutomations();
    await flush();
    expect(mounted.byTestId('automations-rule-count')?.textContent).toBe('2');
    expect(mounted.byTestId('automations-enabled-count')?.textContent).toBe('2');
    mounted.unmount();
  });

  it('selects a rule and shows its status/account/trigger/action/history in the inspector', async () => {
    const mounted = mountAutomations();
    await flush();
    await actClick(mounted.byTestId('automation-select-rule-pco-volunteer-decline')!);
    await flush();
    const inspector = mounted.byTestId('automation-inspector');
    expect(inspector?.textContent).toContain('Volunteer declined');
    expect(inspector?.textContent).toContain('Production Services');
    expect(inspector?.textContent).toContain('1');
    mounted.unmount();
  });

  it('opens a preview dialog with match history for a rule', async () => {
    const mounted = mountAutomations();
    await flush();
    await actClick(mounted.byTestId('automation-select-rule-rhythm-due-reminder')!);
    await flush();
    await actClick(mounted.byTestId('automation-preview-rule-rhythm-due-reminder')!);
    await flush();
    const dialog = mounted.byTestId('automation-preview-dialog');
    expect(dialog?.textContent).toContain('Nudge owners before tasks are due');
    expect(dialog?.textContent).toContain('3');
    await actKeyDown(document, 'Escape');
    await flush();
    expect(mounted.byTestId('automation-preview-dialog')).toBeNull();
    mounted.unmount();
  });

  it('enables and disables a rule through the toggle and the gateway', async () => {
    const automationsGateway = fixtureAutomationsGateway();
    const mounted = mountAutomations({ automations: automationsGateway });
    await flush();
    await actClick(mounted.byTestId('automation-select-rule-rhythm-due-reminder')!);
    await flush();
    const toggle = mounted.byTestId('automation-toggle-rule-rhythm-due-reminder') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    await actClick(toggle);
    await flush();
    const rules = await automationsGateway.list();
    expect(rules.find((rule) => rule.id === 'rule-rhythm-due-reminder')?.enabled).toBe(false);
    mounted.unmount();
  });

  it('deletes a rule through a confirmation dialog and the gateway', async () => {
    const automationsGateway = fixtureAutomationsGateway();
    const mounted = mountAutomations({ automations: automationsGateway });
    await flush();
    await actClick(mounted.byTestId('automation-select-rule-pco-volunteer-decline')!);
    await flush();
    await actClick(mounted.byTestId('automation-delete-rule-pco-volunteer-decline')!);
    await flush();
    expect(mounted.byTestId('automation-delete-dialog')).toBeTruthy();
    await actClick(mounted.byTestId('automation-delete-confirm')!);
    await flush();
    const rules = await automationsGateway.list();
    expect(rules.some((rule) => rule.id === 'rule-pco-volunteer-decline')).toBe(false);
    mounted.unmount();
  });

  it('creates an automation through the builder dialog with a real trigger/action/condition workflow', async () => {
    const automationsGateway = fixtureAutomationsGateway();
    const mounted = mountAutomations({ automations: automationsGateway });
    await flush();
    await actClick(mounted.byTestId('automations-new')!);
    await flush();
    await actSetValue(mounted.byTestId('automation-source') as HTMLSelectElement, 'gmail');
    await flush();
    await actSetValue(mounted.byTestId('automation-trigger') as HTMLSelectElement, 'gmail.message_matches');
    await actSetValue(mounted.byTestId('automation-action') as HTMLSelectElement, 'create_task');
    await actClick(mounted.byTestId('automation-add-condition')!);
    await flush();
    await actSetValue(mounted.byTestId('automation-condition-value-0') as HTMLInputElement, 'Worship');
    await actSetValue(mounted.byTestId('automation-name') as HTMLInputElement, 'Follow up on worship emails');
    await actClick(mounted.byTestId('automation-builder-submit')!);
    await flush();
    const rules = await automationsGateway.list();
    const created = rules.find((rule) => rule.name === 'Follow up on worship emails');
    expect(created?.source).toBe('gmail');
    expect(created?.triggerKey).toBe('gmail.message_matches');
    expect(created?.actionType).toBe('create_task');
    expect(created?.conditions).toEqual([{ field: 'subject', operator: 'equals', value: 'Worship' }]);
    mounted.unmount();
  });

  it('restricts the action catalog for Planning Center automations to its allowed actions', async () => {
    const mounted = mountAutomations();
    await flush();
    await actClick(mounted.byTestId('automations-new')!);
    await flush();
    await actSetValue(mounted.byTestId('automation-source') as HTMLSelectElement, 'planning_center');
    await flush();
    const actionSelect = mounted.byTestId('automation-action') as HTMLSelectElement;
    const options = [...actionSelect.options].map((option) => option.value);
    expect(options).toContain('create_task');
    expect(options).not.toContain('create_reservation');
    mounted.unmount();
  });

  it('edits an existing rule through the builder dialog, pre-filled with its current source/trigger/action', async () => {
    const automationsGateway = fixtureAutomationsGateway();
    const mounted = mountAutomations({ automations: automationsGateway });
    await flush();
    await actClick(mounted.byTestId('automation-select-rule-rhythm-due-reminder')!);
    await flush();
    await actClick(mounted.byTestId('automation-edit-rule-rhythm-due-reminder')!);
    await flush();
    const nameInput = mounted.byTestId('automation-name') as HTMLInputElement;
    expect(nameInput.value).toBe('Nudge owners before tasks are due');
    await actSetValue(nameInput, 'Nudge owners before tasks are due (updated)');
    await actClick(mounted.byTestId('automation-builder-submit')!);
    await flush();
    const rules = await automationsGateway.list();
    expect(rules.find((rule) => rule.id === 'rule-rhythm-due-reminder')?.name).toBe('Nudge owners before tasks are due (updated)');
    mounted.unmount();
  });

  it('never imports an agent-session launcher or a live automation-catalog fetch to build/edit a rule', () => {
    const automationsGateway = fixtureAutomationsGateway();
    expect(automationsGateway.create.length).toBe(1);
    expect(automationsGateway.update.length).toBe(2);
  });
});
