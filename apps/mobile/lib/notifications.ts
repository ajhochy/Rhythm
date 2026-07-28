import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { buildClient } from '@/lib/opencode/client';
import { parseStoredConnectionSettings } from '@/lib/opencode/connection-persistence';
import { RHYTHM_ACCOUNT_META_KEY } from '@/lib/auth/rhythm-session-store';
import {
  parsePendingNotificationSessions,
  resolvePendingNotificationConnection,
  serializePendingNotificationSessions,
  type PendingNotificationSession,
} from '@/lib/notification-persistence';
import { clearPendingSessionInScope } from '@/lib/pending-notification-state';
import {
  createDirectMacConnectionScope,
  type DirectMacConnectionScope,
} from '@/lib/security/connection-account-scope';
import {
  connectionCredentialStore,
  directMacStateManager,
} from '@/lib/security/connection-credential-store';

const TASK_FINISHED_CHANNEL_ID = 'task-finished';
const CHAT_COMPLETION_TASK_NAME = 'opencode-chat-completion-monitor';
const BACKGROUND_MINIMUM_INTERVAL_MINUTES = 15;

export type NotificationDebugStatus = {
  platform: string;
  appOwnership?: string;
  notificationsSupported: boolean;
  backgroundMonitoringSupported: boolean;
  initialized: boolean;
  permissionGranted: boolean;
  permissionStatus: string;
  canAskAgain: boolean;
  backgroundTaskRegistered: boolean;
  backgroundTaskStatus: string;
  pendingSessionCount: number;
};

let initialized = false;

function canUseNotifications() {
  return Platform.OS !== 'web';
}

function canUseBackgroundMonitoring() {
  return Platform.OS !== 'web' && Constants.appOwnership !== 'expo';
}

function getBackgroundTaskStatusLabel(value: BackgroundTask.BackgroundTaskStatus | null) {
  if (value == null) {
    return 'unknown';
  }

  const match = Object.entries(BackgroundTask.BackgroundTaskStatus).find(([, statusValue]) => statusValue === value);
  return match?.[0] || String(value);
}

async function getCurrentDirectMacScope() {
  try {
    const accountMeta = await AsyncStorage.getItem(RHYTHM_ACCOUNT_META_KEY);
    if (!accountMeta) return null;
    const parsed: unknown = JSON.parse(accountMeta);
    const userId =
      parsed && typeof parsed === 'object'
        ? (parsed as { id?: unknown }).id
        : undefined;
    if (!Number.isSafeInteger(userId) || (userId as number) <= 0) return null;
    return directMacStateManager.getActiveScope(userId as number);
  } catch {
    return null;
  }
}

async function readPendingNotificationSessions(
  scope: DirectMacConnectionScope | null,
) {
  if (Platform.OS === 'web') {
    return {} as Record<string, PendingNotificationSession>;
  }

  try {
    if (!scope) return {} as Record<string, PendingNotificationSession>;
    const raw = await directMacStateManager.readPendingNotifications(scope);
    if (!raw) {
      return {} as Record<string, PendingNotificationSession>;
    }

    const parsed = parsePendingNotificationSessions(raw);
    if (parsed.changed) {
      await directMacStateManager.writePendingNotifications(
        scope,
        serializePendingNotificationSessions(parsed.sessions),
      );
    }
    return parsed.sessions;
  } catch {
    return {} as Record<string, PendingNotificationSession>;
  }
}

async function writePendingNotificationSessions(
  scope: DirectMacConnectionScope,
  value: Record<string, PendingNotificationSession>,
) {
  if (Platform.OS === 'web') {
    return;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    await directMacStateManager.writePendingNotifications(scope, null);
    return;
  }

  await directMacStateManager.writePendingNotifications(
    scope,
    serializePendingNotificationSessions(value),
  );
}

function buildTaskFinishedContent(title: string, body: string): Notifications.NotificationContentInput {
  return {
    title,
    body,
    sound: true,
    ...(Platform.OS === 'android' ? { channelId: TASK_FINISHED_CHANNEL_ID } : {}),
  };
}

async function scheduleLocalNotification(title: string, body: string) {
  if (!canUseNotifications()) {
    return null;
  }

  return Notifications.scheduleNotificationAsync({
    content: buildTaskFinishedContent(title, body),
    trigger: null,
  });
}

async function scheduleTaskFinishedNotification(sessionTitle?: string) {
  await scheduleLocalNotification('OpenCode finished a task', sessionTitle?.trim() || 'Task complete');
}

