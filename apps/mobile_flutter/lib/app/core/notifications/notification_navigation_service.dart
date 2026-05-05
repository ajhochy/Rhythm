import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

import 'local_notification_service.dart';

/// Bridges notification taps to in-app navigation.
///
/// Subscribe to [LocalNotificationService.tapPayloads] and expose the most
/// recent task-id payload as [pendingTaskId]. Consumers (e.g. [AppShell])
/// watch this notifier and clear it via [clear] once the target has been
/// highlighted.
class NotificationNavigationService extends ChangeNotifier {
  NotificationNavigationService(LocalNotificationService notificationService) {
    _sub = notificationService.tapPayloads.listen(_onPayload);
  }

  late final StreamSubscription<String?> _sub;

  String? _pendingTaskId;

  /// The task id most recently delivered by a notification tap, or `null` if
  /// there is no pending navigation request.
  String? get pendingTaskId => _pendingTaskId;

  /// Clears the pending task id after the UI has handled the highlight.
  void clear() {
    if (_pendingTaskId != null) {
      _pendingTaskId = null;
      notifyListeners();
    }
  }

  /// Reads the notification that launched the app from a cold/terminated state.
  ///
  /// Must be called before [runApp] (or at least before [TodayView] first
  /// builds) so the payload is not missed.
  Future<void> consumeColdStart() async {
    final plugin = FlutterLocalNotificationsPlugin();
    final details = await plugin.getNotificationAppLaunchDetails();
    if (details != null &&
        details.didNotificationLaunchApp &&
        details.notificationResponse?.payload != null) {
      _onPayload(details.notificationResponse!.payload);
    }
  }

  void _onPayload(String? payload) {
    if (payload != null && payload.isNotEmpty) {
      _pendingTaskId = payload;
      notifyListeners();
    }
  }

  @override
  void dispose() {
    _sub.cancel();
    super.dispose();
  }
}
