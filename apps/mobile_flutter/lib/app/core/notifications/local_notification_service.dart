import 'dart:async';

import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:timezone/data/latest_all.dart' as tz;
import 'package:timezone/timezone.dart' as tz;

/// Wrapper around [FlutterLocalNotificationsPlugin] for scheduling local
/// task-reminder notifications on iOS and Android.
///
/// Usage:
///   final svc = LocalNotificationService();
///   await svc.initialize();          // call once at startup
///   await svc.requestPermissions();  // call before first schedule
///   await svc.scheduleNotification(
///     id: 1,
///     when: DateTime.now().add(const Duration(seconds: 30)),
///     title: 'Test',
///     body: 'It works',
///   );
class LocalNotificationService {
  LocalNotificationService();

  final FlutterLocalNotificationsPlugin _plugin =
      FlutterLocalNotificationsPlugin();

  final _tapController = StreamController<String?>.broadcast();

  /// Emits the notification payload whenever the user taps a notification.
  Stream<String?> get tapPayloads => _tapController.stream;

  bool _initialized = false;

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  /// Sets up the notifications plugin for iOS and Android.
  /// Must be called once before any other method.
  Future<void> initialize() async {
    if (_initialized) return;

    // Initialize timezone database and set local timezone.
    tz.initializeTimeZones();
    final locationName = tz.local.name;
    // Use the device's local timezone. If already set to the correct location
    // this is a no-op; we set it explicitly to be safe.
    try {
      tz.setLocalLocation(tz.getLocation(locationName));
    } catch (_) {
      // Fallback: UTC (timezone name may not match database entry).
    }

    const androidSettings =
        AndroidInitializationSettings('ic_stat_notification');

    const iosSettings = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );

    const initSettings = InitializationSettings(
      android: androidSettings,
      iOS: iosSettings,
    );

    await _plugin.initialize(
      initSettings,
      onDidReceiveNotificationResponse: _onNotificationResponse,
      onDidReceiveBackgroundNotificationResponse: _onBackgroundResponse,
    );

    _initialized = true;
  }

  // -------------------------------------------------------------------------
  // Permissions
  // -------------------------------------------------------------------------

  /// Requests the platform notification permission.
  ///
  /// On iOS this shows the system permission dialog (alert + badge + sound).
  /// On Android 13+ this shows the POST_NOTIFICATIONS runtime permission dialog.
  ///
  /// Returns `true` if permission was granted.
  ///
  /// Call this just before the first scheduled notification — do NOT call at
  /// app launch (deferred prompt gives better UX).
  Future<bool> requestPermissions() async {
    final impl = _plugin.resolvePlatformSpecificImplementation<
        IOSFlutterLocalNotificationsPlugin>();
    if (impl != null) {
      final granted = await impl.requestPermissions(
        alert: true,
        badge: true,
        sound: true,
      );
      return granted ?? false;
    }

    final androidImpl = _plugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    if (androidImpl != null) {
      final granted = await androidImpl.requestNotificationsPermission();
      return granted ?? false;
    }

    // Permissions not needed on other platforms (macOS/Linux desktop).
    return true;
  }

  // -------------------------------------------------------------------------
  // Scheduling
  // -------------------------------------------------------------------------

  /// Schedules a local notification to fire at [when] (wall-clock time).
  ///
  /// [id] must be unique per notification; re-using an id replaces an existing
  /// scheduled notification.
  /// [payload] is forwarded to [tapPayloads] when the notification is tapped.
  Future<void> scheduleNotification({
    required int id,
    required DateTime when,
    required String title,
    String? body,
    String? payload,
  }) async {
    assert(_initialized, 'Call initialize() before scheduleNotification()');

    const androidDetails = AndroidNotificationDetails(
      'rhythm_reminders',
      'Task Reminders',
      channelDescription: 'Rhythm task reminder notifications',
      importance: Importance.high,
      priority: Priority.high,
      icon: 'ic_stat_notification',
    );

    const iosDetails = DarwinNotificationDetails(
      presentAlert: true,
      presentBadge: true,
      presentSound: true,
    );

    const details = NotificationDetails(
      android: androidDetails,
      iOS: iosDetails,
    );

    final scheduledTime = tz.TZDateTime.from(when, tz.local);

    await _plugin.zonedSchedule(
      id,
      title,
      body,
      scheduledTime,
      details,
      androidScheduleMode: AndroidScheduleMode.exactAllowWhileIdle,
      uiLocalNotificationDateInterpretation:
          UILocalNotificationDateInterpretation.absoluteTime,
      payload: payload,
    );
  }

  // -------------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------------

  /// Cancels all scheduled and delivered notifications.
  Future<void> cancelAll() async {
    await _plugin.cancelAll();
  }

  /// Cancels a single notification by [id].
  Future<void> cancel(int id) async {
    await _plugin.cancel(id);
  }

  // -------------------------------------------------------------------------
  // Dispose
  // -------------------------------------------------------------------------

  void dispose() {
    _tapController.close();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  void _onNotificationResponse(NotificationResponse response) {
    _tapController.add(response.payload);
  }
}

/// Top-level callback required by flutter_local_notifications for background
/// notification responses (e.g. taps while app is terminated).
@pragma('vm:entry-point')
void _onBackgroundResponse(NotificationResponse response) {
  // Background isolate — no access to app state.
  // The payload will be handled when the app next opens via the tap stream.
}
