export type PendingNotificationSession = {
  sessionId: string;
  sessionTitle?: string;
  projectPath: string;
  settings: {
    serverUrl: string;
    username: string;
  };
  requestedAt: number;
};

type PendingNotificationSessions = Record<string, PendingNotificationSession>;

export function serializePendingNotificationSessions(value: PendingNotificationSessions) {
  const sessions: PendingNotificationSessions = {};
  for (const pending of Object.values(value)) {
    sessions[pending.sessionId] = {
      sessionId: pending.sessionId,
      ...(typeof pending.sessionTitle === 'string' ? { sessionTitle: pending.sessionTitle } : {}),
      projectPath: pending.projectPath,
      settings: {
        serverUrl: pending.settings.serverUrl,
        username: pending.settings.username,
      },
      requestedAt: pending.requestedAt,
    };
  }
  return JSON.stringify(sessions);
}

export function parsePendingNotificationSessions(raw: string): {
  sessions: PendingNotificationSessions;
  changed: boolean;
} {
  const sessions: PendingNotificationSessions = {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { sessions, changed: serializePendingNotificationSessions(sessions) !== raw };
    }

    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const pending = value as Record<string, unknown>;
      const settings = pending.settings;
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) continue;
      const connection = settings as Record<string, unknown>;
      if (
        typeof pending.sessionId !== 'string' ||
        typeof pending.projectPath !== 'string' ||
        typeof connection.serverUrl !== 'string' ||
        typeof connection.username !== 'string' ||
        typeof pending.requestedAt !== 'number' ||
        !Number.isFinite(pending.requestedAt)
      ) continue;

      sessions[pending.sessionId] = {
        sessionId: pending.sessionId,
        ...(typeof pending.sessionTitle === 'string' ? { sessionTitle: pending.sessionTitle } : {}),
        projectPath: pending.projectPath,
        settings: {
          serverUrl: connection.serverUrl,
          username: connection.username,
        },
        requestedAt: pending.requestedAt,
      };
    }
  } catch {
    // Invalid persisted data is discarded.
  }
  return { sessions, changed: serializePendingNotificationSessions(sessions) !== raw };
}

export function resolvePendingNotificationConnection(
  pending: PendingNotificationSession,
  current: { serverUrl?: string; username?: string },
  password: string | undefined,
) {
  if (!current.serverUrl || typeof current.username !== 'string') {
    return { kind: 'unavailable' } as const;
  }
  if (
    pending.settings.serverUrl !== current.serverUrl ||
    pending.settings.username !== current.username
  ) {
    return { kind: 'mismatch' } as const;
  }
  return {
    kind: 'ready',
    settings: {
      serverUrl: pending.settings.serverUrl,
      username: pending.settings.username,
      password: password ?? '',
      directory: pending.projectPath,
    },
  } as const;
}
