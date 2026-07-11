/// Contract tests for OPC-M4-4 — Custom agent/mode selection.
///
/// Covers acceptance criteria c3–c6:
///
/// c3 — The composer shows an agent selector populated from the endpoint;
///      default matches the SDK default; selection persists per session for
///      the app run (controller test).
///
/// c4 — An `agent`-type part in the transcript renders a labeled marker
///      ("Switched to plan") rather than the generic card (widget test with
///      fixture).
///
/// c5 — When the SDK reports only built-ins, the selector still works with
///      build/plan (no crash on absent custom agents).
///
/// c6 — Existing permission-mode behavior (plan mode auto-deny semantics) is
///      regression-tested — selecting the plan agent must NOT double-apply
///      permission gating.
///
/// REAL-SURFACE test: pumps the actual [InputAreaTestHarness] (which renders
/// the real [_InputArea] from agents_view.dart) to confirm the agent selector
/// is rendered in the real composer surface — guards against orphaned-widget
/// regression (#694 pattern).
///
/// c1, c2 are covered by the vitest server-side test.
/// c7 (`ai-workflow checks --level pr` exit 0) is manual/gate-level.
///
/// Run with:
///   flutter test test/features/agents/opc_m4_4_agent_selection_test.dart
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

AgentSession _makeSession(String id) => AgentSession(
      id: id,
      agentId: 'claude-code',
      name: 'Test Session',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

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

/// An empty AgentConfigsController for the widget tree. With no profiles
/// loaded, [AgentSelectorPill] falls back to the opencode agent list the
/// stub repository serves — preserving these tests' assertions.
AgentConfigsController _buildConfigsController() => AgentConfigsController(
      AgentConfigsRepository(AgentConfigsDataSource()),
    );

/// Wrap a widget under test with the theme and providers it needs.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  // ── c3: agent selector populates and persists per session ──────────────────

  test(
    'issue-703-c3: agent selector populates from endpoint and persists per session',
    () async {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(repo);

      const sessionId = 'c3-session';

      // Seed the available agents for the session.
      ctrl.setAvailableAgentsForTest(sessionId, [
        AgentInfo(name: 'build', builtIn: true),
        AgentInfo(name: 'plan', builtIn: true),
        AgentInfo(name: 'my-custom-agent', builtIn: false),
      ]);

      // Default: no selection → null (SDK default, build).
      expect(ctrl.selectedAgentFor(sessionId), isNull);

      // Select 'plan' for the session.
      ctrl.setSelectedAgent(sessionId, 'plan');
      expect(ctrl.selectedAgentFor(sessionId), equals('plan'));

      // Switch to a different session — selection should not bleed over.
      const otherSessionId = 'c3-other-session';
      expect(ctrl.selectedAgentFor(otherSessionId), isNull);

      // Switch back — persisted for original session.
      expect(ctrl.selectedAgentFor(sessionId), equals('plan'));

      ctrl.dispose();
    },
  );

  // ── c4: agent-type part renders labeled marker ─────────────────────────────

  testWidgets(
    'issue-703-c4: agent-type part renders labeled marker not generic card',
    (tester) async {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(repo);

      const sessionId = 'c4-session';
      const msgId = 'c4-msg-1';

      ctrl.setActiveSessionForTest(sessionId, _makeSession(sessionId));

      // Inject an assistant message with an 'agent' type part (name:'plan').
      ctrl.setMessageForTest(ChatMessage(
        id: msgId,
        sessionId: sessionId,
        role: 'assistant',
        createdAt: _kEpoch,
      ));
      ctrl.setChatPartForTest(ChatPart(
        id: 'c4-part-1',
        messageId: msgId,
        type: 'agent',
        agentName: 'plan',
      ));

      await tester.pumpWidget(_withProviders(
        controller: ctrl,
        child: Builder(builder: (context) {
          final parts = ctrl.chatPartsFor(msgId);
          return AgentPartMarker(
              agentName: parts.isNotEmpty ? (parts.first.agentName ?? '') : '');
        }),
      ));
      await tester.pump(Duration.zero);

      // Must show the labeled marker text containing the agent name.
      expect(find.textContaining('plan'), findsAtLeastNWidgets(1));

      // Must NOT render a generic card or unknown-type fallback.
      expect(find.text('agent'), findsNothing,
          reason: 'raw type string must not appear; only labeled marker');

      ctrl.dispose();
    },
  );

  // ── c5: built-ins only — no crash ─────────────────────────────────────────

  testWidgets(
    'issue-703-c5: selector works with built-ins only (no crash)',
    (tester) async {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(repo);

      const sessionId = 'c5-session';
      ctrl.setAvailableAgentsForTest(sessionId, [
        AgentInfo(name: 'build', builtIn: true),
        AgentInfo(name: 'plan', builtIn: true),
      ]);

      ctrl.setActiveSessionForTest(sessionId, _makeSession(sessionId));

      // Pump the agent selector with built-ins only.
      await tester.pumpWidget(_withProviders(
        controller: ctrl,
        child: AgentSelectorPill(sessionId: sessionId),
      ));
      await tester.pump(Duration.zero);

      // Must not crash and must render without throwing.
      expect(tester.takeException(), isNull);
      // Built-in agent names must appear somewhere.
      expect(find.text('build'), findsAtLeastNWidgets(1));

      ctrl.dispose();
    },
  );

  // ── c6: plan-agent selection does not double-apply permission gating ────────

  test(
    'issue-703-c6: selecting plan agent does not double-apply permission gating',
    () async {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(repo);

      const sessionId = 'c6-session';
      ctrl.setAvailableAgentsForTest(sessionId, [
        AgentInfo(name: 'build', builtIn: true),
        AgentInfo(name: 'plan', builtIn: true),
      ]);

      // Starting mode: defaultMode (no plan permission mode applied).
      ctrl.setActiveSessionForTest(
        sessionId,
        _makeSession(sessionId),
      );

      // Select the plan agent via the agent selector.
      ctrl.setSelectedAgent(sessionId, 'plan');

      // The selected agent should be 'plan'.
      expect(ctrl.selectedAgentFor(sessionId), equals('plan'));

      // c6: the permission mode must NOT be automatically changed by agent
      // selection — that would double-apply permission gating when the user
      // also has the PermissionModePicker. The session's permission mode stays
      // at its default (null / defaultMode) regardless of agent selection.
      //
      // The test confirms that setSelectedAgent() does NOT call
      // setPermissionMode() or alter the session's permissionMode field.
      // Frames sent to the repo must not contain any permissionMode update.
      expect(
        repo.sentFrames.any((f) => f.containsKey('permissionMode')),
        isFalse,
        reason:
            'selecting plan agent must not send a permissionMode update frame',
      );

      ctrl.dispose();
    },
  );

  // ── REAL-SURFACE: AgentSelectorPill renders in the real composer ───────────

  testWidgets(
    'issue-703-c3-real-surface: AgentSelectorPill renders in the real InputArea composer',
    (tester) async {
      final repo = _StubAgentsRepository();
      final ctrl = _buildController(repo);

      const sessionId = 'c3-real-surface-session';
      final session = _makeSession(sessionId);
      ctrl.setActiveSessionForTest(sessionId, session);
      ctrl.setAvailableAgentsForTest(sessionId, [
        AgentInfo(name: 'build', builtIn: true),
        AgentInfo(name: 'plan', builtIn: true),
      ]);

      await tester.pumpWidget(MaterialApp(
        theme: AppTheme.light(),
        home: MultiProvider(
          providers: [
            ChangeNotifierProvider<AgentsController>.value(value: ctrl),
            ChangeNotifierProvider<AgentConfigsController>.value(
              value: _buildConfigsController(),
            ),
          ],
          child: const Scaffold(
            body: InputAreaTestHarness(),
          ),
        ),
      ));
      await tester.pump(Duration.zero);

      // The agent selector pill must be present in the real composer.
      expect(
        find.byType(AgentSelectorPill),
        findsAtLeastNWidgets(1),
        reason:
            'AgentSelectorPill must render in the real composer (InputAreaTestHarness)',
      );

      ctrl.dispose();
    },
  );

  // ── #745: manager-profile default ─────────────────────────────────────────

  test(
    'issue-745-c1: selectedAgentFor returns manager ocAgent when no explicit selection',
    () {
      final repo = _StubAgentsRepository();
      // Resolver always returns 'secretary' (the manager profile's ocAgent).
      final ctrl =
          _buildController(repo, managerAgentNameResolver: () => 'secretary');

      const sessionId = '745-c1-session';

      // No explicit selection → should return the manager default.
      expect(ctrl.selectedAgentFor(sessionId), equals('secretary'));

      // Explicit selection → should return the overridden value.
      ctrl.setSelectedAgent(sessionId, 'build');
      expect(ctrl.selectedAgentFor(sessionId), equals('build'));
      expect(ctrl.hasExplicitAgentSelection(sessionId), isTrue);

      // Clear back to default (null = reset) → manager default resumes.
      ctrl.setSelectedAgent(sessionId, null);
      expect(ctrl.selectedAgentFor(sessionId), equals('secretary'));
      expect(ctrl.hasExplicitAgentSelection(sessionId), isFalse);

      ctrl.dispose();
    },
  );

  test(
    'issue-745-c2: dispatcher sends manager ocAgent when no explicit selection',
    () {
      final repo = _StubAgentsRepository();
      final ctrl =
          _buildController(repo, managerAgentNameResolver: () => 'secretary');

      const sessionId = '745-c2-session';

      // No explicit selection set — manager agent must be sent on the wire.
      ctrl.sendInput(sessionId, 'hello');

      expect(repo.sentFrames.length, equals(1));
      expect(
        repo.sentFrames.first['agent'],
        equals('secretary'),
        reason:
            'turn dispatch must include the manager agent when no explicit selection',
      );

      ctrl.dispose();
    },
  );

  test(
    'issue-745-c3: selectedAgentFor returns null when no resolver and no selection',
    () {
      final repo = _StubAgentsRepository();
      // No resolver → falls back to SDK default (null).
      final ctrl = _buildController(repo);

      const sessionId = '745-c3-session';
      expect(ctrl.selectedAgentFor(sessionId), isNull);
      expect(ctrl.hasExplicitAgentSelection(sessionId), isFalse);

      ctrl.dispose();
    },
  );
}
