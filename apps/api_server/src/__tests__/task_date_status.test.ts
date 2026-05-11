import { describe, it, expect } from 'vitest';
import {
  isOverdue,
  isPastDeadline,
  priorityDate,
  taskDateStatus,
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
