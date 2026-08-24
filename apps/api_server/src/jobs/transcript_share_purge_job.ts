import { SharedTranscriptsRepository } from '../repositories/shared_transcripts_repository';
import { logger } from '../utils/logger';

export const TRANSCRIPT_SHARE_PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export function startTranscriptSharePurgeJob(): { stop: () => void } {
  const sweep = async (): Promise<void> => {
    try {
      const purged = await new SharedTranscriptsRepository().purgeDueSnapshots();
      if (purged > 0) logger.info(`[server] transcript share retention: purged=${purged}`);
    } catch (error) {
      logger.warn(`[server] transcript share retention failed (non-fatal): ${String(error)}`);
    }
  };
  void sweep();
  const timer = setInterval(() => void sweep(), TRANSCRIPT_SHARE_PURGE_INTERVAL_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

export function startTranscriptSharePurgeJobIfEnabled(options: {
  env: Record<string, string | undefined>;
  dbClient: string;
  start?: () => unknown;
}): boolean {
  if (
    options.env.VITEST === 'true' ||
    options.env.RHYTHM_TRANSCRIPT_SHARE_PURGE_ENABLED !== 'true' ||
    options.dbClient !== 'postgres'
  ) return false;
  (options.start ?? startTranscriptSharePurgeJob)();
  return true;
}
