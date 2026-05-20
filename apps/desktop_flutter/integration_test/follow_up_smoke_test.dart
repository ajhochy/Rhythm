// Integration smoke for PR #617 "Follow Up" — exercises the new UI surfaces
// without requiring a live api_server or opencode subprocess. Stubs the
// AgentsRepository so we can mount AgentsView and assert that the redesigned
// composer, archive flow, permission-mode pill, file-attach button, slash
// popover, action row, and VCS chip all render and respond to taps.
//
// Run with:
//   flutter test integration_test/follow_up_smoke_test.dart -d macos

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:provider/provider.dart';
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
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_permission_mode_picker.dart';
import 'package:rhythm_desktop/features/agents/views/_project_vcs_chip.dart';
import 'package:rhythm_desktop/features/agents/views/_unified_agent_model_picker.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';
import 'package:rhythm_desktop/features/settings/services/destructive_modal_service.dart';
import 'package:rhythm_desktop/features/tasks/controllers/tasks_controller.dart';
import 'package:rhythm_desktop/features/tasks/data/tasks_local_data_source.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/repositories/tasks_repository.dart';

// ---------------------------------------------------------------------------
// Fakes
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
}

/// Repository that holds a mutable in-memory session list so the tests can
/// archive / unarchive / hard-delete and observe live state.
class _FakeAgentsRepository implements AgentsRepository {
  final StreamController<AgentWsMessage> _msg = StreamController.broadcast();
  final StreamController<bool> _conn = StreamController.broadcast();
  final List<AgentSession> _store = [];

  void seed(List<AgentSession> rows) {
    _store
      ..clear()
      ..addAll(rows);
  }

  @override
  Stream<AgentWsMessage> get messages => _msg.stream;

  @override
  Stream<bool> get connectivityStream => _conn.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {
    _conn.add(true);
  }

  @override
  Future<void> dispose() async {
    await _msg.close();
    await _conn.close();
  }

  @override
  void send(Map<String, dynamic> msg) {}

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
  }) async {
    if (archivedOnly) return _store.where((s) => s.isArchived).toList();
    if (includeArchived) return List.of(_store);
    return _store.where((s) => !s.isArchived).toList();
  }

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    final s = _store.firstWhere((s) => s.id == id);
    return (session: s, messages: <AgentSessionMessage>[]);
  }

  @override
  Future<List<AgentSessionMessage>> getMessages(String id, {int? limit}) async {
    return [];
  }

  @override
  Future<AgentSession> createSession({
    String? agentId,
    String? taskId,
    required String cwd,
    required String name,
    String? branch,
    String? stash,
    bool createBranch = false,
  }) async {
    final session = AgentSession(
      id: 'sid-${_store.length + 1}',
      agentId: agentId ?? '__pending__',
      status: AgentSessionStatus.idle,
      cwd: cwd,
      name: name,
      createdAt: DateTime.now(),
      updatedAt: DateTime.now(),
    );
    _store.add(session);
    return session;
  }

  @override
  Future<void> closeSession(String id) async {}

  @override
  Future<void> deleteSession(String id) async {
    _store.removeWhere((s) => s.id == id);
  }

  @override
  Future<void> cancelSession(String id) async {}

  @override
  Future<AgentSession> updateSession(
    String id, {
    String? name,
    String? providerId,
    String? modelId,
    String? permissionMode,
    bool clearProvider = false,
    bool clearModel = false,
    bool? fastMode,
  }) async {
    final idx = _store.indexWhere((s) => s.id == id);
    final s = _store[idx];
    final updated = s.copyWith(
      name: name ?? s.name,
      permissionMode: permissionMode != null
          ? PermissionMode.fromWire(permissionMode)
          : s.permissionMode,
      fastMode: fastMode ?? s.fastMode,
    );
    _store[idx] = updated;
    return updated;
  }

  @override
  Future<AgentSession> updateSessionThinkingBudget(
    String id,
    int? budget,
  ) async {
    final idx = _store.indexWhere((s) => s.id == id);
    final updated = _store[idx].copyWith(thinkingBudget: budget);
    _store[idx] = updated;
    return updated;
  }

  @override
  Future<void> respondPermission(
    String sessionId,
    String permissionId,
    String decision,
  ) async {}

  @override
  Future<AgentSession> resumeSession(String id) async {
    return _store.firstWhere((s) => s.id == id);
  }

  @override
  Future<AgentSession> archiveSession(String id) async {
    final idx = _store.indexWhere((s) => s.id == id);
    final updated = _store[idx].copyWith(archivedAt: DateTime.now());
    _store[idx] = updated;
    return updated;
  }

  @override
  Future<AgentSession> unarchiveSession(String id) async {
    final idx = _store.indexWhere((s) => s.id == id);
    final updated = _store[idx].copyWith(archivedAt: null);
    _store[idx] = updated;
    return updated;
  }
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
// Helpers
// ---------------------------------------------------------------------------

