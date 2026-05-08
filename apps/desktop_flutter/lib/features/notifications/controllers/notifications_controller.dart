import 'dart:async';
import 'package:flutter/foundation.dart';
import '../models/agent_notification.dart';
import '../models/app_notification.dart';
import '../repositories/notifications_repository.dart';

/// A pending navigation request triggered by tapping a notification.
class PendingNavigation {
  PendingNavigation({required this.entityType, required this.entityId});

  /// 'task', 'rhythm', or 'project'
  final String entityType;
  final String entityId;
}

class NotificationsController extends ChangeNotifier {
  NotificationsController(this._repository);

  final NotificationsRepository _repository;

  List<AppNotification> _notifications = [];
  Timer? _pollingTimer;
  final List<AgentNotification> _agentNotifications = [];
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
    _agentNotifications.add(AgentNotification(
      id: id,
      title: title,
      body: body,
      receivedAt: DateTime.now(),
    ));
    notifyListeners();
  }

  Future<void> _poll() async {
    try {
      _notifications = await _repository.getUnread();
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
  void navigateTo(String entityType, String entityId) {
    _pendingNavigation = PendingNavigation(
      entityType: entityType,
      entityId: entityId,
    );
    notifyListeners();
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
