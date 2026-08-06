/// Contract tests for OPC-M1-3 — Flutter parts rehydration, single render path,
/// mini-bubble removed.
///
/// Run with: flutter test test/features/agents/opc_m1_3_rehydration_test.dart
library;

import 'dart:async';
import 'dart:io';

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

  @override
  Future<void> retry() async {}
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

/// Stub repository — implements AgentsRepository (concrete class) with
/// noSuchMethod for unused methods, following the issue_645 test pattern.
class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  /// When set, getSession returns this.
  ({
    AgentSession session,
    List<AgentSessionMessage> messages
  })? getSessionResult;
  List<AgentSession> sessionsToReturn = [];

  void emit(AgentWsMessage msg) => _msgController.add(msg);

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
  bool send(Map<String, dynamic> msg) => true;

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async =>
      sessionsToReturn;

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    if (getSessionResult != null) return getSessionResult!;
    return (session: _makeSession(id), messages: <AgentSessionMessage>[]);
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// ---------------------------------------------------------------------------
// Test data helpers
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

AgentSessionMessage _makeMsg({
  required String sessionId,
  required String role,
  required String rawText,
  int id = 1,
}) =>
    AgentSessionMessage(
      id: id,
      sessionId: sessionId,
      role: role,
      rawText: rawText,
      strippedText: rawText,
      createdAt: DateTime.now(),
    );

// ---------------------------------------------------------------------------
// Builds a controller under test
// ---------------------------------------------------------------------------

({AgentsController ctrl, _StubAgentsRepository repo}) _buildController() {
  final repo = _StubAgentsRepository();
  final agentServer = _ReadyAgentServerController();
  final notifService = _FakeLocalNotificationService();
  final notifCtrl = _FakeNotificationsController();
  final ctrl = AgentsController(repo, agentServer, notifService, notifCtrl);
  return (ctrl: ctrl, repo: repo);
}

