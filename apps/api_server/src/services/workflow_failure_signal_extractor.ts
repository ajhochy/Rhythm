
import { AgentSession, AgentSessionMessage } from '../models/agent_session';

export type WorkflowFailureSignalKind =
  | 'session-errored'
  | 'tool-error'
  | 'delegated-failure'
  | 'workflow-adherence'
  | 'process-health';

export interface WorkflowFailureSignal {
  sessionId: string;
  kind: WorkflowFailureSignalKind;
  evidence: string;
  createdAt: string;
  /** Source message row when the signal came from transcript text. */
  messageId?: number;
  /** Canonical workflow/process category when detectable (W1-W7, P1-P4, or workflow-run-error). */
  workflowCategory?: string;
  /** Skill/profile that should receive the prompt/process repair. */
  affectedSkill?: string;
}


// Capping constants
const MAX_SESSIONS_TO_QUERY = 1000;
const MAX_SIGNALS_TO_EMIT = 50;
const MAX_EVIDENCE_CHARS = 500;

const WORKFLOW_SKILLS = new Set([
  'acceptance-contract',
  'coding-agent',
  'failure-triage',
  'issue-writer',
  'planning-agent',
  'project-state-updater',
  'prompt-evolver',
  'smoke-test-writer',
  'verification-gate',
  'workflow-orchestrator',
  'workflow-retrospective',
]);

const CATEGORY_TARGET_HINTS: Record<string, string> = {
  P1: 'workflow-orchestrator',
  P2: 'workflow-orchestrator',
  P3: 'acceptance-contract',
  P4: 'acceptance-contract',
  W1: 'workflow-orchestrator',
  W2: 'workflow-orchestrator',
  W3: 'workflow-orchestrator',
  W4: 'workflow-orchestrator',
  W5: 'verification-gate',
  W6: 'workflow-orchestrator',
  W7: 'workflow-retrospective',
};

function compactEvidence(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_EVIDENCE_CHARS);
}

function categoryFromText(text: string): { kind: 'workflow-adherence' | 'process-health'; category: string } | null {
  const match = text.match(/\b(W[1-7]|P[1-4])\b/i);
  if (!match) return null;
  const category = match[1].toUpperCase();
  return {
    kind: category.startsWith('W') ? 'workflow-adherence' : 'process-health',
    category,
  };
}

function findWorkflowSkill(text: string): string | null {
  const lower = text.toLowerCase();
  for (const skill of WORKFLOW_SKILLS) {
    if (lower.includes(skill)) return skill;
  }
  return null;
}

function explicitAffectedSkill(text: string): string | null {
  const match = text.match(/affected\s+skill\s*[:=]\s*`?([a-z0-9][a-z0-9-]*)`?/i);
  if (!match) return null;
  const value = match[1].toLowerCase();
  return WORKFLOW_SKILLS.has(value) ? value : null;
}

function affectedSkillForSignal(
  text: string,
  category: string,
  session: AgentSession | undefined,
): string {
  const explicit = explicitAffectedSkill(text);
  if (explicit) return explicit;

  const hinted = CATEGORY_TARGET_HINTS[category];
  if (hinted) return hinted;

  const mentioned = findWorkflowSkill(text);
  if (mentioned) return mentioned;

  if (session?.mcpRole && WORKFLOW_SKILLS.has(session.mcpRole)) {
    return session.mcpRole;
  }

  return 'workflow-orchestrator';
}

export function extractWorkflowFailureSignals(
  sessions: AgentSession[],
  messages: AgentSessionMessage[],
): WorkflowFailureSignal[] {
  const signals: WorkflowFailureSignal[] = [];
  const seen = new Set<string>();
  
  // Apply capping
  const sessionsToProcess = sessions.slice(-MAX_SESSIONS_TO_QUERY);
  const sessionsById = new Map(sessionsToProcess.map((session) => [session.id, session]));

  const pushSignal = (signal: WorkflowFailureSignal) => {
    const key = [
      signal.kind,
      signal.sessionId,
      signal.messageId ?? '',
      signal.workflowCategory ?? '',
      signal.affectedSkill ?? '',
      signal.evidence,
    ].join('::');
    if (seen.has(key)) return;
    seen.add(key);
    signals.push(signal);
  };
  
  // 1. Detect errored session status
  for (const session of sessionsToProcess) {
    if (session.status === 'error') {
      const evidence = session.statusMessage ?? 'Unknown error';
      pushSignal({
        sessionId: session.id,
        kind: 'session-errored',
        evidence,
        createdAt: session.updatedAt,
      });
      if (session.mcpRole && WORKFLOW_SKILLS.has(session.mcpRole)) {
        pushSignal({
          sessionId: session.id,
          kind: 'workflow-adherence',
          evidence: compactEvidence(`Workflow agent '${session.mcpRole}' errored: ${evidence}`),
          createdAt: session.updatedAt,
          workflowCategory: 'workflow-run-error',
          affectedSkill: session.mcpRole,
        });
      }
    }
  }

  // 2. Detect tool/workflow error markers in recent workflow transcript text.
  for (const message of messages.slice(-MAX_SESSIONS_TO_QUERY * 10)) {
    const session = sessionsById.get(message.sessionId);
    const rawText = message.rawText || message.strippedText || '';
    const evidence = compactEvidence(rawText);
    if (!evidence) continue;

    const categorized = categoryFromText(evidence);
    if (categorized) {
      pushSignal({
        sessionId: message.sessionId,
        kind: categorized.kind,
        evidence,
        createdAt: message.createdAt,
        messageId: message.id,
        workflowCategory: categorized.category,
        affectedSkill: affectedSkillForSignal(evidence, categorized.category, session),
      });
      continue;
    }

    if (
      session?.mcpRole &&
      WORKFLOW_SKILLS.has(session.mcpRole) &&
      /\b(error:|failed|failure|aborted)\b/i.test(evidence)
    ) {
      pushSignal({
        sessionId: message.sessionId,
        kind: 'tool-error',
        evidence,
        createdAt: message.createdAt,
        messageId: message.id,
        workflowCategory: 'tool-error',
        affectedSkill: session.mcpRole,
      });
    }
  }

  // 3. Detect delegated child session explicit failure
  for (const session of sessionsToProcess) {
    if (session.parentSessionId && session.status === 'error') {
       pushSignal({
         sessionId: session.parentSessionId,
         kind: 'delegated-failure',
         evidence: `Child session ${session.id} failed: ${session.statusMessage ?? 'Unknown error'}`,
         createdAt: session.updatedAt,
       });
    }
  }

  return signals.slice(0, MAX_SIGNALS_TO_EMIT);
}
