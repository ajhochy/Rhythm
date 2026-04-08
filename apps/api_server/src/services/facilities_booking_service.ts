import type {
  CreateReservationSeriesDto,
  CreateReservationSeriesResult,
  ReservationSeries,
} from '../models/facility';
import { AppError } from '../errors/app_error';
import { FacilitiesRepository } from '../repositories/facilities_repository';

export class FacilitiesBookingService {
  private readonly repo = new FacilitiesRepository();

  createRecurringSeries(
    data: CreateReservationSeriesDto,
  ): CreateReservationSeriesResult {
    const start = new Date(data.start_time);
    const end = new Date(data.end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw AppError.badRequest('start_time and end_time must be valid ISO timestamps');
    }
    if (end <= start) {
      throw AppError.badRequest('end_time must be after start_time');
    }
    if (data.recurrence_type !== 'custom' && !data.end_date) {
      throw AppError.badRequest(
        'end_date is required for weekly, biweekly, and monthly series',
      );
    }
    if (
      data.recurrence_type === 'custom' &&
      (!data.custom_dates || data.custom_dates.length === 0)
    ) {
      throw AppError.badRequest(
        'custom_dates is required for custom recurring series',
      );
    }

    const series = this.repo.createReservationSeries(data);
    const occurrenceDates = this.computeSeriesDates(series);
    const createdReservations = [];
    const conflicts = [];
    const durationMs = end.getTime() - start.getTime();

    for (const date of occurrenceDates) {
      const occurrenceStart = applyUtcDate(start, date);
      const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
      try {
        createdReservations.push(
          this.repo.createReservation(series.facilityId, {
            title: series.title,
            series_id: series.id,
            requester_name: series.requesterName,
            requester_user_id: series.requesterUserId,
            created_by_user_id: series.createdByUserId,
            start_time: occurrenceStart.toISOString(),
            end_time: occurrenceEnd.toISOString(),
            notes: series.notes,
          }),
        );
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
      createdReservations,
      conflicts,
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
  const results = [];
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
  const results = [];

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
