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
    { id: 'auto-1', facilityId: '101', title: 'Sanctuary reset', requesterName: 'Automation', creatorId: 'automation', start: '2026-08-13T08:00:00-07:00', end: '2026-08-13T08:30:00-07:00', notes: null, automation: true },
  ];
}

export function fixtureFacilitiesGateway(): FacilitiesGateway {
  const facilities = seedFacilities();
  let reservations = seedReservations();
  return {
    facilities: async () => facilities,
    reservations: async ({ start, end }) => reservations.filter((reservation) => reservation.start >= start && reservation.start <= end || true),
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
  };
}

export function failingFacilitiesGateway(kind: 'forbidden' | 'not_found' | 'unavailable' | 'server_error'): FacilitiesGateway {
  const fail = async (): Promise<never> => { throw new RhythmGatewayError(kind, `simulated ${kind}`); };
  return { facilities: fail, reservations: fail, createReservation: fail, updateReservation: fail, deleteReservation: fail };
}

export function emptyFacilitiesGateway(): FacilitiesGateway {
  const gateway = fixtureFacilitiesGateway();
  return { ...gateway, facilities: async () => [], reservations: async () => [] };
}
