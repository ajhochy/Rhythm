/// Tests for #1059 (OCU-18) — Worktree UI: create-session toggle, isolation
/// badge, and Changes-tab reset/remove actions.
///
/// A) New Session dialog: toggling "Run in isolated worktree" (+ optional
///    name) produces the right createSession payload. Pumps the real
///    production AgentsView + `_NewSessionDialog` (mirrors
///    new_session_dialog_error_test.dart's harness).
/// B) ChangesTab: Reset/Remove worktree actions, gated on session status.
///    Pumps the real production ChangesTab widget directly.
/// C) AgentsController: resetWorktree/removeWorktree + worktree.ready/failed
///    WS-frame handling (toast via pushAgentNotification).
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agent_projects/controllers/agent_projects_controller.dart';
import 'package:rhythm_desktop/features/agent_projects/data/agent_projects_remote_data_source.dart';
import 'package:rhythm_desktop/features/agent_projects/models/agent_project.dart';
import 'package:rhythm_desktop/features/agent_projects/repositories/agent_projects_repository.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_changes_tab.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/settings/services/destructive_modal_service.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';
import 'package:rhythm_desktop/features/tasks/controllers/tasks_controller.dart';
import 'package:rhythm_desktop/features/tasks/data/tasks_local_data_source.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/repositories/tasks_repository.dart';

// ---------------------------------------------------------------------------
// Shared fakes
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
}

class _FakeLocalNotificationService extends LocalNotificationService {
  @override
  Future<void> showMessageNotification({
    required int id,
    required String title,
    required String body,
  }) async {}
}

/// Records every pushAgentNotification call so WS toast handling is
/// assertable without a real OS notification.
class _RecordingNotificationsController extends NotificationsController {
  _RecordingNotificationsController()
      : super(NotificationsRepository(NotificationsDataSource()));

  final List<(String, String)> pushed = [];

  @override
  void pushAgentNotification({
    required int id,
    required String title,
    required String body,
  }) {
    pushed.add((title, body));
  }
}

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

AgentSession _makeSession(
  String id, {
  AgentSessionStatus status = AgentSessionStatus.idle,
  String? worktreeName,
  String? worktreePath,
  String? worktreeBranch,
}) =>
    AgentSession(
      id: id,
      agentId: 'claude-code',
      name: 'Test $id',
      cwd: '/tmp',
      status: status,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
      worktreeName: worktreeName,
      worktreePath: worktreePath,
      worktreeBranch: worktreeBranch,
    );

// ---------------------------------------------------------------------------
// A) New Session dialog — isolated worktree toggle
// ---------------------------------------------------------------------------

/// Records createSession calls; returns a stub session on success.
class _RecordingAgentsRepository implements AgentsRepository {
  _RecordingAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  /// (isolateWorktree, worktreeName) from the last createSession call.
  (bool, String?)? lastCreateWorktreeArgs;

  void emit(AgentWsMessage msg) => _msgController.add(msg);

  @override
  Stream<AgentWsMessage> get messages => _msgController.stream;

  @override
  Stream<bool> get connectivityStream => _connectivityController.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msgController.close();
    await _connectivityController.close();
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
    lastCreateWorktreeArgs = (isolateWorktree, worktreeName);
    return _makeSession(
      'new',
      status: AgentSessionStatus.starting,
      worktreeName: isolateWorktree ? (worktreeName ?? 'wt-auto') : null,
      worktreePath: isolateWorktree ? '/tmp/.worktrees/wt-auto' : null,
      worktreeBranch: isolateWorktree ? 'agent/wt-auto' : null,
    );
  }

  @override
  Future<void> resetWorktree(String sessionId) async {}

  @override
  Future<AgentSession> removeWorktree(String sessionId) async =>
      _makeSession(sessionId, status: AgentSessionStatus.closed);

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final _claudeCodeConfig = AgentConfig(
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'assets/icons/claude_code.png',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
);

class _FakeAgentConfigsDataSource extends AgentConfigsDataSource {
  @override
  Future<List<AgentConfig>> list() async => [_claudeCodeConfig];
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

Future<Widget> _buildAgentsViewApp(AgentsController agentsController) async {
  final agentConfigsController = AgentConfigsController(
      AgentConfigsRepository(_FakeAgentConfigsDataSource()));
  await agentConfigsController.refresh();
  final tasksController =
      TasksController(TasksRepository(_EmptyTasksLocalDataSource()));
  final agentProjectsController = AgentProjectsController(
    AgentProjectsRepository(_EmptyAgentProjectsRemote()),
  );

  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentServerController>.value(
        value: _ReadyAgentServerController(),
      ),
      ChangeNotifierProvider<AgentConfigsController>.value(
        value: agentConfigsController,
      ),
      ChangeNotifierProvider<AgentsController>.value(value: agentsController),
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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // AgentsController.initialize() / the transcript path calls
  // SharedPreferences.getInstance() — mock so it resolves synchronously.
  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

  group('#1059 — New Session dialog isolated-worktree toggle', () {
    testWidgets(
        'toggle ON + name produces isolateWorktree:true payload with the name',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1400, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final repo = _RecordingAgentsRepository();
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _RecordingNotificationsController(),
      );

      await tester.pumpWidget(await _buildAgentsViewApp(controller));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('new-session-options-button')));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.widgetWithText(TextField, 'e.g. Fix auth bug'),
        'Test session',
      );
      await tester.pump();

