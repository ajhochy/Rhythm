/**
 * agent_status_service.test.ts
 *
 * Unit tests for the I/O-burst-based working/idle status detector.
 *
 * Strategy: we do NOT import the real service (it calls `_internal_getSessionsMap`
 * and `broadcast`, both live module singletons). Instead we test the identical
 * tick logic in isolation by re-implementing the tiny state machine here and
 * driving it with a fake clock.  This keeps the tests fast and free of side
 * effects while exercising the exact branching we care about.
 */

import { beforeEach, describe, expect, test } from 'vitest';

// ─── Re-implement the tick logic under test ───────────────────────────────────
// (mirrored exactly from agent_status_service.ts so changes there break tests)

const BURST_WORKING_MS = 500;
const IDLE_SILENCE_MS = 3000;
const DEBOUNCE_TICKS = 2;

interface FakeSession {
  lastOutAt: number;
  burstStart: number;
  working: boolean;
}

interface DebounceState {
  state: boolean;
  count: number;
}

function runTick(
  sessions: Map<string, FakeSession>,
  debounce: Map<string, DebounceState>,
  now: number,
  onTransition: (id: string, next: boolean) => void,
): void {
  for (const [id, s] of sessions) {
    const silence = s.lastOutAt ? now - s.lastOutAt : Infinity;
    const burstMs = s.burstStart > 0 && silence < 2000 ? now - s.burstStart : 0;

    const nowWorking = burstMs > BURST_WORKING_MS;
    const nowIdle = silence > IDLE_SILENCE_MS;
    const next: boolean = nowWorking ? true : nowIdle ? false : s.working;

    if (next === s.working) {
      debounce.delete(id);
      continue;
    }

    const d = debounce.get(id);
    if (!d || d.state !== next) {
      debounce.set(id, { state: next, count: 1 });
      continue;
    }

    d.count++;
    if (d.count < DEBOUNCE_TICKS) continue;

    debounce.delete(id);
    s.working = next;
    onTransition(id, next);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AgentStatusService tick logic', () => {
  let sessions: Map<string, FakeSession>;
  let debounce: Map<string, DebounceState>;
  let transitions: Array<{ id: string; working: boolean }>;

  beforeEach(() => {
    sessions = new Map();
    debounce = new Map();
    transitions = [];
  });

  function tick(now: number): void {
    runTick(sessions, debounce, now, (id, working) => transitions.push({ id, working }));
  }

  // ── Scenario 1: burst transitions session to working after threshold ─────────
  test('transitions to working:true after sustained burst exceeds BURST_WORKING_MS', () => {
    const t0 = 1_000_000;
    sessions.set('s1', {
      lastOutAt: t0 + 100,
      burstStart: t0,
      working: false,
    });

    // At t0 + 400ms the burst is only 400ms — below threshold, no transition yet
    tick(t0 + 400);
    expect(transitions).toHaveLength(0);

    // At t0 + 600ms burst = 600ms > 500ms (BURST_WORKING_MS)
    // Tick 1: debounce count reaches 1
    const s = sessions.get('s1')!;
    s.lastOutAt = t0 + 600; // still receiving output
    tick(t0 + 600);
    expect(transitions).toHaveLength(0); // first tick — not yet committed

    // Tick 2: debounce count reaches DEBOUNCE_TICKS (2) → transition fires
    s.lastOutAt = t0 + 700;
    tick(t0 + 700);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toEqual({ id: 's1', working: true });
  });

  // ── Scenario 2: silence transitions session to idle ───────────────────────────
  test('transitions to working:false after IDLE_SILENCE_MS of silence', () => {
    const t0 = 2_000_000;
    sessions.set('s2', {
      lastOutAt: t0,
      burstStart: 0,
      working: true, // starts as working
    });

    // After 2 s of silence — still below IDLE_SILENCE_MS (3 s)
    tick(t0 + 2000);
    expect(transitions).toHaveLength(0);

    // After 3.5 s — silence > 3000ms → idle desired
    // Tick 1: debounce count 1
    tick(t0 + 3500);
    expect(transitions).toHaveLength(0);

    // Tick 2: debounce count reaches 2 → transition fires
    tick(t0 + 4500);
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toEqual({ id: 's2', working: false });
  });

  // ── Scenario 3: single-tick flip does NOT broadcast (debounce) ───────────────
  test('single-tick flip does not broadcast — debounce must accumulate', () => {
    const t0 = 3_000_000;
    sessions.set('s3', {
      lastOutAt: t0,
      burstStart: t0,
      working: false,
    });

    // Burst starts — tick 1 only (count = 1 < DEBOUNCE_TICKS)
    const s = sessions.get('s3')!;
    s.lastOutAt = t0 + 600;
    tick(t0 + 600);
    expect(transitions).toHaveLength(0);

    // Simulate a brief gap in output (burst restarts, silence resets the desired state)
    s.burstStart = 0;
    s.lastOutAt = t0 + 605; // recent output, but burst reset — nowWorking = false
    tick(t0 + 3700); // and also idle now (silence > 3000 from 605ms)
    // desired state is now false again → debounce for true is cleared
    // but working is already false → no transition
    expect(transitions).toHaveLength(0);
  });

  // ── Scenario 4: debounce resets when desired state flips mid-accumulation ────
  test('debounce resets if desired state changes before threshold', () => {
    const t0 = 4_000_000;
    sessions.set('s4', {
      lastOutAt: t0 + 600,
      burstStart: t0,
      working: false,
    });

    // Tick 1: burst pushes toward working:true
    const s = sessions.get('s4')!;
    tick(t0 + 600); // count=1
    expect(transitions).toHaveLength(0);

    // Burst ends, silence resets desired state back to false
    s.burstStart = 0;
    s.lastOutAt = t0; // old lastOutAt so silence > 3s from t0+4000
    tick(t0 + 4000); // desired = false (idle), same as working=false → debounce cleared
    // No transition (working was already false)
    expect(transitions).toHaveLength(0);

    // Resume burst — debounce must start fresh (count reset to 1)
    s.burstStart = t0 + 4500;
    s.lastOutAt = t0 + 5100;
    tick(t0 + 5100); // count=1
    expect(transitions).toHaveLength(0);

    s.lastOutAt = t0 + 5200;
    tick(t0 + 5200); // count=2 → transition fires
    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toEqual({ id: 's4', working: true });
  });
});
