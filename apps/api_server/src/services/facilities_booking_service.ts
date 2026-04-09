import { getDb } from '../database/db';
import { AppError } from '../errors/app_error';
import type {
  CreateReservationSeriesDto,
  CreateReservationSeriesResult,
  ReservationGroup,
  Reservation,
  ReservationSeries,
  ReservationSeriesDetail,
  ReservationSeriesConflict,
  UpdateReservationSeriesDto,
} from '../models/facility';
import { FacilitiesRepository } from '../repositories/facilities_repository';

type ResolvedSeriesInput = {
  title: string;
  requesterName: string;
  requesterUserId: number | null;
  createdByUserId: number | null;
  notes: string | null;
  recurrenceType: ReservationSeries['recurrenceType'];
  recurrenceInterval: number | null;
  weekdayPattern: ReservationSeries['weekdayPattern'];
  customDates: string[];
  startDate: string;
  endDate: string | null;
};

type ResolvedSeriesFacilities = {
  anchorFacilityId: number;
  facilityIds: number[];
};

export class FacilitiesBookingService {
  private readonly repo = new FacilitiesRepository();

  createRecurringSeries(
    data: CreateReservationSeriesDto,
  ): CreateReservationSeriesResult {
    const start = this.parseTime(data.start_time, 'start_time');
    const end = this.parseTime(data.end_time, 'end_time');
    this.assertValidTimeRange(start, end);
    const facilities = this.resolveSeriesFacilities(
      data.facility_ids,
      data.facility_id,
    );

    const resolved = this.resolveSeriesInput(data, {
      title: data.title,
      requesterName: data.requester_name,
      requesterUserId: data.requester_user_id ?? null,
      createdByUserId: data.created_by_user_id ?? null,
      notes: data.notes ?? null,
      recurrenceType: data.recurrence_type,
      recurrenceInterval:
        data.recurrence_interval ?? (data.recurrence_type === 'biweekly' ? 1 : null),
      weekdayPattern: data.weekday_pattern ?? null,
      customDates: data.custom_dates ?? [],
      startDate: data.start_date,
      endDate: data.end_date ?? null,
    });

    const series = this.repo.createReservationSeries({
      facility_id: facilities.anchorFacilityId,
      title: resolved.title,
      requester_name: resolved.requesterName,
      requester_user_id: resolved.requesterUserId,
      created_by_user_id: resolved.createdByUserId,
      notes: resolved.notes,
      recurrence_type: resolved.recurrenceType,
      recurrence_interval: resolved.recurrenceInterval,
      weekday_pattern: resolved.weekdayPattern,
      custom_dates: resolved.customDates,
      start_time: data.start_time,
      end_time: data.end_time,
      start_date: resolved.startDate,
      end_date: resolved.endDate,
    });

    return this.materializeSeries(series, start, end, facilities.facilityIds);
  }

  getReservationSeries(seriesId: string): ReservationSeriesDetail {
    return this.repo.findReservationSeriesDetailById(seriesId);
  }

