/// Mounted-surface contract tests for issue #861 — Task card delegation
/// navigation, including NESTED delegation (parent → orchestrator →
/// specialist).
///
/// Per the "agents inspector was orphaned" lesson (a prior attempt tested
/// panels in isolation with a detached `Builder` widget instead of the real
/// navigation path), these tests pump the REAL `AgentsView` — the actual
/// `_TranscriptPanel` mounted surface reached via the sessions nav — not a
/// standalone `TaskChip`/`ChildTranscriptView` widget test.
///
/// Covers:
///   n1 — Tapping a top-level Task card opens the child session in the real
///        chat pane (transcript visible in place of the parent).
///   n2 — Nested delegation: a Task card INSIDE that child transcript opens
///        its own child (grandchild), and the breadcrumb after that tap
///        reads "‹ <child's own name>" — not the top-level parent's name.
///   n3 — Back from the grandchild returns to the intermediate child (its
///        own transcript + nested chip are still visible), not all the way
///        to the top-level parent. A second back returns to the top-level
///        parent (Task chip visible again).
///   n4 — A Task card whose child SDK id cannot be resolved renders as a
///        disabled/non-clickable card (chevron dims, tapping is a no-op)
///        rather than a dead click.
///
/// Run with:
///   flutter test test/features/agents/issue_861_nested_task_card_nav_test.dart
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
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_tool_renderers/_task_chip.dart';
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
// Stubs / fakes (mirror inspector_collapse_mounted_test.dart)
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

