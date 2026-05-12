import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';

// Stage 1: cursor-positioning sequences → whitespace approximations.
// TUIs like Claude Code lay out text with these instead of literal spaces.
// ESC [ <n> C  cursor-right n columns (default 1)
// ESC [ <n> G  cursor to column n (1-based)
// ESC [ <r> ; <c> H  absolute position row r, col c
const CURSOR_RIGHT_RE = /\x1b\[(\d*)C/g;
const CURSOR_COLUMN_RE = /\x1b\[(\d+)G/g;
const CURSOR_POS_RE = /\x1b\[(\d+);(\d+)H/g;

// Stage 2: strip remaining CSI / OSC / single-char ESC sequences.
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\].*?(?:\x07|\x1b\\)|\x1b./g;

export function expandCursorMoves(raw: string): string {
  return raw
    .replace(CURSOR_RIGHT_RE, (_m, n) => ' '.repeat(Math.max(1, parseInt(n || '1', 10))))
    .replace(CURSOR_COLUMN_RE, (_m, n) => ' '.repeat(Math.max(0, parseInt(n, 10) - 1)))
    .replace(CURSOR_POS_RE, (_m, _r, c) => '\n' + ' '.repeat(Math.max(0, parseInt(c, 10) - 1)));
}

export class TranscriptService {
  private repo = new AgentSessionMessagesRepository();

  stripAnsi(raw: string): string {
    return expandCursorMoves(raw).replace(ANSI_RE, '');
  }

  async recordOutput(sessionId: string, raw: string): Promise<void> {
    try {
      this.repo.append(sessionId, 'output', raw, this.stripAnsi(raw));
    } catch {
      // fire-and-forget — failure to persist must not break the PTY stream
    }
  }

  async recordInput(sessionId: string, raw: string): Promise<void> {
    try {
      this.repo.append(sessionId, 'input', raw, this.stripAnsi(raw));
    } catch {
      // fire-and-forget
    }
  }
}