  updateRecurringSeries(
    seriesId: string,
    data: UpdateReservationSeriesDto,
  ): CreateReservationSeriesResult {
    const existingSeries = this.repo.findReservationSeriesById(seriesId);
    const existingReservations = this.repo.findReservationsBySeriesId(seriesId);
    const facilities = this.resolveSeriesFacilities(
      data.facility_ids,
      this.resolveExistingSeriesFacilityId(existingReservations, existingSeries.facilityId),
    );

    const start =
      data.start_time != null
        ? this.parseTime(data.start_time, 'start_time')
        : existingReservations[0]
          ? this.parseTime(existingReservations[0].startTime, 'start_time')
          : null;
    const end =
      data.end_time != null
        ? this.parseTime(data.end_time, 'end_time')
        : existingReservations[0]
          ? this.parseTime(existingReservations[0].endTime, 'end_time')
          : null;
    if (!start || !end) {
      throw AppError.badRequest(
        'start_time and end_time are required to update a recurring series',
      );
    }
    this.assertValidTimeRange(start, end);

    const resolved = this.resolveSeriesInput(data, {
      title: data.title ?? existingSeries.title,
      requesterName: data.requester_name ?? existingSeries.requesterName,
      requesterUserId:
        data.requester_user_id !== undefined
          ? data.requester_user_id
          : existingSeries.requesterUserId,
      createdByUserId: existingSeries.createdByUserId,
      notes: data.notes !== undefined ? data.notes : existingSeries.notes,
      recurrenceType: data.recurrence_type ?? existingSeries.recurrenceType,
      recurrenceInterval:
        data.recurrence_interval !== undefined
          ? data.recurrence_interval
          : existingSeries.recurrenceInterval,
      weekdayPattern:
        data.weekday_pattern !== undefined
          ? data.weekday_pattern
          : existingSeries.weekdayPattern,
      customDates:
        data.custom_dates !== undefined
          ? data.custom_dates ?? []
          : existingSeries.customDates,
      startDate: data.start_date ?? existingSeries.startDate,
      endDate: data.end_date !== undefined ? data.end_date : existingSeries.endDate,
    });

    let updatedSeries = existingSeries;
    let createdReservations: Reservation[] = [];
    let createdGroups: ReservationGroup[] = [];
    let conflicts: ReservationSeriesConflict[] = [];

    getDb().transaction(() => {
      updatedSeries = this.repo.updateReservationSeries(seriesId, {
        title: resolved.title,
        requester_name: resolved.requesterName,
        requester_user_id: resolved.requesterUserId,
        created_by_user_id: resolved.createdByUserId,
        notes: resolved.notes,
        recurrence_type: resolved.recurrenceType,
        recurrence_interval: resolved.recurrenceInterval,
        weekday_pattern: resolved.weekdayPattern,
        custom_dates: resolved.customDates,
        start_date: resolved.startDate,
        end_date: resolved.endDate,
      });
      this.repo.deleteReservationGroupsBySeriesId(seriesId);
      const materialized = this.materializeSeries(
        updatedSeries,
        start,
        end,
        facilities.facilityIds,
      );
      createdReservations = materialized.createdReservations;
      createdGroups = materialized.createdGroups;
      conflicts = materialized.conflicts;
    })();

    return {
      series: updatedSeries,
      createdGroups,
      createdReservations,
      conflicts,
    };
  }

  deleteRecurringSeries(seriesId: string): {
    series: ReservationSeries;
    deletedReservations: Reservation[];
  } {
    let deletedSeries = this.repo.findReservationSeriesById(seriesId);
    let deletedReservations: Reservation[] = this.repo.findReservationsBySeriesId(seriesId);

    getDb().transaction(() => {
      deletedSeries = this.repo.deleteReservationSeriesById(seriesId);
    })();

    return {
      series: deletedSeries,
      deletedReservations,
    };
  }

  private materializeSeries(
    series: ReservationSeries,
    start: Date,
    end: Date,
    facilityIds: number[],
  ): CreateReservationSeriesResult {
    const occurrenceDates = this.computeSeriesDates(series);
    const createdReservations: Reservation[] = [];
    const createdGroups: ReservationGroup[] = [];
    const conflicts: ReservationSeriesConflict[] = [];
    const durationMs = end.getTime() - start.getTime();

    for (const date of occurrenceDates) {
      const occurrenceStart = applyUtcDate(start, date);
      const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
      try {
        const result = this.repo.createReservationGroup({
          facility_ids: facilityIds,
          title: series.title,
          series_id: series.id,
          requester_name: series.requesterName,
          requester_user_id: series.requesterUserId,
          created_by_user_id: series.createdByUserId,
          start_time: occurrenceStart.toISOString(),
          end_time: occurrenceEnd.toISOString(),
          notes: series.notes,
          occurrence_date: toDateOnly(date),
        });
        createdGroups.push(result.group);
        createdReservations.push(...result.reservations);
        for (const conflict of result.conflicts) {
          conflicts.push({
            date: toDateOnly(date),
            facilityId: conflict.facilityId,
            facilityName: conflict.facilityName,
            reason: conflict.reason,
          });
        }
      } catch (error) {
        if (error instanceof AppError && error.code === 'CONFLICT') {
          conflicts.push({
            date: toDateOnly(date),
            reason: error.message,
          });
          continue;
        }
        throw error;
      }
    }

    return {
      series,
      createdGroups,
      createdReservations,
      conflicts,
    };
  }

