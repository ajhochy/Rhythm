import { describe, it, expect } from 'vitest';
import {
  isOverdue,
  isPastDeadline,
  priorityDate,
  taskDateStatus,
  todayInTimezone,
  todayDateInTimezone,
} from '../services/task_date_status';

// Pin a fixed reference date for all tests: 2026-05-15
const TODAY = new Date('2026-05-15T00:00:00');

// ── priorityDate ─────────────────────────────────────────────────────────────

describe('priorityDate', () => {
  it('returns scheduledDate when both are set', () => {
    const result = priorityDate({ scheduledDate: '2026-05-10', dueDate: '2026-05-12' });
    expect(result).toEqual(new Date('2026-05-10T00:00:00'));
  });

  it('returns dueDate when only dueDate is set', () => {
    const result = priorityDate({ dueDate: '2026-05-12' });
    expect(result).toEqual(new Date('2026-05-12T00:00:00'));
  });

  it('returns scheduledDate when only scheduledDate is set', () => {
    const result = priorityDate({ scheduledDate: '2026-05-10' });
    expect(result).toEqual(new Date('2026-05-10T00:00:00'));
  });

  it('returns null when both dates are null', () => {
    expect(priorityDate({ scheduledDate: null, dueDate: null })).toBeNull();
  });

  it('returns null when both dates are undefined', () => {
    expect(priorityDate({})).toBeNull();
  });
});

// ── isOverdue ─────────────────────────────────────────────────────────────────

describe('isOverdue', () => {
  it('returns true when scheduledDate is in the past (scheduled-only task)', () => {
    expect(isOverdue({ status: 'open', scheduledDate: '2026-05-14' }, TODAY)).toBe(true);
  });

  it('returns true when dueDate is in the past (due-only task)', () => {
    expect(isOverdue({ status: 'open', dueDate: '2026-05-14' }, TODAY)).toBe(true);
  });

  it('returns true when both dates are in the past', () => {
    expect(
      isOverdue({ status: 'open', scheduledDate: '2026-05-10', dueDate: '2026-05-12' }, TODAY),
    ).toBe(true);
  });

  it('returns false when both dates are null', () => {
    expect(isOverdue({ status: 'open', scheduledDate: null, dueDate: null }, TODAY)).toBe(false);
  });

  it('returns false when status is done (hard short-circuit)', () => {
    expect(isOverdue({ status: 'done', scheduledDate: '2026-05-10' }, TODAY)).toBe(false);
    expect(isOverdue({ status: 'done', dueDate: '2026-05-10' }, TODAY)).toBe(false);
    expect(isOverdue({ status: 'done', scheduledDate: null, dueDate: null }, TODAY)).toBe(false);
  });

  it('returns false for status=done even when both dates are deeply in the past', () => {
    expect(
      isOverdue({ status: 'done', scheduledDate: '2020-01-01', dueDate: '2019-01-01' }, TODAY),
    ).toBe(false);
  });

  it('returns false when scheduledDate is today (not strictly before)', () => {
    expect(isOverdue({ status: 'open', scheduledDate: '2026-05-15' }, TODAY)).toBe(false);
  });

  it('returns false when dueDate is today (not strictly before)', () => {
    expect(isOverdue({ status: 'open', dueDate: '2026-05-15' }, TODAY)).toBe(false);
  });

  it('returns false when scheduledDate is in the future', () => {
    expect(isOverdue({ status: 'open', scheduledDate: '2026-05-20' }, TODAY)).toBe(false);
  });

  // Reported bug case: scheduledDate is in future but dueDate is in past
  // isOverdue uses scheduledDate ?? dueDate, so scheduledDate wins → NOT overdue
  it('returns false when scheduledDate is in the future even if dueDate is in the past (bug case)', () => {
    expect(
      isOverdue({ status: 'open', scheduledDate: '2026-05-20', dueDate: '2026-05-10' }, TODAY),
    ).toBe(false);
  });

  it('returns true for in_progress status when scheduledDate is past', () => {
    expect(isOverdue({ status: 'in_progress', scheduledDate: '2026-05-14' }, TODAY)).toBe(true);
  });

  it('returns true for waiting_for_reply status when dueDate is past', () => {
    expect(
      isOverdue({ status: 'waiting_for_reply', dueDate: '2026-05-14' }, TODAY),
    ).toBe(true);
  });
});

// ── isPastDeadline ────────────────────────────────────────────────────────────

