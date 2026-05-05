import '../../../app/core/notifications/local_notification_service.dart';
import '../../tasks/controllers/tasks_controller.dart';
import '../utils/quiet_hours.dart';
import 'reminder_preferences_service.dart';

/// Orchestrates local notification scheduling based on [TasksController] and
/// [ReminderPreferencesService].
///
/// Call [reschedule] whenever either the task list or the preferences change,
/// or when the app returns to the foreground.
///
/// Example wiring in main.dart:
/// ```dart
/// tasksController.addListener(scheduler.reschedule);
/// prefsService.addListener(scheduler.reschedule);
/// ```
class ReminderScheduler {
  ReminderScheduler({
    required TasksController tasksController,
    required LocalNotificationService notificationService,
    required ReminderPreferencesService preferencesService,
  })  : _tasks = tasksController,
        _notifications = notificationService,
        _prefs = preferencesService;

  final TasksController _tasks;
  final LocalNotificationService _notifications;
  final ReminderPreferencesService _prefs;

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /// Cancels all pending notifications and re-schedules them based on the
  /// current task list and preferences.
  ///
  /// Silently no-ops if the user has not granted notification permission (the
  /// permission check is implicit — [scheduleNotification] will throw on some
  /// platforms if not granted, so we guard with a try/catch per notification).
  Future<void> reschedule() async {
    final prefs = _prefs.preferences;

    // Kill switch — clear all and exit.
    if (!prefs.enabled) {
      await _notifications.cancelAll();
      return;
    }

    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);

    // Build the wall-clock DateTime at which today's reminders should fire.
    final reminderDateTime = DateTime(
      today.year,
      today.month,
      today.day,
      prefs.reminderTime.hour,
      prefs.reminderTime.minute,
    );

    // Cancel everything first so stale notifications don't linger.
    await _notifications.cancelAll();

    // Skip if reminder time has already passed for today.
    if (reminderDateTime.isBefore(now)) {
      return;
    }

    // Skip if reminder time falls inside quiet hours.
    if (isInQuietHours(
        reminderDateTime, prefs.quietHoursStart, prefs.quietHoursEnd)) {
      return;
    }

    // Schedule one notification per today task that isn't done.
    for (final task in _tasks.todayTasks) {
      final id = task.id.hashCode & 0x7FFFFFFF;

      // Body is task title; subtitle (iOS) / notification title uses source name
      // when available — map to flutter_local_notifications title/body order.
      final title = task.sourceName != null ? task.sourceName! : 'Rhythm';
      final body = task.title;

      try {
        await _notifications.scheduleNotification(
          id: id,
          when: reminderDateTime,
          title: title,
          body: body,
          payload: task.id,
        );
      } catch (_) {
        // Permission not granted or platform error — silently skip.
      }
    }
  }
}
