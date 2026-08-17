import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/features/notifications/controllers/agent_approvals_controller.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/agent_approvals_data_source.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/models/agent_approval.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

class _PendingApprovalSource implements AgentApprovalsDataSource {
  @override
  Future<List<AgentApproval>> listPending() async => [
        AgentApproval.fromJson({
          'id': 'approval-route-target',
          'sessionId': 'session-origin',
          'action': 'Authorize notification.send',
          'preview': 'Send the requested notification',
          'consequence': 'The notification is delivered',
          'status': 'pending',
          'createdAt': '2026-08-14T19:00:00.000Z',
          'decisionNonce': 'nonce-route',
          'payloadDigest': 'digest-route',
        }),
      ];

  @override
  Future<void> decide(AgentApproval approval, {required bool approve}) async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'issue-1392-c5: a new approval pushes a notification whose activation targets its session and request',
    () async {
      // Regression caught: polling can update the bell without emitting a
      // native notification, or the banner can open a generic Agents screen
      // without retaining the exact request. The native `show` assertion and
      // the session/request route assertions catch those failures.
      debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
      addTearDown(() => debugDefaultTargetPlatformOverride = null);
      const channel =
          MethodChannel('dexterous.com/flutter/local_notifications');
      final calls = <MethodCall>[];
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
        calls.add(call);
        return null;
      });
      addTearDown(() {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, null);
      });

      final approvals = AgentApprovalsController(
        _PendingApprovalSource(),
        notifications: LocalNotificationService(),
      );
      addTearDown(approvals.dispose);
      approvals.startPolling();
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);

      final showCalls = calls.where((call) => call.method == 'show').toList();
      expect(
        showCalls,
        hasLength(1),
        reason: 'The transition to a newly pending approval must emit one '
            'native push notification, not merely increment the bell.',
      );
      final arguments = Map<String, dynamic>.from(
        showCalls.single.arguments as Map,
      );
      expect(arguments['title'], contains('Approval'));
      expect(arguments['body'], contains('Authorize notification.send'));
      expect(
        arguments['payload'],
        'agentApproval:session-origin:approval-route-target',
        reason: 'The activation payload must retain both routing coordinates.',
      );

      // Activate the exact payload at the app-routing boundary. The production
      // tap wiring must decode this into an Agents navigation request carrying
      // both the originating session and the approval to focus.
      final notifications = NotificationsController(
        NotificationsRepository(NotificationsDataSource()),
      );
      addTearDown(notifications.dispose);
      final payload = arguments['payload'] as String;
      final segments = payload.split(':');
      notifications.navigateTo(
        segments.first,
        segments.skip(1).join(':'),
      );

      final dynamic route = notifications.pendingNavigation;
      expect(route.entityType, 'agentApproval');
      expect(route.entityId, 'session-origin');
      expect(
        route.requestId,
        'approval-route-target',
        reason: 'The route must target the still-open request after selecting '
            'the originating chat.',
      );

      await approvals.approve('approval-route-target');
      await Future<void>.delayed(Duration.zero);

      expect(
        calls.where((call) => call.method == 'cancel'),
        isEmpty,
        reason: 'Approving in the app must not immediately erase the native '
            'banner before the user can see or click it.',
      );
      final resolvedShowCalls =
          calls.where((call) => call.method == 'show').toList();
      expect(
        resolvedShowCalls,
        hasLength(2),
        reason: 'The actionable notification should be replaced in-place '
            'with a non-actionable resolution notification.',
      );
      final resolvedArguments = Map<String, dynamic>.from(
        resolvedShowCalls.last.arguments as Map,
      );
      expect(resolvedArguments['id'], arguments['id']);
      expect(resolvedArguments['title'], 'Approval approved');
      expect(resolvedArguments['body'], 'Authorize notification.send');
      expect(resolvedArguments['payload'], arguments['payload']);
    },
  );
}