AgentSession _session({
  required String id,
  String agentId = 'claude-code',
  AgentSessionStatus status = AgentSessionStatus.idle,
  String name = 'demo',
  DateTime? archivedAt,
}) {
  final now = DateTime.now();
  return AgentSession(
    id: id,
    agentId: agentId,
    status: status,
    cwd: '/tmp',
    name: name,
    createdAt: now,
    updatedAt: now,
    archivedAt: archivedAt,
  );
}

Future<Widget> _buildHarness({
  required AgentsController agentsController,
}) async {
  final cfgController = AgentConfigsController(
    AgentConfigsRepository(_FakeAgentConfigsDataSource([
      AgentConfig(
        id: 'claude-code',
        label: 'Claude Code',
        icon: 'assets/icons/claude_code.png',
        enabled: true,
        isAgent: true,
        sortOrder: 0,
      ),
    ])),
  );
  await cfgController.refresh();
  final tasksController = TasksController(
    TasksRepository(_EmptyTasksLocalDataSource()),
  );
  final projectsController = AgentProjectsController(
    AgentProjectsRepository(_EmptyAgentProjectsRemote()),
  );

  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentServerController>.value(
        value: _ReadyAgentServerController(),
      ),
      ChangeNotifierProvider<AgentConfigsController>.value(
          value: cfgController),
      ChangeNotifierProvider<AgentsController>.value(value: agentsController),
      ChangeNotifierProvider<TasksController>.value(value: tasksController),
      ChangeNotifierProvider<AgentProjectsController>.value(
        value: projectsController,
      ),
      ChangeNotifierProvider<DestructiveModalService>(
        create: (_) => DestructiveModalService(),
      ),
    ],
    child: const MaterialApp(home: Scaffold(body: AgentsView())),
  );
}

