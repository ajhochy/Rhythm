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

/**
 * #1576 S2 — one served-identity stamp per engine step-finish part.
 *
 * `servedModelId`/`servedResponseId` are provider-controlled strings, never
 * trusted verbatim: the repository sanitizes them to a bounded identifier
 * shape or the `<unrecognized>` sentinel before they ever reach SQL. No
 * prompt/response content is carried here — see the table comment in
 * migrations.ts.
 */
export interface ServedStepInput {
  sessionId: string;
  sdkMessageId: string;
  sdkPartId: string;
  /** The alias/model that was actually requested for this step, if known. */
  requestModelId?: string | null;
  /** The model that actually served the step, per the engine/provider. */
  servedModelId: string;
  /** Upstream generation id (e.g. OpenRouter's), if the provider supplied one. */
  servedResponseId?: string | null;
}

export interface ServedStepRecord {
  id: string;
  sessionId: string;
  sdkMessageId: string;
  sdkPartId: string;
  requestModelId: string | null;
  servedModelId: string;
  servedResponseId: string | null;
  createdAt: string;
}