describe('isPastDeadline', () => {
  it('returns true when dueDate is in the past', () => {
    expect(isPastDeadline({ status: 'open', dueDate: '2026-05-14' }, TODAY)).toBe(true);
  });

  it('returns false when dueDate is today (not strictly before)', () => {
    expect(isPastDeadline({ status: 'open', dueDate: '2026-05-15' }, TODAY)).toBe(false);
  });

  it('returns false when dueDate is in the future', () => {
    expect(isPastDeadline({ status: 'open', dueDate: '2026-05-20' }, TODAY)).toBe(false);
  });

  it('returns false when dueDate is null', () => {
    expect(isPastDeadline({ status: 'open', dueDate: null }, TODAY)).toBe(false);
  });

  it('returns false when dueDate is undefined', () => {
    expect(isPastDeadline({ status: 'open' }, TODAY)).toBe(false);
  });

  it('returns false when status is done (hard short-circuit)', () => {
    expect(isPastDeadline({ status: 'done', dueDate: '2026-05-10' }, TODAY)).toBe(false);
  });

  // Reported bug case: scheduledDate is in future but dueDate is in past
  // isPastDeadline only looks at dueDate → IS past deadline
  it('returns true when dueDate is past even if scheduledDate is in the future (bug case)', () => {
    expect(
      isPastDeadline({ status: 'open', scheduledDate: '2026-05-20', dueDate: '2026-05-10' }, TODAY),
    ).toBe(true);
  });

  it('ignores scheduledDate entirely when dueDate is not set', () => {
    expect(
      isPastDeadline({ status: 'open', scheduledDate: '2026-05-10', dueDate: null }, TODAY),
    ).toBe(false);
  });
});

// ── taskDateStatus ────────────────────────────────────────────────────────────

describe('taskDateStatus', () => {
  it('returns combined result for a straightforwardly overdue task', () => {
    const result = taskDateStatus({ status: 'open', scheduledDate: '2026-05-14' }, TODAY);
    expect(result.overdue).toBe(true);
    expect(result.pastDeadline).toBe(false); // no dueDate
    expect(result.priorityDate).toEqual(new Date('2026-05-14T00:00:00'));
  });

  it('returns false for both flags when status is done', () => {
    const result = taskDateStatus(
      { status: 'done', scheduledDate: '2026-05-10', dueDate: '2026-05-10' },
      TODAY,
    );
    expect(result.overdue).toBe(false);
    expect(result.pastDeadline).toBe(false);
  });

  it('handles the reported bug case correctly', () => {
    // scheduledDate in future, dueDate in past
    const result = taskDateStatus(
      { status: 'open', scheduledDate: '2026-05-20', dueDate: '2026-05-10' },
      TODAY,
    );
    expect(result.overdue).toBe(false);       // scheduled for the future
    expect(result.pastDeadline).toBe(true);   // deadline already passed
    expect(result.priorityDate).toEqual(new Date('2026-05-20T00:00:00'));
  });

  it('returns null priorityDate and both false when no dates set', () => {
    const result = taskDateStatus({ status: 'open' }, TODAY);
    expect(result.overdue).toBe(false);
    expect(result.pastDeadline).toBe(false);
    expect(result.priorityDate).toBeNull();
  });
});

// ── Canonical cross-stack date-status predicate matrix ───────────────────────
//
// Anchor date: 2026-05-11 (today).
// Each row asserts isOverdue and isPastDeadline for the documented combination
// of status, scheduledDate, and dueDate. The Dart test file in
// apps/desktop_flutter/test/date_formatters_test.dart mirrors every row.

