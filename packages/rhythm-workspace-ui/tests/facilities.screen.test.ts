import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FacilitiesScreen } from '../src/screens/FacilitiesScreen';
import { RhythmWorkspaceProvider } from '../src/context';
import { defaultRhythmTokens } from '../src/host/theme';
import { assertScreenContract } from './test-utils/screenContract';
import { fixtureDomainGateway, fixtureFacilitiesGateway, failingFacilitiesGateway, emptyFacilitiesGateway } from './test-utils/fixtures';
import { mount, flush, actClick, actSetValue, actKeyDown } from './test-utils/mount';

function buildHost(overrides: Record<string, unknown> = {}) {
  return { tokens: defaultRhythmTokens, viewport: 'regular' as const, currentUser: { id: 'user-aj', displayName: 'AJ Hochhalter', initials: 'AH', capabilities: ['facilities.manage', 'facilities.reserve', 'automations.write', 'integrations.write'] as const }, ...overrides };
}

function mountFacilities(gatewayOverrides: Partial<ReturnType<typeof fixtureDomainGateway>> = {}, hostOverrides: Record<string, unknown> = {}) {
  const gateway = { ...fixtureDomainGateway(), ...gatewayOverrides };
  return mount(createElement(RhythmWorkspaceProvider, { gateway, host: buildHost(hostOverrides), children: createElement(FacilitiesScreen) }));
}

