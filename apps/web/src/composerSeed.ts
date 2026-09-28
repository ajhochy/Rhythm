// One-shot composer text for a session the app is about to open (e.g. "Ask about this" from a
// research magazine). In-memory only: it must not outlive the navigation that requested it.
const seeds = new Map<string, string>();

export function seedComposer(sessionId: string, text: string): void { seeds.set(sessionId, text); }

export function takeComposerSeed(sessionId: string): string | undefined {
  const text = seeds.get(sessionId);
  // ponytail: kept for 1 s so a StrictMode/dev double effect reads the same seed; a keyed ack if that ever races.
  if (text !== undefined) setTimeout(() => { if (seeds.get(sessionId) === text) seeds.delete(sessionId); }, 1_000);
  return text;
}
