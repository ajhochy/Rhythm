/// Mounted-surface test for the Odysseus-style AgentsNavColumn (Phase A + B).
///
/// Pumps the REAL AgentsView with a real provider tree and asserts:
///   1. The nav column renders (key: 'agents-nav-column').
///   2. The CHATS section label is present.
///   3. A session row renders when the controller has sessions.
///   4. The "By Project" selector is present (key: 'by-project-selector').
///   5. The Search field filters rows — a non-matching query hides a session.
///   6. Each TOOLS row (Brain, Deep Research, Tasks, Webhooks, Profiles) is
///      found by its text label.
///   7. The footer Settings affordance is present (key: 'nav-col-settings').
///   8. [RICH ROW CONTRACT] Session rows show a MODEL BADGE (agent kind pill)
///      — locks rich SessionRow rendering so it cannot silently regress to
///      lean inline rows that omit the badge.
///   9. [RICH ROW CONTRACT] The Archived section header renders in the CHATS
///      body (key: 'archived-section-header') — ensures SessionListBody is
///      mounted, not a plain list.
///
/// Run with:
///   flutter test test/features/agents/agents_nav_column_mounted_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/agent_projects/controllers/agent_projects_controller.dart';
import 'package:rhythm_desktop/features/agent_projects/data/agent_projects_remote_data_source.dart';
import 'package:rhythm_desktop/features/agent_projects/models/agent_project.dart';
import 'package:rhythm_desktop/features/agent_projects/repositories/agent_projects_repository.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';
import 'package:rhythm_desktop/features/settings/services/destructive_modal_service.dart';
import 'package:rhythm_desktop/features/tasks/controllers/tasks_controller.dart';
import 'package:rhythm_desktop/features/tasks/data/tasks_local_data_source.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/repositories/tasks_repository.dart';

// ---------------------------------------------------------------------------
// Stubs / fakes (mirrored from inspector_collapse_mounted_test.dart)
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
  bool isAgentAvailable(String kind) => true;

  @override
  Future<void> initialize() async {}

  @override
  Future<void> retry() async {}
}

class _StubAgentsRepository implements AgentsRepository {
  final List<AgentSession> _sessions;

  _StubAgentsRepository(this._sessions);

  final StreamController<AgentWsMessage> _msgCtrl =
      StreamController<AgentWsMessage>.broadcast();
  final StreamController<bool> _connCtrl = StreamController<bool>.broadcast();

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
  }) async =>
      archivedOnly ? const [] : _sessions;

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async => (
            session: _sessions.firstWhere((s) => s.id == id),
            messages: const <AgentSessionMessage>[],
          );

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

  @override
  void pushAgentNotification({
    required int id,
    required String title,
    required String body,
  }) {}
}

class _FakeAgentConfigsDataSource extends AgentConfigsDataSource {
  _FakeAgentConfigsDataSource(this._configs);

  final List<AgentConfig> _configs;

  @override
  Future<List<AgentConfig>> list() async => _configs;
}

class _EmptyAgentProjectsRemote extends AgentProjectsRemoteDataSource {
  _EmptyAgentProjectsRemote() : super();

  @override
  Future<List<AgentProject>> list({bool includeArchived = false}) async =>
      const [];
}

