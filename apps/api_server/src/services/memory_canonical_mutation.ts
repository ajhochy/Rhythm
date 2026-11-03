import { logger } from '../utils/logger';

/** Body-free canonical change signal; never carries note text or credentials. */
export interface CanonicalMemoryMutation {
  memoryDir: string;
  destructive: boolean;
}

export type CanonicalMutationSink = (mutation: CanonicalMemoryMutation) => void;

let defaultSink: { token: symbol; sink: CanonicalMutationSink } | undefined;
const observers = new Set<CanonicalMutationSink>();

/** Register the sole runtime admission sink. An old disposer cannot remove a replacement. */
export function registerCanonicalMutationSink(sink: CanonicalMutationSink): () => void {
  const token = Symbol('canonical-mutation-sink');
  defaultSink = { token, sink };
  return () => {
    if (defaultSink?.token === token) defaultSink = undefined;
  };
}

/** Additive test/diagnostic observer; it never replaces the runtime sink. */
export function observeCanonicalMutations(observer: CanonicalMutationSink): () => void {
  observers.add(observer);
  return () => observers.delete(observer);
}

export function publishCanonicalMutation(mutation: CanonicalMemoryMutation): void {
  const delivery = [defaultSink?.sink, ...observers];
  for (const sink of delivery) {
    if (!sink) continue;
    try { sink({ ...mutation }); }
    catch { logger.warn('[MemoryCanonicalMutation] observer rejected canonical mutation.'); }
  }
}
