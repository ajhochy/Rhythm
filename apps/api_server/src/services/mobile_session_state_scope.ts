/**
 * A session row carries an authoritative execution binding only when at least
 * one execution field was actually persisted. Attaching an all-null state to
 * a response masks the engine record's own agent/model fields and lets the
 * client treat "nothing was ever bound" as known state.
 */
export function hasMobileSessionExecutionBinding(session: {
  profileId: string | null;
  providerId: string | null;
  modelId: string | null;
}): boolean {
  // opencodeAgentId is deliberately NOT a binding signal: the repository
  // backfills it from the NOT NULL agent_kind column, so every row carries
  // one whether or not anything was ever bound.
  return Boolean(
    session.profileId ||
    session.providerId ||
    session.modelId,
  );
}

export function canUpdateMobileSessionState(
  session: {
    ownerUserId: number | null;
    projectId: string | null;
  } | null | undefined,
  ownerUserId: number,
  projectId: string,
): boolean {
  if (!session || session.ownerUserId !== ownerUserId) return false;
  return session.projectId === projectId ||
    session.projectId === null ||
    session.projectId.trim() === '';
}
