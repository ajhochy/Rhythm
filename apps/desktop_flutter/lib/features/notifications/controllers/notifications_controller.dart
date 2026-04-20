import 'dart:async';
import 'package:flutter/foundation.dart';
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
  PendingNavigation? _pendingNavigation;

  List<AppNotification> get notifications => _notifications;
  int get unreadCount => _notifications.length;
  PendingNavigation? get pendingNavigation => _pendingNavigation;

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
