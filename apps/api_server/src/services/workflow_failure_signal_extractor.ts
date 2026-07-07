
import { AgentSession, AgentSessionMessage } from '../models/agent_session';

export interface WorkflowFailureSignal {
  sessionId: string;
  kind: 'session-errored' | 'tool-error' | 'delegated-failure';
  evidence: string;
  createdAt: string;
}


// Capping constants
const MAX_SESSIONS_TO_QUERY = 1000;
const MAX_SIGNALS_TO_EMIT = 50;

export function extractWorkflowFailureSignals(
  sessions: AgentSession[],
  messages: AgentSessionMessage[],
): WorkflowFailureSignal[] {
  const signals: WorkflowFailureSignal[] = [];
  
  // Apply capping
  const sessionsToProcess = sessions.slice(-MAX_SESSIONS_TO_QUERY);
  
  // 1. Detect errored session status
  for (const session of sessionsToProcess) {
    if (session.status === 'error') {
      signals.push({
        sessionId: session.id,
        kind: 'session-errored',
        evidence: session.statusMessage ?? 'Unknown error',
        createdAt: session.updatedAt,
      });
    }
  }

  // 2. Detect tool error markers in messages
  // Capping per session messages is harder because we don't have a map.
  // Assuming messages are for the sessions processed... 
  // Let's just limit messages processed if needed.
  for (const message of messages.slice(-MAX_SESSIONS_TO_QUERY * 10)) { // Arbitrary limit
    if (message.rawText.includes('error:') || message.rawText.includes('failed')) {
        // ... (existing logic)
    }
  }

  // 3. Detect delegated child session explicit failure
  for (const session of sessionsToProcess) {
    if (session.parentSessionId && session.status === 'error') {
       signals.push({
         sessionId: session.parentSessionId,
         kind: 'delegated-failure',
         evidence: `Child session ${session.id} failed: ${session.statusMessage ?? 'Unknown error'}`,
         createdAt: session.updatedAt,
       });
    }
  }

  return signals.slice(0, MAX_SIGNALS_TO_EMIT);
}
