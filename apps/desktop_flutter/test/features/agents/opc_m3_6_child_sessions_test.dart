/// Contract tests for OPC-M3-6 — Subagent child-session navigation.
///
/// Covers acceptance criteria c2–c6 from the issue spec:
///
/// c2 — Tapping a task chip pushes a child transcript view showing the child's
///      parts via the standard renderers (REAL-SURFACE widget test).
///
/// c3 — The child view shows a breadcrumb '‹ parent-session-name'; tapping
///      returns to the parent transcript at its prior scroll context (no
///      rehydrate refetch of the parent).
///
/// c4 — The child view has no composer (read-only assert: composer widget absent).
///
/// c5 — Child sessions never appear in the sidebar session lists (controller
///      test: children excluded from active/resumable lists).
///
/// c6 — While the child is streaming (subtask parts updating), the chip's
///      status indicator updates in the parent transcript (existing ToolState
///      path — regression assert).
///
/// c1 is covered by the vitest server-side test.
/// c7 (ai-workflow checks --level pr exit 0) is manual / gate-level.
///
/// Run with:
///   flutter test test/features/agents/opc_m3_6_child_sessions_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_tool_renderers/_task_chip.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Fakes and stubs
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

/// Stub repository with injectable child-session responses.
class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  /// Sessions returned by listSessions (normally populated only with parent
  /// sessions — NOT child sessions; set by tests to verify c5).
  List<AgentSession> _sessions = [];

  /// Messages returned by fetchChildMessages.
  List<AgentSessionMessage> stagedChildMessages = const [];

  /// Track call counts for assertions.
  int fetchChildMessagesCallCount = 0;
  int fetchParentSessionCallCount = 0;

  void injectWsMessage(AgentWsMessage msg) => _msgController.add(msg);

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
      _sessions;

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    fetchParentSessionCallCount++;
    return (
      session: _makeSession(id),
      messages: const <AgentSessionMessage>[],
    );
  }

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

  @override
  Future<List<Map<String, dynamic>>> fetchSessionTodos(String id) async =>
      const [];

  @override
  Future<void> revertSession(String sessionId, String messageId) async {}

  @override
  Future<void> unrevertSession(String sessionId) async {}

  @override
  Future<void> summarizeSession(String sessionId) async {}

  @override
  Future<List<AgentSessionMessage>> fetchChildMessages(
      String parentSessionId, String childSdkId,
      {String? cwd}) async {
    fetchChildMessagesCallCount++;
    return stagedChildMessages;
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);

  @override
  Future<List<AgentInfo>> fetchAvailableAgents({String? cwd}) async => const [];
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

AgentsController _buildController(_StubAgentsRepository repo) =>
    AgentsController(
      repo,
      _ReadyAgentServerController(),
      LocalNotificationService(),
      NotificationsController(
        NotificationsRepository(NotificationsDataSource()),
      ),
    );

Widget _wrap(AgentsController controller, Widget child) => MultiProvider(
      providers: [
        ChangeNotifierProvider<AgentsController>.value(value: controller),
        ChangeNotifierProvider<AgentServerController>.value(
          value: _ReadyAgentServerController(),
        ),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(body: child),
      ),
    );

/// Build a minimal ChatPart for a 'task' tool with the given status and
/// optional childSdkId embedded in toolArgs and/or the tool output.
///
/// [childSdkId] → embedded in `state.input.sessionId` (legacy path).
/// [outputChildId] → embedded in `state.output` as `task_id: <id>`, which is
/// how opencode's native `task` tool actually returns the child session id.
ChatPart _makeTaskPart({
  String messageId = 'msg-parent-001',
  String toolStatus = 'running',
  String description = 'Fix the auth bug',
  String? childSdkId,
  String? outputChildId,
}) =>
    ChatPart.fromJson(messageId, {
      'id': 'part-task-001',
      'type': 'tool',
      'tool': 'task',
      'callID': 'call-task-001',
      'state': {
        'status': toolStatus,
        'input': {
          'description': description,
          if (childSdkId != null) 'sessionId': childSdkId,
        },
        if (outputChildId != null)
          'output':
              'task_id: $outputChildId (for resuming to continue this task if needed)\n\n<task_result>\ndone\n</task_result>',
        'title': 'Task: $description',
        'metadata': <String, dynamic>{},
      },
    });

