import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FacilitiesScreen } from '../src/screens/FacilitiesScreen';
import { AutomationsScreen } from '../src/screens/AutomationsScreen';
import { IntegrationsScreen } from '../src/screens/IntegrationsScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import type { AutomationPreview, RhythmAutomation } from '../src/domain/types';
import { fixtureDomainGateway, fixtureFacilitiesGateway } from './test-utils/fixtures';
import { actClick, actKeyDown, actSetValue, flush, mount } from './test-utils/mount';

const readonlyHost = { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { id: 'reader', displayName: 'Reader', initials: 'R' } };
function wrap(screen: ReturnType<typeof createElement>, gateway = fixtureDomainGateway()) { return mount(createElement(RhythmWorkspaceProvider, { gateway, host: readonlyHost, children: screen })); }

describe('issue #4 operations corrective contract', () => {
  it('issue-4-c2: denied users can inspect and every visible mutation control is disabled without gateway writes', async () => {
    const gateway = fixtureDomainGateway();
    gateway.facilities.createFacility = vi.fn(gateway.facilities.createFacility);
    gateway.facilities.updateFacility = vi.fn(gateway.facilities.updateFacility);
    gateway.facilities.deleteFacility = vi.fn(gateway.facilities.deleteFacility);
    gateway.facilities.createReservation = vi.fn(gateway.facilities.createReservation);
    gateway.facilities.updateReservation = vi.fn(gateway.facilities.updateReservation);
    gateway.facilities.deleteReservation = vi.fn(gateway.facilities.deleteReservation);
    gateway.automations.create = vi.fn(gateway.automations.create);
    gateway.automations.update = vi.fn(gateway.automations.update);
    gateway.automations.delete = vi.fn(gateway.automations.delete);
    gateway.integrations.saveCalendarSelection = vi.fn(gateway.integrations.saveCalendarSelection);
    gateway.integrations.sync = vi.fn(gateway.integrations.sync);
    gateway.integrations.disconnect = vi.fn(gateway.integrations.disconnect);
    gateway.integrations.requestAuthorization = vi.fn(gateway.integrations.requestAuthorization);
    const facilities = wrap(createElement(FacilitiesScreen), gateway);
    await flush();
    expect(facilities.byTestId('facilities-read-only')?.getAttribute('role')).toBe('status');
    expect((facilities.byTestId('facilities-reserve-space') as HTMLButtonElement).disabled).toBe(true);
    await actClick(facilities.byTestId('facilities-mode-rooms')!);
    for (const id of ['facility-room-reserve-101', 'facility-automation-manage', 'facility-add-space']) {
      const control = facilities.byTestId(id) as HTMLButtonElement;
      expect(control.matches(':disabled'), id).toBe(true);
      await actClick(control);
    }
    facilities.unmount();
    const automations = wrap(createElement(AutomationsScreen), gateway);
    await flush();
    expect(automations.byTestId('automations-read-only')).toBeTruthy();
    expect((automations.byTestId('automations-new') as HTMLButtonElement).disabled).toBe(true);
    for (const id of ['automation-toggle-rule-rhythm-due-reminder', 'automation-edit-rule-rhythm-due-reminder', 'automation-delete-rule-rhythm-due-reminder']) expect((automations.byTestId(id) as HTMLButtonElement).disabled, id).toBe(true);
    automations.unmount();
    const integrations = wrap(createElement(IntegrationsScreen), gateway);
    await flush();
    expect(integrations.byTestId('integrations-read-only')?.getAttribute('role')).toBe('status');
    for (const id of ['integrations-sync-all', 'integration-sync-google-calendar', 'integration-reconnect-google-calendar', 'integration-disconnect-google-calendar', 'integration-calendar-select-all', 'integration-calendar-select-none', 'integration-calendar-option-cal-primary', 'integration-calendar-save']) expect((integrations.byTestId(id) as HTMLButtonElement).disabled, id).toBe(true);
    integrations.unmount();
    for (const write of [gateway.facilities.createFacility, gateway.facilities.updateFacility, gateway.facilities.deleteFacility, gateway.facilities.createReservation, gateway.facilities.updateReservation, gateway.facilities.deleteReservation, gateway.automations.create, gateway.automations.update, gateway.automations.delete, gateway.integrations.saveCalendarSelection, gateway.integrations.sync, gateway.integrations.disconnect, gateway.integrations.requestAuthorization]) expect(write).not.toHaveBeenCalled();
  });

  it('issue-4-c3: next week requests the effective range and a stale request cannot replace the newer response', async () => {
    const facilitiesGateway = fixtureFacilitiesGateway();
    const calls: Array<{ start: string; resolve: (value: Awaited<ReturnType<typeof facilitiesGateway.reservations>>) => void }> = [];
    facilitiesGateway.reservations = ({ start }) => new Promise((resolve) => calls.push({ start, resolve }));
    const gateway = { ...fixtureDomainGateway(), facilities: facilitiesGateway };
    const host = { ...readonlyHost, currentUser: { ...readonlyHost.currentUser, capabilities: ['facilities.reserve'] as const } };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(FacilitiesScreen) }));
    await flush();
    calls[0]!.resolve([]); await flush();
    await actClick(mounted.byTestId('facilities-range-forward')!);
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1]?.start).toContain('2026-08-17');
    calls[1]!.resolve([]); await flush();
    calls[0]!.resolve([{ id: 'stale', facilityId: '101', title: 'stale', requesterName: 'A', creatorId: 'A', start: '2026-08-10T10:00:00-07:00', end: '2026-08-10T11:00:00-07:00', notes: null }]); await flush();
    expect(mounted.byTestId('facility-reservation-stale')).toBeNull();
    mounted.unmount();
  });

  it('issue-4-c5: a failed calendar save retains the selected draft and gives local retry guidance', async () => {
    const gateway = fixtureDomainGateway();
    gateway.integrations.saveCalendarSelection = async () => { throw new Error('offline'); };
    const host = { ...readonlyHost, currentUser: { ...readonlyHost.currentUser, capabilities: ['integrations.write'] as const } };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(IntegrationsScreen) }));
    await flush(); await actClick(mounted.byTestId('integration-calendar-option-cal-community')!); await actClick(mounted.byTestId('integration-calendar-save')!); await flush();
    expect(mounted.byTestId('integration-calendar-save-status')?.textContent).toContain('retry');
    expect((mounted.byTestId('integration-calendar-option-cal-community') as HTMLInputElement).checked).toBe(true);
    mounted.unmount();
  });

  it('issue-4-c5: calendar save stays single-flight and keeps its local retry draft', async () => {
    const gateway = fixtureDomainGateway();
    let resolveSave!: (sources: Awaited<ReturnType<typeof gateway.integrations.saveCalendarSelection>>) => void;
    gateway.integrations.saveCalendarSelection = vi.fn(() => new Promise<Awaited<ReturnType<typeof gateway.integrations.saveCalendarSelection>>>((resolve) => { resolveSave = resolve; }));
    const host = { ...readonlyHost, currentUser: { ...readonlyHost.currentUser, capabilities: ['integrations.write'] as const } };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(IntegrationsScreen) }));
    await flush(); await actClick(mounted.byTestId('integration-calendar-option-cal-community')!);
    await actClick(mounted.byTestId('integration-calendar-save')!);
    await actClick(mounted.byTestId('integration-calendar-save')!);
    expect(gateway.integrations.saveCalendarSelection).toHaveBeenCalledTimes(1);
    expect((mounted.byTestId('integration-calendar-save') as HTMLButtonElement).disabled).toBe(true);
    resolveSave(await gateway.integrations.calendarSources()); await flush();
    expect((mounted.byTestId('integration-calendar-option-cal-community') as HTMLInputElement).checked).toBe(true);
    mounted.unmount();
  });

  it('issue-4-c5: Gmail detail rejection is local and a deferred detail cannot update after unmount', async () => {
    const gateway = fixtureDomainGateway();
    let rejectSignals!: (reason?: unknown) => void;
    gateway.integrations.accounts = async () => (await fixtureDomainGateway().integrations.accounts()).map((account) => account.id === 'gmail' ? { ...account, status: 'connected' as const } : account);
    gateway.integrations.gmailSignals = vi.fn(() => new Promise<Awaited<ReturnType<typeof gateway.integrations.gmailSignals>>>((_, reject) => { rejectSignals = reject; }));
    const host = { ...readonlyHost, currentUser: { ...readonlyHost.currentUser, capabilities: ['integrations.write'] as const } };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(IntegrationsScreen) }));
    await flush(); await actClick(mounted.byTestId('integration-select-gmail')!); await flush();
    rejectSignals(new Error('offline')); await flush();
    expect(mounted.byTestId('integration-sync-status-gmail')?.textContent).toContain('could not load');
    mounted.unmount();
    let resolveSignals!: (value: Awaited<ReturnType<typeof gateway.integrations.gmailSignals>>) => void;
    gateway.integrations.gmailSignals = vi.fn(() => new Promise<Awaited<ReturnType<typeof gateway.integrations.gmailSignals>>>((resolve) => { resolveSignals = resolve; }));
    const deferred = mount(createElement(RhythmWorkspaceProvider, { gateway, host, children: createElement(IntegrationsScreen) }));
    await flush(); await actClick(deferred.byTestId('integration-select-gmail')!); await flush();
    deferred.unmount();
    resolveSignals([]); await flush();
    expect(gateway.integrations.gmailSignals).toHaveBeenCalledTimes(1);
  });

  it('issue-4-c3: facilities drops a deferred range response after unmount', async () => {
    const facilities = fixtureFacilitiesGateway();
    let resolveReservations!: (value: Awaited<ReturnType<typeof facilities.reservations>>) => void;
    facilities.reservations = () => new Promise((resolve) => { resolveReservations = resolve; });
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway: { ...fixtureDomainGateway(), facilities }, host: readonlyHost, children: createElement(FacilitiesScreen) }));
    await flush(); mounted.unmount();
    resolveReservations([{ id: 'late', facilityId: '101', title: 'late', requesterName: 'A', creatorId: 'A', start: '2026-08-12T10:00:00-07:00', end: '2026-08-12T11:00:00-07:00', notes: null }]);
    await flush();
    expect(document.querySelector('[data-testid="facility-reservation-late"]')).toBeNull();
  });

  it('issue-4-c4: partial automation cleanup reloads the authoritative range and announces the exact result', async () => {
    const facilities = fixtureFacilitiesGateway();
    let listed = 0;
    facilities.reservations = async () => {
      listed += 1;
      return listed === 1
        ? [{ id: 'auto-a', facilityId: '101', title: 'A', requesterName: 'Automation', creatorId: 'automation', start: '2026-08-13T08:00:00-07:00', end: '2026-08-13T08:30:00-07:00', notes: null, automation: true }, { id: 'auto-b', facilityId: '101', title: 'B', requesterName: 'Automation', creatorId: 'automation', start: '2026-08-14T08:00:00-07:00', end: '2026-08-14T08:30:00-07:00', notes: null, automation: true }]
        : [{ id: 'auto-b', facilityId: '101', title: 'B', requesterName: 'Automation', creatorId: 'automation', start: '2026-08-14T08:00:00-07:00', end: '2026-08-14T08:30:00-07:00', notes: null, automation: true }];
    };
    facilities.deleteReservation = vi.fn(async (id) => { if (id === 'auto-b') throw new Error('locked'); });
    const host = { ...readonlyHost, currentUser: { ...readonlyHost.currentUser, capabilities: ['facilities.manage'] as const } };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway: { ...fixtureDomainGateway(), facilities }, host, children: createElement(FacilitiesScreen) }));
    await flush(); await actClick(mounted.byTestId('facilities-mode-rooms')!); await actClick(mounted.byTestId('facility-automation-manage')!); await flush();
    await actClick(mounted.byTestId('facility-automation-delete')!); await flush();
    expect(mounted.byTestId('facilities-mutation-notice')?.getAttribute('role')).toBe('alert');
    expect(mounted.byTestId('facilities-mutation-notice')?.textContent).toContain('1 of 2');
    expect(listed).toBeGreaterThanOrEqual(2);
    mounted.unmount();
  });

  it('issue-4-c4: partial atomic series cleanup reloads and announces the precise result', async () => {
    const facilities = fixtureFacilitiesGateway();
    let listed = 0;
    const series = [
      { id: 'series-a', facilityId: '101', title: 'Recurring setup', requesterName: 'AJ', creatorId: 'user-aj', start: '2026-08-12T10:00:00-07:00', end: '2026-08-12T11:00:00-07:00', notes: null, seriesId: 'weekly' },
      { id: 'series-b', facilityId: '101', title: 'Recurring setup', requesterName: 'AJ', creatorId: 'user-aj', start: '2026-08-19T10:00:00-07:00', end: '2026-08-19T11:00:00-07:00', notes: null, seriesId: 'weekly' },
    ];
    facilities.reservations = async () => (++listed === 1 ? series : [series[1]!]);
    facilities.deleteSeries = vi.fn(async () => ({ deletedCount: 1 }));
    const host = { ...readonlyHost, currentUser: { ...readonlyHost.currentUser, capabilities: ['facilities.manage'] as const } };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway: { ...fixtureDomainGateway(), facilities }, host, children: createElement(FacilitiesScreen) }));
    await flush(); await actClick(mounted.byTestId('facility-reservation-open-series-a')!); await actClick(mounted.byTestId('facility-inspector-delete')!); await actClick(mounted.byTestId('facility-series-delete-confirm')!); await flush();
    expect(facilities.deleteSeries).toHaveBeenCalledWith('weekly');
    expect(mounted.byTestId('facilities-mutation-notice')?.textContent).toContain('1 recurring');
    expect(listed).toBeGreaterThanOrEqual(2);
    mounted.unmount();
  });

  it('issue-4-c4: deletes a recurring series authoritatively even when this range exposes only one occurrence', async () => {
    const facilities = fixtureFacilitiesGateway();
    let serverSeries = ['visible-weekly', 'outside-range-1', 'outside-range-2', 'outside-range-3'];
    facilities.reservations = async () => serverSeries.includes('visible-weekly') ? [{ id: 'visible-weekly', facilityId: '101', title: 'Weekly setup', requesterName: 'AJ', creatorId: 'user-aj', start: '2026-08-12T10:00:00-07:00', end: '2026-08-12T11:00:00-07:00', notes: null, seriesId: 'weekly' }] : [];
    facilities.deleteSeries = vi.fn(async () => { const deletedCount = serverSeries.length; serverSeries = []; return { deletedCount }; });
    const host = { ...readonlyHost, currentUser: { ...readonlyHost.currentUser, id: 'user-aj', capabilities: ['facilities.manage'] as const } };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway: { ...fixtureDomainGateway(), facilities }, host, children: createElement(FacilitiesScreen) }));
    await flush(); await actClick(mounted.byTestId('facility-reservation-open-visible-weekly')!); await actClick(mounted.byTestId('facility-inspector-delete')!); await actClick(mounted.byTestId('facility-series-delete-confirm')!); await flush();
    expect(facilities.deleteSeries).toHaveBeenCalledWith('weekly');
    expect(serverSeries).toEqual([]);
    expect(mounted.byTestId('facility-reservation-visible-weekly')).toBeNull();
    mounted.unmount();
  });

  it('issue-4-c4: requester fields round-trip and managers edit/delete every linked group member authoritatively', async () => {
    const facilities = fixtureFacilitiesGateway();
    const group = [{ id: 'group-a', facilityId: '101', title: 'Team setup', requesterName: 'Original requester', creatorId: 'user-other', start: '2026-08-12T10:00:00-07:00', end: '2026-08-12T11:00:00-07:00', notes: null, groupId: 'linked-team' }];
    facilities.reservations = async () => group;
    facilities.updateGroup = vi.fn(async (_id, input) => group.map((reservation) => ({ ...reservation, ...input })));
    facilities.deleteGroup = vi.fn(async () => ({ deletedCount: 3 }));
    const host = { ...readonlyHost, currentUser: { ...readonlyHost.currentUser, id: 'manager', capabilities: ['facilities.manage'] as const } };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway: { ...fixtureDomainGateway(), facilities }, host, children: createElement(FacilitiesScreen) }));
    await flush(); await actClick(mounted.byTestId('facility-reservation-menu-group-a')!); await actClick(mounted.byTestId('facility-reservation-menu-edit-group-a')!); await flush();
    await actSetValue(mounted.byTestId('facility-form-requester') as HTMLInputElement, 'Updated requester'); await actClick(mounted.byTestId('facility-form-submit')!); await flush();
    expect(facilities.updateGroup).toHaveBeenCalledWith('linked-team', expect.objectContaining({ requesterName: 'Updated requester' }));
    await actClick(mounted.byTestId('facility-reservation-open-group-a')!); await actClick(mounted.byTestId('facility-inspector-delete')!); await actClick(mounted.byTestId('facility-group-delete-confirm')!); await flush();
    expect(facilities.deleteGroup).toHaveBeenCalledWith('linked-team');
    mounted.unmount();
  });

  it('issue-4-c4: a creator can manage their own linked group but not someone else’s', async () => {
    const facilities = fixtureFacilitiesGateway();
    facilities.reservations = async () => [
      { id: 'own-group', facilityId: '101', title: 'Own group', requesterName: 'AJ', creatorId: 'creator', start: '2026-08-12T10:00:00-07:00', end: '2026-08-12T11:00:00-07:00', notes: null, groupId: 'own' },
      { id: 'other-group', facilityId: '101', title: 'Other group', requesterName: 'Morgan', creatorId: 'other', start: '2026-08-12T12:00:00-07:00', end: '2026-08-12T13:00:00-07:00', notes: null, groupId: 'other' },
    ];
    const host = { ...readonlyHost, currentUser: { ...readonlyHost.currentUser, id: 'creator', capabilities: ['facilities.reserve'] as const } };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway: { ...fixtureDomainGateway(), facilities }, host, children: createElement(FacilitiesScreen) }));
    await flush(); await actClick(mounted.byTestId('facility-reservation-menu-own-group')!);
    expect((mounted.byTestId('facility-reservation-menu-edit-own-group') as HTMLButtonElement).disabled).toBe(false);
    expect((mounted.byTestId('facility-reservation-menu-delete-own-group') as HTMLButtonElement).disabled).toBe(false);
    await actClick(mounted.byTestId('facility-reservation-menu-other-group')!);
    expect((mounted.byTestId('facility-reservation-menu-edit-other-group') as HTMLButtonElement).disabled).toBe(true);
    expect((mounted.byTestId('facility-reservation-menu-delete-other-group') as HTMLButtonElement).disabled).toBe(true);
    mounted.unmount();
  });

  it('issue-4-c6: live automation catalog, action config, fetched preview, and resync are rendered through host ports', async () => {
    const automations = fixtureDomainGateway().automations;
    automations.catalog = async () => ({ providers: [{ source: 'gmail', status: 'stale', accountId: 'gmail-1', accountLabel: 'Worship inbox' }], triggers: { gmail: [{ key: 'gmail.live', label: 'Live Gmail trigger' }] }, actions: [{ type: 'create_task', label: 'Create live task', configFields: [{ key: 'titleTemplate', label: 'Title template' }] }] });
    automations.preview = async () => ({ summary: 'Fetched provider preview', matchedAt: '2026-08-21T09:00:00Z', matchCount: 7 });
    automations.resync = async (id) => ({ ...(await automations.list()).find((rule) => rule.id === id)!, matchCountLastRun: 9 });
    const host = { ...readonlyHost, currentUser: { ...readonlyHost.currentUser, capabilities: ['automations.write'] as const } };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway: { ...fixtureDomainGateway(), automations }, host, children: createElement(AutomationsScreen) }));
    await flush(); await actClick(mounted.byTestId('automations-new')!); await flush();
    await actSetValue(mounted.byTestId('automation-source') as HTMLSelectElement, 'gmail'); await flush();
    expect(mounted.byTestId('automation-provider-state')?.textContent).toContain('Worship inbox');
    expect((mounted.byTestId('automation-trigger') as HTMLSelectElement).value).toBe('gmail.live');
    await actSetValue(mounted.byTestId('automation-action-config-titleTemplate') as HTMLInputElement, 'Follow {{subject}}');
    expect((mounted.byTestId('automation-builder-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(mounted.byTestId('automation-provider-write-blocked')).toBeTruthy();
    await actSetValue(mounted.byTestId('automation-source') as HTMLSelectElement, 'rhythm'); await flush();
    await actClick(mounted.byTestId('automation-builder-submit')!); await flush();
    expect((await automations.list()).some((rule) => rule.source === 'rhythm')).toBe(true);
    await actClick(mounted.byTestId('automation-preview-rule-rhythm-due-reminder')!); await flush();
    expect(mounted.byTestId('automation-preview-summary')?.textContent).toBe('Fetched provider preview');
    await actKeyDown(document, 'Escape'); await actClick(mounted.byTestId('automation-select-rule-rhythm-due-reminder')!); await flush();
    expect(mounted.byTestId('automation-provider-stale')).toBeNull();
    await actClick(mounted.byTestId('automation-resync')!); await flush();
    expect(mounted.byTestId('automation-resync-status')?.textContent).toContain('9 matched');
    mounted.unmount();
  });

  it('issue-4-c6: preview generations, resync, and initial loads are unmount-safe and single-flight', async () => {
    const automations = fixtureDomainGateway().automations;
    let resolveFirstPreview!: (value: AutomationPreview) => void;
    let resolveSecondPreview!: (value: AutomationPreview) => void;
    let previewCalls = 0;
    automations.preview = vi.fn(() => new Promise<AutomationPreview>((resolve) => { if (previewCalls++ === 0) resolveFirstPreview = resolve; else resolveSecondPreview = resolve; }));
    let resolveResync!: (value: RhythmAutomation) => void;
    automations.resync = vi.fn(() => new Promise<RhythmAutomation>((resolve) => { resolveResync = resolve; }));
    const host = { ...readonlyHost, currentUser: { ...readonlyHost.currentUser, capabilities: ['automations.write'] as const } };
    const mounted = mount(createElement(RhythmWorkspaceProvider, { gateway: { ...fixtureDomainGateway(), automations }, host, children: createElement(AutomationsScreen) }));
    await flush(); await actClick(mounted.byTestId('automation-preview-rule-rhythm-due-reminder')!); await actClick(mounted.byTestId('automation-preview-close')!); await actClick(mounted.byTestId('automation-preview-rule-rhythm-due-reminder')!);
    resolveSecondPreview({ summary: 'Fresh preview', matchedAt: null, matchCount: 2 }); await flush();
    resolveFirstPreview({ summary: 'Stale preview', matchedAt: null, matchCount: 1 }); await flush();
    expect(mounted.byTestId('automation-preview-summary')?.textContent).toBe('Fresh preview');
    await actClick(mounted.byTestId('automation-select-rule-rhythm-due-reminder')!); await actClick(mounted.byTestId('automation-resync')!); await actClick(mounted.byTestId('automation-resync')!);
    expect(automations.resync).toHaveBeenCalledTimes(1);
    mounted.unmount();
    resolveResync((await fixtureDomainGateway().automations.list())[0]!); await flush();
  });
});
