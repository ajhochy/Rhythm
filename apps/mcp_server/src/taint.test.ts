import { describe, it, expect, beforeEach } from 'vitest';
import { markTainted, isTainted, taintReason, __resetTaintForTest } from './taint.js';

describe('taint (#1134)', () => {
  beforeEach(() => {
    __resetTaintForTest();
  });

  it('starts clean', () => {
    expect(isTainted()).toBe(false);
    expect(taintReason()).toBeNull();
  });

  it('marks tainted with a reason', () => {
    markTainted('gmail');
    expect(isTainted()).toBe(true);
    expect(taintReason()).toBe('gmail');
  });

  it('__resetTaintForTest clears taint back to clean', () => {
    markTainted('gmail');
    __resetTaintForTest();
    expect(isTainted()).toBe(false);
    expect(taintReason()).toBeNull();
  });
});
