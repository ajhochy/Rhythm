/**
 * The one strict encoding of the exact child-completion callback marker that
 * the completion producer, durable dispatch provenance insert and callback
 * lookup all share. The marker is provenance SHAPE only, never authority: the
 * consumer still re-proves owner/project/root/profile/SDK/goal/delegation/
 * child/native user message from durable records.
 */
export const COORDINATOR_CALLBACK_MARKER_PREFIX = 'c2_goal_callback:';

/** Only the UUID-like delegation ids the delegation repository mints. */
const DELEGATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export function encodeCoordinatorCallbackMarker(delegationId: unknown): string | null {
  return typeof delegationId === 'string' && DELEGATION_ID.test(delegationId)
    ? `${COORDINATOR_CALLBACK_MARKER_PREFIX}${delegationId}`
    : null;
}

/** The delegation id inside a strictly valid marker, else null. */
export function parseCoordinatorCallbackMarker(reasonCode: unknown): string | null {
  if (typeof reasonCode !== 'string' || !reasonCode.startsWith(COORDINATOR_CALLBACK_MARKER_PREFIX)) return null;
  const id = reasonCode.slice(COORDINATOR_CALLBACK_MARKER_PREFIX.length);
  return DELEGATION_ID.test(id) ? id : null;
}

/**
 * The single narrow exception to the generic dispatch reason-code shape: a
 * valid marker is accepted ONLY with origin `delegation_completion` and
 * requestedSource `agent_config`. Anything else keeps the generic rule.
 */
export function isCoordinatorCallbackProvenance(input: {
  origin?: unknown;
  requestedSource?: unknown;
  reasonCode?: unknown;
}): boolean {
  return input.origin === 'delegation_completion' && input.requestedSource === 'agent_config' &&
    parseCoordinatorCallbackMarker(input.reasonCode) !== null;
}
