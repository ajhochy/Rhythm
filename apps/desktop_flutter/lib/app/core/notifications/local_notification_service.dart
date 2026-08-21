import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Signature for a handler invoked when the user taps a notification that
/// carries a routing [payload]. Used by #815 to route agent-ask notification
/// taps into [NotificationsController.navigateTo].
typedef NotificationTapHandler = void Function(String payload);

class LocalNotificationService {
  LocalNotificationService() : _plugin = FlutterLocalNotificationsPlugin();

  final FlutterLocalNotificationsPlugin _plugin;
  bool _initialized = false;
  NotificationTapHandler? _onTap;
  String? _pendingTapPayload;

  /// Optional tap handler. Set by `main.dart` so a notification tap can route
  /// the app to the relevant screen/session. Kept nullable so tests and the
  /// pre-wiring construction order never crash when a tap arrives early.
  NotificationTapHandler? get onTap => _onTap;

  set onTap(NotificationTapHandler? handler) {
    _onTap = handler;
    final pendingPayload = _pendingTapPayload;
    if (handler != null && pendingPayload != null) {
      _pendingTapPayload = null;
      handler(pendingPayload);
    }
  }

  Future<void> initialize() async {
    if (_initialized) return;

    const macos = DarwinInitializationSettings();
    const linux = LinuxInitializationSettings(defaultActionName: 'Open');
    const settings = InitializationSettings(macOS: macos, linux: linux);
    await _plugin.initialize(
      settings,
      onDidReceiveNotificationResponse: _handleTap,
    );
    _initialized = true;
  }

  void _handleTap(NotificationResponse response) {
    final payload = response.payload;
    if (payload == null || payload.isEmpty) return;
    final handler = _onTap;
    if (handler == null) {
      _pendingTapPayload = payload;
      return;
    }
    handler(payload);
  }

  /// Replays a notification that launched the app from a terminated state.
  ///
  /// `onDidReceiveNotificationResponse` only covers activations delivered to
  /// an already-running app. This method is intentionally separate from
  /// [initialize] so launch routing can run after [onTap] has been wired.
  Future<void> replayLaunchNotification() async {
    try {
      final details = await _plugin.getNotificationAppLaunchDetails();
      if (details?.didNotificationLaunchApp != true) return;
      final response = details?.notificationResponse;
      if (response != null) _handleTap(response);
    } catch (e) {
      debugPrint(
          'LocalNotificationService.replayLaunchNotification failed: $e');
    }
  }

  /// Explicitly request macOS notification authorization (#815, AC4).
  ///
  /// Fail-soft: a denial or any platform error returns `false` and is logged;
  /// it never throws, so it can never block an agent session.
  Future<bool> requestPermissions() async {
    if (!_initialized) {
      await initialize();
    }
    try {
      final macos = _plugin.resolvePlatformSpecificImplementation<
          MacOSFlutterLocalNotificationsPlugin>();
      if (macos == null) return false;
      final granted = await macos.requestPermissions(
        alert: true,
        badge: true,
        sound: true,
      );
      return granted ?? false;
    } catch (e) {
      debugPrint('LocalNotificationService.requestPermissions failed: $e');
      return false;
    }
  }

  Future<void> showMessageNotification({
    required int id,
    required String title,
    required String body,
  }) async {
    if (!_initialized) {
      await initialize();
    }

    const details = NotificationDetails(
      macOS: DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
      ),
      linux: LinuxNotificationDetails(),
    );

    await _plugin.show(id, title, body, details);
  }

  /// Show a fail-soft native notification that routes back into Rhythm.
  Future<void> showRoutedMessageNotification({
    required int id,
    required String title,
    required String body,
    required String payload,
  }) async {
    try {
      if (!_initialized) await initialize();

      const details = NotificationDetails(
        macOS: DarwinNotificationDetails(
          presentAlert: true,
          presentBadge: true,
          presentSound: true,
        ),
        linux: LinuxNotificationDetails(),
      );
      await _plugin.show(id, title, body, details, payload: payload);
    } catch (e) {
      debugPrint(
        'LocalNotificationService.showRoutedMessageNotification failed: $e',
      );
    }
  }

  /// Show a native notification for an agent permission/question ask (#815).
  ///
  /// [payload] is round-tripped to [onTap] when the user clicks the banner so
  /// the app can focus the window and open the asking session. Fail-soft: any
  /// platform error is logged and swallowed so a failing notification never
  /// blocks the session.
  Future<void> showAgentAskNotification({
    required int id,
    required String title,
    required String body,
    required String payload,
  }) async {
    if (!_initialized) {
      await initialize();
    }

    const details = NotificationDetails(
      macOS: DarwinNotificationDetails(
        presentAlert: true,
        presentBadge: true,
        presentSound: true,
      ),
      linux: LinuxNotificationDetails(),
    );

    try {
      await _plugin.show(id, title, body, details, payload: payload);
    } catch (e) {
      debugPrint(
          'LocalNotificationService.showAgentAskNotification failed: $e');
    }
  }

  /// Withdraw a previously-shown notification by its id (#815). Used when an
  /// ask is resolved so a stale banner does not linger. Fail-soft.
  Future<void> cancel(int id) async {
    try {
      await _plugin.cancel(id);
    } catch (e) {
      debugPrint('LocalNotificationService.cancel failed: $e');
    }
  }
}
