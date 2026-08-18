import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/layout/app_shell.dart';
import 'package:rhythm_desktop/features/notifications/controllers/agent_approvals_controller.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/agent_approvals_data_source.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/models/agent_approval.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

class _FakeAgentApprovalsDataSource implements AgentApprovalsDataSource {
  List<AgentApproval> pending = [];

  @override
  Future<List<AgentApproval>> listPending() async => pending;

  @override
  Future<void> decide(AgentApproval approval, {required bool approve}) async {}
}

AgentApproval _approval(String id) => AgentApproval(
      id: id,
      action: 'Authorize live-artifact.bundle.update',
      preview: null,
      consequence: null,
      status: 'pending',
      createdAt: DateTime.now(),
      decisionNonce: 'nonce-$id',
      payloadDigest: null,
    );

void main() {
  group('notificationBadgeCount', () {
    test(
        'includes pending agent approvals so a blocked security gate always pings the bell',
        () async {
      final approvalsController = AgentApprovalsController(
        _FakeAgentApprovalsDataSource()
          ..pending = [_approval('a1'), _approval('a2')],
      );
      approvalsController.startPolling();
      await Future<void>.delayed(Duration.zero);

      final notifications = NotificationsController(
        NotificationsRepository(NotificationsDataSource()),
      );

      // Regression for the invisible-approval bug: before this fix, the bell
      // badge was sourced only from NotificationsController.unreadCount, so
      // two pending rhythm_request_approval calls produced zero visible
      // signal anywhere in the desktop UI.
      expect(
        notificationBadgeCount(
          notifications: notifications,
          approvals: approvalsController,
        ),
        2,
      );

      approvalsController.stopPolling();
    });
  });
}
