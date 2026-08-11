/// Widget tests for QuickActionsBar (issue #863).
///
/// Asserts:
///   1. All four quick-action buttons render with jargon-free labels.
///   2. "Help me finish this" creates a session (mcpRole 'secretary'),
///      selects it, and sends a preset prompt containing the item's title —
///      the user never types anything.
///   3. "Draft next steps" and "Summarize" behave the same way with their
///      own preset prompts.
///   4. "Create follow-up tasks" creates a REAL task via TasksController,
///      linked to the source item in its notes, AND starts an agent session.
///   5. onSessionReady is invoked with the new session id so the host can
///      navigate to view the result.
///   6. A failed createSession() surfaces a clear, visible error (SnackBar)
///      instead of failing silently.
///   7. No model name, token count, or MCP terminology ever appears in this
///      surface (labels only mention plain-language actions).
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/quick_action_context.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/quick_actions_bar.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';
import 'package:rhythm_desktop/features/tasks/controllers/tasks_controller.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/repositories/tasks_repository.dart';
import 'package:rhythm_desktop/features/tasks/data/tasks_local_data_source.dart';

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

  String? lastMcpRole;
  String? lastTaskId;
  String? lastCwd;
  String? lastAgentId;
  bool createSessionShouldFail = false;
  final List<Map<String, dynamic>> sentMessages = [];

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
  bool send(Map<String, dynamic> msg) {
    sentMessages.add(msg);
    return true;
  }

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
    String? profileId,
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
    if (createSessionShouldFail) {
      throw Exception('boom');
    }
    lastMcpRole = mcpRole;
    lastTaskId = taskId;
    lastCwd = cwd;
    lastAgentId = agentId;
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

/// Data source stub so the controller never makes a real HTTP call —
/// [_FakeAgentConfigsController] overrides [secretaryAgent] directly and never
/// calls [refresh], so this is only needed to satisfy the constructor chain.
class _StubAgentConfigsDataSource extends AgentConfigsDataSource {}

/// Test double for [AgentConfigsController] exposing the Secretary profile
/// whose `ocAgent` is `'secretary'` — the shape the quick actions bar must
/// resolve `agentId` from (issue #888). Overrides [secretaryAgent] (NOT
/// managerAgent): the bar must target Secretary specifically even when other
/// managers exist. The real getter's multi-manager resolution is guarded
/// separately in agent_configs_controller_test.dart.
class _FakeAgentConfigsController extends AgentConfigsController {
  _FakeAgentConfigsController()
      : super(AgentConfigsRepository(_StubAgentConfigsDataSource()));

  @override
  AgentConfig? get secretaryAgent => AgentConfig(
        id: 'secretary',
        label: 'Secretary',
        icon: '',
        enabled: true,
        isAgent: true,
        sortOrder: 0,
        isManager: true,
        ocAgent: 'secretary',
      );
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

/// Fake task creation without touching the network — mirrors the pattern
/// used for other data-source fakes in this repo (e.g. _FakeEmailDataSource).
class _FakeTasksLocalDataSource extends TasksLocalDataSource {
  _FakeTasksLocalDataSource() : super(baseUrl: 'http://localhost');

  final List<Map<String, dynamic>> createdCalls = [];
  bool shouldFail = false;

