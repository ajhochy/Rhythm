import { describe, expect, it } from 'vitest';

import { DAYFLOW_ERROR_CATALOG } from '../integrations/dayflow/public_contract';
import { dayflowRouteTesting } from '../routes/dayflow_integration_routes';

describe('Dayflow management-route public boundary', () => {
  it('accepts only real YYYY-MM-DD preview dates', () => {
    expect(dayflowRouteTesting.strictDate('2026-02-28')).toBe('2026-02-28');
    expect(() => dayflowRouteTesting.strictDate('2026-02-30')).toThrow('INVALID_REQUEST');
    expect(() => dayflowRouteTesting.strictDate('2026-2-28')).toThrow('INVALID_REQUEST');
  });

  it('keeps selection and explicit enable as separate configuration operations', () => {
    expect(() => dayflowRouteTesting.configPatch({ enabled: true, sourceSelectionToken: 'opaque-token' })).toThrow('INVALID_REQUEST');
    expect(dayflowRouteTesting.configPatch({ sourceSelectionToken: 'opaque-token' })).toEqual({ sourceSelectionToken: 'opaque-token' });
    expect(() => dayflowRouteTesting.configPatch({ automaticImport: true })).toThrow('INVALID_REQUEST');
  });

  it('requires opaque preview tokens and canonical candidate IDs', () => {
    const candidateId = 'a'.repeat(64);
    expect(dayflowRouteTesting.commitRequest({ token: 'preview-token', candidateIds: [candidateId] })).toEqual({ token: 'preview-token', candidateIds: [candidateId] });
    expect(() => dayflowRouteTesting.commitRequest({ token: 'preview-token', candidateIds: ['not-a-candidate'] })).toThrow('INVALID_REQUEST');
  });

  it('bounds ledger pagination without inspecting note content', () => {
    expect(dayflowRouteTesting.ownedNotesInput({})).toEqual({ limit: 25 });
    expect(dayflowRouteTesting.ownedNotesInput({ limit: '100', cursor: 'opaque-cursor' })).toEqual({ limit: 100, cursor: 'opaque-cursor' });
    expect(() => dayflowRouteTesting.ownedNotesInput({ limit: '101' })).toThrow('CURSOR_INVALID');
    expect(() => dayflowRouteTesting.ownedNotesInput({ summary: 'not-public' })).toThrow('INVALID_REQUEST');
  });

  it('publishes only static Dayflow error messages', () => {
    for (const entry of Object.values(DAYFLOW_ERROR_CATALOG)) {
      expect(entry.message.length).toBeLessThanOrEqual(160);
      expect(entry.message).not.toMatch(/\/(Users|private|var)\//);
    }
  });
});