  private resolveSeriesFacilities(
    facilityIds: number[] | null | undefined,
    anchorFacilityId: number,
  ): ResolvedSeriesFacilities {
    const normalized = this.normalizeFacilityIds([
      anchorFacilityId,
      ...(facilityIds ?? []),
    ]);
    if (normalized.length === 0) {
      throw AppError.badRequest('facility_ids is required');
    }
    return {
      anchorFacilityId: normalized[0],
      facilityIds: normalized,
    };
  }

  private resolveExistingSeriesFacilityId(
    reservations: Reservation[],
    fallbackFacilityId: number,
  ): number {
    if (reservations.length === 0) {
      return fallbackFacilityId;
    }
    const firstGroupId = reservations[0].groupId;
    const groupReservations =
      firstGroupId != null
        ? reservations.filter((reservation) => reservation.groupId === firstGroupId)
        : reservations;
    const facilityId = groupReservations[0]?.facilityId ?? fallbackFacilityId;
    return facilityId;
  }

  private normalizeFacilityIds(facilityIds: number[]): number[] {
    const seen = new Set<number>();
    const normalized: number[] = [];
    for (const facilityId of facilityIds) {
      if (!Number.isFinite(facilityId)) continue;
      if (seen.has(facilityId)) continue;
      seen.add(facilityId);
      normalized.push(facilityId);
    }
    return normalized;
  }

  private resolveSeriesInput(
    data: Partial<CreateReservationSeriesDto> | UpdateReservationSeriesDto,
    fallback: ResolvedSeriesInput,
  ): ResolvedSeriesInput {
    const recurrenceType =
      data.recurrence_type ?? fallback.recurrenceType;
    this.assertValidRecurrenceType(recurrenceType);

    const recurrenceInterval =
      data.recurrence_interval !== undefined
        ? data.recurrence_interval
        : fallback.recurrenceInterval;
    const weekdayPattern =
      data.weekday_pattern !== undefined
        ? data.weekday_pattern
        : fallback.weekdayPattern;
    const customDates =
      data.custom_dates !== undefined ? data.custom_dates ?? [] : fallback.customDates;
    const startDate = data.start_date ?? fallback.startDate;
    const endDate = data.end_date !== undefined ? data.end_date : fallback.endDate;

    if (recurrenceType !== 'custom' && !endDate) {
      throw AppError.badRequest(
        'end_date is required for weekly, biweekly, and monthly series',
      );
    }
    if (recurrenceType === 'custom' && customDates.length === 0) {
      throw AppError.badRequest('custom_dates is required for custom recurring series');
    }
    if (
      recurrenceInterval != null &&
      (!Number.isFinite(recurrenceInterval) || recurrenceInterval <= 0)
    ) {
      throw AppError.badRequest('recurrence_interval must be a positive number');
    }

    return {
      title: data.title ?? fallback.title,
      requesterName: data.requester_name ?? fallback.requesterName,
      requesterUserId:
        data.requester_user_id !== undefined
          ? data.requester_user_id
          : fallback.requesterUserId,
      createdByUserId:
        'created_by_user_id' in data && data.created_by_user_id !== undefined
          ? data.created_by_user_id
          : fallback.createdByUserId,
      notes: data.notes !== undefined ? data.notes : fallback.notes,
      recurrenceType,
      recurrenceInterval: recurrenceInterval ?? (recurrenceType === 'biweekly' ? 1 : null),
      weekdayPattern: recurrenceType === 'monthly' ? weekdayPattern : fallback.weekdayPattern,
      customDates,
      startDate,
      endDate,
    };
  }

