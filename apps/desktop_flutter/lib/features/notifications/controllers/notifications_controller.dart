import 'dart:async';
import 'package:flutter/foundation.dart';
import '../../../app/core/notifications/local_notification_service.dart';
import '../models/agent_notification.dart';
import '../models/app_notification.dart';
import '../repositories/notifications_repository.dart';

/// A pending navigation request triggered by tapping a notification.
class PendingNavigation {
  PendingNavigation({
    required this.entityType,
    required this.entityId,
    this.requestId,
  });

  /// 'task', 'rhythm', 'project', or 'agentSession' (#815).
  final String entityType;
  final String entityId;
  final String? requestId;
}

class NotificationsController extends ChangeNotifier {
  NotificationsController(
    this._repository, {
    LocalNotificationService? nativeNotifications,
  }) : _nativeNotifications = nativeNotifications ?? LocalNotificationService();

  final NotificationsRepository _repository;
  final LocalNotificationService _nativeNotifications;

  List<AppNotification> _notifications = [];
  Timer? _pollingTimer;
  final List<AgentNotification> _agentNotifications = [];
  final Set<int> _knownUnreadIds = {};
  final Set<int> _notifiedAgentIds = {};
  bool _hasUnreadBaseline = false;
  PendingNavigation? _pendingNavigation;

  List<AppNotification> get notifications => _notifications;
  int get unreadCount => _notifications.length + unreadAgentCount;
  PendingNavigation? get pendingNavigation => _pendingNavigation;

  List<AgentNotification> get agentNotifications =>
      List.unmodifiable(_agentNotifications.reversed.toList());

  int get unreadAgentCount =>
      _agentNotifications.where((n) => !n.isRead).length;

  /// Start polling every 60 seconds. Call once when the app is ready.
  void startPolling() {
    _pollingTimer?.cancel();
    _poll();
    _pollingTimer = Timer.periodic(const Duration(seconds: 60), (_) => _poll());
  }

  void stopPolling() {
    _pollingTimer?.cancel();
    _pollingTimer = null;
  }

  void pushAgentNotification({
    required int id,
    required String title,
    required String body,
  }) {
    if (!_notifiedAgentIds.add(id)) return;
    _agentNotifications.add(AgentNotification(
      id: id,
      title: title,
      body: body,
      receivedAt: DateTime.now(),
    ));
    unawaited(
      _nativeNotifications.showRoutedMessageNotification(
        id: id,
        title: title,
        body: body,
        payload: 'notification:agents:root',
      ),
    );
    notifyListeners();
  }

  Future<void> _poll() async {
    try {
      final next = await _repository.getUnread();
      final nextIds = next.map((notification) => notification.id).toSet();
      if (_hasUnreadBaseline) {
        for (final notification in next) {
          if (_knownUnreadIds.contains(notification.id)) continue;
          unawaited(
            _nativeNotifications.showRoutedMessageNotification(
              id: notification.id,
              title: 'Rhythm',
              body: notification.message,
              payload:
                  'notification:${notification.entityType}:${notification.entityId}',
            ),
          );
        }
      } else {
        _hasUnreadBaseline = true;
      }
      _knownUnreadIds
        ..clear()
        ..addAll(nextIds);
      _notifications = next;
      notifyListeners();
    } catch (_) {
      // Silently ignore polling errors — network may be unavailable.
    }
  }

  Future<void> markRead(int id) async {
    try {
      await _repository.markRead(id);
      _notifications = _notifications.where((n) => n.id != id).toList();
      notifyListeners();
    } catch (_) {}
  }

  Future<void> markAllRead() async {
    try {
      await _repository.markAllRead();
      _notifications = [];
      for (final n in _agentNotifications) {
        n.isRead = true;
      }
      notifyListeners();
    } catch (_) {}
  }

  /// Called when the user taps a notification. Sets [pendingNavigation] so
  /// AppShell can respond and switch to the right tab.
  void navigateTo(
    String entityType,
    String entityId, {
    String? requestId,
  }) {
    var targetEntityId = entityId;
    var targetRequestId = requestId;
    if (entityType == 'agentApproval' && targetRequestId == null) {
      final separator = entityId.indexOf(':');
      if (separator > 0 && separator < entityId.length - 1) {
        targetEntityId = entityId.substring(0, separator);
        targetRequestId = entityId.substring(separator + 1);
      }
    }
    _pendingNavigation = PendingNavigation(
      entityType: entityType,
      entityId: targetEntityId,
      requestId: targetRequestId,
    );
    notifyListeners();
  }

  /// Routes a native-notification payload to the same pending navigation used
  /// by in-app bell items. Unknown or malformed payloads are ignored.
  void navigateFromPayload(String payload) {
    const approvalPrefix = 'agentApproval:';
    const sessionPrefix = 'agentSession:';
    const notificationPrefix = 'notification:';
    const legacyNotificationPrefix = 'appNotification:';

    if (payload.startsWith(approvalPrefix)) {
      final target = payload.substring(approvalPrefix.length);
      if (target.isNotEmpty) navigateTo('agentApproval', target);
      return;
    }
    if (payload.startsWith(sessionPrefix)) {
      final sessionId = payload.substring(sessionPrefix.length);
      if (sessionId.isNotEmpty) navigateTo('agentSession', sessionId);
      return;
    }

    final prefix = payload.startsWith(notificationPrefix)
        ? notificationPrefix
        : payload.startsWith(legacyNotificationPrefix)
            ? legacyNotificationPrefix
            : null;
    if (prefix == null) return;
    final target = payload.substring(prefix.length);
    final separator = target.indexOf(':');
    if (separator <= 0 || separator >= target.length - 1) return;
    navigateTo(
      target.substring(0, separator),
      target.substring(separator + 1),
    );
  }

  /// Called by AppShell after it has handled the navigation.
  void clearPendingNavigation() {
    _pendingNavigation = null;
    notifyListeners();
  }

  @override
  void dispose() {
    stopPolling();
    super.dispose();
  }
}
