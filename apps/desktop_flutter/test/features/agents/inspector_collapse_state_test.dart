/// Unit tests for persisted inspector panel-collapse state on [AgentsController].
///
/// Run with:
///   flutter test test/features/agents/inspector_collapse_state_test.dart
library;

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Fakes (mirrored from inspector_context_getters_test.dart)
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
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async => (
            session: _makeSession(id),
            messages: const <AgentSessionMessage>[],
          );

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

  @override
  Future<void> revertSession(String sessionId, String messageId) async {}

  @override
  Future<void> unrevertSession(String sessionId) async {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

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

AgentsController _buildController() {
  final repo = _StubAgentsRepository();
  return AgentsController(
    repo,
    _ReadyAgentServerController(),
    LocalNotificationService(),
    NotificationsController(
      NotificationsRepository(NotificationsDataSource()),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  // AgentsController is a WidgetsBindingObserver; dispose() touches
  // WidgetsBinding.instance, so the test binding must be initialized.
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  // #905 — the panel now defaults to collapsed (true) until a user
  // explicitly opens it, so both the raw field default and the
  // no-stored-preference load path must return true.
  test('panelCollapsed defaults true and setPanelCollapsed persists', () async {
    final c = _buildController();
    expect(c.panelCollapsed, true);
    await c.setPanelCollapsed(false);
    expect(c.panelCollapsed, false);
    final prefs = await SharedPreferences.getInstance();
    expect(prefs.getBool('agents.inspector.collapsed'), false);
    c.dispose();
  });

  test('loadInspectorPrefs defaults to collapsed when nothing is persisted',
      () async {
    final c = _buildController();
    await c.loadInspectorPrefs();
    expect(c.panelCollapsed, true);
    c.dispose();
  });

  test('loadInspectorPrefs restores a persisted "expanded" preference',
      () async {
    SharedPreferences.setMockInitialValues(
        {'agents.inspector.collapsed': false});
    final c = _buildController();
    await c.loadInspectorPrefs();
    expect(c.panelCollapsed, false);
    c.dispose();
  });

  test('loadInspectorPrefs restores a persisted "collapsed" preference',
      () async {
    SharedPreferences.setMockInitialValues(
        {'agents.inspector.collapsed': true});
    final c = _buildController();
    await c.loadInspectorPrefs();
    expect(c.panelCollapsed, true);
    c.dispose();
  });
}
