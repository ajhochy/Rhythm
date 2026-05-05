import { AgentSessionMessagesRepository } from '../repositories/agent_session_messages_repository';

// Matches:
//   CSI sequences:  ESC [ <params> <final>
//   OSC sequences:  ESC ] <payload> (ST or BEL)
//   Single-char:    ESC <any single char>
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\].*?(?:\x07|\x1b\\)|\x1b./g;

export class TranscriptService {
  private repo = new AgentSessionMessagesRepository();

  stripAnsi(raw: string): string {
    return raw.replace(ANSI_RE, '');
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
