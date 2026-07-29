/// Acceptance contract for issue #638 — WS error frame not visible in full
/// Agents view transcript when session is not selected at frame arrival time.
///
/// STRICT CONTRACT: c1 FAILS today (before the production fix) and PASSES
/// after the fix is applied to agents_view.dart line ~1197.
///
/// Background
/// ----------
/// The `WsErrorMessage` handler in AgentsController writes to
/// `_transcriptsBySession[msg.id]` unconditionally, but only appends to the
/// flat `_transcript` list when `msg.id == _selectedSessionId`.
///
/// The full Agents view (`_buildTranscriptBody`, agents_view.dart ~line 1197):
///   final legacyTranscript = controller.transcript;   ← TODAY (BUG)
///
/// Fix (NOT applied here):
///   final legacyTranscript = controller.transcriptFor(session.id);
///
/// Test scenario (c1)
/// ------------------
/// 1. Initialize the controller (sets up WS subscription + timer).
/// 2. Push SessionCreatedMessage to register 'sid-1' in sessions list.
/// 3. Push WsErrorMessage for 'sid-1' while _selectedSessionId == null.
///    → error lands in _transcriptsBySession['sid-1'] but NOT in _transcript.
/// 4. Call selectSession('sid-1') (stub getSession hangs so it stays in the
///    intermediate state: _selectedSessionId='sid-1', _transcript=[]).
/// 5. Pump the widget — transcript panel for 'sid-1' is shown.
///    TODAY (reads controller.transcript = []):
///      legacyTranscript empty → shows "Waiting for output…" → no error text
///      → assertion FAILS ✗
///    AFTER FIX (reads controller.transcriptFor(session.id) = [errorMsg]):
///      legacyTranscript = [errorMsg] → renders SelectableText with error
///      → assertion PASSES ✓
///
/// Note on timers
/// --------------
/// AgentsController.initialize() creates a Timer.periodic (5 s) for stuck
/// detection. testWidgets uses FakeAsync, which would hang on pumpAndSettle
/// with a live periodic timer. We avoid this by:
///   (a) running all async setup via tester.runAsync() so setup executes in
///       real async, not FakeAsync;
///   (b) calling controller.dispose() explicitly BEFORE the widget tree is
///       torn down, which cancels the timer;
///   (c) using tester.pump() (single frame) instead of pumpAndSettle() for
///       the final widget assertion.
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
// Stubs / fakes
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

/// Repository whose getSession() hangs (Completer never completed).
/// This freezes the controller in the intermediate selectSession() state:
///   _selectedSessionId = 'sid-1', _transcript = [], transcriptFor = [error]
///
/// The Completer is stored so tests can complete it in tearDown if needed to
/// satisfy FakeAsync cleanup (only required when using pumpAndSettle).
class _HangingGetSessionRepository implements AgentsRepository {
  _HangingGetSessionRepository();

  final StreamController<AgentWsMessage> _msgCtrl =
      StreamController<AgentWsMessage>.broadcast();
  final StreamController<bool> _connCtrl = StreamController<bool>.broadcast();

