/** #1576 B1: server-owned local dispatch metadata; no prompt or provider payloads. */
export type DispatchOutcome = 'pending' | 'accepted' | 'rejected' | 'unknown';
export type DispatchOrigin = 'ws_input' | 'fallback_redispatch' | 'agent_runner' | 'delegation' | 'delegation_completion' | 'approval_continuation' | 'prompt_api' | 'unspecified';
export type RequestedSource = 'turn_override' | 'session' | 'agent_config' | 'agent_default' | 'tier' | 'fallback_chain' | 'caller';

export interface DispatchInput {
  sessionId: string;
  sdkSessionId?: string | null;
  sdkUserMessageId?: string | null;
  origin: DispatchOrigin;
  requestedSource: RequestedSource;
  requestedProviderId?: string | null;
  requestedModelId?: string | null;
  requestedTier?: string | null;
  resolvedProviderId?: string | null;
  resolvedModelId?: string | null;
  resolvedTier?: string | null;
  overrideApplied?: boolean;
  downgraded?: boolean;
  routeAuthed?: boolean | null;
  finalProviderId?: string | null;
  finalModelId?: string | null;
  /** Closed, bounded server classification, never a raw provider error. */
  reasonCode?: string | null;
  predecessorId?: string | null;
}

export interface DispatchRecord extends Required<Omit<DispatchInput, 'routeAuthed'>> {
  id: string;
  routeAuthed: boolean | null;
  outcome: DispatchOutcome;
  createdAt: string;
  updatedAt: string;
}
