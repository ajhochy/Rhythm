/// Contract tests for issue #867 — dispatched/subagent session UI must
/// reflect and CONTINUE as the session's own resolved agent, not the
/// app-wide default picker selection.
///
/// Two coupled defects fixed here:
///   1. The session UI didn't reflect the ACTIVE agent — a dispatched/
///      subagent session showed the app-wide manager-profile default in
///      the footer's [AgentSelectorPill] instead of its own [AgentSession.
///      agentId].
///   2. Replying re-bound the session to the UI's currently-selected
///      default agent — [AgentsController.sendInput] forwarded whatever
///      [AgentsController.selectedAgentFor] returned, which (before this
///      fix) fell straight through to the app-wide manager default whenever
///      no EXPLICIT per-session override had been made, silently converting
///      a dispatched session into a generic default-agent session mid-thread.
///
/// Fix: [AgentsController.selectedAgentFor] resolution order is now
/// explicit-per-session-override → the session's OWN [AgentSession.agentId]
/// (when non-empty) → app-wide manager default → null. Switching the app-wide
/// picker (the manager resolver) must NOT retroactively re-bind a session
/// that already carries its own resolved agent. Switching a session's agent
/// remains possible ONLY via the explicit [AgentSelectorPill] action
/// ([AgentsController.setSelectedAgent]), never as a side effect of sending.
///
/// REAL-SURFACE: per the "agents inspector was orphaned" lesson, the display
/// assertions pump the actual [InputAreaTestHarness] (the real `_InputArea`
/// composer from agents_view.dart, including the real [AgentSelectorPill]),
/// not an isolated widget — mirroring the existing real-surface test in
/// opc_m4_4_agent_selection_test.dart.
///
/// Run with:
///   flutter test test/features/agents/issue_867_session_agent_binding_test.dart
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
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Fakes (mirrors opc_m4_4_agent_selection_test.dart)
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

