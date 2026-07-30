/**
 * Machine-readable failure taxonomy for headless/scheduled agent runs.
 *
 * Teacher escalation is intentionally fail-closed: an unknown failure is
 * infrastructure/configuration, never model quality. Callers that have
 * positive evidence of a quality failure may set `failureCategory` explicitly.
 */
export type AgentRunFailureCategory =
  | 'engine_not_ready'
  | 'required_mcp_unavailable'
  | 'restart_interruption'
  | 'authentication'
  | 'permission'
  | 'infra_config'
  | 'model_quality';

export interface AgentRunFailureInput {
  error?: unknown;
  errorCode?: string;
  failureCategory?: AgentRunFailureCategory;
}

export interface AgentRunFailureClassification {
  category: AgentRunFailureCategory;
  teacherRetryable: boolean;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error == null) return '';
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * Classify an agent-run failure and decide whether a stronger model can help.
 * Pattern order is significant: actionable infra signals win over generic
 * model-output wording (for example an unauthenticated model returning no
 * output is authentication, not model quality).
 */
export function classifyAgentRunFailure(
  input: AgentRunFailureInput,
): AgentRunFailureClassification {
  if (input.failureCategory) {
    return {
      category: input.failureCategory,
      teacherRetryable: input.failureCategory === 'model_quality',
    };
  }

  const text = errorText(input.error).toLowerCase();

  let category: AgentRunFailureCategory;
  if (/required mcp unavailable|required[-_ ]mcp/.test(text)) {
    category = 'required_mcp_unavailable';
  } else if (
    /(?:opencode|engine).*(?:not ready|not initialized|unavailable)/.test(text) ||
    /(?:econnrefused|connection refused|socket hang up)/.test(text)
  ) {
    category = 'engine_not_ready';
  } else if (
    /server restart|restarted|restarting|run interrupted|connection interrupted/.test(text)
  ) {
    category = 'restart_interruption';
  } else if (
    /\b(?:401|unauthorized|unauthenticated|authentication|credentials?|api[-_ ]?key|token expired|reconnect required)\b/.test(
      text,
    )
  ) {
    category = 'authentication';
  } else if (
    /\b(?:403|forbidden|permission denied|permission failure|eacces|eperm)\b/.test(text)
  ) {
    category = 'permission';
  } else if (
    /model.*(?:quality gate|failed (?:the )?(?:output-)?quality|no progress)/.test(text)
  ) {
    category = 'model_quality';
  } else {
    // Includes capacity/profile policy rejections and every unknown SDK,
    // transport, provider, or configuration failure. A teacher model cannot
    // repair these, so the safe default is non-retryable infrastructure.
    category = 'infra_config';
  }

  return {
    category,
    teacherRetryable: category === 'model_quality',
  };
}

/** Prefix a durable task/session result once with its machine-readable class. */
export function formatAgentRunFailure(
  input: AgentRunFailureInput,
  fallbackMessage = 'Agent run failed',
): string {
  const classification = classifyAgentRunFailure(input);
  const message = errorText(input.error).trim() || fallbackMessage;
  const prefix = `[${classification.category}]`;
  return message.startsWith(prefix) ? message : `${prefix} ${message}`;
}
