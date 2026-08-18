export type Facility = {
  id: string;
  name: string;
  building: string | null;
  description: string;
};

export type Reservation = {
  id: string;
  facilityId: string;
  title: string;
  requesterName: string;
  creatorId: string;
  start: string;
  end: string;
  notes: string | null;
  groupId?: string;
  seriesId?: string;
  external?: boolean;
  conflicted?: boolean;
  automation?: boolean;
};

export const currentFacilityUser = {
  id: 'user-aj',
  name: 'AJ Hochhalter',
  isFacilitiesManager: true,
} as const;

export const seededFacilities: Facility[] = [
  { id: '101', name: 'Sanctuary', building: 'Main Campus', description: 'Primary worship room with flexible platform seating.' },
  { id: '102', name: 'Fellowship Hall', building: 'Main Campus', description: 'Open gathering room for meals, teams, and community events.' },
  { id: '103', name: 'Prayer Room', building: 'North Campus', description: 'Quiet room for prayer, care, and small-group conversation.' },
  { id: '104', name: '礼拝チーム室 🎵', building: null, description: '多言語の礼拝チームのための長い名前と絵文字を含む共有スペース。' },
];

export const seededReservations: Reservation[] = [
  {
    id: '501', facilityId: '101', title: 'Leadership sync', requesterName: 'AJ Hochhalter', creatorId: 'user-aj',
    start: '2026-08-12T10:00:00-07:00', end: '2026-08-12T11:00:00-07:00', notes: 'Bring the ministry scorecard and revised agenda.',
  },
  {
    id: '502', facilityId: '101', title: 'Vendor load-in', requesterName: 'Morgan Lee', creatorId: 'user-morgan',
    start: '2026-08-12T10:30:00-07:00', end: '2026-08-12T11:30:00-07:00', notes: null, external: true, conflicted: true,
  },
  {
    id: '503', facilityId: '101', title: 'Choir rehearsal', requesterName: 'AJ Hochhalter', creatorId: 'user-aj',
    start: '2026-08-12T18:30:00-07:00', end: '2026-08-12T20:00:00-07:00', notes: 'Piano and standing microphones.', seriesId: 'series-choir-weekly',
  },
  {
    id: '503-next', facilityId: '101', title: 'Choir rehearsal', requesterName: 'AJ Hochhalter', creatorId: 'user-aj',
    start: '2026-08-19T18:30:00-07:00', end: '2026-08-19T20:00:00-07:00', notes: 'Piano and standing microphones.', seriesId: 'series-choir-weekly',
  },
  {
    id: '504', facilityId: '101', title: 'Weekend team huddle', requesterName: 'AJ Hochhalter', creatorId: 'user-aj',
    start: '2026-08-14T15:00:00-07:00', end: '2026-08-14T16:00:00-07:00', notes: 'Confirm livestream fallback owner.', groupId: 'group-weekend-team',
  },
  {
    id: '504-room-102', facilityId: '102', title: 'Weekend team huddle', requesterName: 'AJ Hochhalter', creatorId: 'user-aj',
    start: '2026-08-14T15:00:00-07:00', end: '2026-08-14T16:00:00-07:00', notes: 'Confirm livestream fallback owner.', groupId: 'group-weekend-team',
  },
  {
    id: '505', facilityId: '102', title: 'Community meal setup', requesterName: 'Riley Chen', creatorId: 'user-riley',
    start: '2026-08-13T16:00:00-07:00', end: '2026-08-13T18:00:00-07:00', notes: 'Set eight round tables and leave the west aisle clear.',
  },
  {
    id: '506', facilityId: '103', title: 'Pastoral care hour', requesterName: 'AJ Hochhalter', creatorId: 'user-aj',
    start: '2026-08-15T09:00:00-07:00', end: '2026-08-15T10:00:00-07:00', notes: null,
  },
  {
    id: '508', facilityId: '101', title: 'Worship planning review', requesterName: 'AJ Hochhalter', creatorId: 'user-aj',
    start: '2026-08-13T14:00:00-07:00', end: '2026-08-13T15:00:00-07:00', notes: null,
  },
  { id: 'auto-1', facilityId: '101', title: 'Sanctuary reset', requesterName: 'Automation', creatorId: 'automation', start: '2026-08-13T08:00:00-07:00', end: '2026-08-13T08:30:00-07:00', notes: null, automation: true },
  { id: 'auto-2', facilityId: '101', title: 'Sunday lighting check', requesterName: 'Automation', creatorId: 'automation', start: '2026-08-20T08:00:00-07:00', end: '2026-08-20T08:30:00-07:00', notes: null, automation: true },
  { id: 'auto-3', facilityId: '101', title: 'Platform preparation', requesterName: 'Automation', creatorId: 'automation', start: '2026-09-03T08:00:00-07:00', end: '2026-09-03T08:30:00-07:00', notes: null, automation: true },
  { id: 'auto-4', facilityId: '102', title: 'Meal room reset', requesterName: 'Automation', creatorId: 'automation', start: '2026-08-22T08:00:00-07:00', end: '2026-08-22T08:30:00-07:00', notes: null, automation: true },
];

export const initialFacilityReceipts = [
  'GET /facilities → 200',
  ...seededFacilities.flatMap((facility) => [
    `GET /facilities/${facility.id}/reservations → 200`,
    `GET /facilities/${facility.id}/reservation-series → 200`,
  ]),
  'GET /facilities/reservations?start=2026-08-10T00:00:00.000&end=2026-08-16T23:59:59.999 → 200',
];

export function cloneSeededFacilities() {
  return structuredClone(seededFacilities) as Facility[];
}

export function cloneSeededReservations() {
  return structuredClone(seededReservations) as Reservation[];
}
