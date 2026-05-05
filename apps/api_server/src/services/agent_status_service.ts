/**
 * agent_status_service.ts
 *
 * 1 Hz ticker that monitors PTY I/O bursts to detect when an agent session
 * transitions between working and idle.  Only edge transitions are broadcast;
 * a 2-tick debounce prevents flapping on mid-line ANSI sequences.
 *
 * Port of the I/O-burst logic from CLIdeck activity.js (issue #372).
 */

import { broadcast } from './ws_gateway';
import { _internal_getSessionsMap } from './pty_runner';
import { AgentSessionsRepository } from '../repositories/agent_sessions_repository';

// ─── Tunables ─────────────────────────────────────────────────────────────────

/** Minimum burst duration before a session is considered "working". */
const BURST_WORKING_MS = 500;

/** Silence duration after which a session is considered "idle". */
const IDLE_SILENCE_MS = 3000;

/** Number of consecutive ticks the desired state must hold before a transition. */
const DEBOUNCE_TICKS = 2;

// ─── Module state ─────────────────────────────────────────────────────────────

interface DebounceState {
  state: boolean;
  count: number;
}

const debounce = new Map<string, DebounceState>();
let interval: NodeJS.Timeout | null = null;

// ─── Core tick ────────────────────────────────────────────────────────────────

function tick(repo: AgentSessionsRepository): void {
  const sessions = _internal_getSessionsMap();
  const now = Date.now();

  for (const [id, s] of sessions) {
    const silence = s.lastOutAt ? now - s.lastOutAt : Infinity;
    const burstMs = s.burstStart > 0 && silence < 2000 ? now - s.burstStart : 0;

    const nowWorking = burstMs > BURST_WORKING_MS;
    const nowIdle = silence > IDLE_SILENCE_MS;
    const next: boolean = nowWorking ? true : nowIdle ? false : s.working;

    // No state change desired — clear any pending debounce
    if (next === s.working) {
      debounce.delete(id);
      continue;
    }

    // Accumulate debounce ticks
    const d = debounce.get(id);
    if (!d || d.state !== next) {
      debounce.set(id, { state: next, count: 1 });
      continue;
    }

    d.count++;
    if (d.count < DEBOUNCE_TICKS) continue;

    // Debounce satisfied — commit the transition
    debounce.delete(id);
    s.working = next;

    try {
      repo.updateStatus(id, next ? 'working' : 'idle');
    } catch {
      // Non-fatal: DB update failing should not crash the ticker
    }

    broadcast({
      v: 1,
      type: 'session.status',
      id,
      working: next,
      source: 'io_burst',
      ts: now,
    });
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function startAgentStatusService(): void {
  if (interval) return; // idempotent
  const repo = new AgentSessionsRepository();
  interval = setInterval(() => tick(repo), 1000);
}

export function stopAgentStatusService(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  debounce.clear();
}
