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
