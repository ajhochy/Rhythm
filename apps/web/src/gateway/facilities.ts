import type { GatewayMode } from '.';

export interface Facility { id: number; name: string; description: string | null; capacity: number | null; location: string | null; building: string | null; createdAt: string; updatedAt: string }
export interface Reservation { id: number; facilityId: number; seriesId: string | null; groupId: string | null; title: string; requesterName: string; requesterUserId: number | null; createdByName: string | null; createdByUserId: number | null; startTime: string; endTime: string; notes: string | null; externalEventId: string | null; externalSource: string | null; createdByRhythm: boolean; isConflicted: boolean; conflictReason: string | null; createdAt: string; updatedAt: string }
export interface ReservationGroup { id: string; seriesId: string | null; title: string; requesterName: string; requesterUserId: number | null; createdByUserId: number | null; notes: string | null; startTime: string; endTime: string; occurrenceDate: string | null; createdAt: string; updatedAt: string }
export interface ReservationGroupConflict { facilityId: number; facilityName: string; reason: string }
export interface ReservationGroupResult { group: ReservationGroup; reservations: Reservation[]; conflicts: ReservationGroupConflict[] }
export interface ReservationGroupOverview { group: ReservationGroup; reservations: Reservation[]; facilities: Facility[]; conflictCount: number }
export type RecurrenceType = 'weekly' | 'biweekly' | 'monthly' | 'custom';
export interface WeekdayPattern { weekday: number; weekOfMonth: number; isLastWeek: boolean }
export interface ReservationSeries { id: string; facilityId: number; title: string; requesterName: string; requesterUserId: number | null; createdByUserId: number | null; notes: string | null; recurrenceType: RecurrenceType; recurrenceInterval: number | null; weekdayPattern: WeekdayPattern | null; customDates: string[]; startDate: string; endDate: string | null; createdAt: string; updatedAt: string }
export interface ReservationSeriesDetail { series: ReservationSeries; reservations: Reservation[] }
export interface ReservationSeriesConflict { date: string; facilityId?: number; facilityName?: string; reason: string }
export interface CreateReservationSeriesResult { series: ReservationSeries; createdGroups: ReservationGroup[]; createdReservations: Reservation[]; conflicts: ReservationSeriesConflict[] }
export interface CreateFacilityInput { name: string; description?: string | null; capacity?: number | null; location?: string | null; building?: string | null }
export type UpdateFacilityInput = Partial<CreateFacilityInput>;
export interface CreateReservationInput { title: string; series_id?: string | null; group_id?: string | null; requester_name: string; requester_user_id?: number | null; created_by_user_id?: number | null; start_time: string; end_time: string; notes?: string | null; facility_ids?: number[] | null }
export interface UpdateReservationInput { title?: string; requester_name?: string; requester_user_id?: number | null; start_time?: string; end_time?: string; notes?: string | null; facility_ids?: number[] | null; external_event_id?: string | null; external_source?: string | null; created_by_rhythm?: boolean; is_conflicted?: boolean; conflict_reason?: string | null }
export interface CreateReservationSeriesInput { facility_id: number; facility_ids?: number[] | null; title: string; requester_name: string; requester_user_id?: number | null; created_by_user_id?: number | null; notes?: string | null; recurrence_type: RecurrenceType; recurrence_interval?: number | null; weekday_pattern?: WeekdayPattern | null; custom_dates?: string[] | null; start_time: string; end_time: string; start_date: string; end_date?: string | null }
export type UpdateReservationSeriesInput = Partial<Omit<CreateReservationSeriesInput, 'facility_id'>>;
export interface ReservationFilters { facilityId?: number; start?: string; end?: string; building?: string }
export interface AutomationReservationFilters { facilityId?: number; startAfter?: string; endBefore?: string }

export interface FacilitiesGateway {
  readonly mode: GatewayMode;
  facilities(): Promise<Facility[]>;
  createFacility(input: CreateFacilityInput): Promise<Facility>;
  updateFacility(id: number, input: UpdateFacilityInput): Promise<Facility>;
  deleteFacility(id: number): Promise<void>;
  reservations(filters?: ReservationFilters): Promise<Reservation[]>;
  reservationGroups(filters?: ReservationFilters): Promise<ReservationGroupOverview[]>;
  facilityReservations(facilityId: number): Promise<Reservation[]>;
  createReservation(facilityId: number, input: CreateReservationInput): Promise<Reservation | ReservationGroupResult>;
  updateReservation(facilityId: number, reservationId: number, input: UpdateReservationInput): Promise<Reservation | ReservationGroupResult>;
  deleteReservation(facilityId: number, reservationId: number): Promise<void>;
  reservationSeries(facilityId: number): Promise<ReservationSeries[]>;
  reservationSeriesDetail(facilityId: number, seriesId: string): Promise<ReservationSeriesDetail>;
  createReservationSeries(facilityId: number, input: CreateReservationSeriesInput): Promise<CreateReservationSeriesResult>;
  updateReservationSeries(facilityId: number, seriesId: string, input: UpdateReservationSeriesInput): Promise<CreateReservationSeriesResult>;
  deleteReservationSeries(facilityId: number, seriesId: string): Promise<void>;
  previewAutomationReservations(filters?: AutomationReservationFilters): Promise<unknown>;
  deleteAutomationReservations(filters?: AutomationReservationFilters): Promise<unknown>;
}

