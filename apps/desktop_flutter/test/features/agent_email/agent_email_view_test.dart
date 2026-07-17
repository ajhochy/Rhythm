/// Widget tests for AgentEmailView.
///
/// Asserts:
///   1. Signal list renders subject lines from a fake controller.
///   2. Empty-state widget renders when signals list is empty.
///   3. "Launch email assistant" button is present.
///   4. Tapping the button calls createSession with mcpRole 'email-assistant'.
///   5. Tapping the button calls selectSession on the returned session.
///   6. Tapping the button stages a composer draft for the new session.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agent_email/controllers/agent_email_controller.dart';
import 'package:rhythm_desktop/features/agent_email/data/agent_email_data_source.dart';
import 'package:rhythm_desktop/features/agent_email/models/gmail_signal.dart';
import 'package:rhythm_desktop/features/agent_email/repositories/agent_email_repository.dart';
import 'package:rhythm_desktop/features/agent_email/views/agent_email_view.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

class _FakeApiServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null, failureMessage: null);

  @override
  void stop() {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _ReadyAgentServerController extends AgentServerController {
  _ReadyAgentServerController() : super(_FakeApiServerService());

  @override
  AgentServerStatus get status => AgentServerStatus.ready;

  @override
  bool get isReady => true;

  @override
  bool get hasAnyAgent => true;

  @override
  Future<void> initialize() async {}
}

class _StubAgentsRepository implements AgentsRepository {
  final StreamController<AgentWsMessage> _msgCtrl =
      StreamController<AgentWsMessage>.broadcast();
  final StreamController<bool> _connCtrl = StreamController<bool>.broadcast();

  // Track createSession calls for assertions.
  String? lastMcpRole;

  @override
  Stream<AgentWsMessage> get messages => _msgCtrl.stream;

  @override
  Stream<bool> get connectivityStream => _connCtrl.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msgCtrl.close();
    await _connCtrl.close();
  }

  @override
  void send(Map<String, dynamic> msg) {}

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async =>
      const [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    final now = DateTime.now();
    return (
      session: AgentSession(
        id: id,
        agentId: '',
        name: '',
        cwd: '',
        status: AgentSessionStatus.idle,
        createdAt: now,
        updatedAt: now,
      ),
      messages: const <AgentSessionMessage>[],
    );
  }

  @override
  Future<AgentSession> createSession({
    String? agentId,
    String? taskId,
    required String cwd,
    String name = '',
    String? branch,
    String? stash,
    bool createBranch = false,
    String? mcpRole,
    String? anthropicAccountId,
    bool isolateWorktree = false,
    String? worktreeName,
  }) async {
    lastMcpRole = mcpRole;
    final now = DateTime.now();
    return AgentSession(
      id: 'test-session-id',
      agentId: agentId ?? '',
      name: name,
      cwd: cwd,
      status: AgentSessionStatus.idle,
      createdAt: now,
      updatedAt: now,
    );
  }

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeLocalNotificationService extends LocalNotificationService {
  @override
  Future<void> showMessageNotification({
    required int id,
    required String title,
    required String body,
  }) async {}
}

class _FakeNotificationsController extends NotificationsController {
  _FakeNotificationsController()
      : super(NotificationsRepository(NotificationsDataSource()));
}

class _FakeEmailDataSource extends AgentEmailDataSource {
  _FakeEmailDataSource(this._signals) : super(baseUrl: 'http://localhost');

  final List<AgentEmailGmailSignal> _signals;

  @override
  Future<List<AgentEmailGmailSignal>> listSignals() async => _signals;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

AgentEmailGmailSignal _makeSignal(String id, String subject) =>
    AgentEmailGmailSignal(
      id: id,
      fromName: 'Test Sender',
      fromEmail: 'test@example.com',
      subject: subject,
      isUnread: false,
    );

Future<Widget> _buildApp({
  required AgentEmailController emailController,
  required AgentsController agentsController,
}) async {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentEmailController>.value(
        value: emailController,
      ),
      ChangeNotifierProvider<AgentsController>.value(
        value: agentsController,
      ),
    ],
    child: const MaterialApp(home: AgentEmailView()),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _StubAgentsRepository stubRepo;
  late AgentsController agentsController;

  setUp(() {
    stubRepo = _StubAgentsRepository();
    agentsController = AgentsController(
      stubRepo,
      _ReadyAgentServerController(),
      _FakeLocalNotificationService(),
      _FakeNotificationsController(),
    );
  });

  tearDown(() {
    agentsController.dispose();
  });

  group('AgentEmailView', () {
    testWidgets('renders subject lines from controller', (tester) async {
      final signals = [
        _makeSignal('s1', 'Alpha Subject'),
        _makeSignal('s2', 'Beta Subject'),
      ];
      final dataSource = _FakeEmailDataSource(signals);
      final emailController = AgentEmailController(
        AgentEmailRepository(dataSource),
      );
      await emailController.loadSignals();

      await tester.pumpWidget(
        await _buildApp(
          emailController: emailController,
          agentsController: agentsController,
        ),
      );
      await tester.pump();

      expect(
        find.text('Alpha Subject'),
        findsOneWidget,
        reason: 'Alpha Subject should render',
      );
      expect(
        find.text('Beta Subject'),
        findsOneWidget,
        reason: 'Beta Subject should render',
      );

      emailController.dispose();
    });

    testWidgets('renders empty state when signals list is empty',
        (tester) async {
      final dataSource = _FakeEmailDataSource([]);
      final emailController = AgentEmailController(
        AgentEmailRepository(dataSource),
      );
      await emailController.loadSignals();

      await tester.pumpWidget(
        await _buildApp(
          emailController: emailController,
          agentsController: agentsController,
        ),
      );
      await tester.pump();

      expect(
        find.byKey(const ValueKey('email-empty-state')),
        findsOneWidget,
        reason: 'Empty state should render when signals list is empty',
      );

      emailController.dispose();
    });

    testWidgets('"Launch email assistant" button is present', (tester) async {
      final dataSource = _FakeEmailDataSource([]);
      final emailController = AgentEmailController(
        AgentEmailRepository(dataSource),
      );
      await emailController.loadSignals();

      await tester.pumpWidget(
        await _buildApp(
          emailController: emailController,
          agentsController: agentsController,
        ),
      );
      await tester.pump();

      expect(
        find.byKey(const ValueKey('launch-email-assistant-btn')),
        findsOneWidget,
        reason: '"Launch email assistant" button should be present',
      );

      emailController.dispose();
    });

    testWidgets(
        'tapping launch button calls createSession with mcpRole email-assistant',
        (tester) async {
      final dataSource = _FakeEmailDataSource([]);
      final emailController = AgentEmailController(
        AgentEmailRepository(dataSource),
      );

      await tester.pumpWidget(
        await _buildApp(
          emailController: emailController,
          agentsController: agentsController,
        ),
      );
      await tester.pump();

      await tester.tap(
        find.byKey(const ValueKey('launch-email-assistant-btn')),
      );
      await tester.pumpAndSettle();

      expect(
        stubRepo.lastMcpRole,
        equals('email-assistant'),
        reason: 'createSession must be called with mcpRole email-assistant',
      );

      emailController.dispose();
    });

    testWidgets(
        'tapping launch button selects the new session via selectSession',
        (tester) async {
      final dataSource = _FakeEmailDataSource([]);
      final emailController = AgentEmailController(
        AgentEmailRepository(dataSource),
      );

      await tester.pumpWidget(
        await _buildApp(
          emailController: emailController,
          agentsController: agentsController,
        ),
      );
      await tester.pump();

      await tester.tap(
        find.byKey(const ValueKey('launch-email-assistant-btn')),
      );
      await tester.pumpAndSettle();

      expect(
        agentsController.selectedSessionId,
        equals('test-session-id'),
        reason: 'selectSession must be called with the new session id',
      );

      emailController.dispose();
    });

    testWidgets(
        'tapping launch button stages a composer draft for the new session',
        (tester) async {
      final dataSource = _FakeEmailDataSource([]);
      final emailController = AgentEmailController(
        AgentEmailRepository(dataSource),
      );

      await tester.pumpWidget(
        await _buildApp(
          emailController: emailController,
          agentsController: agentsController,
        ),
      );
      await tester.pump();

      await tester.tap(
        find.byKey(const ValueKey('launch-email-assistant-btn')),
      );
      await tester.pumpAndSettle();

      expect(
        agentsController.hasComposerDraft('test-session-id'),
        isTrue,
        reason: 'setComposerDraft must be called for the new session',
      );

      emailController.dispose();
    });
  });
}