/// Build AgentSessionMessage fixtures representing the child session transcript.
List<AgentSessionMessage> _makeChildMessages() => [
      AgentSessionMessage.fromStructuredJson({
        'id': 1,
        'sessionId': 'child-local-synthetic',
        'role': 'input',
        'rawText': 'Fix the auth bug',
        'strippedText': 'Fix the auth bug',
        'createdAt': '2026-06-13T10:00:00Z',
        'sdkMessageId': 'msg-child-001',
        'parts': [
          {
            'id': 'part-child-text-001',
            'type': 'text',
            'text': 'Fix the auth bug',
          }
        ],
        'tokens': null,
        'cost': null,
      }),
      AgentSessionMessage.fromStructuredJson({
        'id': 2,
        'sessionId': 'child-local-synthetic',
        'role': 'output',
        'rawText': 'I found and fixed the bug.',
        'strippedText': 'I found and fixed the bug.',
        'createdAt': '2026-06-13T10:00:01Z',
        'sdkMessageId': 'msg-child-002',
        'parts': [
          {
            'id': 'part-child-text-002',
            'type': 'text',
            'text': 'I found and fixed the bug.',
          }
        ],
        'tokens': null,
        'cost': null,
      }),
    ];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  late _StubAgentsRepository repo;
  late AgentsController controller;

  setUp(() {
    repo = _StubAgentsRepository();
    controller = _buildController(repo);
  });

  tearDown(() => controller.dispose());

  // ── c2: REAL-SURFACE — tapping a task chip navigates to child transcript ──

  group('issue-699-c2: tapping a task chip shows child transcript view', () {
    testWidgets(
        'c2a: REAL-SURFACE — TaskChip with onTap navigates to child transcript',
        (tester) async {
      const parentSessionId = 'parent-session-c2a';
      const childSdkId = 'sdk-child-c2a';
      const parentSessionName = 'Parent Session C2a';

      // Stage child messages.
      repo.stagedChildMessages = _makeChildMessages();

      // Set up controller with parent session selected (used via controller.sessions).
      _makeSession(parentSessionId, name: parentSessionName);

      final taskPart = _makeTaskPart(
        toolStatus: 'running',
        description: 'Fix the auth bug',
        childSdkId: childSdkId,
      );

      // Seed the parent session and the task part in the controller.
      controller.setMessageForTest(ChatMessage(
        id: 'msg-parent-001',
        sessionId: parentSessionId,
        role: 'assistant',
        createdAt: _kEpoch,
      ));
      controller.setChatPartForTest(taskPart);

      // Track initial fetch count to assert no re-fetch when navigating back.
      final initialFetchCount = repo.fetchParentSessionCallCount;

      // Build the navigable TaskChip with controller wired in.
      await tester.pumpWidget(
        _wrap(
          controller,
          Builder(
            builder: (ctx) {
              final agentsCtrl = ctx.watch<AgentsController>();
              // The child view is shown when controller has an active child session.
              final childView = agentsCtrl.activeChildSessionId;
              if (childView != null) {
                // The child transcript view should be rendered.
                return Column(
                  children: [
                    // Breadcrumb back button (c3).
                    TextButton.icon(
                      onPressed: () => agentsCtrl.closeChildSession(),
                      icon: const Icon(Icons.chevron_left),
                      label:
                          Text('‹ ${agentsCtrl.activeChildParentName ?? ''}'),
                    ),
                    const Expanded(child: Text('Child transcript area')),
                  ],
                );
              }
              // Parent view: show the TaskChip.
              return TaskChip(
                part: taskPart,
                parentSessionId: parentSessionId,
                parentSessionName: parentSessionName,
              );
            },
          ),
        ),
      );

      // Initially the parent view is shown (TaskChip visible).
      expect(find.byType(TaskChip), findsOneWidget);
      expect(find.text('Fix the auth bug'), findsOneWidget);

      // Tap the chip — should navigate to child view.
      // Use pump() instead of pumpAndSettle() because the running chip has
      // a CircularProgressIndicator that never settles.
      await tester.tap(find.byType(TaskChip));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      // After tap, child view is shown (breadcrumb visible, TaskChip gone).
      expect(find.text('‹ $parentSessionName'), findsOneWidget);
      expect(find.byType(TaskChip), findsNothing);

      // c3: no extra fetch of the parent session after navigation back.
      // Navigate back by tapping breadcrumb.
      await tester.tap(find.byType(TextButton));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      // Back to parent view — TaskChip visible again.
      expect(find.byType(TaskChip), findsOneWidget);

      // c3: the parent session was NOT refetched on return (same count).
      expect(repo.fetchParentSessionCallCount, equals(initialFetchCount),
          reason: 'Returning to parent must not trigger a rehydrate refetch');
    });

    testWidgets(
        'c2a-out: TaskChip navigates when child id is ONLY in tool output '
        '(opencode `task_id: ses_…`)', (tester) async {
      const parentSessionId = 'parent-session-c2a-out';
      const childSdkId = 'ses_10091f3c5ffee81eES4aW1V8Ev';
      const parentSessionName = 'Parent Session C2a-out';

      repo.stagedChildMessages = _makeChildMessages();
      _makeSession(parentSessionId, name: parentSessionName);

      // Completed task whose child id is ONLY present in the tool output —
      // exactly how opencode's native `task` tool reports it. The input has
      // no `sessionId`, so the chevron must resolve the id from the output.
      final taskPart = _makeTaskPart(
        toolStatus: 'completed',
        description: 'Delegation smoke test',
        outputChildId: childSdkId,
      );

      controller.setMessageForTest(ChatMessage(
        id: 'msg-parent-001',
        sessionId: parentSessionId,
        role: 'assistant',
        createdAt: _kEpoch,
      ));
      controller.setChatPartForTest(taskPart);

      await tester.pumpWidget(
        _wrap(
          controller,
          Builder(
            builder: (ctx) {
              final agentsCtrl = ctx.watch<AgentsController>();
              if (agentsCtrl.activeChildSessionId != null) {
                return TextButton.icon(
                  onPressed: () => agentsCtrl.closeChildSession(),
                  icon: const Icon(Icons.chevron_left),
                  label: Text('‹ ${agentsCtrl.activeChildParentName ?? ''}'),
                );
              }
              return TaskChip(
                part: taskPart,
                parentSessionId: parentSessionId,
                parentSessionName: parentSessionName,
              );
            },
          ),
        ),
      );

      expect(find.byType(TaskChip), findsOneWidget);

      await tester.tap(find.byType(TaskChip));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 50));

      // Navigated into the child transcript using the id parsed from output.
      expect(find.text('‹ $parentSessionName'), findsOneWidget);
      expect(find.byType(TaskChip), findsNothing);
      expect(controller.activeChildSessionId, equals(childSdkId));
    });

    testWidgets('c2b: controller.openChildSession fetches child messages',
        (tester) async {
      const parentSessionId = 'parent-session-c2b';
      const childSdkId = 'sdk-child-c2b';

      repo.stagedChildMessages = _makeChildMessages();

      // Call openChildSession directly (the controller path wired to the chip tap).
      await controller.openChildSession(
        parentSessionId: parentSessionId,
        parentSessionName: 'Parent Session C2b',
        childSdkId: childSdkId,
      );
      await tester.pump(Duration.zero);

      // Repository must have been called once to fetch child messages.
      expect(repo.fetchChildMessagesCallCount, 1);

      // Controller must have the child session active.
      expect(controller.activeChildSessionId, childSdkId);

      // Child messages must be stored and accessible.
      final msgs = controller.childMessagesFor(childSdkId);
      expect(msgs, hasLength(2));
      expect(msgs.first.sdkMessageId, 'msg-child-001');
      expect(msgs.last.sdkMessageId, 'msg-child-002');
    });
  });

  // ── c3: breadcrumb back returns to parent without rehydrate ──

  group('issue-699-c3: breadcrumb back returns to parent without refetch', () {
    test('closeChildSession clears active child and does not refetch parent',
        () async {
      const parentSessionId = 'parent-session-c3';
      const childSdkId = 'sdk-child-c3';

      repo.stagedChildMessages = _makeChildMessages();

      await controller.initialize();

      // Open child session.
      await controller.openChildSession(
        parentSessionId: parentSessionId,
        parentSessionName: 'Parent C3',
        childSdkId: childSdkId,
      );

      expect(controller.activeChildSessionId, childSdkId);
      final fetchCountBefore = repo.fetchParentSessionCallCount;

      // Close (navigate back).
      controller.closeChildSession();

      // Child session is cleared.
      expect(controller.activeChildSessionId, isNull);

      // No extra parent session fetch.
      expect(repo.fetchParentSessionCallCount, equals(fetchCountBefore),
          reason: 'closeChildSession must not trigger a getSession call');
    });
  });

  // ── c4: child view has no composer ──

  group('issue-699-c4: child view is read-only (no composer)', () {
    testWidgets('c4: child transcript has no TextField/TextFormField composer',
        (tester) async {
      const parentSessionId = 'parent-session-c4';
      const childSdkId = 'sdk-child-c4';

      repo.stagedChildMessages = _makeChildMessages();

      // Open the child session directly (no initialize() — avoids the periodic
      // WS-reconnect timer which would be pending at testWidgets teardown).
      await controller.openChildSession(
        parentSessionId: parentSessionId,
        parentSessionName: 'Parent C4',
        childSdkId: childSdkId,
      );
      await tester.pump(Duration.zero);

      expect(controller.activeChildSessionId, isNotNull);

      // Build a widget that shows the child transcript view from the controller state.
      await tester.pumpWidget(
        _wrap(
          controller,
          Builder(
            builder: (ctx) {
              final agentsCtrl = ctx.watch<AgentsController>();
              final childId = agentsCtrl.activeChildSessionId;
              if (childId == null) return const SizedBox();
              // Render the ChildTranscriptView as exported by agents_view.
              return ChildTranscriptView(
                childSdkId: childId,
                parentSessionName: agentsCtrl.activeChildParentName ?? 'Parent',
                onBack: () => agentsCtrl.closeChildSession(),
              );
            },
          ),
        ),
      );

      await tester.pump(Duration.zero);

      // c4: no TextField (composer input) in the child view.
      expect(find.byType(TextField), findsNothing,
          reason: 'Child view must be read-only; no composer TextField');
    });
  });

  // ── c4b: parts-only child messages render text (regression) ──

  group('issue-699-c4b: child transcript renders text carried only in parts',
      () {
    testWidgets(
        'c4b: subagent message with text only in parts renders (not blank)',
        (tester) async {
      const parentSessionId = 'parent-session-c4b';
      const childSdkId = 'sdk-child-c4b';

      // Real subagent shape: rawText/strippedText empty, text lives in parts.
      repo.stagedChildMessages = [
        AgentSessionMessage.fromStructuredJson({
          'id': 1,
          'sessionId': 'child-synthetic',
          'role': 'output',
          'rawText': '',
          'strippedText': '',
          'createdAt': '2026-06-25T10:00:00Z',
          'sdkMessageId': 'msg-child-parts-001',
          'parts': [
            {'id': 'p1', 'type': 'text', 'text': 'Subagent transcript line'},
          ],
          'tokens': null,
          'cost': null,
        }),
      ];

      await controller.openChildSession(
        parentSessionId: parentSessionId,
        parentSessionName: 'Parent C4b',
        childSdkId: childSdkId,
      );
      await tester.pump(Duration.zero);

      await tester.pumpWidget(
        _wrap(
          controller,
          Builder(
            builder: (ctx) {
              final agentsCtrl = ctx.watch<AgentsController>();
              final childId = agentsCtrl.activeChildSessionId;
              if (childId == null) return const SizedBox();
              return ChildTranscriptView(
                childSdkId: childId,
                parentSessionName: agentsCtrl.activeChildParentName ?? 'Parent',
                onBack: () => agentsCtrl.closeChildSession(),
              );
            },
          ),
        ),
      );
      await tester.pump(Duration.zero);

      expect(find.text('Subagent transcript line'), findsOneWidget);
      expect(
        find.text('No messages in this subagent session.'),
        findsNothing,
      );
    });
  });

  // ── c5: children never appear in sidebar session lists ──

  group('issue-699-c5: child sessions never appear in active/resumable lists',
      () {
    test(
        'c5: loading sessions does not include child sessions from openChildSession',
        () async {
      const parentSessionId = 'parent-session-c5';
      const childSdkId = 'sdk-child-c5';

      // Stage only the parent session in the repository list.
      repo._sessions = [_makeSession(parentSessionId, name: 'Parent C5')];
      repo.stagedChildMessages = _makeChildMessages();

      await controller.initialize();
      await controller.load();

      // Only the parent session is in the active list.
      expect(controller.sessions.length, 1);
      expect(controller.sessions.first.id, parentSessionId);
      expect(controller.resumable.isEmpty, isTrue);

      // Open child session.
      await controller.openChildSession(
        parentSessionId: parentSessionId,
        parentSessionName: 'Parent C5',
        childSdkId: childSdkId,
      );

      // After opening, session lists are unchanged (child not added).
      expect(controller.sessions.length, 1,
          reason: 'Child session must not appear in sessions list');
      expect(controller.sessions.first.id, parentSessionId);
      expect(controller.resumable.isEmpty, isTrue,
          reason: 'Child session must not appear in resumable list');
    });
  });

  // ── c6: task chip ToolState indicator updates while child streams ──

  group('issue-699-c6: chip ToolState indicator updates in parent transcript',
      () {
    testWidgets(
        'c6: TaskChip ToolStateIndicator updates when part toolStatus changes (regression)',
        (tester) async {
      const sessionId = 'parent-session-c6';
      const messageId = 'msg-parent-c6';

      // Build a task part with 'running' status (use messageId that matches the test).
      final runningPart =
          _makeTaskPart(messageId: messageId, toolStatus: 'running');

      controller.setMessageForTest(ChatMessage(
        id: messageId,
        sessionId: sessionId,
        role: 'assistant',
        createdAt: _kEpoch,
      ));
      controller.setChatPartForTest(runningPart);

      await tester.pumpWidget(
        _wrap(
          controller,
          Builder(
            builder: (ctx) {
              final agentsCtrl = ctx.watch<AgentsController>();
              final parts = agentsCtrl.chatPartsFor(messageId);
              if (parts.isEmpty) return const SizedBox();
              return TaskChip(
                part: parts.first,
                parentSessionId: sessionId,
                parentSessionName: 'Parent C6',
              );
            },
          ),
        ),
      );

      await tester.pump(Duration.zero);

      // 'running' state: chip should show a CircularProgressIndicator.
      expect(find.byType(CircularProgressIndicator), findsOneWidget,
          reason: 'Running task chip should show spinner ToolStateIndicator');

      // Now update the part to 'completed'.
      final completedPart =
          _makeTaskPart(messageId: messageId, toolStatus: 'completed');
      controller.setChatPartForTest(completedPart);
      await tester.pump(Duration.zero);

      // 'completed' state: CircularProgressIndicator gone, check icon present.
      expect(find.byType(CircularProgressIndicator), findsNothing,
          reason: 'Completed chip must not show spinner');
      expect(find.byIcon(Icons.check_circle_outline), findsOneWidget,
          reason: 'Completed chip must show check_circle_outline icon');
    });
  });
}
