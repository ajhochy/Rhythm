/// Flutter-side smoke test for issue #626 — session list chip status flip.
///
/// Coverage: [AgentsController] handles a [SessionUpdatedMessage] WS frame
/// (the server-push broadcast added in #605) and upserts the updated session
/// into the appropriate list. This is the controller-level state that drives
/// the status chip in the session list — no real WebSocket needed.
///
/// What is NOT covered here (still manual):
///   issue-626-c3: End-to-end chip animation requires the opencode SDK + a
///   live agent run over a real socket.  That is documented in
///   docs/testing/manual-smoke.md under issue #626.
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
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Minimal fakes — reuse the same pattern as agents_controller_test.dart.
// ---------------------------------------------------------------------------

class _FakeApiServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null, failureMessage: null);

  @override
  Future<void> stop() async {}
}

class _FakeAgentServerController extends AgentServerController {
  _FakeAgentServerController() : super(_FakeApiServerService());

  @override
  bool get isReady => true;

  @override
  bool get hasAnyAgent => true;

  @override
  Future<void> initialize() async {}
}

class _FakeAgentsRepository implements AgentsRepository {
  _FakeAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;
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
  void send(Map<String, dynamic> msg) {}

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
    final s = sessionsToReturn.firstWhere(
      (s) => s.id == id,
      orElse: () => _makeSession(id, AgentSessionStatus.idle),
    );
    return (session: s, messages: <AgentSessionMessage>[]);
  }

  @override
  Future<AgentSession> createSession({
    String? agentId,
    String? taskId,
    required String cwd,
    String name = '',
    String? branch,
    String? stash,
    bool createBranch = false,
    String? mcpRole,
    String? anthropicAccountId,
  }) async =>
      _makeSession('new', AgentSessionStatus.starting);

  @override
  Future<void> closeSession(String id) async {}

  @override
  Future<void> deleteSession(String id) async {}

  @override
  Future<void> cancelSession(String id) async {}

  @override
  Future<AgentSession> updateSession(
    String id, {
    String? name,
    String? providerId,
    String? modelId,
    String? permissionMode,
    bool clearProvider = false,
    bool clearModel = false,
    bool? fastMode,
    String? anthropicAccountId,
  }) async =>
      throw UnimplementedError();

  @override
  Future<AgentSession> updateSessionThinkingBudget(
    String id,
    int? budget,
  ) async =>
      throw UnimplementedError();

  @override
  Future<AgentSession> resumeSession(String id) async =>
      _makeSession(id, AgentSessionStatus.idle);

  @override
  Future<AgentSession> archiveSession(String id) async =>
      _makeSession(id, AgentSessionStatus.closed);

  @override
  Future<AgentSession> unarchiveSession(String id) async =>
      _makeSession(id, AgentSessionStatus.idle);

  @override
  Future<void> respondPermission(
    String sessionId,
    String permissionId,
    String decision, {
    String? message,
  }) async {}

  @override
  Future<void> replyQuestion(
    String sessionId,
    String callId,
    List<List<String>> answers,
  ) async {}

  @override
  Future<void> rejectQuestion(String sessionId, String callId) async {}

  @override
  Future<List<AgentSessionMessage>> getMessages(String id,
          {int? limit}) async =>
      [];

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async => [];

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
  Future<List<Map<String, dynamic>>> fetchSessionTodos(String id) async => [];

  @override
  Future<Map<String, dynamic>> fetchMemoryProvenance(String id) async =>
      {'recorded': false, 'memoryIds': [], 'notePaths': []};

  @override
  Future<List<Map<String, dynamic>>> fetchChildSessions(
          String parentSessionId) async =>
      [];

  @override
  Future<List<AgentSessionMessage>> fetchChildMessages(
          String parentSessionId, String childSdkId,
          {String? cwd}) async =>
      [];

  @override
  Future<AgentSession> forkSession(String sessionId, String messageId) async {
    throw UnimplementedError();
  }

  @override
  Future<List<AgentInfo>> fetchAvailableAgents({String? cwd}) async => const [];

  @override
  Future<String> createPty(String sessionId) async => 'pty-stub';

  @override
  Future<void> resizePty(String ptyId, int cols, int rows) async {}

  @override
  Future<void> killPty(String ptyId) async {}

  @override
  String ptyWsUrl(String ptyId) => 'ws://localhost:4001/ws/pty/$ptyId';

  // OCU-19..25 (#1060-#1066): vcs/shell/init/files methods added to
  // AgentsRepository — not exercised by this test file, so fall back.
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

