import type { FacilitiesGateway, RhythmFacility, RhythmReservation } from '../../../src/domain/types';
import { RhythmGatewayError } from '../../../src/domain/types';

function seedFacilities(): RhythmFacility[] {
  return [
    { id: '101', name: 'Sanctuary', building: 'Main Campus', description: 'Primary worship room with flexible platform seating.' },
    { id: '102', name: 'Fellowship Hall', building: 'Main Campus', description: 'Open gathering room for meals, teams, and community events.' },
    { id: '103', name: 'Prayer Room', building: 'North Campus', description: 'Quiet room for prayer and small-group conversation.' },
  ];
}

function seedReservations(): RhythmReservation[] {
  return [
    { id: '501', facilityId: '101', title: 'Leadership sync', requesterName: 'AJ Hochhalter', creatorId: 'user-aj', start: '2026-08-12T10:00:00-07:00', end: '2026-08-12T11:00:00-07:00', notes: 'Bring the ministry scorecard.' },
    { id: '502', facilityId: '101', title: 'Vendor load-in', requesterName: 'Morgan Lee', creatorId: 'user-morgan', start: '2026-08-12T10:30:00-07:00', end: '2026-08-12T11:30:00-07:00', notes: null, external: true, conflicted: true },
    { id: '503', facilityId: '101', title: 'Choir rehearsal', requesterName: 'AJ Hochhalter', creatorId: 'user-aj', start: '2026-08-12T18:30:00-07:00', end: '2026-08-12T20:00:00-07:00', notes: 'Piano and standing microphones.', seriesId: 'series-choir-weekly' },
    { id: '503-next', facilityId: '101', title: 'Choir rehearsal', requesterName: 'AJ Hochhalter', creatorId: 'user-aj', start: '2026-08-19T18:30:00-07:00', end: '2026-08-19T20:00:00-07:00', notes: 'Piano and standing microphones.', seriesId: 'series-choir-weekly' },
    { id: '505', facilityId: '102', title: 'Community meal setup', requesterName: 'Riley Chen', creatorId: 'user-riley', start: '2026-08-13T16:00:00-07:00', end: '2026-08-13T18:00:00-07:00', notes: 'Set eight round tables.' },
    { id: '506', facilityId: '103', title: 'Pastoral care hour', requesterName: 'AJ Hochhalter', creatorId: 'user-aj', start: '2026-08-15T09:00:00-07:00', end: '2026-08-15T10:00:00-07:00', notes: null },
    { id: 'auto-1', facilityId: '101', title: 'Sanctuary reset', requesterName: 'Automation', creatorId: 'automation', start: '2026-08-13T08:00:00-07:00', end: '2026-08-13T08:30:00-07:00', notes: null, automation: true },
    { id: 'auto-2', facilityId: '101', title: 'Sunday lighting check', requesterName: 'Automation', creatorId: 'automation', start: '2026-08-20T08:00:00-07:00', end: '2026-08-20T08:30:00-07:00', notes: null, automation: true },
    { id: 'auto-3', facilityId: '102', title: 'Meal room reset', requesterName: 'Automation', creatorId: 'automation', start: '2026-08-22T08:00:00-07:00', end: '2026-08-22T08:30:00-07:00', notes: null, automation: true },
  ];
}

export function fixtureFacilitiesGateway(): FacilitiesGateway {
  let facilities = seedFacilities();
  let reservations = seedReservations();
  return {
    facilities: async () => facilities,
    createFacility: async (input) => {
      const created: RhythmFacility = { id: `facility-${facilities.length + 1}`, building: null, description: '', ...input };
      facilities = [...facilities, created];
      return created;
    },
    updateFacility: async (id, input) => {
      const existing = facilities.find((facility) => facility.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown facility ${id}`);
      const updated = { ...existing, ...input };
      facilities = facilities.map((facility) => (facility.id === id ? updated : facility));
      return updated;
    },
    deleteFacility: async (id) => {
      facilities = facilities.filter((facility) => facility.id !== id);
      reservations = reservations.filter((reservation) => reservation.facilityId !== id);
    },
    // Every call returns the full seeded set regardless of the requested range: this fixture
    // has no real backend to scope against, and the screen already re-filters client-side by
    // the active range/building/room before rendering (see FacilitiesScreen.tsx).
    reservations: async () => reservations,
    createReservation: async (input) => {
      const created: RhythmReservation = { id: `res-${reservations.length + 1}`, requesterName: 'AJ Hochhalter', creatorId: 'user-aj', notes: null, ...input };
      reservations = [...reservations, created];
      return created;
    },
    updateReservation: async (id, input) => {
      const existing = reservations.find((reservation) => reservation.id === id);
      if (!existing) throw new RhythmGatewayError('not_found', `unknown reservation ${id}`);
      const updated = { ...existing, ...input };
      reservations = reservations.map((reservation) => (reservation.id === id ? updated : reservation));
      return updated;
    },
    deleteReservation: async (id) => {
      reservations = reservations.filter((reservation) => reservation.id !== id);
    },
    updateGroup: async (groupId, input) => {
      const updated = reservations.filter((reservation) => reservation.groupId === groupId).map((reservation) => ({ ...reservation, ...input }));
      reservations = reservations.map((reservation) => updated.find((item) => item.id === reservation.id) ?? reservation);
      return updated;
    },
    deleteGroup: async (groupId) => {
      const deletedCount = reservations.filter((reservation) => reservation.groupId === groupId).length;
      reservations = reservations.filter((reservation) => reservation.groupId !== groupId);
      return { deletedCount };
    },
    deleteSeries: async (seriesId) => {
      const deletedCount = reservations.filter((reservation) => reservation.seriesId === seriesId).length;
      reservations = reservations.filter((reservation) => reservation.seriesId !== seriesId);
      return { deletedCount };
    },
  };
}

export function failingFacilitiesGateway(kind: 'forbidden' | 'not_found' | 'unavailable' | 'server_error'): FacilitiesGateway {
  const fail = async (): Promise<never> => { throw new RhythmGatewayError(kind, `simulated ${kind}`); };
  return { facilities: fail, createFacility: fail, updateFacility: fail, deleteFacility: fail, reservations: fail, createReservation: fail, updateReservation: fail, deleteReservation: fail, updateGroup: fail, deleteGroup: fail, deleteSeries: fail };
}

export function emptyFacilitiesGateway(): FacilitiesGateway {
  const gateway = fixtureFacilitiesGateway();
  return { ...gateway, facilities: async () => [], reservations: async () => [] };
}
