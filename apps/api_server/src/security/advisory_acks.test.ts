/**
 * Unit tests for issue #877 — advisory acknowledgment storage.
 *
 * The ack file is a local, plain-text/JSON file containing ONLY advisory IDs
 * (never package versions or secrets), consistent with the issue's
 * data-safety section.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AdvisoryAckStore } from './advisory_acks';

describe('AdvisoryAckStore (#877)', () => {
  let tempDir: string;
  let ackPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'rhythm-advisory-acks-test-'));
    ackPath = join(tempDir, '.rhythm_acks');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('no crash and reports not-acked when the ack file is absent', () => {
    const store = new AdvisoryAckStore(ackPath);
    expect(existsSync(ackPath)).toBe(false);
    expect(store.isAcked('RHYTHM-SA-TEST-001')).toBe(false);
  });

  it('acknowledging an advisory persists it and suppresses future warnings for that id', () => {
    const store = new AdvisoryAckStore(ackPath);
    store.ack('RHYTHM-SA-TEST-001');
    expect(store.isAcked('RHYTHM-SA-TEST-001')).toBe(true);
    expect(store.isAcked('RHYTHM-SA-TEST-002')).toBe(false);
  });

  it('acknowledgment persists across a new store instance reading the same file', () => {
    const first = new AdvisoryAckStore(ackPath);
    first.ack('RHYTHM-SA-TEST-001');

    const second = new AdvisoryAckStore(ackPath);
    expect(second.isAcked('RHYTHM-SA-TEST-001')).toBe(true);
  });

  it('ack file contains only advisory ids — no package names or versions', () => {
    const store = new AdvisoryAckStore(ackPath);
    store.ack('RHYTHM-SA-TEST-001');
    const raw = readFileSync(ackPath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    expect(parsed).toEqual({ acked: ['RHYTHM-SA-TEST-001'] });
  });

  it('does not crash and ignores acks on a malformed ack file', () => {
    writeFileSync(ackPath, 'not valid json {{{');
    const store = new AdvisoryAckStore(ackPath);
    expect(() => store.isAcked('RHYTHM-SA-TEST-001')).not.toThrow();
    expect(store.isAcked('RHYTHM-SA-TEST-001')).toBe(false);
    // Acking after a malformed read should still succeed and self-heal the file.
    expect(() => store.ack('RHYTHM-SA-TEST-001')).not.toThrow();
    expect(store.isAcked('RHYTHM-SA-TEST-001')).toBe(true);
  });

  it('acking the same id twice does not duplicate entries', () => {
    const store = new AdvisoryAckStore(ackPath);
    store.ack('RHYTHM-SA-TEST-001');
    store.ack('RHYTHM-SA-TEST-001');
    const parsed = JSON.parse(readFileSync(ackPath, 'utf8')) as { acked: string[] };
    expect(parsed.acked).toEqual(['RHYTHM-SA-TEST-001']);
  });
});