AgentSession _makeSession(String id, AgentSessionStatus status) {
  final now = DateTime.now();
  return AgentSession(
    id: id,
    agentId: 'claude-code',
    status: status,
    cwd: '/tmp',
    name: 'Test $id',
    createdAt: now,
    updatedAt: now,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _FakeAgentsRepository fakeRepo;
  late AgentsController controller;

  setUp(() async {
    fakeRepo = _FakeAgentsRepository();
    controller = AgentsController(
      fakeRepo,
      _FakeAgentServerController(),
      _FakeLocalNotificationService(),
      _FakeNotificationsController(),
    );
    await controller.initialize();
  });

  tearDown(() {
    controller.dispose();
  });

  // --------------------------------------------------------------------------
  // #626 — chip status flip via SessionUpdatedMessage
  // --------------------------------------------------------------------------

  group('issue #626 — SessionUpdatedMessage upserts session status', () {
    test('idle session is flipped to working by SessionUpdatedMessage',
        () async {
      // Seed an idle session via WS.
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('sess-a', AgentSessionStatus.idle),
      ));
      await Future<void>.delayed(Duration.zero);

      expect(controller.sessions.first.status, AgentSessionStatus.idle);

      // Server broadcasts a full updated row with status=working.
      fakeRepo.emit(SessionUpdatedMessage(
        session: _makeSession('sess-a', AgentSessionStatus.working),
      ));
      await Future<void>.delayed(Duration.zero);

      final updated = controller.sessions.firstWhere((s) => s.id == 'sess-a');
      expect(
        updated.status,
        AgentSessionStatus.working,
        reason:
            'SessionUpdatedMessage should flip the chip from idle to working.',
      );
    });

    test('working session is flipped back to idle by SessionUpdatedMessage',
        () async {
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('sess-b', AgentSessionStatus.working),
      ));
      await Future<void>.delayed(Duration.zero);

      fakeRepo.emit(SessionUpdatedMessage(
        session: _makeSession('sess-b', AgentSessionStatus.idle),
      ));
      await Future<void>.delayed(Duration.zero);

      final updated = controller.sessions.firstWhere((s) => s.id == 'sess-b');
      expect(
        updated.status,
        AgentSessionStatus.idle,
        reason:
            'SessionUpdatedMessage should flip the chip from working back to idle.',
      );
    });

    test(
        'SessionUpdatedMessage with archived session moves row out of active list',
        () async {
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('sess-c', AgentSessionStatus.idle),
      ));
      await Future<void>.delayed(Duration.zero);
      expect(controller.sessions.any((s) => s.id == 'sess-c'), isTrue);

      // Create an archived session variant.
      final now = DateTime.now();
      final archived = AgentSession(
        id: 'sess-c',
        agentId: 'claude-code',
        status: AgentSessionStatus.closed,
        cwd: '/tmp',
        name: 'Test sess-c',
        archivedAt: now,
        createdAt: now,
        updatedAt: now,
      );
      fakeRepo.emit(SessionUpdatedMessage(session: archived));
      await Future<void>.delayed(Duration.zero);

      expect(
        controller.sessions.any((s) => s.id == 'sess-c'),
        isFalse,
        reason:
            'Archived session should be removed from the active sessions list.',
      );
    });

    test('notifyListeners fires when SessionUpdatedMessage arrives', () async {
      fakeRepo.emit(SessionCreatedMessage(
        session: _makeSession('sess-d', AgentSessionStatus.idle),
      ));
      await Future<void>.delayed(Duration.zero);

      var notified = false;
      controller.addListener(() => notified = true);

      fakeRepo.emit(SessionUpdatedMessage(
        session: _makeSession('sess-d', AgentSessionStatus.working),
      ));
      await Future<void>.delayed(Duration.zero);

      expect(
        notified,
        isTrue,
        reason:
            'Listeners (including the chip widget) must be notified on update.',
      );
    });

    test('SessionUpdatedMessage for unknown id appends session to list',
        () async {
      // No prior session with id 'sess-new'.
      expect(controller.sessions, isEmpty);

      fakeRepo.emit(SessionUpdatedMessage(
        session: _makeSession('sess-new', AgentSessionStatus.idle),
      ));
      await Future<void>.delayed(Duration.zero);

      expect(
        controller.sessions.any((s) => s.id == 'sess-new'),
        isTrue,
        reason:
            'An unknown session ID in SessionUpdatedMessage should be appended.',
      );
    });
  });
}