class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  final List<Map<String, dynamic>> sentFrames = [];

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
  void send(Map<String, dynamic> msg) => sentFrames.add(msg);

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async =>
      const [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async =>
          (session: _makeSession(id), messages: const <AgentSessionMessage>[]);

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

  @override
  Future<void> revertSession(String sessionId, String messageId) async {}

  @override
  Future<void> unrevertSession(String sessionId) async {}

  @override
  Future<void> summarizeSession(String sessionId) async {}

  @override
  Future<void> dispatchCommand(
      String sessionId, String command, String args) async {}

  @override
  Future<List<Map<String, dynamic>>> fetchSessionTodos(String id) async =>
      const [];

  @override
  Future<List<Map<String, dynamic>>> fetchChildSessions(
          String parentSessionId) async =>
      const [];

  @override
  Future<List<AgentSessionMessage>> fetchChildMessages(
          String parentSessionId, String childSdkId,
          {String? cwd}) async =>
      const [];

  @override
  Future<AgentSession> forkSession(String sessionId, String messageId) async {
    throw UnimplementedError();
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

/// A plain top-level session with no agent of its own yet — the shape a
/// brand-new user-created session has before any turn is sent.
AgentSession _makeSession(String id, {String agentId = ''}) => AgentSession(
      id: id,
      agentId: agentId,
      name: 'Test Session',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

/// A dispatched/subagent session that already carries its OWN resolved
/// engine agent (e.g. 'secretary') — as #858's create/resume path persists
/// for delegated sessions via agentConfig.ocAgent.
AgentSession _makeDispatchedSession(String id, String dispatchedAgentId) =>
    _makeSession(id, agentId: dispatchedAgentId);

AgentsController _buildController(
  _StubAgentsRepository repo, {
  String? Function()? managerAgentNameResolver,
}) =>
    AgentsController(
      repo,
      _ReadyAgentServerController(),
      LocalNotificationService(),
      NotificationsController(
        NotificationsRepository(NotificationsDataSource()),
      ),
      managerAgentNameResolver: managerAgentNameResolver,
    );

AgentConfigsController _buildConfigsController() => AgentConfigsController(
      AgentConfigsRepository(AgentConfigsDataSource()),
    );

Widget _withProviders({
  required AgentsController controller,
  required Widget child,
}) {
  return MaterialApp(
    theme: AppTheme.light(),
    home: MultiProvider(
      providers: [
        ChangeNotifierProvider<AgentsController>.value(value: controller),
        ChangeNotifierProvider<AgentConfigsController>.value(
          value: _buildConfigsController(),
        ),
      ],
      child: Scaffold(body: child),
    ),
  );
}

void main() {
  // ── AC1: opening a dispatched/subagent session shows ITS agent, not the
  //         app-wide default ─────────────────────────────────────────────

  test(
    'issue-867-ac1: selectedAgentFor returns the session\'s OWN agent, not '
    'the app-wide manager default, when no explicit selection was made',
    () {
      final repo = _StubAgentsRepository();
      // App-wide default resolver simulates a manager profile ("Coding
      // Workflow") configured globally — this is what the OLD code would
      // have returned for every session with no explicit override.
      final ctrl = _buildController(
        repo,
        managerAgentNameResolver: () => 'coding-workflow-manager',
      );

      const dispatchedSessionId = '867-dispatched-session';
      final dispatchedSession =
          _makeDispatchedSession(dispatchedSessionId, 'secretary');
      ctrl.setActiveSessionForTest(dispatchedSessionId, dispatchedSession);

      // Must resolve to the session's OWN agent ('secretary'), never the
      // app-wide manager default ('coding-workflow-manager').
      expect(
        ctrl.selectedAgentFor(dispatchedSessionId),
        equals('secretary'),
        reason: 'a dispatched session with its own agentId must not silently '
            'inherit the app-wide default agent',
      );

      // This is NOT an "explicit override" — it's the session's natural
      // identity. The pill must not render as "overridden".
      expect(ctrl.hasExplicitAgentSelection(dispatchedSessionId), isFalse);

      ctrl.dispose();
    },
  );

  testWidgets(
    'issue-867-ac1-real-surface: AgentSelectorPill in the mounted composer '
    'shows the dispatched session\'s own agent label, not the app-wide '
    'default',
    (tester) async {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(
        repo,
        managerAgentNameResolver: () => 'coding-workflow-manager',
      );

      const dispatchedSessionId = '867-dispatched-real-surface';
      final dispatchedSession =
          _makeDispatchedSession(dispatchedSessionId, 'secretary');
      ctrl.setActiveSessionForTest(dispatchedSessionId, dispatchedSession);

      await tester.pumpWidget(_withProviders(
        controller: ctrl,
        child: const InputAreaTestHarness(),
      ));
      await tester.pump(Duration.zero);

      // The pill must show the session's own agent, not the manager default
      // label, and must not be rendered as an "overridden" (accent) pill.
      expect(find.text('secretary'), findsOneWidget);
      expect(find.text('coding-workflow-manager'), findsNothing);

      ctrl.dispose();
    },
  );

  // ── AC2: sending a reply uses the session's resolved agent, not the
  //         picker's app-wide default ────────────────────────────────────

  test(
    'issue-867-ac2: sendInput ships the DISPATCHED session\'s own agent on '
    'the wire, not the app-wide manager default',
    () {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(
        repo,
        managerAgentNameResolver: () => 'coding-workflow-manager',
      );

      const dispatchedSessionId = '867-ac2-session';
      final dispatchedSession =
          _makeDispatchedSession(dispatchedSessionId, 'secretary');
      ctrl.setActiveSessionForTest(dispatchedSessionId, dispatchedSession);

      ctrl.sendInput(dispatchedSessionId, 'continue the task');

      expect(repo.sentFrames.length, equals(1));
      expect(
        repo.sentFrames.first['agent'],
        equals('secretary'),
        reason:
            'a reply in a dispatched session must continue as that session\'s '
            'own resolved agent, not the app-wide default picker selection',
      );

      ctrl.dispose();
    },
  );

  test(
    'issue-867-ac2-regression: a normal top-level session with no agent of '
    'its own still uses the app-wide picker as its INITIAL agent',
    () {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(
        repo,
        managerAgentNameResolver: () => 'coding-workflow-manager',
      );

      const freshSessionId = '867-fresh-session';
      // A brand-new session has no agentId of its own yet (empty string is
      // the wire value for agent-less instant-create sessions).
      final freshSession = _makeSession(freshSessionId, agentId: '');
      ctrl.setActiveSessionForTest(freshSessionId, freshSession);

      expect(
        ctrl.selectedAgentFor(freshSessionId),
        equals('coding-workflow-manager'),
        reason:
            'a fresh session with no agent of its own must still default to '
            'the app-wide picker selection',
      );

      ctrl.sendInput(freshSessionId, 'hello');
      expect(
        repo.sentFrames.first['agent'],
        equals('coding-workflow-manager'),
      );

      ctrl.dispose();
    },
  );

  // ── AC3: changing the global picker must NOT retroactively re-bind an
  //         already-running session ──────────────────────────────────────

  test(
    'issue-867-ac3: changing the app-wide default agent does not re-bind an '
    'already-dispatched session',
    () {
      final repo = _StubAgentsRepository();
      String currentManagerAgent = 'coding-workflow-manager';
      final ctrl = _buildController(
        repo,
        managerAgentNameResolver: () => currentManagerAgent,
      );

      const dispatchedSessionId = '867-ac3-session';
      final dispatchedSession =
          _makeDispatchedSession(dispatchedSessionId, 'secretary');
      ctrl.setActiveSessionForTest(dispatchedSessionId, dispatchedSession);

      expect(ctrl.selectedAgentFor(dispatchedSessionId), equals('secretary'));

      // Simulate the user changing the app-wide default picker/manager
      // profile while the dispatched session is open.
      currentManagerAgent = 'a-different-manager-profile';

      // The dispatched session must still resolve to ITS OWN agent —
      // unaffected by the app-wide default change.
      expect(
        ctrl.selectedAgentFor(dispatchedSessionId),
        equals('secretary'),
        reason:
            'an already-running dispatched session must not be retroactively '
            're-bound when the app-wide default picker changes',
      );

      ctrl.sendInput(dispatchedSessionId, 'still secretary?');
      expect(repo.sentFrames.first['agent'], equals('secretary'));

      ctrl.dispose();
    },
  );

  // ── AC4: switching a session's agent is only possible via an EXPLICIT
  //         user action ──────────────────────────────────────────────────

  test(
    'issue-867-ac4: switching a dispatched session\'s agent requires an '
    'explicit setSelectedAgent call — never a side effect of sendInput',
    () {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(
        repo,
        managerAgentNameResolver: () => 'coding-workflow-manager',
      );

      const dispatchedSessionId = '867-ac4-session';
      final dispatchedSession =
          _makeDispatchedSession(dispatchedSessionId, 'secretary');
      ctrl.setActiveSessionForTest(dispatchedSessionId, dispatchedSession);

      // Sending several turns must never mutate the resolved agent as a
      // side effect.
      ctrl.sendInput(dispatchedSessionId, 'turn 1');
      ctrl.sendInput(dispatchedSessionId, 'turn 2');
      expect(ctrl.selectedAgentFor(dispatchedSessionId), equals('secretary'));
      expect(ctrl.hasExplicitAgentSelection(dispatchedSessionId), isFalse);

      // An EXPLICIT user action (e.g. picking a different agent from the
      // AgentSelectorPill popup menu) is the only way to change it.
      ctrl.setSelectedAgent(dispatchedSessionId, 'build');
      expect(ctrl.selectedAgentFor(dispatchedSessionId), equals('build'));
      expect(ctrl.hasExplicitAgentSelection(dispatchedSessionId), isTrue);

      // Resetting back to "default" (null) falls through to the session's
      // OWN agent again — NOT the app-wide manager default — because the
      // session still has its own resolved identity.
      ctrl.setSelectedAgent(dispatchedSessionId, null);
      expect(ctrl.selectedAgentFor(dispatchedSessionId), equals('secretary'));
      expect(ctrl.hasExplicitAgentSelection(dispatchedSessionId), isFalse);

      ctrl.dispose();
    },
  );

  testWidgets(
    'issue-867-ac4-real-surface: picking a different agent from the real '
    'AgentSelectorPill explicitly overrides the session, and the pill shows '
    'the overridden state',
    (tester) async {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(
        repo,
        managerAgentNameResolver: () => 'coding-workflow-manager',
      );

      const dispatchedSessionId = '867-ac4-real-surface';
      final dispatchedSession =
          _makeDispatchedSession(dispatchedSessionId, 'secretary');
      ctrl.setActiveSessionForTest(dispatchedSessionId, dispatchedSession);
      ctrl.setAvailableAgentsForTest(dispatchedSessionId, [
        AgentInfo(name: 'build', builtIn: true),
        AgentInfo(name: 'plan', builtIn: true),
      ]);

      await tester.pumpWidget(_withProviders(
        controller: ctrl,
        child: const InputAreaTestHarness(),
      ));
      await tester.pump(Duration.zero);

      // Initial state: shows the session's own agent, not overridden.
      expect(find.text('secretary'), findsOneWidget);

      // Open the popup and pick 'build' explicitly.
      await tester.tap(find.byType(AgentSelectorPill));
      await tester.pumpAndSettle();
      await tester.tap(find.text('build').last);
      await tester.pumpAndSettle();

      expect(
        ctrl.selectedAgentFor(dispatchedSessionId),
        equals('build'),
        reason: 'explicit pick from the real popup must override the session',
      );
      expect(ctrl.hasExplicitAgentSelection(dispatchedSessionId), isTrue);

      ctrl.dispose();
    },
  );
}
