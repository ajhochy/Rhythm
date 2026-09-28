import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/auth/auth_data_source.dart';
import 'package:rhythm_desktop/app/core/auth/auth_session_service.dart';
import 'package:rhythm_desktop/app/core/errors/app_error.dart';
import 'package:rhythm_desktop/features/agents/views/_inline_agent_approval_card.dart';
import 'package:rhythm_desktop/features/notifications/controllers/agent_approvals_controller.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/agent_approvals_data_source.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/models/agent_approval.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';
import 'package:rhythm_desktop/features/notifications/views/notification_panel.dart';

class _FailingApprovalsDataSource implements AgentApprovalsDataSource {
  @override
  Future<List<AgentApproval>> listPending() async =>
      throw AppError('stale session', statusCode: 401);

  @override
  Future<void> decide(AgentApproval approval, {required bool approve}) async {}
}

/// #1382 major finding: decide() can fail for reasons other than 401/403
/// (signer StateError, network error, decode error) — those must still be
/// visible, not silently swallowed while authState stays `ready`.
class _DecisionFailingApprovalsDataSource implements AgentApprovalsDataSource {
  _DecisionFailingApprovalsDataSource(this.pending);

  final List<AgentApproval> pending;

  @override
  Future<List<AgentApproval>> listPending() async => pending;

  @override
  Future<void> decide(AgentApproval approval, {required bool approve}) async {
    throw StateError('Human approval signature is unavailable');
  }
}

class _FakeAuthSessionService extends AuthSessionService {
  _FakeAuthSessionService()
      : super(AuthDataSource(baseUrl: 'http://example.invalid'));

  int signInCalls = 0;

  @override
  Future<void> signInWithGoogle() async {
    signInCalls++;
  }
}

AgentApproval _approval() => AgentApproval(
      id: 'approval-1',
      sessionId: 'session-1',
      action: 'Delegate the tainted payload',
      preview: 'External data will cross an agent boundary',
      consequence: 'Requires a human decision',
      status: 'pending',
      createdAt: DateTime.utc(2026, 9, 25),
      decisionNonce: 'nonce-1',
      payloadDigest: 'digest-1',
    );

Future<void> _enterNeedsSignIn(
  WidgetTester tester,
  AgentApprovalsController controller,
) async {
  controller.startPolling();
  await tester.pump();
  controller.stopPolling();
}

void main() {
  testWidgets('notification panel offers sign-in recovery for approval 401s', (
    tester,
  ) async {
    final approvals = AgentApprovalsController(_FailingApprovalsDataSource());
    final auth = _FakeAuthSessionService();
    await _enterNeedsSignIn(tester, approvals);

    await tester.pumpWidget(
      MultiProvider(
        providers: [
          ChangeNotifierProvider.value(value: approvals),
          ChangeNotifierProvider<AuthSessionService>.value(value: auth),
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

    expect(find.text('Sign in again to approve'), findsOneWidget);
    await tester.tap(find.widgetWithText(TextButton, 'Sign in'));
    expect(auth.signInCalls, 1);
  });

  testWidgets(
    'inline approval card offers sign-in recovery for approval 401s',
    (tester) async {
      final approvals = AgentApprovalsController(_FailingApprovalsDataSource());
      final auth = _FakeAuthSessionService();
      await _enterNeedsSignIn(tester, approvals);

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider.value(value: approvals),
            ChangeNotifierProvider<AuthSessionService>.value(value: auth),
          ],
          child: MaterialApp(
            home: Scaffold(
              body: InlineAgentApprovalCard(approval: _approval()),
            ),
          ),
        ),
      );

      expect(find.text('Sign in again to approve'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Sign in'));
      expect(auth.signInCalls, 1);
    },
  );

  testWidgets(
    'inline approval card shows a non-401/403 decision failure and keeps the card',
    (tester) async {
      final approval = _approval();
      final approvals =
          AgentApprovalsController(_DecisionFailingApprovalsDataSource([
        approval,
      ]));
      approvals.startPolling();
      await tester.pump();
      approvals.stopPolling();

      await tester.pumpWidget(
        ChangeNotifierProvider.value(
          value: approvals,
          child: MaterialApp(
            home: Scaffold(body: InlineAgentApprovalCard(approval: approval)),
          ),
        ),
      );

      // Before the decision, no error is shown yet.
      expect(find.text('Approval failed'), findsNothing);

      await tester.tap(find.widgetWithText(TextButton, 'Approve'));
      await tester.pump();

      // The signer StateError must be visible, sanitized, and the card
      // (with its retry actions) must still be present.
      expect(find.text('Approval failed'), findsOneWidget);
      expect(find.textContaining('StateError'), findsNothing);
      expect(find.textContaining('Bad state'), findsNothing);
      expect(find.widgetWithText(TextButton, 'Approve'), findsOneWidget);
      expect(find.widgetWithText(TextButton, 'Reject'), findsOneWidget);
    },
  );

  testWidgets(
    'notification panel shows a non-401/403 decision failure and keeps the card',
    (tester) async {
      final approval = _approval();
      final approvals =
          AgentApprovalsController(_DecisionFailingApprovalsDataSource([
        approval,
      ]));
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

      await tester.tap(find.widgetWithText(FilledButton, 'Approve'));
      await tester.pump();

      expect(find.text('Approval failed'), findsOneWidget);
      expect(find.textContaining('StateError'), findsNothing);
      expect(find.widgetWithText(FilledButton, 'Approve'), findsOneWidget);
      expect(find.widgetWithText(TextButton, 'Reject'), findsOneWidget);
    },
  );
}