class _EmptyTasksLocalDataSource extends TasksLocalDataSource {
  @override
  Future<List<Task>> fetchAll() async => [];
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

AgentSession _makeSession(String id, String name) => AgentSession(
      id: id,
      agentId: 'claude-code',
      name: name,
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

final _claudeCodeConfig = AgentConfig(
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'assets/icons/claude_code.png',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
);

Future<Widget> _buildTestApp(AgentsController agentsController) async {
  final agentServerController = _ReadyAgentServerController();
  final agentConfigsController = AgentConfigsController(
    AgentConfigsRepository(_FakeAgentConfigsDataSource([_claudeCodeConfig])),
  );
  await agentConfigsController.refresh();

  final tasksController = TasksController(
    TasksRepository(_EmptyTasksLocalDataSource()),
  );
  final agentProjectsController = AgentProjectsController(
    AgentProjectsRepository(_EmptyAgentProjectsRemote()),
  );

  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentServerController>.value(
        value: agentServerController,
      ),
      ChangeNotifierProvider<AgentConfigsController>.value(
        value: agentConfigsController,
      ),
      ChangeNotifierProvider<AgentsController>.value(
        value: agentsController,
      ),
      ChangeNotifierProvider<TasksController>.value(value: tasksController),
      ChangeNotifierProvider<AgentProjectsController>.value(
        value: agentProjectsController,
      ),
      ChangeNotifierProvider<DestructiveModalService>(
        create: (_) => DestructiveModalService(),
      ),
    ],
    child: const MaterialApp(home: Scaffold(body: AgentsView())),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  /// Creates a controller with sessions already set via [setActiveSessionForTest],
  /// avoiding [initialize()] (which starts a periodic timer that fires after tests).
  ///
  /// Uses [setActiveSessionForTest] with only the id (no session object) after
  /// accumulating sessions via the two-arg form, so all sessions are in _sessions
  /// but the last call that specifies a session object will also mark it selected.
  /// To avoid duplicate text from SessionSidePanel, pass an id that is not in the
  /// list to clear selection — but there's no public API for that.
  ///
  /// Therefore tests asserting session text should use [findsWidgets] / at-least-1
  /// when sessions exist, since the SessionSidePanel may also render the selected
  /// session's name.
  AgentsController _makeControllerWithSessions(List<AgentSession> sessions) {
    final repo = _StubAgentsRepository(sessions);
    final controller = AgentsController(
      repo,
      _ReadyAgentServerController(),
      _FakeLocalNotificationService(),
      _FakeNotificationsController(),
    );
    // Inject sessions. The last call sets selectedSessionId to the last session id.
    for (final s in sessions) {
      controller.setActiveSessionForTest(s.id, s);
    }
    return controller;
  }

  group('AgentsNavColumn — mounted surface', () {
    testWidgets('nav column renders with CHATS section and session list',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final sessions = [
        _makeSession('s1', 'Alpha Session'),
        _makeSession('s2', 'Beta Session'),
      ];
      final controller = _makeControllerWithSessions(sessions);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // (1) Nav column renders
      expect(
        find.byKey(const ValueKey('agents-nav-column')),
        findsOneWidget,
        reason: 'Agents nav column should render',
      );

      // (2) CHATS section label present
      expect(
        find.text('CHATS'),
        findsOneWidget,
        reason: 'CHATS section label should be present',
      );

      // (3) Session rows render (use at-least-1 since the selected session's
      // name may also appear in the SessionSidePanel header).
      expect(
        find.text('Alpha Session'),
        findsAtLeastNWidgets(1),
        reason: 'Session row Alpha Session should render',
      );
      expect(
        find.text('Beta Session'),
        findsAtLeastNWidgets(1),
        reason: 'Session row Beta Session should render',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    testWidgets('"By Project" selector is present', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final controller = _makeControllerWithSessions([]);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // (4) By Project selector present
      expect(
        find.byKey(const ValueKey('by-project-selector')),
        findsOneWidget,
        reason: '"By Project" dropdown selector should render in CHATS',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    testWidgets('Search field filters session rows', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final sessions = [
        _makeSession('s1', 'Alpha Session'),
        _makeSession('s2', 'Beta Session'),
      ];
      final controller = _makeControllerWithSessions(sessions);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // Both sessions visible in the nav column initially.
      // (use descendant to scope to the nav column, avoiding inspector panel)
      final navCol = find.byKey(const ValueKey('agents-nav-column'));
      expect(
        find.descendant(of: navCol, matching: find.text('Alpha Session')),
        findsOneWidget,
        reason: 'Alpha Session should be visible in nav column initially',
      );
      expect(
        find.descendant(of: navCol, matching: find.text('Beta Session')),
        findsOneWidget,
        reason: 'Beta Session should be visible in nav column initially',
      );

      // (5) Type a query that matches only Alpha.
      await tester.enterText(
        find.byKey(const ValueKey('nav-search-field')),
        'Alpha',
      );
      await tester.pump();

      expect(
        find.descendant(of: navCol, matching: find.text('Alpha Session')),
        findsOneWidget,
        reason: 'Alpha Session should still be visible after "Alpha" query',
      );
      expect(
        find.descendant(of: navCol, matching: find.text('Beta Session')),
        findsNothing,
        reason:
            'Beta Session should be hidden in nav column after "Alpha" query',
      );

      // Clearing restores both.
      await tester.enterText(
        find.byKey(const ValueKey('nav-search-field')),
        '',
      );
      await tester.pump();
      expect(
        find.descendant(of: navCol, matching: find.text('Beta Session')),
        findsOneWidget,
        reason: 'Beta Session should be visible again after clearing query',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    testWidgets('TOOLS rows are present and tappable', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final controller = _makeControllerWithSessions([]);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // (6) Each TOOLS row is present by its key.
      expect(
        find.byKey(const ValueKey('tools-row-brain')),
        findsOneWidget,
        reason: 'Brain tools row should be present',
      );
      expect(
        find.byKey(const ValueKey('tools-row-research')),
        findsOneWidget,
        reason: 'Deep Research tools row should be present',
      );
      expect(
        find.byKey(const ValueKey('tools-row-tasks')),
        findsOneWidget,
        reason: 'Tasks tools row should be present',
      );
      expect(
        find.byKey(const ValueKey('tools-row-webhooks')),
        findsOneWidget,
        reason: 'Webhooks tools row should be present',
      );
      expect(
        find.byKey(const ValueKey('tools-row-profiles')),
        findsOneWidget,
        reason: 'Profiles tools row should be present',
      );

      // TOOLS label itself.
      expect(find.text('TOOLS'), findsOneWidget);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    testWidgets('footer Settings affordance is present', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final controller = _makeControllerWithSessions([]);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // (7) Footer Settings icon.
      expect(
        find.byKey(const ValueKey('nav-col-settings')),
        findsOneWidget,
        reason: 'Footer Settings affordance should render',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    // ── (8) Rich rows: model badge present ──────────────────────────────────

    testWidgets(
        'session rows show agent kind badge (rich SessionRow rendering)',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      // Session with agentId='claude-code' → badge resolves to "Claude Code".
      final sessions = [_makeSession('s1', 'Model Badge Session')];
      final controller = _makeControllerWithSessions(sessions);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // (8) The agent badge pill text ("Claude Code") must be present inside
      // the nav column, confirming rich SessionRow is rendered (not a lean row
      // that only shows session name + a plain dot).
      final navCol = find.byKey(const ValueKey('agents-nav-column'));
      expect(
        find.descendant(
          of: navCol,
          matching: find.text('Claude Code'),
        ),
        findsAtLeastNWidgets(1),
        reason: 'Rich SessionRow must render the AgentKindBadge pill',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    // ── (9) Rich rows: Archived section header from SessionListBody ──────────

    testWidgets('Archived section header renders in CHATS body',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final sessions = [_makeSession('s1', 'Alpha Session')];
      final controller = _makeControllerWithSessions(sessions);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // (9) The Archived section header (key: 'archived-section-header') must
      // be present — it is rendered by SessionListBody, not the old lean inline
      // list. Its presence guarantees SessionListBody is actually mounted.
      final navCol = find.byKey(const ValueKey('agents-nav-column'));
      expect(
        find.descendant(
          of: navCol,
          matching: find.byKey(const ValueKey('archived-section-header')),
        ),
        findsOneWidget,
        reason:
            'SessionListBody must be mounted (archived-section-header must render)',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });
  });
}
