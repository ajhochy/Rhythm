import { createHash, randomUUID } from 'node:crypto';
import type { DayflowCandidate, DayflowObservation, DayflowPreview } from './types';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function stableMemoryId(sourceId: string): string {
  const bytes = createHash('sha256').update(sourceId).digest();
  let bits = 0; let value = 0; let result = '';
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5 && result.length < 26) { result += CROCKFORD[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  return result.padEnd(26, '0');
}
/** JSON tuple avoids delimiter collisions; it is never reused as a footnote ID. */
export function sourceIdFor(observation: DayflowObservation) { return JSON.stringify([observation.sourceInstanceId, observation.recordId]); }
export function contentFor(observation: DayflowObservation) { return `Dayflow activity observation (unverified)\n\n${observation.summary}\n\nObserved: ${observation.observedStart}`; }
export function previewFor(observations: DayflowObservation[], now = Date.now(), rejected: DayflowPreview['rejected'] = []): DayflowPreview {
  const candidates: DayflowCandidate[] = observations.map((observation) => ({ ...observation, candidateId: createHash('sha256').update(`${sourceIdFor(observation)}:${observation.revisionHash}`).digest('hex') }));
  return { token: randomUUID(), expiresAt: new Date(now + 10 * 60_000).toISOString(), candidates, rejected };
}