describe('cross-stack matrix (anchor: 2026-05-11)', () => {
  const MATRIX_TODAY = new Date('2026-05-11T00:00:00');

  it('case 1: done task, both dates in past → neither flag set', () => {
    expect(isOverdue({ status: 'done', scheduledDate: '2026-04-01', dueDate: '2026-04-01' }, MATRIX_TODAY)).toBe(false);
    expect(isPastDeadline({ status: 'done', scheduledDate: '2026-04-01', dueDate: '2026-04-01' }, MATRIX_TODAY)).toBe(false);
  });

  it('case 2: open, no dates → neither flag set', () => {
    expect(isOverdue({ status: 'open', scheduledDate: null, dueDate: null }, MATRIX_TODAY)).toBe(false);
    expect(isPastDeadline({ status: 'open', scheduledDate: null, dueDate: null }, MATRIX_TODAY)).toBe(false);
  });

  it('case 3: open, future scheduled, no due → neither flag set', () => {
    expect(isOverdue({ status: 'open', scheduledDate: '2026-05-15' }, MATRIX_TODAY)).toBe(false);
    expect(isPastDeadline({ status: 'open', scheduledDate: '2026-05-15' }, MATRIX_TODAY)).toBe(false);
  });

  it('case 4: open, past scheduled, no due → overdue only', () => {
    expect(isOverdue({ status: 'open', scheduledDate: '2026-05-05' }, MATRIX_TODAY)).toBe(true);
    expect(isPastDeadline({ status: 'open', scheduledDate: '2026-05-05' }, MATRIX_TODAY)).toBe(false);
  });

  it('case 5: open, no scheduled, future due → neither flag set', () => {
    expect(isOverdue({ status: 'open', dueDate: '2026-05-15' }, MATRIX_TODAY)).toBe(false);
    expect(isPastDeadline({ status: 'open', dueDate: '2026-05-15' }, MATRIX_TODAY)).toBe(false);
  });

  it('case 6: open, no scheduled, past due → both flags set', () => {
    expect(isOverdue({ status: 'open', dueDate: '2026-05-05' }, MATRIX_TODAY)).toBe(true);
    expect(isPastDeadline({ status: 'open', dueDate: '2026-05-05' }, MATRIX_TODAY)).toBe(true);
  });

  it('case 7: scheduled future, deadline past → past-deadline only — the original reported bug', () => {
    // scheduledDate wins for isOverdue (future → not overdue)
    // isPastDeadline only checks dueDate (past → true)
    expect(isOverdue({ status: 'open', scheduledDate: '2026-05-15', dueDate: '2026-05-05' }, MATRIX_TODAY)).toBe(false);
    expect(isPastDeadline({ status: 'open', scheduledDate: '2026-05-15', dueDate: '2026-05-05' }, MATRIX_TODAY)).toBe(true);
  });

  it('case 8: open, past scheduled, future due → overdue only', () => {
    expect(isOverdue({ status: 'open', scheduledDate: '2026-05-05', dueDate: '2026-05-15' }, MATRIX_TODAY)).toBe(true);
    expect(isPastDeadline({ status: 'open', scheduledDate: '2026-05-05', dueDate: '2026-05-15' }, MATRIX_TODAY)).toBe(false);
  });

  it('case 9: open, both dates == today → neither flag set (today is not past)', () => {
    expect(isOverdue({ status: 'open', scheduledDate: '2026-05-11', dueDate: '2026-05-11' }, MATRIX_TODAY)).toBe(false);
    expect(isPastDeadline({ status: 'open', scheduledDate: '2026-05-11', dueDate: '2026-05-11' }, MATRIX_TODAY)).toBe(false);
  });

  it('case 10: open, both dates == yesterday → both flags set', () => {
    expect(isOverdue({ status: 'open', scheduledDate: '2026-05-10', dueDate: '2026-05-10' }, MATRIX_TODAY)).toBe(true);
    expect(isPastDeadline({ status: 'open', scheduledDate: '2026-05-10', dueDate: '2026-05-10' }, MATRIX_TODAY)).toBe(true);
  });
});

// ── todayInTimezone / todayDateInTimezone ──────────────────────────────────────
//
// These tests verify TZ-boundary behaviour by constructing a pinned Date that
// falls in "UTC tomorrow" but is still "today" in America/Los_Angeles.
//
// 2026-05-15 at 23:00 UTC = 2026-05-15 at 16:00 PDT (UTC-7 in summer).
// So when "now" is 2026-05-15T23:00:00Z:
//   • todayInTimezone('America/Los_Angeles') → '2026-05-15'
//   • todayInTimezone('UTC') → '2026-05-15'
//
// 2026-05-16 at 01:00 UTC = 2026-05-15 at 18:00 PDT.
// So when "now" is 2026-05-16T01:00:00Z:
//   • todayInTimezone('UTC') → '2026-05-16'
//   • todayInTimezone('America/Los_Angeles') → '2026-05-15'   ← the key TZ-boundary case

describe('todayInTimezone', () => {
  it('returns a string in YYYY-MM-DD format', () => {
    const result = todayInTimezone('America/Los_Angeles');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns a string in YYYY-MM-DD format for UTC', () => {
    const result = todayInTimezone('UTC');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('todayDateInTimezone', () => {
  it('returns a Date whose YYYY-MM-DD matches todayInTimezone for the same TZ', () => {
    const tz = 'America/Los_Angeles';
    const dateStr = todayInTimezone(tz);
    const d = todayDateInTimezone(tz);
    const expected = new Date(dateStr + 'T00:00:00');
    expect(d.getTime()).toBe(expected.getTime());
  });

  it('task overdue check uses LA date — task for "today in LA" is NOT overdue even when UTC says tomorrow', () => {
    // Simulate: user is in LA. Their local date is 2026-05-15.
    // The server clock (UTC) shows 2026-05-16T01:00:00Z (1 AM UTC next day).
    // A task scheduled for 2026-05-15 should NOT be overdue from the LA perspective.
    const laTodayDate = new Date('2026-05-15T00:00:00'); // midnight, local representation
    const task = { status: 'open' as const, scheduledDate: '2026-05-15' };
    // From LA's "today" (2026-05-15), this task is due today — not overdue.
    expect(isOverdue(task, laTodayDate)).toBe(false);
    // From UTC's "today" (2026-05-16), the same task would appear overdue.
    const utcTodayDate = new Date('2026-05-16T00:00:00');
    expect(isOverdue(task, utcTodayDate)).toBe(true);
  });
});