// ===========================================================================
// TESTS
// ===========================================================================

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  // -------------------------------------------------------------------------
  // c1: selectSession populates chatMessagesBySession from structured payload
  // -------------------------------------------------------------------------
  group('OPC-M1-3 c1: selectSession populates chatMessagesBySession', () {
    test(
      'c1a: selecting a session with structured payload populates chatMessagesFor',
      () async {
        final (:ctrl, :repo) = _buildController();
        addTearDown(ctrl.dispose);

        const sessionId = 'sess-c1';

        // Repository returns a session with a structured message.
        // After OPC-M1-3, selectSession must call getSession and populate
        // chatMessagesBySession from the REST payload (not just transcriptsBySession).
        repo.getSessionResult = (
          session: _makeSession(sessionId),
          messages: [
            _makeMsg(sessionId: sessionId, role: 'output', rawText: 'hello')
          ],
        );

        repo.sessionsToReturn = [_makeSession(sessionId)];
        await ctrl.load();
        await ctrl.selectSession(sessionId);
        await Future<void>.delayed(Duration.zero);

        final msgs = ctrl.chatMessagesFor(sessionId);
        expect(
          msgs,
          isNotEmpty,
          reason: 'selectSession must populate chatMessagesBySession '
              'from the structured REST payload. '
              'If empty, the rehydration path is not wired.',
        );
        expect(msgs.first.sessionId, equals(sessionId));
      },
    );

    test(
      'c1b: rehydrated messages have parts in chatPartsFor',
      () async {
        final (:ctrl, :repo) = _buildController();
        addTearDown(ctrl.dispose);

        const sessionId = 'sess-c1b';

        repo.getSessionResult = (
          session: _makeSession(sessionId),
          messages: [
            _makeMsg(sessionId: sessionId, role: 'output', rawText: 'response')
          ],
        );

        repo.sessionsToReturn = [_makeSession(sessionId)];
        await ctrl.load();
        await ctrl.selectSession(sessionId);
        await Future<void>.delayed(Duration.zero);

        final msgs = ctrl.chatMessagesFor(sessionId);
        expect(msgs, isNotEmpty,
            reason: 'Rehydration must create ChatMessage entries.');

        final firstMsgId = msgs.first.id;
        final parts = ctrl.chatPartsFor(firstMsgId);
        // At minimum a legacy text shim must be present for messages with rawText.
        expect(
          parts,
          isNotEmpty,
          reason: 'chatPartsFor must return at least a text shim part '
              'for a rehydrated message.',
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // c2: reconnectSession rehydrates parts
  // -------------------------------------------------------------------------
  group('OPC-M1-3 c2: reconnectSession rehydrates parts', () {
    test(
      'c2: reconnectSession re-fetches and keeps chatMessagesFor populated',
      () async {
        final (:ctrl, :repo) = _buildController();
        addTearDown(ctrl.dispose);

        const sessionId = 'sess-c2';

        repo.getSessionResult = (
          session: _makeSession(sessionId),
          messages: [
            _makeMsg(sessionId: sessionId, role: 'output', rawText: 'result')
          ],
        );
        repo.sessionsToReturn = [_makeSession(sessionId)];
        await ctrl.load();

        await ctrl.selectSession(sessionId);
        await Future<void>.delayed(Duration.zero);

        expect(ctrl.chatMessagesFor(sessionId), isNotEmpty,
            reason: 'selectSession must populate chatMessagesFor.');

        await ctrl.reconnectSession(sessionId);
        await Future<void>.delayed(Duration.zero);

        expect(
          ctrl.chatMessagesFor(sessionId),
          isNotEmpty,
          reason:
              'reconnectSession must re-fetch and keep chatMessagesFor populated.',
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // c3: Source-text guards — _liveOutputBuffer zero refs, no hasChat branch
  // -------------------------------------------------------------------------
  group('OPC-M1-3 c3: source-text guards', () {
    const controllerPath =
        'lib/features/agents/controllers/agents_controller.dart';
    const viewPath = 'lib/features/agents/views/agents_view.dart';

    test('c3a: _liveOutputBuffer has zero references in agents_controller.dart',
        () {
      final projectDir = _projectDir();
      final src = File('$projectDir/$controllerPath').readAsStringSync();

      expect(
        src.contains('_liveOutputBuffer'),
        isFalse,
        reason:
            '_liveOutputBuffer must be deleted from agents_controller.dart.',
      );
    });

    test('c3b: liveOutputFor removed from agents_controller.dart', () {
      final projectDir = _projectDir();
      final src = File('$projectDir/$controllerPath').readAsStringSync();

      expect(
        src.contains('liveOutputFor'),
        isFalse,
        reason: 'liveOutputFor must be deleted from agents_controller.dart.',
      );
    });

    test('c3c: liveOutputFor removed from agents_view.dart', () {
      final projectDir = _projectDir();
      final src = File('$projectDir/$viewPath').readAsStringSync();

      expect(
        src.contains('liveOutputFor'),
        isFalse,
        reason: 'liveOutputFor must be deleted from agents_view.dart.',
      );
    });

    test('c3d: hasChat conditional removed from agents_view.dart', () {
      final projectDir = _projectDir();
      final src = File('$projectDir/$viewPath').readAsStringSync();

      expect(
        src.contains('hasChat'),
        isFalse,
        reason:
            'hasChat conditional must be removed from _buildTranscriptBody.',
      );
      expect(
        src.contains('legacyTranscript'),
        isFalse,
        reason:
            'legacyTranscript variable must be removed — legacy path is deleted.',
      );
    });

    test('c3e: transcriptFor not used in agents_view.dart', () {
      final projectDir = _projectDir();
      final src = File('$projectDir/$viewPath').readAsStringSync();

      expect(
        src.contains('transcriptFor('),
        isFalse,
        reason: 'transcriptFor() must not be called in agents_view.dart. '
            'The view uses chatMessagesFor() exclusively.',
      );
    });
  });

  // -------------------------------------------------------------------------
  // c4: Mini-bubble fully removed
  // -------------------------------------------------------------------------
  group('OPC-M1-3 c4: mini-bubble removed', () {
    test('c4a: agent_bubble_overlay.dart does not exist', () {
      final projectDir = _projectDir();
      final f =
          File('$projectDir/lib/app/core/agents/agent_bubble_overlay.dart');
      expect(
        f.existsSync(),
        isFalse,
        reason: 'agent_bubble_overlay.dart must be deleted. File still exists.',
      );
    });

    test('c4b: no references to AgentBubbleEntry in lib/', () {
      final projectDir = _projectDir();
      final result = _grepInLib(projectDir, 'AgentBubbleEntry');
      expect(
        result,
        isEmpty,
        reason: 'AgentBubbleEntry must have zero references. Found: $result',
      );
    });

    test('c4c: no references to AgentBubbleOverlayLayer in lib/', () {
      final projectDir = _projectDir();
      final result = _grepInLib(projectDir, 'AgentBubbleOverlayLayer');
      expect(
        result,
        isEmpty,
        reason:
            'AgentBubbleOverlayLayer must have zero references. Found: $result',
      );
    });

    test(
        'c4d: handleIncomingTrigger still adds to pendingTriggers (no bubble needed)',
        () async {
      final (:ctrl, :repo) = _buildController();
      addTearDown(ctrl.dispose);

      await ctrl.handleIncomingTrigger({
        'taskId': 'task-1',
        'taskTitle': 'Deploy app',
      });

      expect(
        ctrl.pendingTriggers,
        isNotEmpty,
        reason:
            'handleIncomingTrigger must add a PendingTrigger so it surfaces '
            'in the Agents tab trigger banner (no bubble required).',
      );
      expect(ctrl.pendingTriggers.first.taskId, equals('task-1'));
    });
  });

  // -------------------------------------------------------------------------
  // c5: Stuck detection uses parts state
  // -------------------------------------------------------------------------
  group('OPC-M1-3 c5: stuck detection uses parts state', () {
    test('c5a: session not flagged stuck when first seen just now', () async {
      final (:ctrl, :repo) = _buildController();
      addTearDown(ctrl.dispose);

      const sessionId = 'sess-stuck-1';
      final session = AgentSession(
        id: sessionId,
        agentId: 'claude-code',
        name: 'starting session',
        cwd: '/tmp',
        status: AgentSessionStatus.starting,
        createdAt: _kEpoch,
        updatedAt: _kEpoch,
      );
      repo.sessionsToReturn = [session];
      await ctrl.load();

      ctrl.sessionFirstSeenAt[sessionId] = DateTime.now();
      ctrl.recomputeStuckForTest();

      expect(
        ctrl.connectivity.stuckSessionIds.contains(sessionId),
        isFalse,
        reason: 'A newly-started session must not be flagged stuck.',
      );
    });

    test('c5b: session IS flagged stuck after threshold with no part activity',
        () async {
      final (:ctrl, :repo) = _buildController();
      addTearDown(ctrl.dispose);

      const sessionId = 'sess-stuck-2';
      final session = AgentSession(
        id: sessionId,
        agentId: 'claude-code',
        name: 'stuck session',
        cwd: '/tmp',
        status: AgentSessionStatus.starting,
        createdAt: _kEpoch,
        updatedAt: _kEpoch,
      );
      repo.sessionsToReturn = [session];
      await ctrl.load();

      ctrl.sessionFirstSeenAt[sessionId] =
          DateTime.now().subtract(const Duration(seconds: 31));
      ctrl.recomputeStuckForTest();

      expect(
        ctrl.connectivity.stuckSessionIds.contains(sessionId),
        isTrue,
        reason:
            'A session in "starting" state with no activity for >30s must be '
            'flagged stuck. After OPC-M1-3 the predicate must NOT rely on '
            '_liveOutputBuffer (which no longer exists).',
      );
    });

    test('c5c: stuck flag clears when a MessagePartUpdatedMessage arrives',
        () async {
      final (:ctrl, :repo) = _buildController();
      addTearDown(ctrl.dispose);

      const sessionId = 'sess-stuck-3';
      final session = AgentSession(
        id: sessionId,
        agentId: 'claude-code',
        name: 'stuck->active',
        cwd: '/tmp',
        status: AgentSessionStatus.starting,
        createdAt: _kEpoch,
        updatedAt: _kEpoch,
      );
      repo.sessionsToReturn = [session];
      await ctrl.initialize();

      ctrl.sessionFirstSeenAt[sessionId] =
          DateTime.now().subtract(const Duration(seconds: 40));
      ctrl.recomputeStuckForTest();

      expect(ctrl.connectivity.stuckSessionIds.contains(sessionId), isTrue,
          reason: 'Must be stuck before part arrival.');

      // Emit a MessagePartUpdatedMessage — after OPC-M1-3, a part arriving
      // must clear stuck tracking by updating lastPartActivityAt (or equivalent).
      repo.emit(MessagePartUpdatedMessage(
        sessionId: sessionId,
        part: {
          'id': 'part-1',
          'messageID': 'msg-1',
          'type': 'text',
          'text': 'hello',
        },
      ));
      await Future<void>.delayed(Duration.zero);

      ctrl.recomputeStuckForTest();

      expect(
        ctrl.connectivity.stuckSessionIds.contains(sessionId),
        isFalse,
        reason:
            'A part arriving must clear stuck tracking. After OPC-M1-3 this '
            'replaces the liveOutputBuffer check.',
      );
    });
  });

  // -------------------------------------------------------------------------
  // c6: WS error frames become system-role chat messages
  // -------------------------------------------------------------------------
  group('OPC-M1-3 c6: WS error frames -> system-role chat messages', () {
    test('c6: WsErrorMessage stored as system-role ChatMessage', () async {
      final (:ctrl, :repo) = _buildController();
      addTearDown(ctrl.dispose);

      const sessionId = 'sess-c6';
      repo.sessionsToReturn = [_makeSession(sessionId)];
      await ctrl.initialize();
      await ctrl.selectSession(sessionId);
      await Future<void>.delayed(Duration.zero);

      // Emit a WS error frame.
      // After OPC-M1-3, this must create a system-role ChatMessage in
      // chatMessagesBySession (not in _transcriptsBySession which is deleted).
      repo.emit(WsErrorMessage(id: sessionId, message: 'Something went wrong'));
      await Future<void>.delayed(Duration.zero);

      final msgs = ctrl.chatMessagesFor(sessionId);
      final systemMsgs = msgs.where((m) => m.role == 'system').toList();

      expect(
        systemMsgs,
        isNotEmpty,
        reason: 'WsErrorMessage must create a system-role ChatMessage in '
            'chatMessagesBySession. The legacy _transcriptsBySession render '
            'path is deleted after OPC-M1-3.',
      );
    });
  });

  // -------------------------------------------------------------------------
  // c7: providerToAgentKind consumed from capabilities endpoint
  // -------------------------------------------------------------------------
  group('OPC-M1-3 c7: providerToAgentKind from capabilities', () {
    test('c7a: _kProviderToAgentKind removed from agents_view.dart', () {
      final projectDir = _projectDir();
      final src = File('$projectDir/lib/features/agents/views/agents_view.dart')
          .readAsStringSync();

      expect(
        src.contains('_kProviderToAgentKind'),
        isFalse,
        reason: '_kProviderToAgentKind must be removed from agents_view.dart. '
            'The map is consumed from the capabilities endpoint.',
      );
    });

    test('c7b: AgentServerController exposes providerToAgentKind getter', () {
      final projectDir = _projectDir();
      final src =
          File('$projectDir/lib/app/core/agents/agent_server_controller.dart')
              .readAsStringSync();

      expect(
        src.contains('providerToAgentKind'),
        isTrue,
        reason:
            'AgentServerController must expose providerToAgentKind after OPC-M1-3.',
      );
    });

    test('c7c: agents_view.dart does not define its own provider-to-kind map',
        () {
      final projectDir = _projectDir();
      final src = File('$projectDir/lib/features/agents/views/agents_view.dart')
          .readAsStringSync();

      expect(
        src.contains('_kProviderToAgentKind'),
        isFalse,
        reason: '_kProviderToAgentKind must not exist in agents_view.dart.',
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

String _projectDir() {
  final cwd = Directory.current.path;
  if (cwd.endsWith('/test')) return Directory(cwd).parent.path;
  return cwd;
}

/// Grep for [pattern] recursively in lib/ under [projectDir].
List<String> _grepInLib(String projectDir, String pattern) {
  final libDir = Directory('$projectDir/lib');
  if (!libDir.existsSync()) return [];
  final matches = <String>[];
  for (final entity in libDir.listSync(recursive: true)) {
    if (entity is! File) continue;
    if (!entity.path.endsWith('.dart')) continue;
    final src = entity.readAsStringSync();
    if (src.contains(pattern)) matches.add(entity.path);
  }
  return matches;
}