describe('FacilitiesScreen', () => {
  it('binds facility writes to the exact foreground confirmation payload before mutation', async () => {
    const facilities = fixtureFacilitiesGateway();
    const confirmWorkspaceOperation = vi.fn(async () => true);
    const createReservation = vi.fn(facilities.createReservation);
    const mounted = mountFacilities({ facilities: { ...facilities, createReservation } }, { confirmWorkspaceOperation });
    await flush(); await actClick(mounted.byTestId('facilities-reserve-space')!); await flush();
    await actSetValue(mounted.byTestId('facility-form-room') as HTMLSelectElement, '101');
    await actSetValue(mounted.byTestId('facility-form-title') as HTMLInputElement, 'Exact payload');
    await actSetValue(mounted.byTestId('facility-form-date') as HTMLInputElement, '2026-08-14');
    await actSetValue(mounted.byTestId('facility-form-start') as HTMLInputElement, '12:00');
    await actSetValue(mounted.byTestId('facility-form-end') as HTMLInputElement, '13:00');
    await actClick(mounted.byTestId('facility-form-submit')!); await flush();
    expect(createReservation).not.toHaveBeenCalled();
    const payload = { facilityId: '101', title: 'Exact payload', requesterName: 'AJ Hochhalter', start: '2026-08-14T12:00:00-07:00', end: '2026-08-14T13:00:00-07:00', notes: null };
    await actClick(mounted.byTestId('facility-operation-confirm')!); await flush();
    expect(confirmWorkspaceOperation).toHaveBeenCalledWith(expect.objectContaining({ operation: 'facilities.create-reservation', entityId: 'new-reservation', payload }));
    expect(createReservation).toHaveBeenCalledWith(payload);
    mounted.unmount();
  });
  it('satisfies the shared page/focus/responsive/theme/accessibility contract', async () => {
    await assertScreenContract({ Screen: FacilitiesScreen, screenName: 'Facilities', testId: 'rhythm-facilities-screen', gateway: fixtureDomainGateway() });
  });

  it('shows the loading state before the gateway resolves, then the reservation schedule', async () => {
    const mounted = mountFacilities();
    expect(mounted.byTestId('page-state-loading')).toBeTruthy();
    await flush();
    expect(mounted.byTestId('page-state-loading')).toBeNull();
    expect(mounted.byTestId('facilities-overview-results')).toBeTruthy();
    expect(mounted.byTestId('facility-reservation-501')?.textContent).toContain('Leadership sync');
    mounted.unmount();
  });

  it('shows the empty state when the gateway has no facilities', async () => {
    const mounted = mountFacilities({ facilities: emptyFacilitiesGateway() });
    await flush();
    expect(mounted.byTestId('page-state-empty')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the forbidden state on a forbidden gateway error', async () => {
    const mounted = mountFacilities({ facilities: failingFacilitiesGateway('forbidden') });
    await flush();
    expect(mounted.byTestId('page-state-forbidden')).toBeTruthy();
    mounted.unmount();
  });

  it('shows the unavailable state on a not_found/unavailable gateway error', async () => {
    const mounted = mountFacilities({ facilities: failingFacilitiesGateway('unavailable') });
    await flush();
    expect(mounted.byTestId('page-state-unavailable')).toBeTruthy();
    mounted.unmount();
  });

  it('shows a retryable server-error state and recovers on retry', async () => {
    const mounted = mountFacilities({ facilities: failingFacilitiesGateway('server_error') });
    await flush();
    expect(mounted.byTestId('page-state-server-error')).toBeTruthy();
    mounted.unmount();
  });

  it('excludes automation-created reservations from the overview schedule', async () => {
    const mounted = mountFacilities();
    await flush();
    expect(mounted.byTestId('facility-reservation-auto-1')).toBeNull();
    mounted.unmount();
  });

  it('switches between day, week, and month ranges and navigates forward/back', async () => {
    const mounted = mountFacilities();
    await flush();
    const weekLabel = mounted.byTestId('facilities-range-label')?.textContent;
    await actClick(mounted.byTestId('facilities-range-day')!);
    await flush();
    const dayLabel = mounted.byTestId('facilities-range-label')?.textContent;
    expect(dayLabel).not.toBe(weekLabel);
    await actClick(mounted.byTestId('facilities-range-forward')!);
    await flush();
    const forwardLabel = mounted.byTestId('facilities-range-label')?.textContent;
    expect(forwardLabel).not.toBe(dayLabel);
    await actClick(mounted.byTestId('facilities-range-back')!);
    await flush();
    expect(mounted.byTestId('facilities-range-label')?.textContent).toBe(dayLabel);
    mounted.unmount();
  });

  it('filters the schedule by building and room', async () => {
    const mounted = mountFacilities();
    await flush();
    await actSetValue(mounted.byTestId('facilities-building-filter') as HTMLSelectElement, 'North Campus');
    await flush();
    expect(mounted.byTestId('facility-reservation-501')).toBeNull();
    expect(mounted.byTestId('facility-reservation-506')).toBeTruthy();
    await actSetValue(mounted.byTestId('facilities-building-filter') as HTMLSelectElement, '');
    await actSetValue(mounted.byTestId('facilities-room-filter') as HTMLSelectElement, '102');
    await flush();
    expect(mounted.byTestId('facility-reservation-505')).toBeTruthy();
    expect(mounted.byTestId('facility-reservation-501')).toBeNull();
    mounted.unmount();
  });

  it('shows a no-results panel with a clear-filters action when a filter empties the schedule', async () => {
    const mounted = mountFacilities();
    await flush();
    await actSetValue(mounted.byTestId('facilities-room-filter') as HTMLSelectElement, '103');
    await actSetValue(mounted.byTestId('facilities-building-filter') as HTMLSelectElement, 'Main Campus');
    await flush();
    expect(mounted.byTestId('facilities-no-results')).toBeTruthy();
    await actClick(mounted.byTestId('facilities-clear-filters')!);
    await flush();
    expect(mounted.byTestId('facility-reservation-501')).toBeTruthy();
    mounted.unmount();
  });

  it('reflects the visible reservations in the metrics strip', async () => {
    const mounted = mountFacilities();
    await flush();
    await actSetValue(mounted.byTestId('facilities-room-filter') as HTMLSelectElement, '101');
    await flush();
    expect(mounted.byTestId('facilities-metric-conflicts')?.textContent).toBe('1');
    expect(mounted.byTestId('facilities-metric-setup-notes')?.textContent).toBe('2');
    mounted.unmount();
  });

  it('opens the inspector for a selected reservation with its room, time, and requester', async () => {
    const mounted = mountFacilities();
    await flush();
    await actClick(mounted.byTestId('facility-reservation-open-501')!);
    await flush();
    const inspector = mounted.byTestId('facility-inspector');
    expect(inspector?.textContent).toContain('Leadership sync');
    expect(inspector?.textContent).toContain('Sanctuary');
    expect(inspector?.textContent).toContain('AJ Hochhalter');
    mounted.unmount();
  });

  it('opens the reservation action menu with roving focus and closes on Escape, restoring focus to the trigger', async () => {
    const mounted = mountFacilities();
    await flush();
    await actClick(mounted.byTestId('facility-reservation-open-501')!);
    await flush();
    const trigger = mounted.byTestId('facility-reservation-menu-501') as HTMLButtonElement;
    await actClick(trigger);
    await flush();
    await flush();
    const menu = mounted.container.querySelector('[role="menu"]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
    await actKeyDown(document, 'Escape');
    await flush();
    expect(mounted.container.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    mounted.unmount();
  });

  it('creates a reservation through the dialog, validating required fields and blocking an overlapping single-room slot', async () => {
    const facilitiesGateway = fixtureFacilitiesGateway();
    const mounted = mountFacilities({ facilities: facilitiesGateway });
    await flush();
    await actClick(mounted.byTestId('facilities-reserve-space')!);
    await flush();
    await actClick(mounted.byTestId('facility-form-submit')!);
    await flush();
    expect(mounted.byTestId('facility-form-title-error')).toBeTruthy();

    await actSetValue(mounted.byTestId('facility-form-title') as HTMLInputElement, 'Board meeting');
    await actSetValue(mounted.byTestId('facility-form-room') as HTMLSelectElement, '101');
    await actSetValue(mounted.byTestId('facility-form-date') as HTMLInputElement, '2026-08-12');
    await actSetValue(mounted.byTestId('facility-form-start') as HTMLInputElement, '10:15');
    await actSetValue(mounted.byTestId('facility-form-end') as HTMLInputElement, '10:45');
    await flush();
    expect(mounted.byTestId('facility-form-availability')?.textContent).toContain('overlap');
    await actClick(mounted.byTestId('facility-form-submit')!);
    await flush();
    expect(mounted.byTestId('facility-reservation-dialog')).toBeTruthy();

    await actSetValue(mounted.byTestId('facility-form-start') as HTMLInputElement, '13:00');
    await actSetValue(mounted.byTestId('facility-form-end') as HTMLInputElement, '13:30');
    await flush();
    await actClick(mounted.byTestId('facility-form-submit')!);
    await flush();
    await actClick(mounted.byTestId('facility-operation-confirm')!); await flush();
    const created = await facilitiesGateway.reservations({ start: '2026-08-01T00:00:00.000', end: '2026-08-31T23:59:59.999' });
    expect(created.some((reservation) => reservation.title === 'Board meeting')).toBe(true);
    mounted.unmount();
  });

  it('edits a reservation through the menu and persists the change via the gateway', async () => {
    const facilitiesGateway = fixtureFacilitiesGateway();
    const mounted = mountFacilities({ facilities: facilitiesGateway });
    await flush();
    await actClick(mounted.byTestId('facility-reservation-open-501')!);
    await flush();
    await actClick(mounted.byTestId('facility-reservation-menu-501')!);
    await flush();
    await actClick(mounted.byTestId('facility-reservation-menu-edit-501')!);
    await flush();
    const titleInput = mounted.byTestId('facility-form-title') as HTMLInputElement;
    expect(titleInput.value).toBe('Leadership sync');
    await actSetValue(titleInput, 'Leadership sync (updated)');
    await actClick(mounted.byTestId('facility-form-submit')!);
    await flush();
    await actClick(mounted.byTestId('facility-operation-confirm')!); await flush();
    const reservations = await facilitiesGateway.reservations({ start: '2026-08-01T00:00:00.000', end: '2026-08-31T23:59:59.999' });
    expect(reservations.find((reservation) => reservation.id === '501')?.title).toBe('Leadership sync (updated)');
    mounted.unmount();
  });

  it('deletes a reservation through a confirmation dialog and the gateway', async () => {
    const facilitiesGateway = fixtureFacilitiesGateway();
    const mounted = mountFacilities({ facilities: facilitiesGateway });
    await flush();
    await actClick(mounted.byTestId('facility-reservation-open-502')!);
    await flush();
    await actClick(mounted.byTestId('facility-reservation-menu-502')!);
    await flush();
    await actClick(mounted.byTestId('facility-reservation-menu-delete-502')!);
    await flush();
    expect(mounted.byTestId('facility-reservation-delete-dialog')).toBeTruthy();
    await actClick(mounted.byTestId('facility-reservation-delete-confirm')!);
    await flush();
    await actClick(mounted.byTestId('facility-operation-confirm')!); await flush();
    const reservations = await facilitiesGateway.reservations({ start: '2026-08-01T00:00:00.000', end: '2026-08-31T23:59:59.999' });
    expect(reservations.some((reservation) => reservation.id === '502')).toBe(false);
    mounted.unmount();
  });

  it('deletes an entire recurring series (every occurrence sharing the seriesId) through the gateway', async () => {
    const facilitiesGateway = fixtureFacilitiesGateway();
    const mounted = mountFacilities({ facilities: facilitiesGateway });
    await flush();
    await actClick(mounted.byTestId('facility-reservation-open-503')!);
    await flush();
    await actClick(mounted.byTestId('facility-reservation-menu-503')!);
    await flush();
    await actClick(mounted.byTestId('facility-reservation-menu-delete-503')!);
    await flush();
    expect(mounted.byTestId('facility-series-delete-dialog')).toBeTruthy();
    await actClick(mounted.byTestId('facility-series-delete-confirm')!);
    await flush();
    await actClick(mounted.byTestId('facility-operation-confirm')!); await flush();
    const reservations = await facilitiesGateway.reservations({ start: '2026-08-01T00:00:00.000', end: '2026-08-31T23:59:59.999' });
    expect(reservations.some((reservation) => reservation.seriesId === 'series-choir-weekly')).toBe(false);
    mounted.unmount();
  });

  it('switches to Rooms mode and groups rooms by building with upcoming counts', async () => {
    const mounted = mountFacilities();
    await flush();
    await actClick(mounted.byTestId('facilities-mode-rooms')!);
    await flush();
    expect(mounted.byTestId('facility-building-main-campus')).toBeTruthy();
    expect(mounted.byTestId('facility-room-101')?.textContent).toContain('Sanctuary');
    mounted.unmount();
  });

  it('adds a new space through the editor dialog, validating the room name', async () => {
    const facilitiesGateway = fixtureFacilitiesGateway();
    const mounted = mountFacilities({ facilities: facilitiesGateway });
    await flush();
    await actClick(mounted.byTestId('facilities-mode-rooms')!);
    await flush();
    await actClick(mounted.byTestId('facility-add-space')!);
    await flush();
    await actClick(mounted.byTestId('facility-editor-submit')!);
    await flush();
    expect(mounted.byTestId('facility-editor-name-error')).toBeTruthy();
    await actSetValue(mounted.byTestId('facility-editor-name') as HTMLInputElement, 'Youth Room');
    await actClick(mounted.byTestId('facility-editor-submit')!);
    await flush();
    await actClick(mounted.byTestId('facility-operation-confirm')!); await flush();
    const facilities = await facilitiesGateway.facilities();
    expect(facilities.some((facility) => facility.name === 'Youth Room')).toBe(true);
    mounted.unmount();
  });

  it('edits a room from its inspector and persists through the gateway', async () => {
    const facilitiesGateway = fixtureFacilitiesGateway();
    const mounted = mountFacilities({ facilities: facilitiesGateway });
    await flush();
    await actClick(mounted.byTestId('facilities-mode-rooms')!);
    await flush();
    await actClick(mounted.byTestId('facility-room-open-101')!);
    await flush();
    await actClick(mounted.byTestId('facility-room-inspector-edit')!);
    await flush();
    await actSetValue(mounted.byTestId('facility-editor-description') as HTMLTextAreaElement, 'Updated description');
    await actClick(mounted.byTestId('facility-editor-submit')!);
    await flush();
    await actClick(mounted.byTestId('facility-operation-confirm')!); await flush();
    const facilities = await facilitiesGateway.facilities();
    expect(facilities.find((facility) => facility.id === '101')?.description).toBe('Updated description');
    mounted.unmount();
  });

  it('deletes a room through a confirmation dialog and removes its reservations from the schedule', async () => {
    const facilitiesGateway = fixtureFacilitiesGateway();
    const mounted = mountFacilities({ facilities: facilitiesGateway });
    await flush();
    await actClick(mounted.byTestId('facilities-mode-rooms')!);
    await flush();
    await actClick(mounted.byTestId('facility-room-open-103')!);
    await flush();
    await actClick(mounted.byTestId('facility-room-menu-103')!);
    await flush();
    await actClick(mounted.byTestId('facility-room-menu-delete-103')!);
    await flush();
    expect(mounted.byTestId('facility-delete-dialog')).toBeTruthy();
    await actClick(mounted.byTestId('facility-delete-confirm')!);
    await flush();
    await actClick(mounted.byTestId('facility-operation-confirm')!); await flush();
    const facilities = await facilitiesGateway.facilities();
    expect(facilities.some((facility) => facility.id === '103')).toBe(false);
    await actClick(mounted.byTestId('facilities-mode-overview')!);
    await flush();
    expect(mounted.byTestId('facility-reservation-506')).toBeNull();
    mounted.unmount();
  });

  it('previews and deletes automation-created reservations by room and date scope', async () => {
    const facilitiesGateway = fixtureFacilitiesGateway();
    const mounted = mountFacilities({ facilities: facilitiesGateway });
    await flush();
    await actClick(mounted.byTestId('facilities-mode-rooms')!);
    await flush();
    await actClick(mounted.byTestId('facility-automation-manage')!);
    await flush();
    expect(mounted.byTestId('facility-automation-total')?.textContent).toBe('3');
    await actSetValue(mounted.byTestId('facility-automation-room-filter') as HTMLSelectElement, '101');
    await flush();
    expect(mounted.byTestId('facility-automation-total')?.textContent).toBe('2');
    await actClick(mounted.byTestId('facility-automation-delete')!);
    await flush();
    await actClick(mounted.byTestId('facility-operation-confirm')!); await flush();
    const reservations = await facilitiesGateway.reservations({ start: '2026-08-01T00:00:00.000', end: '2026-08-31T23:59:59.999' });
    expect(reservations.some((reservation) => reservation.id === 'auto-1' || reservation.id === 'auto-2')).toBe(false);
    expect(reservations.some((reservation) => reservation.id === 'auto-3')).toBe(true);
    mounted.unmount();
  });
});
