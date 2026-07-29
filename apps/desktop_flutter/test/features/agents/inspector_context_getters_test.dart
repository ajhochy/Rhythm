/// Unit tests for the inspector context getters on [AgentsController]:
/// [AgentsController.sessionTotalCost] and
/// [AgentsController.sessionTokenBreakdown].
///
/// Messages are seeded through the public WS test seam
/// (`handleWsMessageForTest`) by feeding `message.updated` frames — the same
/// path the production reducer uses to populate cost/tokens on chat messages.
///
/// Run with:
///   flutter test test/features/agents/inspector_context_getters_test.dart
library;

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
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

AgentsController _buildController(_StubAgentsRepository repo) =>
    AgentsController(
      repo,
      _ReadyAgentServerController(),
      LocalNotificationService(),
      NotificationsController(
        NotificationsRepository(NotificationsDataSource()),
      ),
    );

/// Seed a `message.updated` frame for [sessionId] carrying [cost] / [tokens].
void _seedMessage(
  AgentsController controller, {
  required String sessionId,
  required String messageId,
  String role = 'assistant',
  double? cost,
  Map<String, dynamic>? tokens,
}) {
  controller.handleWsMessageForTest(
    MessageUpdatedMessage(
      sessionId: sessionId,
      info: <String, dynamic>{
        'id': messageId,
        'role': role,
        if (cost != null) 'cost': cost,
        if (tokens != null) 'tokens': tokens,
      },
    ),
  );
}

void main() {
  // AgentsController is a WidgetsBindingObserver; dispose() touches
  // WidgetsBinding.instance, so the test binding must be initialized.
  TestWidgetsFlutterBinding.ensureInitialized();

  late _StubAgentsRepository repo;
  late AgentsController controller;

  setUp(() {
    repo = _StubAgentsRepository();
    controller = _buildController(repo);
  });

  tearDown(() => controller.dispose());

  group('sessionTotalCost (via ?? 0)', () {
    test('sums cost across messages in the session', () {
      _seedMessage(controller, sessionId: 's1', messageId: 'm1', cost: 0.001);
      _seedMessage(controller, sessionId: 's1', messageId: 'm2', cost: 0.0025);

      expect(controller.sessionTotalCost('s1') ?? 0, closeTo(0.0035, 1e-9));
    });

    test('returns 0 for an unknown session', () {
      expect(controller.sessionTotalCost('unknown') ?? 0, 0);
    });
  });

  group('sessionTokenBreakdown', () {
    test('returns the breakdown from the latest message carrying tokens', () {
      _seedMessage(
        controller,
        sessionId: 's1',
        messageId: 'm1',
        tokens: const {
          'input': 100,
          'output': 50,
          'reasoning': 10,
          'cache': {'read': 20, 'write': 5},
        },
      );

      final b = controller.sessionTokenBreakdown('s1');
      expect(b.input, 100);
      expect(b.output, 50);
      expect(b.reasoning, 10);
      expect(b.cacheRead, 20);
      expect(b.cacheWrite, 5);
    });

    test('returns all zeros for a session with no token data', () {
      final b = controller.sessionTokenBreakdown('none');
      expect(b.input, 0);
      expect(b.output, 0);
      expect(b.reasoning, 0);
      expect(b.cacheRead, 0);
      expect(b.cacheWrite, 0);
    });

    test('cache as bare int: cacheRead == int, cacheWrite == 0', () {
      _seedMessage(
        controller,
        sessionId: 's2',
        messageId: 'm1',
        tokens: const {
          'input': 200,
          'output': 80,
          'reasoning': 0,
          'cache': 7, // bare int — read-count only
        },
      );

      final b = controller.sessionTokenBreakdown('s2');
      expect(b.cacheRead, 7);
      expect(b.cacheWrite, 0);
    });
  });
}