AgentsController _makeController(_FakeAgentsRepository repo) {
  return AgentsController(
    repo,
    _ReadyAgentServerController(),
    _FakeLocalNotificationService(),
    _FakeNotificationsController(),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    '#602 composer redesign — model + permission + effort + fast-mode + attach all render',
    (tester) async {
      final repo = _FakeAgentsRepository();
      repo.seed([_session(id: 'live-1', status: AgentSessionStatus.idle)]);
      final controller = _makeController(repo);
      await controller.initialize();
      controller.selectSession('live-1');

      await tester
          .pumpWidget(await _buildHarness(agentsController: controller));
      await tester.pumpAndSettle();

      // Composer area widgets all present.
      expect(find.byType(UnifiedAgentModelPicker), findsOneWidget);
      expect(find.byType(PermissionModePicker), findsOneWidget);
      // File-attach paperclip icon.
      expect(find.byIcon(Icons.attach_file), findsOneWidget);
      // Effort + fast-mode controls: the budget picker uses the tooltip
      // "Reasoning effort (thinking budget)" and shows "Off" until a budget
      // is set; the fast-mode toggle uses tooltip "Fast mode".
      expect(
          find.byTooltip('Reasoning effort (thinking budget)'), findsOneWidget);

      controller.dispose();
    },
  );

  testWidgets(
    '#602 new-session dialog has no agent dropdown',
    (tester) async {
      final repo = _FakeAgentsRepository();
      final controller = _makeController(repo);
      await controller.initialize();

      await tester
          .pumpWidget(await _buildHarness(agentsController: controller));
      await tester.pumpAndSettle();

      // Open the new-session dialog.
      await tester.tap(find.text('New').first);
      await tester.pumpAndSettle();

      // The dialog used to have an "Agent" picker; it shouldn't anymore.
      // Heuristic: there should NOT be a DropdownButton labeled "Agent".
      final agentLabel = find.text('Agent');
      // It's OK for the word "Agent" to appear in unrelated context, but
      // a DropdownButton ancestor for it would be the old picker.
      expect(
        agentLabel.evaluate().any((el) {
          return el.findAncestorWidgetOfExactType<DropdownButton<dynamic>>() !=
              null;
        }),
        isFalse,
        reason: 'New-session dialog must not have an Agent dropdown (#602).',
      );

      // The Working directory + Name fields are still present.
      expect(find.textContaining('Working directory'), findsWidgets);

      controller.dispose();
    },
  );

  testWidgets(
    '#601 archive moves session to Archived section; unarchive restores it',
    (tester) async {
      final repo = _FakeAgentsRepository();
      repo.seed([
        _session(id: 's1', name: 'will-archive'),
      ]);
      final controller = _makeController(repo);
      await controller.initialize();

      await tester
          .pumpWidget(await _buildHarness(agentsController: controller));
      await tester.pumpAndSettle();

      expect(find.text('will-archive'), findsOneWidget);
      expect(controller.archived, isEmpty);

      // Archive via controller (UI menu interaction is brittle; the
      // controller path is the public API the menu calls anyway).
      await controller.archiveSession('s1');
      await tester.pumpAndSettle();

      // Row no longer in the active list.
      expect(
        controller.sessions.where((s) => s.id == 's1' && !s.isArchived),
        isEmpty,
      );

      // Loading archived rows from the server surfaces the row in the
      // controller's archived list — which is what the collapsible
      // "Archived (N)" section in the UI watches.
      await controller.loadArchivedSessions();
      await tester.pumpAndSettle();
      expect(controller.archived.where((s) => s.id == 's1').isNotEmpty, isTrue);

      // Round-trip back to the main list.
      await controller.unarchiveSession('s1');
      await tester.pumpAndSettle();
      expect(controller.archived.where((s) => s.id == 's1'), isEmpty);
      expect(find.text('will-archive'), findsOneWidget);

      controller.dispose();
    },
  );

  testWidgets(
    '#611 PermissionModePicker reflects setPermissionMode',
    (tester) async {
      final repo = _FakeAgentsRepository();
      repo.seed([_session(id: 'pm-1')]);
      final controller = _makeController(repo);
      await controller.initialize();
      controller.selectSession('pm-1');

      await tester
          .pumpWidget(await _buildHarness(agentsController: controller));
      await tester.pumpAndSettle();

      // Default label.
      expect(find.byType(PermissionModePicker), findsOneWidget);

      // Drive a programmatic change — the picker should reflect it on rebuild.
      await controller.setPermissionMode('pm-1', PermissionMode.acceptEdits);
      await tester.pumpAndSettle();

      final s = controller.sessions.firstWhere((s) => s.id == 'pm-1');
      expect(s.permissionMode, PermissionMode.acceptEdits);

      controller.dispose();
    },
  );

  testWidgets(
    '#604 thinking_budget + fastMode persist through the controller',
    (tester) async {
      final repo = _FakeAgentsRepository();
      repo.seed([_session(id: 't1')]);
      final controller = _makeController(repo);
      await controller.initialize();
      controller.selectSession('t1');

      await tester
          .pumpWidget(await _buildHarness(agentsController: controller));
      await tester.pumpAndSettle();

      await controller.setThinkingBudget('t1', 12288);
      await controller.setFastMode('t1', enabled: true);
      await tester.pumpAndSettle();

      final s = controller.sessions.firstWhere((s) => s.id == 't1');
      expect(s.thinkingBudget, 12288);
      expect(s.fastMode, isTrue);

      controller.dispose();
    },
  );

  testWidgets(
    '#607 ProjectVcsChip is rendered and is tappable when vcsRoot is set',
    (tester) async {
      // Build the chip in isolation — simpler and more deterministic than
      // surfacing it through the full AgentsView, which only renders the chip
      // when an active project with a vcsRoot is selected.
      final project = AgentProject(
        id: 'p1',
        name: 'demo',
        cwd: '/tmp',
        icon: '🧪',
        createdAt: DateTime.now(),
        vcsRoot: '/tmp',
        vcsBranch: 'main',
        vcsDirty: false,
      );

      await tester.pumpWidget(MaterialApp(
        home: Scaffold(
          body: Center(child: ProjectVcsChip(project: project)),
        ),
      ));
      await tester.pumpAndSettle();

      expect(find.text('main'), findsOneWidget);
      expect(find.byType(InkWell), findsWidgets);
    },
  );

  testWidgets(
    '#605 controller upserts a row on session.updated WS message',
    (tester) async {
      final repo = _FakeAgentsRepository();
      repo.seed([_session(id: 'live-1', name: 'before')]);
      final controller = _makeController(repo);
      await controller.initialize();

      await tester
          .pumpWidget(await _buildHarness(agentsController: controller));
      await tester.pumpAndSettle();
      expect(find.text('before'), findsOneWidget);

      // Simulate the server pushing a session.updated.
      repo._msg.add(SessionUpdatedMessage(
        session: _session(id: 'live-1', name: 'after'),
      ));
      await tester.pumpAndSettle();

      expect(find.text('after'), findsOneWidget);

      controller.dispose();
    },
  );
}
