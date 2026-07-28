import type { DirectMacConnectionScope } from '@/lib/security/connection-account-scope';
import type { PendingNotificationSession } from '@/lib/notification-persistence';

export async function clearPendingSessionInScope({
  scope,
  sessionId,
  read,
  write,
}: {
  scope: DirectMacConnectionScope;
  sessionId: string;
  read: (
    scope: DirectMacConnectionScope,
  ) => Promise<Record<string, PendingNotificationSession>>;
  write: (
    scope: DirectMacConnectionScope,
    value: Record<string, PendingNotificationSession>,
  ) => Promise<unknown>;
}) {
  const current = await read(scope);
  if (!current[sessionId]) return;
  delete current[sessionId];
  await write(scope, current);
}