      // Toggle isolation on — the name field should appear.
      await tester.tap(find.byKey(const ValueKey('isolate-worktree-toggle')));
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('worktree-name-field')), findsOneWidget);

      await tester.enterText(
        find.byKey(const ValueKey('worktree-name-field')),
        'feature-x',
      );
      await tester.pump();

      await tester.tap(find.text('Start'));
      await tester.pumpAndSettle();

      expect(repo.lastCreateWorktreeArgs, (true, 'feature-x'));
    });

    testWidgets('toggle OFF (default) creates a non-isolated session',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1400, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final repo = _RecordingAgentsRepository();
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _RecordingNotificationsController(),
      );

      await tester.pumpWidget(await _buildAgentsViewApp(controller));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('new-session-options-button')));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.widgetWithText(TextField, 'e.g. Fix auth bug'),
        'Test session',
      );
      await tester.pump();

      expect(
        find.byKey(const ValueKey('worktree-name-field')),
        findsNothing,
        reason: 'name field only shows once the toggle is enabled',
      );

      await tester.tap(find.text('Start'));
      await tester.pumpAndSettle();

      expect(repo.lastCreateWorktreeArgs, (false, null));
    });
  });

  group('#1059 — ChangesTab worktree actions', () {
    late _RecordingAgentsRepository repo;
    late AgentsController controller;

    setUp(() {
      repo = _RecordingAgentsRepository();
      controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _RecordingNotificationsController(),
      );
    });

    Widget harness(AgentSession session) {
      return MultiProvider(
        providers: [
          ChangeNotifierProvider<AgentsController>.value(value: controller),
        ],
        child: MaterialApp(
          home: Scaffold(
            body: ChangesTab(
              sessionId: session.id,
              diffEntries: const [],
              session: session,
            ),
          ),
        ),
      );
    }

    testWidgets('non-isolated session shows no worktree actions row',
        (tester) async {
      await tester.pumpWidget(
          harness(_makeSession('s1', status: AgentSessionStatus.idle)));
      await tester.pump();

      expect(find.byKey(const ValueKey('changes-worktree-reset-button')),
          findsNothing);
    });

    testWidgets('isolated but active session: Reset enabled, Remove disabled',
        (tester) async {
      await tester.pumpWidget(harness(_makeSession(
        's2',
        status: AgentSessionStatus.working,
        worktreeName: 'wt',
        worktreePath: '/tmp/.wt/wt',
        worktreeBranch: 'agent/wt',
      )));
      await tester.pump();

      final resetButton = tester.widget<TextButton>(
        find.byKey(const ValueKey('changes-worktree-reset-button')),
      );
      final removeButton = tester.widget<TextButton>(
        find.byKey(const ValueKey('changes-worktree-remove-button')),
      );
      expect(resetButton.onPressed, isNotNull);
      expect(removeButton.onPressed, isNull,
          reason: 'Remove is only available for an ENDED session');
    });

    testWidgets('isolated + ended session: Remove enabled and calls through',
        (tester) async {
      await tester.pumpWidget(harness(_makeSession(
        's3',
        status: AgentSessionStatus.closed,
        worktreeName: 'wt',
        worktreePath: '/tmp/.wt/wt',
        worktreeBranch: 'agent/wt',
      )));
      await tester.pump();

      final removeButton = tester.widget<TextButton>(
        find.byKey(const ValueKey('changes-worktree-remove-button')),
      );
      expect(removeButton.onPressed, isNotNull);

      await tester
          .tap(find.byKey(const ValueKey('changes-worktree-remove-button')));
      await tester.pumpAndSettle();
      // Confirm in the dialog — its action is a FilledButton, distinct from
      // the row's TextButton with the same label.
      await tester.tap(find.widgetWithText(FilledButton, 'Remove'));
      await tester.pumpAndSettle();

      expect(find.text('Worktree removed.'), findsOneWidget);
    });
  });

  group('#1059 — AgentsController worktree events + actions', () {
    testWidgets('worktree.ready WS frame pushes a notification',
        (tester) async {
      final repo = _RecordingAgentsRepository();
      final notifications = _RecordingNotificationsController();
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        notifications,
      );
      addTearDown(controller.dispose);
      await repo.connect();
      final sub = repo.messages.listen(controller.handleWsMessageForTest);
      addTearDown(sub.cancel);

      repo.emit(const WorktreeReadyMessage(name: 'wt-a', branch: 'agent/wt-a'));
      await tester.pump(Duration.zero);

      expect(notifications.pushed, hasLength(1));
      expect(notifications.pushed.first.$1, 'Worktree ready');
      expect(notifications.pushed.first.$2, contains('agent/wt-a'));
    });

    testWidgets('worktree.failed WS frame pushes a notification',
        (tester) async {
      final repo = _RecordingAgentsRepository();
      final notifications = _RecordingNotificationsController();
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        notifications,
      );
      addTearDown(controller.dispose);
      await repo.connect();
      final sub = repo.messages.listen(controller.handleWsMessageForTest);
      addTearDown(sub.cancel);

      repo.emit(const WorktreeFailedMessage(message: 'disk full'));
      await tester.pump(Duration.zero);

      expect(notifications.pushed, hasLength(1));
      expect(notifications.pushed.first.$1, 'Worktree failed');
      expect(notifications.pushed.first.$2, 'disk full');
    });
  });
}