export class FacilitiesGatewayError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const failureText = (status: number, operation: string) => ({ 0: 'Facilities service unavailable', 401: 'Authentication required', 403: 'Forbidden', 404: 'Facility record not found' })[status] ?? `${operation} failed (${status})`;
async function response<T>(operation: string, pending: Promise<Response>): Promise<T> { try { const result = await pending; if (!result.ok) throw new FacilitiesGatewayError(result.status, failureText(result.status, operation)); return result.status === 204 ? undefined as T : await result.json() as T; } catch (error) { if (error instanceof FacilitiesGatewayError) throw error; throw new FacilitiesGatewayError(0, failureText(0, operation)); } }
function query(values: Record<string, string | number | boolean | undefined>): string { const params = new URLSearchParams(); for (const [key, value] of Object.entries(values)) if (value !== undefined) params.set(key, String(value)); const encoded = params.toString(); return encoded ? `?${encoded}` : ''; }

export function createFixtureFacilitiesGateway(_fetcher?: typeof fetch): FacilitiesGateway {
  const unsupported = async (..._args: unknown[]): Promise<never> => { throw new FacilitiesGatewayError(0, 'Fixture facilities gateway is unsupported'); };
  return { mode: 'fixture', facilities: unsupported, createFacility: unsupported, updateFacility: unsupported, deleteFacility: unsupported, reservations: unsupported, reservationGroups: unsupported, facilityReservations: unsupported, createReservation: unsupported, updateReservation: unsupported, deleteReservation: unsupported, reservationSeries: unsupported, reservationSeriesDetail: unsupported, createReservationSeries: unsupported, updateReservationSeries: unsupported, deleteReservationSeries: unsupported, previewAutomationReservations: unsupported, deleteAutomationReservations: unsupported };
}

export function createLiveFacilitiesGateway(apiBase: string, token: string | undefined, fetcher: typeof fetch = fetch): FacilitiesGateway {
  if (!token?.trim()) throw new Error('Live configuration error: an explicit facilities token is required');
  const request = (path: string, init: RequestInit = {}) => fetcher(`${apiBase}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } });
  const json = (value: unknown) => JSON.stringify(value);
  const reservationQuery = (filters: ReservationFilters = {}, grouped = false) => query({ ...filters, grouped: grouped || undefined });
  const automationQuery = (filters: AutomationReservationFilters = {}) => query({ facilityId: filters.facilityId, startAfter: filters.startAfter, endBefore: filters.endBefore });
  return {
    mode: 'live',
    // apps/api_server/src/routes/facilities_routes.ts:9,14,25-26
    facilities: () => response<Facility[]>('Load facilities', request('/facilities')),
    createFacility: (input) => response<Facility>('Create facility', request('/facilities', { method: 'POST', body: json(input) })),
    updateFacility: (id, input) => response<Facility>('Update facility', request(`/facilities/${encodeURIComponent(id)}`, { method: 'PATCH', body: json(input) })),
    deleteFacility: (id) => response<void>('Delete facility', request(`/facilities/${encodeURIComponent(id)}`, { method: 'DELETE' })),
    // apps/api_server/src/routes/facilities_routes.ts:10-13,27
    reservations: (filters) => response<Reservation[]>('Load reservations', request(`/facilities/reservations${reservationQuery(filters)}`)),
    reservationGroups: (filters) => response<ReservationGroupOverview[]>('Load reservation groups', request(`/facilities/reservations${reservationQuery(filters, true)}`)),
    facilityReservations: (facilityId) => response<Reservation[]>('Load facility reservations', request(`/facilities/${encodeURIComponent(facilityId)}/reservations`)),
    // apps/api_server/src/routes/facilities_routes.ts:36,49-55
    createReservation: (facilityId, input) => response<Reservation | ReservationGroupResult>('Create reservation', request(`/facilities/${encodeURIComponent(facilityId)}/reservations`, { method: 'POST', body: json(input) })),
    updateReservation: (facilityId, reservationId, input) => response<Reservation | ReservationGroupResult>('Update reservation', request(`/facilities/${encodeURIComponent(facilityId)}/reservations/${encodeURIComponent(reservationId)}`, { method: 'PATCH', body: json(input) })),
    deleteReservation: (facilityId, reservationId) => response<void>('Delete reservation', request(`/facilities/${encodeURIComponent(facilityId)}/reservations/${encodeURIComponent(reservationId)}`, { method: 'DELETE' })),
    // apps/api_server/src/routes/facilities_routes.ts:28-47
    reservationSeries: (facilityId) => response<ReservationSeries[]>('Load reservation series', request(`/facilities/${encodeURIComponent(facilityId)}/reservation-series`)),
    reservationSeriesDetail: (facilityId, seriesId) => response<ReservationSeriesDetail>('Load reservation series', request(`/facilities/${encodeURIComponent(facilityId)}/reservation-series/${encodeURIComponent(seriesId)}`)),
    createReservationSeries: (facilityId, input) => response<CreateReservationSeriesResult>('Create reservation series', request(`/facilities/${encodeURIComponent(facilityId)}/reservation-series`, { method: 'POST', body: json(input) })),
    updateReservationSeries: (facilityId, seriesId, input) => response<CreateReservationSeriesResult>('Update reservation series', request(`/facilities/${encodeURIComponent(facilityId)}/reservation-series/${encodeURIComponent(seriesId)}`, { method: 'PATCH', body: json(input) })),
    deleteReservationSeries: (facilityId, seriesId) => response<void>('Delete reservation series', request(`/facilities/${encodeURIComponent(facilityId)}/reservation-series/${encodeURIComponent(seriesId)}`, { method: 'DELETE' })),
    // apps/api_server/src/routes/facilities_routes.ts:17-24
    previewAutomationReservations: (filters) => response<unknown>('Preview automation reservations', request(`/facilities/automation-reservations/preview${automationQuery(filters)}`)),
    deleteAutomationReservations: (filters) => response<unknown>('Delete automation reservations', request(`/facilities/automation-reservations${automationQuery(filters)}`, { method: 'DELETE' })),
  };
}
