/// Contract tests for issue #720 — Compaction divider doesn't render
/// (bridge ignores `session.compacted` event).
///
/// opencode signals compaction completion with a `session.compacted` event
/// (NOT a live `compaction` message-part). The bridge now relays it as a
/// `session.compacted` WS frame; on that frame the Flutter controller must:
///   1. clear the compacting spinner, and
///   2. rehydrate the session (re-fetch messages) so the persisted
///      CompactionPart loads and renders as the "Conversation compacted"
///      divider.
///
/// Acceptance (#720): after Compact, the divider renders live (not just on
/// reload). These tests drive the controller's WS ingestion path directly.
///
/// Run with:
///   flutter test test/features/agents/issue_720_compaction_divider_test.dart
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

class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository() : _msgController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;

  /// Per-session count of getSession (rehydrate) calls.
  final Map<String, int> getSessionCalls = {};

  @override
  Stream<AgentWsMessage> get messages => _msgController.stream;

  @override
  Stream<bool> get connectivityStream => const Stream.empty();

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msgController.close();
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
  getSession(String id) async {
    getSessionCalls[id] = (getSessionCalls[id] ?? 0) + 1;
    return (session: _makeSession(id), messages: const <AgentSessionMessage>[]);
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

AgentsController _buildController(_StubAgentsRepository repo) =>
    AgentsController(
      repo,
      _ReadyAgentServerController(),
      LocalNotificationService(),
      NotificationsController(
        NotificationsRepository(NotificationsDataSource()),
      ),
    );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  // AgentsController.dispose touches WidgetsBinding.instance — initialize the
  // test binding so the non-widget controller tests can construct/dispose it.
  TestWidgetsFlutterBinding.ensureInitialized();

  // ── WS message parsing ──────────────────────────────────────────────────

  group('issue-720: session.compacted WS frame parsing', () {
    test(
      'issue-720-parse: type=session.compacted parses to SessionCompactedMessage with id',
      () {
        final msg = AgentWsMessage.parse({
          'type': 'session.compacted',
          'id': 'ses-abc',
        });
        expect(msg, isA<SessionCompactedMessage>());
        expect((msg as SessionCompactedMessage).id, equals('ses-abc'));
      },
    );
  });

  // ── Controller ingestion ──────────────────────────────────────────────────

  group('issue-720: controller handles session.compacted', () {
    late _StubAgentsRepository repo;
    late AgentsController controller;

    setUp(() {
      repo = _StubAgentsRepository();
      controller = _buildController(repo);
    });

    tearDown(() {
      controller.dispose();
    });

    test(
      'issue-720a: handleSessionCompactedEvent clears the compacting spinner '
      'and rehydrates the session',
      () async {
        const sessionId = 'ses-compacted-1';
        controller.setCompactingForTest(sessionId, true);
        expect(controller.isCompacting(sessionId), isTrue);

        controller.handleSessionCompactedEvent(sessionId);

        // Spinner cleared synchronously.
        expect(controller.isCompacting(sessionId), isFalse);

        // Rehydrate (getSession) runs asynchronously — let it complete.
        await Future<void>.delayed(Duration.zero);
        expect(
          repo.getSessionCalls[sessionId],
          equals(1),
          reason:
              'session.compacted must rehydrate the session so the persisted '
              'CompactionPart renders as the divider',
        );
      },
    );

    test('issue-720b: a session.compacted WS frame routed through _onWsMessage '
        'triggers the handler', () async {
      const sessionId = 'ses-compacted-2';
      controller.setCompactingForTest(sessionId, true);

      // Route the frame the bridge now broadcasts through the real WS reducer.
      controller.handleWsMessageForTest(
        const SessionCompactedMessage(id: sessionId),
      );

      // Allow the async rehydrate to run.
      await Future<void>.delayed(Duration.zero);

      expect(controller.isCompacting(sessionId), isFalse);
      expect(repo.getSessionCalls[sessionId], equals(1));
    });

    test('issue-720c: session.compacted is scoped — an unrelated session keeps '
        'its compacting state', () async {
      const compactedId = 'ses-compacted-3';
      const otherId = 'ses-other-3';
      controller.setCompactingForTest(compactedId, true);
      controller.setCompactingForTest(otherId, true);

      controller.handleSessionCompactedEvent(compactedId);
      await Future<void>.delayed(Duration.zero);

      expect(controller.isCompacting(compactedId), isFalse);
      expect(
        controller.isCompacting(otherId),
        isTrue,
        reason: 'only the compacted session is affected',
      );
      expect(repo.getSessionCalls[otherId], isNull);
    });

    test('issue-720d: empty session id is ignored (no rehydrate)', () async {
      controller.handleSessionCompactedEvent('');
      await Future<void>.delayed(Duration.zero);
      expect(repo.getSessionCalls, isEmpty);
    });
  });
}