  // Completers for in-flight getSession calls. Complete them in tearDown to
  // let the widget tree clean up without hanging.
  final List<
    Completer<({AgentSession session, List<AgentSessionMessage> messages})>
  >
  pendingGetSession = [];

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
    // Do NOT complete the pending getSession Completers here — completing them
    // after the controller is disposed would trigger the selectSession()
    // continuation and call notifyListeners() on a disposed controller.
    // The Completers are simply abandoned; the GC will collect them.
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
  }) async => [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
  getSession(String id) {
    final c =
        Completer<
          ({AgentSession session, List<AgentSessionMessage> messages})
        >();
    pendingGetSession.add(c);
    return c.future;
  }

  void push(AgentWsMessage msg) => _msgCtrl.add(msg);

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
// Test widget builder — mirrors new_session_dialog_error_test.dart
// ---------------------------------------------------------------------------

final _claudeCodeConfig = AgentConfig(
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'assets/icons/claude_code.png',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
);

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

// ---------------------------------------------------------------------------
// Contract tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // AgentsController.initialize() fires unawaited loadInspectorPrefs(), which
  // calls SharedPreferences.getInstance(). Without a registered mock the
  // plugin channel rejects AFTER the test body completes, failing the test on
  // a timing race ("test failed after it had already completed"). Registering
  // the mock makes getInstance() resolve synchronously in tests.
  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

  // -------------------------------------------------------------------------
  // c1 — UI widget test (STRICT: FAILS today, PASSES after the line-1197 fix)
  // -------------------------------------------------------------------------
  group('issue-638-c1: WS error frame visible in full Agents view transcript', () {
    testWidgets(
      'error injected before session selection appears in transcript panel',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(1400, 900));
        addTearDown(() => tester.binding.setSurfaceSize(null));

        final repo = _HangingGetSessionRepository();
        final controller = AgentsController(
          repo,
          _ReadyAgentServerController(),
          _FakeLocalNotificationService(),
          _FakeNotificationsController(),
        );

        // All async setup runs via runAsync() — real time, not FakeAsync —
        // so the Timer.periodic created by initialize() is a real timer and
        // does not interfere with the widget-pump FakeAsync environment.
        await tester.runAsync(() async {
          await controller.initialize();

          // Register 'sid-1' in the sessions list via WS.
          repo.push(
            SessionCreatedMessage(
              session: AgentSession(
                id: 'sid-1',
                agentId: 'claude-code',
                name: 'Test session',
                cwd: '/tmp',
                status: AgentSessionStatus.idle,
                createdAt: DateTime(2026),
                updatedAt: DateTime(2026),
              ),
            ),
          );
          // Give the WS stream listener a microtask to process the message.
          await Future<void>.delayed(const Duration(milliseconds: 10));

          // Precondition: no session selected yet.
          assert(controller.selectedSessionId == null);

          // Inject WsErrorMessage for 'sid-1' while no session is selected.
          // The handler writes to _transcriptsBySession['sid-1'] but NOT to
          // _transcript (because _selectedSessionId != 'sid-1').
          repo.push(
            const WsErrorMessage(
              id: 'sid-1',
              message: 'Model not found: openrouter/google/gemini-3-flash',
            ),
          );
          await Future<void>.delayed(const Duration(milliseconds: 10));

          // OPC-M1-3: WsErrorMessage now creates a system-role ChatMessage in
          // chatMessagesBySession instead of transcriptFor.
          assert(
            controller.chatMessagesFor('sid-1').any((m) => m.role == 'system'),
            'chatMessagesFor(sid-1) must have a system-role entry before selection',
          );
          assert(
            controller.transcript.isEmpty,
            'controller.transcript must be empty (no session selected)',
          );

          // Call selectSession — immediately sets _selectedSessionId='sid-1',
          // _transcript=[], and fires notifyListeners(). Then hangs on
          // getSession (Completer never completes), keeping the intermediate
          // state that exposes the bug.
          unawaited(controller.selectSession('sid-1'));
          await Future<void>.delayed(const Duration(milliseconds: 10));

          // Verify intermediate state: session selected, error still in chatMessages.
          assert(controller.selectedSessionId == 'sid-1');
          assert(controller.transcript.isEmpty);
          assert(
            controller.chatMessagesFor('sid-1').any((m) => m.role == 'system'),
          );
        });

        // Pump the widget. The transcript panel for 'sid-1' is shown.
        //
        // TODAY (line 1197: controller.transcript):
        //   legacyTranscript = [] → hasLegacy = false → "Waiting for output…"
        //   → NO "Model not found" → assertion FAILS ✗
        //
        // AFTER FIX (line 1197: controller.transcriptFor(session.id)):
        //   legacyTranscript = [errorMsg] → hasLegacy = true → renders
        //   SelectableText("Error: Model not found: ...") → PASSES ✓
        await tester.pumpWidget(
          await _buildTestApp(agentsController: controller),
        );
        await tester.pump();

        // THE FAILING ASSERTION (today): error text not rendered in view.
        expect(
          find.textContaining('Model not found'),
          findsAtLeastNWidgets(1),
          reason:
              'The full Agents view transcript panel must display the WS '
              'error. Today it reads controller.transcript (empty), missing '
              'the error. After the fix it reads '
              'controller.transcriptFor(session.id) and renders it.',
        );

        // Explicitly dispose the controller to cancel the Timer.periodic
        // before the test framework's FakeAsync cleanup runs. Without this,
        // the fake environment would see a pending timer and hang.
        controller.dispose();
      },
    );
  });

  // -------------------------------------------------------------------------
  // c2 — UNIT (regression guard for data layer)
  // PASSES both before and after the fix; protects the controller invariant.
  // -------------------------------------------------------------------------
  group(
    'issue-638-c2: WsErrorMessage creates system-role ChatMessage for non-selected session',
    () {
      test('error frame for non-selected session lands in chatMessagesFor — '
          'regression guard for OPC-M1-3 single render path', () async {
        final repo = _HangingGetSessionRepository();
        final controller = AgentsController(
          repo,
          _ReadyAgentServerController(),
          _FakeLocalNotificationService(),
          _FakeNotificationsController(),
        );
        addTearDown(controller.dispose);

        await controller.initialize();

        // OPC-M1-3: WsErrorMessage writes to chatMessagesBySession (system role),
        // not transcriptFor. Both must be empty initially.
        expect(controller.chatMessagesFor('sid-1'), isEmpty);
        expect(controller.transcript, isEmpty);

        var notifyCount = 0;
        controller.addListener(() => notifyCount++);

        repo.push(
          const WsErrorMessage(id: 'sid-1', message: 'Model not found: foo'),
        );
        await Future<void>.delayed(Duration.zero);

        final chatMsgs = controller.chatMessagesFor('sid-1');
        expect(
          chatMsgs,
          isNotEmpty,
          reason:
              'chatMessagesFor(sid-1) must contain the system-role error entry '
              'even when sid-1 is not the selected session.',
        );
        expect(
          chatMsgs.any((m) => m.role == 'system'),
          isTrue,
          reason: 'WsErrorMessage must create a system-role ChatMessage.',
        );

        expect(
          controller.transcript,
          isEmpty,
          reason:
              'controller.transcript (flat selected-session list) must be '
              'empty when no session is selected.',
        );

        expect(notifyCount, greaterThan(0));
      });
    },
  );

  // -------------------------------------------------------------------------
  // c5 — UI (STRICT: FAILS today, PASSES after the hasChat-branch fix)
  //
  // When `hasChat = true` (chatMessages are non-empty) the view's hasChat branch
  // returns early and renders ONLY chatMessages, skipping legacyTranscript
  // entirely. A WsErrorMessage (role: 'system') appended to legacyTranscript
  // is therefore hidden — even though transcriptFor() has it.
  //
  // Fix: when hasChat=true, also render legacyTranscript entries with
  // role == 'system' so error frames are always visible.
  // -------------------------------------------------------------------------
  group('issue-638-c5: WS error frame visible even when hasChat = true', () {
    testWidgets(
      'error injected after a chat message appears in transcript panel',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(1400, 900));
        addTearDown(() => tester.binding.setSurfaceSize(null));

        final repo = _HangingGetSessionRepository();
        final controller = AgentsController(
          repo,
          _ReadyAgentServerController(),
          _FakeLocalNotificationService(),
          _FakeNotificationsController(),
        );

        await tester.runAsync(() async {
          await controller.initialize();

          // Register 'sid-chat' in the sessions list via WS.
          repo.push(
            SessionCreatedMessage(
              session: AgentSession(
                id: 'sid-chat',
                agentId: 'claude-code',
                name: 'Chat session',
                cwd: '/tmp',
                status: AgentSessionStatus.working,
                createdAt: DateTime(2026),
                updatedAt: DateTime(2026),
              ),
            ),
          );
          await Future<void>.delayed(const Duration(milliseconds: 10));

          // Populate chatMessages so hasChat = true.
          repo.push(
            MessageUpdatedMessage(
              sessionId: 'sid-chat',
              info: const {'id': 'msg-001', 'role': 'assistant'},
            ),
          );
          await Future<void>.delayed(const Duration(milliseconds: 10));

          // Precondition: chatMessages must be non-empty now.
          assert(
            controller.chatMessagesFor('sid-chat').isNotEmpty,
            'chatMessagesFor must be non-empty to exercise the hasChat=true branch',
          );

          // Inject a WsErrorMessage AFTER chatMessages exist.
          // This appends to legacyTranscript (role: system) but the hasChat
          // branch ignores legacyTranscript — so error is hidden today.
          repo.push(
            const WsErrorMessage(
              id: 'sid-chat',
              message: 'Provider error in chat session',
            ),
          );
          await Future<void>.delayed(const Duration(milliseconds: 10));

          // OPC-M1-3: WsErrorMessage creates a system-role ChatMessage in
          // chatMessagesBySession, not transcriptFor.
          assert(
            controller
                .chatMessagesFor('sid-chat')
                .any((m) => m.role == 'system'),
            'chatMessagesFor(sid-chat) must have a system-role error entry',
          );

          // Select the session.
          unawaited(controller.selectSession('sid-chat'));
          await Future<void>.delayed(const Duration(milliseconds: 10));
        });

        await tester.pumpWidget(
          await _buildTestApp(agentsController: controller),
        );
        await tester.pump();

        // THE FAILING ASSERTION (today): hasChat=true returns ONLY chatMessages,
        // legacyTranscript (with the error) is ignored.
        //
        // AFTER FIX: the hasChat branch also renders role=system messages
        // from legacyTranscript, so 'Provider error' is visible.
        expect(
          find.textContaining('Provider error'),
          findsAtLeastNWidgets(1),
          reason:
              'The error must be visible even when hasChat=true. '
              'Today the hasChat branch returns early without rendering '
              'legacyTranscript (issue #638 hasChat sub-bug).',
        );

        // Replace the widget tree with an empty container first so that
        // any timer-owning widgets (MessageActionsRow, MessageTimeTicker)
        // are properly disposed before controller.dispose() cancels the
        // stuckCheckTimer. Without this, those widget timers are still
        // pending when the test framework's FakeAsync cleanup runs.
        await tester.pumpWidget(const MaterialApp(home: SizedBox()));
        controller.dispose();
      },
    );
  });

  // -------------------------------------------------------------------------
  // c3 — UNIT (STRICT: FAILS today, PASSES after the line-855 merge fix)
  //
  // Race window: WS error frame arrives AFTER selectSession dispatches REST
  // but BEFORE the REST resolves. The REST result is empty (server has not
  // persisted the WS error). Line 855 then overwrites _transcriptsBySession[id]
  // with the empty REST list, silently dropping the WS-appended error.
  //
  // Fix (NOT applied here — see production code):
  //   At line 855 (selectSession) AND line 683 (reconnectSession), replace the
  //   unconditional overwrite:
  //     _transcriptsBySession[id] = result.messages;
  //   with a merge that preserves WS frames already in the map:
  //     final existing = _transcriptsBySession[id] ?? const [];
  //     final backfill = result.messages
  //         .where((m) => !existing.any((e) => e.id != 0 && e.id == m.id))
  //         .toList();
  //     _transcriptsBySession[id] = [...backfill, ...existing];
  // -------------------------------------------------------------------------
  group('issue-638-c3: WS error frame injected during selectSession REST race '
      'must survive REST resolution', () {
    test('WS error frame injected during selectSession REST race must survive '
        'REST resolution', () async {
      final repo = _HangingGetSessionRepository();
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );
      addTearDown(controller.dispose);

      await controller.initialize();

      // Register sid-1 via a fake SessionCreatedMessage so the controller
      // knows about the session before we try to select it.
      repo.push(
        SessionCreatedMessage(
          session: AgentSession(
            id: 'sid-1',
            agentId: 'claude-code',
            name: 'Race test session',
            cwd: '/tmp',
            status: AgentSessionStatus.idle,
            createdAt: DateTime(2026),
            updatedAt: DateTime(2026),
          ),
        ),
      );
      await Future<void>.delayed(Duration.zero);

      // Step 1: dispatch selectSession — hangs on REST (Completer not yet
      // completed). The call immediately sets _selectedSessionId='sid-1'
      // and _transcript=[] then notifies, but the REST future is pending.
      final selectFuture = controller.selectSession('sid-1');

      // Give the microtask queue a tick so selectSession's async body
      // executes up to the `await _repository.getSession(id)` suspension
      // point and registers the Completer.
      await Future<void>.delayed(Duration.zero);

      // Step 2: inject WS error frame DURING the REST race window.
      // The WsErrorMessage handler is unconditional — it writes to
      // _transcriptsBySession['sid-1'] regardless of selected session.
      repo.push(
        const WsErrorMessage(
          id: 'sid-1',
          message: 'SDK error during race window',
        ),
      );
      await Future<void>.delayed(Duration.zero);

      // Step 2 assertion: OPC-M1-3 — WsErrorMessage creates a system-role
      // ChatMessage in chatMessagesBySession (not transcriptFor).
      expect(
        controller.chatMessagesFor('sid-1'),
        isNotEmpty,
        reason:
            'chatMessagesFor(sid-1) must contain the system-role WS '
            'error after it arrives during the REST race window.',
      );
      expect(
        controller.chatMessagesFor('sid-1').any((m) => m.role == 'system'),
        isTrue,
      );

      // Step 3: complete the REST with an EMPTY messages list — simulating
      // a server that has not yet persisted the WS-delivered error frame.
      final session = AgentSession(
        id: 'sid-1',
        agentId: 'claude-code',
        name: 'Race test session',
        cwd: '/tmp',
        status: AgentSessionStatus.idle,
        createdAt: DateTime(2026),
        updatedAt: DateTime(2026),
      );
      expect(
        repo.pendingGetSession,
        isNotEmpty,
        reason: 'There must be a pending getSession Completer to resolve.',
      );
      repo.pendingGetSession.first.complete((
        session: session,
        messages: const <AgentSessionMessage>[],
      ));

      // Await selectSession to fully resolve.
      await selectFuture;

      // Step 4: OPC-M1-3 — chatMessagesBySession holds WS error in place.
      // rehydrateChatMessages skips messages already in WS-streamed state,
      // so the system-role error entry survives REST resolution.
      expect(
        controller.chatMessagesFor('sid-1'),
        isNotEmpty,
        reason:
            'chatMessagesFor(sid-1) must still contain the system-role '
            'error after selectSession resolves with an empty REST result. '
            'OPC-M1-3: the parts-based store is not overwritten by REST.',
      );
      expect(
        controller.chatMessagesFor('sid-1').any((m) => m.role == 'system'),
        isTrue,
        reason:
            'The system-role WS error ChatMessage must survive REST '
            'rehydration.',
      );
    });
  });
}
