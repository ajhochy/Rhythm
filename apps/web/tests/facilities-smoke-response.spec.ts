import { expect, test } from '@playwright/test';
import { reservationIdFromCreateResponse } from './helpers/facilities-smoke-response';

test.describe('Facilities live-smoke response parsing', () => {
  const expected = { facilityId: 26, title: 'MEGA-SMOKE-RESERVATION' };

  test('uses the sole matching reservation from an explicit-facility group response', () => {
    expect(reservationIdFromCreateResponse({
      group: { id: 'group-1' },
      reservations: [{ id: 488, facilityId: 26, title: expected.title }],
      conflicts: [],
    }, expected)).toBe('488');
  });

  test('rejects a grouped reservation response without a usable reservation id', () => {
    expect(() => reservationIdFromCreateResponse({
      group: { id: 'group-1' },
      reservations: [{ facilityId: 26, title: expected.title }],
      conflicts: [],
    }, expected)).toThrow(/stable id/i);
  });

  test('rejects groups that do not contain exactly the requested reservation', () => {
    expect(() => reservationIdFromCreateResponse({
      group: { id: 'group-1' },
      reservations: [
        { id: 488, facilityId: 26, title: expected.title },
        { id: 489, facilityId: 26, title: expected.title },
      ],
      conflicts: [],
    }, expected)).toThrow(/exactly one reservation/i);
    expect(() => reservationIdFromCreateResponse({
      group: { id: 'group-1' },
      reservations: [{ id: 488, facilityId: 99, title: expected.title }],
      conflicts: [],
    }, expected)).toThrow(/requested facility/i);
  });
});