if (Platform.OS !== 'web' && !TaskManager.isTaskDefined(CHAT_COMPLETION_TASK_NAME)) {
  TaskManager.defineTask(CHAT_COMPLETION_TASK_NAME, async () => {
    try {
      const scope = await getCurrentDirectMacScope();
      if (!scope) return BackgroundTask.BackgroundTaskResult.Success;
      const [storedSettings, password] = await Promise.all([
        directMacStateManager.readPublicSettings(scope),
        connectionCredentialStore.getPassword(scope),
      ]);
      const currentPublicSettings = storedSettings
        ? parseStoredConnectionSettings(storedSettings).publicSettings
        : {};
      const pendingBySessionId = await readPendingNotificationSessions(scope);
      const pendingSessions = Object.values(pendingBySessionId);

      if (pendingSessions.length === 0) {
        return BackgroundTask.BackgroundTaskResult.Success;
      }

      for (const pending of pendingSessions) {
        const connection = resolvePendingNotificationConnection(pending, currentPublicSettings, password);
        if (connection.kind === 'unavailable') {
          continue;
        }
        if (connection.kind === 'mismatch') {
          delete pendingBySessionId[pending.sessionId];
          continue;
        }

        try {
          const client = buildClient(connection.settings);
          const [statusesResponse, sessionsResponse] = await Promise.all([
            client.session.status(),
            client.session.list(),
          ]);

          const status = statusesResponse?.data?.[pending.sessionId];
          if (status && status.type !== 'idle') {
            continue;
          }

          const session = sessionsResponse?.data?.find((item: { id: string; title?: string }) => item.id === pending.sessionId);
          if (!session) {
            delete pendingBySessionId[pending.sessionId];
            continue;
          }
          await scheduleTaskFinishedNotification(session?.title || pending.sessionTitle);
          delete pendingBySessionId[pending.sessionId];
        } catch {
          continue;
        }
      }

      await writePendingNotificationSessions(scope, pendingBySessionId);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

async function configureNotificationChannelAsync() {
  if (Platform.OS !== 'android' || !canUseNotifications()) {
    return;
  }

  await Notifications.setNotificationChannelAsync(TASK_FINISHED_CHANNEL_ID, {
    name: 'Task finished',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 180, 120, 180],
  });
}

export async function getNotificationPermissionsStatusAsync() {
  if (!canUseNotifications()) {
    return null;
  }

  return Notifications.getPermissionsAsync();
}

export async function ensureNotificationPermissionsAsync() {
  if (!canUseNotifications()) {
    return null;
  }

  await configureNotificationChannelAsync();

  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.granted || !permissions.canAskAgain) {
    return permissions;
  }

  return Notifications.requestPermissionsAsync();
}

export async function getNotificationDebugStatusAsync(): Promise<NotificationDebugStatus> {
  const permissions = canUseNotifications() ? await Notifications.getPermissionsAsync() : null;
  const backgroundTaskRegistered = canUseBackgroundMonitoring()
    ? await TaskManager.isTaskRegisteredAsync(CHAT_COMPLETION_TASK_NAME)
    : false;
  const backgroundTaskStatus = canUseBackgroundMonitoring()
    ? getBackgroundTaskStatusLabel(await BackgroundTask.getStatusAsync())
    : 'unsupported';
  const pendingSessionCount = Object.keys(
    await readPendingNotificationSessions(await getCurrentDirectMacScope()),
  ).length;

  return {
    platform: Platform.OS,
    appOwnership: Constants.appOwnership || undefined,
    notificationsSupported: canUseNotifications(),
    backgroundMonitoringSupported: canUseBackgroundMonitoring(),
    initialized,
    permissionGranted: permissions?.granted ?? false,
    permissionStatus: permissions?.status ?? 'unavailable',
    canAskAgain: permissions?.canAskAgain ?? false,
    backgroundTaskRegistered,
    backgroundTaskStatus,
    pendingSessionCount,
  };
}

async function registerBackgroundTaskAsync() {
  if (!canUseBackgroundMonitoring()) {
    return;
  }

  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
    return;
  }

  const registered = await TaskManager.isTaskRegisteredAsync(CHAT_COMPLETION_TASK_NAME);
  if (registered) {
    return;
  }

  await BackgroundTask.registerTaskAsync(CHAT_COMPLETION_TASK_NAME, {
    minimumInterval: BACKGROUND_MINIMUM_INTERVAL_MINUTES,
  });
}

export async function initializeNotifications() {
  if (initialized || !canUseNotifications()) {
    return;
  }

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  await configureNotificationChannelAsync();
  await registerBackgroundTaskAsync();
  initialized = true;
}

export async function trackPendingTaskFinishedNotification(
  input: PendingNotificationSession & { accountUserId: number },
) {
  await registerBackgroundTaskAsync();
  const scope = createDirectMacConnectionScope(
    input.accountUserId,
    input.settings.serverUrl,
  );
  const current = await readPendingNotificationSessions(scope);
  current[input.sessionId] = input;
  await writePendingNotificationSessions(scope, current);
}

export type PendingNotificationOrigin = {
  accountUserId: number;
  serverUrl: string;
};

export async function clearPendingTaskFinishedNotification(
  sessionId: string,
  origin: PendingNotificationOrigin,
) {
  const scope = createDirectMacConnectionScope(
    origin.accountUserId,
    origin.serverUrl,
  );
  await clearPendingSessionInScope({
    scope,
    sessionId,
    read: (targetScope) => readPendingNotificationSessions(targetScope),
    write: (targetScope, value) =>
      writePendingNotificationSessions(targetScope, value),
  });
}

export async function notifyTaskFinished(title: string, body: string) {
  await scheduleLocalNotification(title, body);
}

export async function sendTestNotificationAsync() {
  const permissions = await ensureNotificationPermissionsAsync();
  if (!permissions?.granted) {
    return false;
  }

  await scheduleLocalNotification('OpenCode notifications are on', 'This is a test notification from your device.');
  return true;
}
