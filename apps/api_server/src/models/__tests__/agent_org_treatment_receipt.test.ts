/**
 * C2-B — the durable, sanitized treatment receipt model. Pure shape/format
 * validators only; the repository (agent_org_treatment_receipts_repository.ts)
 * owns persistence and binding-to-enrollment.
 */

import { describe, expect, it } from 'vitest';

import {
  TREATMENT_RECEIPT_ADAPTERS,
  TREATMENT_RECEIPT_SCHEMA_VERSION,
  isHex64,
  isTargetRevisionHash,
  buildTargetRef,
} from '../agent_org_treatment_receipt';

describe('agent_org_treatment_receipt — closed domains and hash formats', () => {
  it('the adapter registry is closed to system-prompt-v1 only', () => {
    expect(TREATMENT_RECEIPT_ADAPTERS).toEqual(['system-prompt-v1']);
  });

  it('has a stable schema version', () => {
    expect(TREATMENT_RECEIPT_SCHEMA_VERSION).toBe(1);
  });

  describe('isHex64 — treatment/effective hashes are exactly lowercase 64-hex digests', () => {
    it('accepts a real 64-lowercase-hex digest', () => {
      expect(isHex64('a'.repeat(64))).toBe(true);
      expect(isHex64('0123456789abcdef'.repeat(4))).toBe(true);
    });

    it('rejects uppercase hex', () => {
      expect(isHex64('A'.repeat(64))).toBe(false);
    });

    it('rejects the wrong length', () => {
      expect(isHex64('a'.repeat(63))).toBe(false);
      expect(isHex64('a'.repeat(65))).toBe(false);
      expect(isHex64('')).toBe(false);
    });

    it('rejects non-hex characters', () => {
      expect(isHex64('g'.repeat(64))).toBe(false);
    });

    it('rejects a sha256: prefix on a bare hash field', () => {
      expect(isHex64(`sha256:${'a'.repeat(64)}`)).toBe(false);
    });
  });

  describe('isTargetRevisionHash — the existing sha256:<64hex> format', () => {
    it('accepts the canonical prefixed form', () => {
      expect(isTargetRevisionHash(`sha256:${'a'.repeat(64)}`)).toBe(true);
    });

    it('rejects a bare hash with no prefix', () => {
      expect(isTargetRevisionHash('a'.repeat(64))).toBe(false);
    });

    it('rejects the wrong hex length after the prefix', () => {
      expect(isTargetRevisionHash(`sha256:${'a'.repeat(63)}`)).toBe(false);
    });

    it('rejects uppercase hex after the prefix', () => {
      expect(isTargetRevisionHash(`sha256:${'A'.repeat(64)}`)).toBe(false);
    });
  });

  describe('buildTargetRef', () => {
    it('produces the canonical agent_config:<profileId> ref', () => {
      expect(buildTargetRef('agent-1')).toBe('agent_config:agent-1');
    });
  });
});
