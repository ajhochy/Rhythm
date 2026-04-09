export interface Facility {
  id: number;
  name: string;
  description: string | null;
  capacity: number | null;
  location: string | null;
  building: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFacilityDto {
  name: string;
  description?: string | null;
  capacity?: number | null;
  location?: string | null;
  building?: string | null;
}

export interface UpdateFacilityDto {
  name?: string;
  description?: string | null;
  capacity?: number | null;
  location?: string | null;
  building?: string | null;
}

export interface Reservation {
  id: number;
  facilityId: number;
  seriesId: string | null;
  title: string;
  requesterName: string;
  requesterUserId: number | null;
  createdByName: string | null;
  createdByUserId: number | null;
  startTime: string;
  endTime: string;
  notes: string | null;
  externalEventId: string | null;
  externalSource: string | null;
  createdByRhythm: boolean;
  isConflicted: boolean;
  conflictReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationSeries {
  id: string;
  facilityId: number;
  title: string;
  requesterName: string;
  requesterUserId: number | null;
  createdByUserId: number | null;
  notes: string | null;
  recurrenceType: 'weekly' | 'biweekly' | 'monthly' | 'custom';
  recurrenceInterval: number | null;
  weekdayPattern: {
    weekday: number;
    weekOfMonth: number;
    isLastWeek: boolean;
  } | null;
  customDates: string[];
  startDate: string;
  endDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReservationDto {
  title: string;
  series_id?: string | null;
  requester_name: string;
  requester_user_id?: number | null;
  created_by_user_id?: number | null;
  start_time: string;
  end_time: string;
  notes?: string | null;
}

export interface UpdateReservationDto {
  title?: string;
  requester_name?: string;
  requester_user_id?: number | null;
  start_time?: string;
  end_time?: string;
  notes?: string | null;
  external_event_id?: string | null;
  external_source?: string | null;
  created_by_rhythm?: boolean;
  is_conflicted?: boolean;
  conflict_reason?: string | null;
}

export interface CreateReservationSeriesDto {
  facility_id: number;
  title: string;
  requester_name: string;
  requester_user_id?: number | null;
  created_by_user_id?: number | null;
  notes?: string | null;
  recurrence_type: ReservationSeries['recurrenceType'];
  recurrence_interval?: number | null;
  weekday_pattern?: ReservationSeries['weekdayPattern'];
  custom_dates?: string[] | null;
  start_time: string;
  end_time: string;
  start_date: string;
  end_date?: string | null;
}

export interface ReservationSeriesConflict {
  date: string;
  reason: string;
}

export interface CreateReservationSeriesResult {
  series: ReservationSeries;
  createdReservations: Reservation[];
  conflicts: ReservationSeriesConflict[];
}

export interface ReservationSeriesDetail {
  series: ReservationSeries;
  reservations: Reservation[];
}

export interface UpdateReservationSeriesDto {
  title?: string;
  requester_name?: string;
  requester_user_id?: number | null;
  notes?: string | null;
  recurrence_type?: ReservationSeries['recurrenceType'];
  recurrence_interval?: number | null;
  weekday_pattern?: ReservationSeries['weekdayPattern'];
  custom_dates?: string[] | null;
  start_time?: string;
  end_time?: string;
  start_date?: string;
  end_date?: string | null;
}