  @override
  Future<Task> create(
    String title, {
    String? notes,
    String? dueDate,
    String? scheduledDate,
    int? ownerId,
    String? preferredAgent,
    String? goalId,
    int? priority,
    List<String> tags = const [],
    String? energy,
  }) async {
    if (shouldFail) {
      throw Exception('task creation failed');
    }
    createdCalls.add({'title': title, 'notes': notes});
    final now = DateTime.now().toIso8601String();
    return Task(
      id: 'follow-up-task-id',
      title: title,
      status: TaskStatus.open,
      createdAt: now,
      updatedAt: now,
      notes: notes,
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

Future<Widget> _buildApp({
  required AgentsController agentsController,
  required TasksController tasksController,
  required AgentConfigsController agentConfigsController,
  required QuickActionContext quickActionContext,
  QuickActionSessionOpener? onSessionReady,
}) async {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentsController>.value(value: agentsController),
      ChangeNotifierProvider<TasksController>.value(value: tasksController),
      ChangeNotifierProvider<AgentConfigsController>.value(
        value: agentConfigsController,
      ),
    ],
    child: MaterialApp(
      home: Scaffold(
        body: QuickActionsBar(
          context_: quickActionContext,
          onSessionReady: onSessionReady,
        ),
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _StubAgentsRepository stubAgentsRepo;
  late AgentsController agentsController;
  late _FakeTasksLocalDataSource fakeTasksDataSource;
  late TasksController tasksController;
  late AgentConfigsController agentConfigsController;

  const taskContext = QuickActionContext(
    kind: 'task',
    sourceId: 'task-42',
    title: 'Plan the fall retreat',
    description: 'Need a venue, budget, and speaker lined up.',
  );

  setUp(() {
    stubAgentsRepo = _StubAgentsRepository();
    agentsController = AgentsController(
      stubAgentsRepo,
      _ReadyAgentServerController(),
      _FakeLocalNotificationService(),
      _FakeNotificationsController(),
    );
    fakeTasksDataSource = _FakeTasksLocalDataSource();
    tasksController = TasksController(TasksRepository(fakeTasksDataSource));
    agentConfigsController = _FakeAgentConfigsController();
  });

  tearDown(() {
    agentsController.dispose();
  });

  group('QuickActionsBar', () {
    testWidgets('renders all four jargon-free quick-action buttons',
        (tester) async {
      await tester.pumpWidget(
        await _buildApp(
          agentsController: agentsController,
          tasksController: tasksController,
          agentConfigsController: agentConfigsController,
          quickActionContext: taskContext,
        ),
      );
      await tester.pump();

      expect(find.text('Help me finish this'), findsOneWidget);
      expect(find.text('Draft next steps'), findsOneWidget);
      expect(find.text('Summarize'), findsOneWidget);
      expect(find.text('Create follow-up tasks'), findsOneWidget);

      // No model/token/MCP jargon anywhere in this surface.
      for (final jargon in [
        'model',
        'token',
        'MCP',
        'Claude',
        'Codex',
        'Sonnet',
        'Opus',
      ]) {
        expect(
          find.textContaining(jargon, findRichText: true),
          findsNothing,
          reason: '"$jargon" must not appear in the quick actions surface',
        );
      }
    });

    testWidgets(
        '"Help me finish this" creates a session and sends context with no typing',
        (tester) async {
      await tester.pumpWidget(
        await _buildApp(
          agentsController: agentsController,
          tasksController: tasksController,
          agentConfigsController: agentConfigsController,
          quickActionContext: taskContext,
        ),
      );
      await tester.pump();

      await tester.tap(
        find.byKey(const ValueKey('quick-action-help-finish')),
      );
      await tester.pumpAndSettle();

      expect(stubAgentsRepo.lastMcpRole, equals('secretary'));
      // Regression (#888): mcpRole alone only scopes the MCP tool allowlist —
      // the server resolves which engine agent actually runs the session
      // from agentId. Without this, the server fell back to the default
      // catalog entry ("Coding Workflow") instead of Secretary.
      expect(stubAgentsRepo.lastAgentId, equals('secretary'));
      expect(stubAgentsRepo.lastTaskId, equals('task-42'));
      // Regression (#863 smoke): the quick action must pass a NON-EMPTY cwd —
      // POST /agent-sessions rejects '' with 400 "cwd is required", which
      // silently broke the agent-launch half of the action in the live app.
      expect(stubAgentsRepo.lastCwd, isNotNull);
      expect(stubAgentsRepo.lastCwd, isNotEmpty);
      expect(agentsController.selectedSessionId, equals('test-session-id'));

      final inputFrames = stubAgentsRepo.sentMessages
          .where((m) => m['type'] == 'session.input')
          .toList();
      expect(inputFrames, hasLength(1));
      final sentText = inputFrames.first['data'] as String;
      expect(sentText, contains('Help me finish this'));
      expect(sentText, contains('Plan the fall retreat'));
      expect(sentText, contains('Need a venue, budget'));
    });

    testWidgets('"Draft next steps" sends a next-steps preset prompt',
        (tester) async {
      await tester.pumpWidget(
        await _buildApp(
          agentsController: agentsController,
          tasksController: tasksController,
          agentConfigsController: agentConfigsController,
          quickActionContext: taskContext,
        ),
      );
      await tester.pump();

      await tester.tap(
        find.byKey(const ValueKey('quick-action-draft-next-steps')),
      );
      await tester.pumpAndSettle();

      final inputFrames = stubAgentsRepo.sentMessages
          .where((m) => m['type'] == 'session.input')
          .toList();
      expect(inputFrames, hasLength(1));
      expect(inputFrames.first['data'], contains('Draft the next steps'));
      // Regression (#888): agentId must resolve to the Secretary profile.
      expect(stubAgentsRepo.lastAgentId, equals('secretary'));
    });

    testWidgets('"Summarize" sends a summarize preset prompt', (tester) async {
      await tester.pumpWidget(
        await _buildApp(
          agentsController: agentsController,
          tasksController: tasksController,
          agentConfigsController: agentConfigsController,
          quickActionContext: taskContext,
        ),
      );
      await tester.pump();

      await tester.tap(find.byKey(const ValueKey('quick-action-summarize')));
      await tester.pumpAndSettle();

      final inputFrames = stubAgentsRepo.sentMessages
          .where((m) => m['type'] == 'session.input')
          .toList();
      expect(inputFrames, hasLength(1));
      expect(inputFrames.first['data'], contains('Summarize this'));
      // Regression (#888): agentId must resolve to the Secretary profile.
      expect(stubAgentsRepo.lastAgentId, equals('secretary'));
    });

    testWidgets(
        '"Create follow-up tasks" creates a real linked task and starts an agent',
        (tester) async {
      await tester.pumpWidget(
        await _buildApp(
          agentsController: agentsController,
          tasksController: tasksController,
          agentConfigsController: agentConfigsController,
          quickActionContext: taskContext,
        ),
      );
      await tester.pump();

      await tester.tap(
        find.byKey(const ValueKey('quick-action-follow-up-tasks')),
      );
      await tester.pumpAndSettle();

      expect(fakeTasksDataSource.createdCalls, hasLength(1));
      final created = fakeTasksDataSource.createdCalls.first;
      expect(created['title'], contains('Plan the fall retreat'));
      expect(created['notes'], contains('Plan the fall retreat'));
      expect(created['notes'], contains('task'));

      // The task actually landed in TasksController's list (real task).
      expect(
        tasksController.tasks.any((t) => t.id == 'follow-up-task-id'),
        isTrue,
      );

      // An agent session was also started for further follow-up suggestions.
      expect(stubAgentsRepo.lastMcpRole, equals('secretary'));
      // Regression (#888): agentId must resolve to the Secretary profile —
      // otherwise this session also silently ran under "Coding Workflow".
      expect(stubAgentsRepo.lastAgentId, equals('secretary'));
    });

    testWidgets(
        'onSessionReady is called with the new session id for a chat action',
        (tester) async {
      String? readySessionId;
      await tester.pumpWidget(
        await _buildApp(
          agentsController: agentsController,
          tasksController: tasksController,
          agentConfigsController: agentConfigsController,
          quickActionContext: taskContext,
          onSessionReady: (id) => readySessionId = id,
        ),
      );
      await tester.pump();

      await tester.tap(
        find.byKey(const ValueKey('quick-action-help-finish')),
      );
      await tester.pumpAndSettle();

      expect(readySessionId, equals('test-session-id'));
    });

    testWidgets('a failed createSession shows a clear, visible error',
        (tester) async {
      stubAgentsRepo.createSessionShouldFail = true;

      await tester.pumpWidget(
        await _buildApp(
          agentsController: agentsController,
          tasksController: tasksController,
          agentConfigsController: agentConfigsController,
          quickActionContext: taskContext,
        ),
      );
      await tester.pump();

      await tester.tap(
        find.byKey(const ValueKey('quick-action-help-finish')),
      );
      await tester.pumpAndSettle();

      expect(find.byType(SnackBar), findsOneWidget);
    });
  });
}