/// Stub repository whose `fetchChildMessages` returns different fixtures
/// depending on which SDK id is requested, so the test can stage a
/// grandchild's messages behind the direct child's messages.
class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository();

  final StreamController<AgentWsMessage> _msgCtrl =
      StreamController<AgentWsMessage>.broadcast();
  final StreamController<bool> _connCtrl = StreamController<bool>.broadcast();

  /// childSdkId -> messages to return from fetchChildMessages.
  final Map<String, List<AgentSessionMessage>> messagesByChildId = {};

  /// Track (parentSessionId, childSdkId) pairs the controller requested, to
  /// assert the correct "fetch parent" was used for each hop.
  final List<(String, String)> fetchChildMessagesCalls = [];

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
  }) async => const [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
  getSession(String id) async =>
      (session: _makeSession(id), messages: const <AgentSessionMessage>[]);

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

  @override
  Future<List<AgentSessionMessage>> fetchChildMessages(
    String parentSessionId,
    String childSdkId, {
    String? cwd,
  }) async {
    fetchChildMessagesCalls.add((parentSessionId, childSdkId));
    return messagesByChildId[childSdkId] ?? const [];
  }

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
// Helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

AgentSession _makeSession(String id, {String name = 'Test Session'}) =>
    AgentSession(
      id: id,
      agentId: 'claude-code',
      name: name,
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

/// The breadcrumb in [ChildTranscriptView] renders `Icon(chevron_left)` then
/// the target name as a `Text`, both inside one `Row` (see agents_view.dart).
/// The sessions sidebar ALSO renders session names as plain [Text] (and its
/// row is built on `InkWell`, i.e. a `GestureDetector` too), so neither a
/// bare `find.text(...)` nor a `GestureDetector`-scoped finder is unambiguous.
/// Walk every `Row` in the tree and return the one whose direct children are
/// exactly `[Icon(chevron_left), SizedBox, Text(text)]` — the breadcrumb's
/// exact shape.
Finder _breadcrumb(String text) => find.byWidgetPredicate((widget) {
  if (widget is! Row) return false;
  final children = widget.children;
  if (children.length < 3) return false;
  final icon = children[0];
  final label = children.last;
  return icon is Icon &&
      icon.icon == Icons.chevron_left &&
      label is Text &&
      label.data == text;
});

final _claudeCodeConfig = AgentConfig(
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'assets/icons/claude_code.png',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
);

/// Builds a raw `parts` map entry for a `task` tool part, mirroring the real
/// opencode wire shape (child id surfaces in the tool OUTPUT as `task_id:
/// ses_…`, matching `_task_chip.dart`'s resolution order).
Map<String, dynamic> _taskPartJson({
  required String id,
  required String description,
  String? outputChildId,
  String status = 'completed',
}) => {
  'id': id,
  'type': 'tool',
  'tool': 'task',
  'callID': 'call-$id',
  'state': {
    'status': status,
    'input': {'description': description},
    if (outputChildId != null)
      'output':
          'task_id: $outputChildId (for resuming to continue '
          'this task if needed)\n\n<task_result>done</task_result>',
    'title': 'Task: $description',
    'metadata': <String, dynamic>{},
  },
};

Future<Widget> _buildTestApp({
  required AgentsController agentsController,
}) async {
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

  testWidgets(
    'n1+n2+n3: REAL-SURFACE — nested Task card delegation opens child then '
    'grandchild in the mounted chat pane, and back returns one hop at a time',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      const parentSessionId = 'parent-861';
      const parentSessionName = 'Parent Session 861';
      // NOTE: opencode SDK session ids look like `ses_10091f3c5ffee81eES4aW1V8Ev`
      // — the chip's `task_id: ses_…` output regex is
      // `ses_[A-Za-z0-9]+` (literal `ses_` prefix, then alphanumerics with NO
      // further underscores). A fixture id with an extra underscore anywhere
      // after the prefix would be truncated at that character and silently
      // resolve to the wrong id.
      const childSdkId = 'ses_Child861aBc';
      const grandchildSdkId = 'ses_Grandchild861xYz';

      final repo = _StubAgentsRepository();
      // Direct child's transcript contains its OWN task tool part —
      // delegating further to a grandchild specialist.
      repo.messagesByChildId[childSdkId] = [
        AgentSessionMessage.fromStructuredJson({
          'id': 1,
          'sessionId': 'child-$childSdkId',
          'role': 'output',
          'rawText': '',
          'strippedText': '',
          'createdAt': '2026-07-02T10:00:00Z',
          'sdkMessageId': 'msg-child-861-001',
          'parts': [
            {
              'id': 'part-child-text-861',
              'type': 'text',
              'text': 'Delegating the specialist sub-task…',
            },
            _taskPartJson(
              id: 'part-child-task-861',
              description: 'Research trends',
              outputChildId: grandchildSdkId,
            ),
          ],
          'tokens': null,
          'cost': null,
        }),
      ];
      // Grandchild's own transcript (leaf — no further delegation).
      repo.messagesByChildId[grandchildSdkId] = [
        AgentSessionMessage.fromStructuredJson({
          'id': 1,
          'sessionId': 'child-$grandchildSdkId',
          'role': 'output',
          'rawText': '',
          'strippedText': '',
          'createdAt': '2026-07-02T10:01:00Z',
          'sdkMessageId': 'msg-grandchild-861-001',
          'parts': [
            {
              'id': 'part-grandchild-text-861',
              'type': 'text',
              'text': 'Trend research complete.',
            },
          ],
          'tokens': null,
          'cost': null,
        }),
      ];

      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );

      await tester.runAsync(() async {
        await controller.initialize();
        controller.setActiveSessionForTest(
          parentSessionId,
          _makeSession(parentSessionId, name: parentSessionName),
        );
      });

      // Seed the PARENT transcript with an assistant message containing a
      // top-level Task card (delegation to the direct child).
      controller.setMessageForTest(
        ChatMessage(
          id: 'msg-parent-861',
          sessionId: parentSessionId,
          role: 'assistant',
          createdAt: _kEpoch,
        ),
      );
      controller.setChatPartForTest(
        ChatPart.fromJson(
          'msg-parent-861',
          _taskPartJson(
            id: 'part-parent-task-861',
            description: 'Orchestrate research',
            outputChildId: childSdkId,
          ),
        ),
      );

      await tester.pumpWidget(
        await _buildTestApp(agentsController: controller),
      );
      await tester.pump();

      // ── n1: top-level Task card visible on the real mounted surface ──
      expect(find.byType(TaskChip), findsOneWidget);
      expect(find.text('Orchestrate research'), findsOneWidget);

      // Tap it — real navigation via AgentsController wired through the
      // mounted AgentsView (not an isolated Builder).
      await tester.tap(find.byType(TaskChip));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      // Direct child transcript now shown in the SAME mounted chat pane:
      // breadcrumb to the top-level parent, and the child's own delegation
      // (nested Task card) is rendered.
      expect(_breadcrumb(parentSessionName), findsOneWidget);
      expect(find.text('Delegating the specialist sub-task…'), findsOneWidget);
      expect(
        find.byType(TaskChip),
        findsOneWidget,
        reason:
            'Direct child transcript must render its own nested '
            'Task card for the grandchild delegation',
      );
      expect(find.text('Research trends'), findsOneWidget);

      // ── n2: nested Task card opens the grandchild; breadcrumb reads the
      //        CHILD's own name, not the top-level parent's. ──
      await tester.tap(find.byType(TaskChip));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.text('Trend research complete.'), findsOneWidget);
      expect(
        _breadcrumb('Orchestrate research'),
        findsOneWidget,
        reason:
            'Breadcrumb after opening the grandchild must show the '
            "immediate parent's own name (the direct child's task "
            'description), not the top-level session name',
      );
      expect(
        _breadcrumb(parentSessionName),
        findsNothing,
        reason:
            'Top-level parent name must NOT be the breadcrumb target for '
            'a grandchild — that would incorrectly skip the intermediate '
            'hop',
      );

      // Correct fetch-parent chaining: grandchild fetch used the DIRECT
      // CHILD's own sdk id, not the top-level parent's local id.
      expect(
        repo.fetchChildMessagesCalls.any(
          (c) => c.$1 == childSdkId && c.$2 == grandchildSdkId,
        ),
        isTrue,
        reason:
            'Grandchild messages must be fetched using the direct '
            "child's own SDK id as the fetch-parent",
      );

      // ── n3: back ONE hop lands on the intermediate child, not the top ──
      await tester.tap(_breadcrumb('Orchestrate research'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      expect(
        find.text('Delegating the specialist sub-task…'),
        findsOneWidget,
        reason:
            'One back-tap from the grandchild must land on the '
            'intermediate child transcript, not skip to the top parent',
      );
      expect(find.byType(TaskChip), findsOneWidget);
      expect(
        _breadcrumb(parentSessionName),
        findsOneWidget,
        reason:
            'The intermediate child breadcrumb must point back to '
            'the top-level parent',
      );

      // Second back-tap returns all the way to the top-level parent — the
      // original Task card is visible again.
      await tester.tap(_breadcrumb(parentSessionName));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      expect(find.text('Orchestrate research'), findsOneWidget);
      expect(find.byType(TaskChip), findsOneWidget);
      expect(controller.activeChildSessionId, isNull);

      // Teardown. Flush background fetch rejections first so nothing lands
      // during a LATER test and retro-fails this one.
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 300)),
      );
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );

  testWidgets('n4: REAL-SURFACE — a Task card with no resolvable child id is '
      'disabled (dimmed chevron, tap is a no-op), not a dead click', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(1600, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    const parentSessionId = 'parent-861-unresolvable';
    const parentSessionName = 'Parent Session 861 Unresolvable';

    final repo = _StubAgentsRepository();
    final controller = AgentsController(
      repo,
      _ReadyAgentServerController(),
      _FakeLocalNotificationService(),
      _FakeNotificationsController(),
    );

    await tester.runAsync(() async {
      await controller.initialize();
      controller.setActiveSessionForTest(
        parentSessionId,
        _makeSession(parentSessionId, name: parentSessionName),
      );
    });

    controller.setMessageForTest(
      ChatMessage(
        id: 'msg-parent-861-unresolvable',
        sessionId: parentSessionId,
        role: 'assistant',
        createdAt: _kEpoch,
      ),
    );
    // A still-running task with NO output yet and no sessionId in input —
    // the child id cannot be resolved.
    controller.setChatPartForTest(
      ChatPart.fromJson(
        'msg-parent-861-unresolvable',
        _taskPartJson(
          id: 'part-parent-task-unresolvable',
          description: 'Still starting up…',
          status: 'running',
        ),
      ),
    );

    await tester.pumpWidget(await _buildTestApp(agentsController: controller));
    await tester.pump();

    expect(find.byType(TaskChip), findsOneWidget);
    expect(find.text('Still starting up…'), findsOneWidget);

    // Tapping must be a no-op — no navigation occurs.
    await tester.tap(find.byType(TaskChip));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 50));

    expect(
      controller.activeChildSessionId,
      isNull,
      reason: 'Unresolvable child id must never navigate',
    );
    // Still on the parent view — the same Task card, not a child transcript.
    expect(find.byType(TaskChip), findsOneWidget);
    expect(find.text('Still starting up…'), findsOneWidget);

    // Teardown. Flush background fetch rejections first so nothing lands
    // during a LATER test and retro-fails this one.
    await tester.runAsync(
      () => Future<void>.delayed(const Duration(milliseconds: 300)),
    );
    await tester.pumpWidget(const MaterialApp(home: SizedBox()));
    controller.dispose();
  });

  testWidgets(
    '#861 link-first: a Task card whose child exists as a LOCAL session '
    '(persisted #743 row with sdkSessionId) just selects that session — '
    'no child-frame pipeline, no SDK refetch',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      const parentSessionId = 'parent-local-861-link';
      const parentSessionName = 'Parent session';
      const childLocalId = 'child-local-861-link';
      const childSdkId = 'ses_localchild861';

      final stubRepo = _StubAgentsRepository();
      final controller = AgentsController(
        stubRepo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );

      await tester.runAsync(() async {
        await controller.initialize();
        // The delegated child ALREADY exists as a local session (#743):
        // parentId links it to the parent; sdkSessionId is the engine id the
        // Task card carries.
        controller.setActiveSessionForTest(
          childLocalId,
          _makeSession(
            childLocalId,
            name: 'Research trends (@AI-Trend)',
          ).copyWith(parentId: parentSessionId, sdkSessionId: childSdkId),
        );
        controller.setActiveSessionForTest(
          parentSessionId,
          _makeSession(parentSessionId, name: parentSessionName),
        );
      });

      controller.setMessageForTest(
        ChatMessage(
          id: 'msg-parent-861-link',
          sessionId: parentSessionId,
          role: 'assistant',
          createdAt: _kEpoch,
        ),
      );
      controller.setChatPartForTest(
        ChatPart.fromJson(
          'msg-parent-861-link',
          _taskPartJson(
            id: 'part-parent-task-861-link',
            description: 'Research trends',
            outputChildId: childSdkId,
          ),
        ),
      );

      await tester.pumpWidget(
        await _buildTestApp(agentsController: controller),
      );
      await tester.pump();

      expect(find.byType(TaskChip), findsOneWidget);
      await tester.tap(find.byType(TaskChip));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      // Linked to the EXISTING local session (normal session view) …
      expect(controller.selectedSessionId, childLocalId);
      // … with no child-frame breadcrumb view and no SDK child refetch.
      expect(controller.childStackDepth, 0);
      expect(stubRepo.fetchChildMessagesCalls, isEmpty);

      // Flush any selectSession-triggered background fetches before teardown.
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 300)),
      );
      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );
}
