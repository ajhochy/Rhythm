/**
 * #1001 — fast unit coverage for the live-E2E isolation guard.
 *
 * Proves the guard fails CLOSED: it throws for the default/real DB path (unset
 * DB_PATH → default fallback, or DB_PATH pointed at the real Rhythm DB) and for
 * a missing isolation acknowledgement, and only passes for an isolated temp DB
 * with RHYTHM_LIVE_E2E_ISOLATED=1. Runs in the normal suite (no live flag, no
 * server) — this is the required, always-on proof of the durable prevention.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { assertLiveE2EIsolation } from './_live_e2e_guard';

const REAL_DB = join(homedir(), 'Library', 'Application Support', 'Rhythm', 'rhythm.db');

let savedDbPath: string | undefined;
let savedIsolated: string | undefined;

beforeEach(() => {
  savedDbPath = process.env.DB_PATH;
  savedIsolated = process.env.RHYTHM_LIVE_E2E_ISOLATED;
});

afterEach(() => {
  if (savedDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = savedDbPath;
  if (savedIsolated === undefined) delete process.env.RHYTHM_LIVE_E2E_ISOLATED;
  else process.env.RHYTHM_LIVE_E2E_ISOLATED = savedIsolated;
});

describe('#1001 assertLiveE2EIsolation — fails closed on the default/real DB path', () => {
  it('throws when DB_PATH is unset (would fall back to the default real DB)', () => {
    delete process.env.DB_PATH;
    process.env.RHYTHM_LIVE_E2E_ISOLATED = '1';
    expect(() => assertLiveE2EIsolation()).toThrow(/DB_PATH is unset/);
  });

  it('throws when DB_PATH points at the REAL Rhythm DB', () => {
    process.env.DB_PATH = REAL_DB;
    process.env.RHYTHM_LIVE_E2E_ISOLATED = '1';
    expect(() => assertLiveE2EIsolation()).toThrow(/REAL DB/);
  });

  it('throws when the isolation acknowledgement is not set, even with a temp DB_PATH', () => {
    process.env.DB_PATH = '/tmp/rhythm-e2e-1001/rhythm.db';
    delete process.env.RHYTHM_LIVE_E2E_ISOLATED;
    expect(() => assertLiveE2EIsolation()).toThrow(/RHYTHM_LIVE_E2E_ISOLATED=1 is not set/);
  });

  it('passes for an isolated temp DB_PATH with RHYTHM_LIVE_E2E_ISOLATED=1', () => {
    process.env.DB_PATH = '/tmp/rhythm-e2e-1001/rhythm.db';
    process.env.RHYTHM_LIVE_E2E_ISOLATED = '1';
    expect(() => assertLiveE2EIsolation()).not.toThrow();
  });
});
