import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/agents/views/_inline_agent_approval_card.dart';
import 'package:rhythm_desktop/features/notifications/controllers/agent_approvals_controller.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/agent_approvals_data_source.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/models/agent_approval.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';
import 'package:rhythm_desktop/features/notifications/views/notification_panel.dart';

class _ApprovalDataSource implements AgentApprovalsDataSource {
  _ApprovalDataSource(this.approvals);

  final List<AgentApproval> approvals;

  @override
  Future<List<AgentApproval>> listPending() async => approvals;

  @override
  Future<void> decide(AgentApproval approval, {required bool approve}) async {}
}

AgentApproval _hardlineApproval() => AgentApproval(
      id: 'approval-1',
      sessionId: 'session-1',
      action: 'Authorize delegated work',
      preview: 'External payload',
      consequence: 'The next agent receives tainted context',
      status: 'pending',
      createdAt: DateTime.utc(2026, 9, 25),
      decisionNonce: 'nonce-1',
      payloadDigest: 'digest-1',
      lane: 'hardline',
      laneReason: 'external_data_taint',
    );

void main() {
  test('AgentApproval lane parsing is backward-compatible', () {
    final olderServer = AgentApproval.fromJson({
      'id': 'old-approval',
      'action': 'Old approval',
      'status': 'pending',
      'decisionNonce': 'old-nonce',
      'createdAt': '2026-09-25T00:00:00.000Z',
    });
    expect(olderServer.lane, isNull);
    expect(olderServer.laneReason, isNull);

    final currentServer = AgentApproval.fromJson({
      'id': 'current-approval',
      'action': 'Current approval',
      'status': 'pending',
      'decisionNonce': 'current-nonce',
      'createdAt': '2026-09-25T00:00:00.000Z',
      'lane': 'hardline',
      'laneReason': 'external_data_taint',
    });
    expect(currentServer.lane, 'hardline');
    expect(currentServer.laneReason, 'external_data_taint');
  });

  testWidgets('hardline labels appear in the inline approval card', (
    tester,
  ) async {
    final approval = _hardlineApproval();
    final controller = AgentApprovalsController(_ApprovalDataSource([]));
    await tester.pumpWidget(
      ChangeNotifierProvider.value(
        value: controller,
        child: MaterialApp(
          home: Scaffold(body: InlineAgentApprovalCard(approval: approval)),
        ),
      ),
    );

    expect(find.text("Bypass mode can't approve this"), findsOneWidget);
    expect(
      find.text('External data requires a human approval.'),
      findsOneWidget,
    );
  });

  testWidgets('hardline labels appear in the notification panel', (
    tester,
  ) async {
    final approval = _hardlineApproval();
    final approvals = AgentApprovalsController(_ApprovalDataSource([approval]));
    approvals.startPolling();
    await tester.pump();
    approvals.stopPolling();

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: approvals),
          ChangeNotifierProvider(
            create: (_) => NotificationsController(
              NotificationsRepository(
                NotificationsDataSource(baseUrl: 'http://example.invalid'),
              ),
            ),
          ),
        ],
        child: const MaterialApp(home: Scaffold(body: NotificationPanel())),
      ),
    );

    expect(find.text("Bypass mode can't approve this"), findsOneWidget);
    expect(
      find.text('External data requires a human approval.'),
      findsOneWidget,
    );
  });
}