  private computeSeriesDates(series: ReservationSeries): Date[] {
    const startDate = parseDateOnly(series.startDate);
    const endDate =
      series.endDate != null ? parseDateOnly(series.endDate) : startDate;
    if (endDate < startDate) {
      throw AppError.badRequest('end_date must be on or after start_date');
    }

    switch (series.recurrenceType) {
      case 'weekly':
        return everyNDays(startDate, endDate, 7 * (series.recurrenceInterval ?? 1));
      case 'biweekly':
        return everyNDays(startDate, endDate, 14 * (series.recurrenceInterval ?? 1));
      case 'monthly':
        return monthlyWeekdayPatternDates(startDate, endDate);
      case 'custom':
        return [...series.customDates]
          .map(parseDateOnly)
          .filter((date) => date >= startDate && date <= endDate)
          .sort((a, b) => a.getTime() - b.getTime());
    }
  }

  private parseTime(value: string, fieldName: string): Date {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw AppError.badRequest(`${fieldName} must be a valid ISO timestamp`);
    }
    return parsed;
  }

  private assertValidTimeRange(start: Date, end: Date): void {
    if (end <= start) {
      throw AppError.badRequest('end_time must be after start_time');
    }
  }

  private assertValidRecurrenceType(
    recurrenceType: string,
  ): asserts recurrenceType is ReservationSeries['recurrenceType'] {
    if (
      recurrenceType !== 'weekly' &&
      recurrenceType !== 'biweekly' &&
      recurrenceType !== 'monthly' &&
      recurrenceType !== 'custom'
    ) {
      throw AppError.badRequest(
        'recurrence_type must be weekly, biweekly, monthly, or custom',
      );
    }
  }
}

function parseDateOnly(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw AppError.badRequest(`Invalid date: ${value}`);
  }
  return date;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function applyUtcDate(timeSource: Date, dateSource: Date): Date {
  return new Date(
    Date.UTC(
      dateSource.getUTCFullYear(),
      dateSource.getUTCMonth(),
      dateSource.getUTCDate(),
      timeSource.getUTCHours(),
      timeSource.getUTCMinutes(),
      timeSource.getUTCSeconds(),
      timeSource.getUTCMilliseconds(),
    ),
  );
}

function everyNDays(startDate: Date, endDate: Date, dayStep: number): Date[] {
  const results: Date[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    results.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + dayStep);
  }
  return results;
}

function monthlyWeekdayPatternDates(startDate: Date, endDate: Date): Date[] {
  const weekday = startDate.getUTCDay();
  const weekOfMonth = Math.floor((startDate.getUTCDate() - 1) / 7) + 1;
  const isLastWeek = startDate.getUTCDate() + 7 > daysInMonth(startDate);
  const results: Date[] = [];

  let year = startDate.getUTCFullYear();
  let month = startDate.getUTCMonth();
  while (true) {
    const candidate = isLastWeek
      ? lastWeekdayOfMonth(year, month, weekday)
      : nthWeekdayOfMonth(year, month, weekday, weekOfMonth);
    if (candidate > endDate) break;
    if (candidate >= startDate) {
      results.push(candidate);
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  return results;
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  weekOfMonth: number,
): Date {
  const firstDay = new Date(Date.UTC(year, month, 1));
  const offset = (weekday - firstDay.getUTCDay() + 7) % 7;
  const day = 1 + offset + (weekOfMonth - 1) * 7;
  const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  if (day > maxDay) {
    return lastWeekdayOfMonth(year, month, weekday);
  }
  return new Date(Date.UTC(year, month, day));
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = new Date(Date.UTC(year, month + 1, 0));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  last.setUTCDate(last.getUTCDate() - offset);
  return last;
}

function daysInMonth(date: Date): number {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
}
