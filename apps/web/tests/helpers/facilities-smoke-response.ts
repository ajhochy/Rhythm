type JsonRow = Record<string, unknown>;

type ExpectedReservation = {
  facilityId: string | number;
  title: string;
};

function asRow(value: unknown, label: string): JsonRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRow;
}

export function stableResponseId(value: unknown, label: string): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`${label} must have a stable id`);
  }
  const id = String(value).trim();
  if (!id || id === 'undefined' || id === 'null') {
    throw new Error(`${label} must have a stable id`);
  }
  return id;
}

export function reservationIdFromCreateResponse(body: unknown, expected: ExpectedReservation): string {
  const response = asRow(body, 'reservation create response');
  const reservations = 'reservations' in response
    ? response.reservations
    : [response];
  if (!Array.isArray(reservations) || reservations.length !== 1) {
    throw new Error('reservation create response must contain exactly one reservation');
  }
  const reservation = asRow(reservations[0], 'created reservation');
  const facilityId = reservation.facilityId ?? reservation.facility_id;
  if (String(facilityId) !== String(expected.facilityId)) {
    throw new Error('created reservation must belong to the requested facility');
  }
  if (reservation.title !== expected.title) {
    throw new Error('created reservation must retain the marked title');
  }
  return stableResponseId(reservation.id ?? reservation.reservationId, 'created reservation');
}
