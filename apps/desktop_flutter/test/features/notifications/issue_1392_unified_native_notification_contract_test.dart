import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/models/app_notification.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

class _SnapshotNotificationsRepository extends NotificationsRepository {
  _SnapshotNotificationsRepository(this.snapshots)
      : super(NotificationsDataSource());

  final List<List<AppNotification>> snapshots;
  int _readIndex = 0;

  @override
  Future<List<AppNotification>> getUnread() async {
    final index = _readIndex.clamp(0, snapshots.length - 1);
    _readIndex += 1;
    return snapshots[index];
  }
}

AppNotification _notification({
  required int id,
  required String entityType,
  required String entityId,
  required String message,
}) {
  return AppNotification(
    id: id,
    recipientUserId: 7,
    type: 'task_assigned',
    entityType: entityType,
    entityId: entityId,
    message: message,
    createdAt: '2026-08-15T08:00:00.000Z',
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
  });

  tearDown(() {
    debugDefaultTargetPlatformOverride = null;
  });

  List<MethodCall> configureNativeChannel() {
    final calls = <MethodCall>[];
    const channel = MethodChannel('dexterous.com/flutter/local_notifications');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
      calls.add(call);
      return null;
    });
    addTearDown(() {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, null);
    });
    return calls;
  }

  test(
    'issue-1392-c17: startup unread baseline does not replay native notifications',
    () async {
      // Regression caught: treating the initial unread fetch as newly arrived
      // replays every old bell item as a macOS banner on each app launch.
      final calls = configureNativeChannel();
      final repository = _SnapshotNotificationsRepository([
        [
          _notification(
            id: 10,
            entityType: 'task',
            entityId: '42',
            message: 'An existing unread task notification',
          ),
        ],
      ]);
      final controller = NotificationsController(repository);
      addTearDown(controller.dispose);

      controller.startPolling();
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      controller.stopPolling();

      expect(controller.unreadCount, 1);
      expect(calls.where((call) => call.method == 'show'), isEmpty);
    },
  );

  test(
    'issue-1392-c18: newly unread app notification pushes once with its exact navigation route',
    () async {
      // Regression caught: the bell turns red after a poll but no native push
      // is emitted, or every unchanged poll emits the same push again.
      final calls = configureNativeChannel();
      final existing = _notification(
        id: 10,
        entityType: 'task',
        entityId: '42',
        message: 'Existing unread notification',
      );
      final newlyUnread = _notification(
        id: 11,
        entityType: 'project',
        entityId: 'project-99',
        message: 'You were added to Launch Sunday',
      );
      final repository = _SnapshotNotificationsRepository([
        [existing],
        [newlyUnread, existing],
        [newlyUnread, existing],
      ]);
      final controller = NotificationsController(repository);
      addTearDown(controller.dispose);

      controller.startPolling();
      await Future<void>.delayed(Duration.zero);
      controller.startPolling();
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final firstPollShowCalls =
          calls.where((call) => call.method == 'show').toList();

      controller.startPolling();
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      final repeatedPollShowCalls =
          calls.where((call) => call.method == 'show').toList();
      controller.stopPolling();

      expect(firstPollShowCalls, hasLength(1));
      final arguments = Map<String, dynamic>.from(
        firstPollShowCalls.single.arguments as Map,
      );
      expect(arguments['title'], 'Rhythm');
      expect(arguments['body'], 'You were added to Launch Sunday');
      expect(arguments['payload'], 'notification:project:project-99');
      expect(repeatedPollShowCalls, hasLength(1));
    },
  );

  test(
    'issue-1392-c19: immediate agent notification pushes once and routes to Agents',
    () async {
      // Regression caught: an agent event increments the red bell only, while
      // duplicate WebSocket delivery increments it twice or emits two pushes.
      final calls = configureNativeChannel();
      final controller = NotificationsController(
        _SnapshotNotificationsRepository([const []]),
      );
      addTearDown(controller.dispose);

      controller.pushAgentNotification(
        id: 77,
        title: 'Agent finished',
        body: 'The requested work is ready.',
      );
      controller.pushAgentNotification(
        id: 77,
        title: 'Agent finished',
        body: 'The requested work is ready.',
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      expect(controller.unreadAgentCount, 1);
      final showCalls = calls.where((call) => call.method == 'show').toList();
      expect(showCalls, hasLength(1));
      final arguments = Map<String, dynamic>.from(
        showCalls.single.arguments as Map,
      );
      expect(arguments['title'], 'Agent finished');
      expect(arguments['body'], 'The requested work is ready.');
      expect(arguments['payload'], 'notification:agents:root');

      controller.navigateFromPayload(arguments['payload'] as String);
      expect(controller.pendingNavigation?.entityType, 'agents');
      expect(controller.pendingNavigation?.entityId, 'root');
    },
  );
}
