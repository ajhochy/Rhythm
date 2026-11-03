import { env } from '../config/env';
import { getDb } from '../database/db';
import { findSolePairedUserId } from '../repositories/mobile_devices_repository';

/**
 * The one human a loopback desktop acts for: its sole paired mobile user.
 * Null when hosted, on Postgres, or when more than one user is paired, so
 * callers keep work unowned instead of guessing.
 */
export function localOperatorUserId(): number | null {
  return env.agentLocal && env.dbClient === 'sqlite' ? findSolePairedUserId(getDb()) : null;
}
