/// Confirms that bash (shell) tool output renders incrementally as
/// `message.part.updated` events arrive with a growing `state.output` field.
///
/// The opencode SDK does NOT send `message.part.delta` for tool parts —
/// instead it emits successive `message.part.updated` events as the tool
/// runs, each carrying the current accumulated `state.output`. The Flutter
/// AgentsController must update `ChatPart.toolOutput` on every such event so
/// the `ToolCallPart` widget shows live output, not just the final result.
///
/// Acceptance criteria:
///   c1 — First `message.part.updated` (status='running', partial output)
///        sets `toolOutput` to the partial string.
///   c2 — Second `message.part.updated` (status='completed', full output)
///        updates `toolOutput` to the full string; the part count stays at 1.
///   c3 — `toolStatus` reflects each update in-place ('running' → 'completed').
///
/// Run with:
///   flutter test test/features/agents/bash_tool_output_streaming_test.dart
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
// Minimal fakes (mirrors opc_m2_2_reasoning_test.dart)
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

class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

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
  }) async =>
      [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    return (
      session: _makeSession(id),
      messages: const <AgentSessionMessage>[],
    );
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

({AgentsController ctrl, _StubAgentsRepository repo}) _buildController() {
  final repo = _StubAgentsRepository();
  final agentServer = _ReadyAgentServerController();
  final notifService = _FakeLocalNotificationService();
  final notifCtrl = _FakeNotificationsController();
  final ctrl = AgentsController(repo, agentServer, notifService, notifCtrl);
  return (ctrl: ctrl, repo: repo);
}

// ---------------------------------------------------------------------------
// Fixtures — real opencode v1.14.49 bash tool-part shapes.
//
// The SDK sends successive `message.part.updated` events for the same part
// as the bash command runs. Each update carries the current accumulated
// `state.output`. The bridge forwards these verbatim to the Flutter WS client.
// ---------------------------------------------------------------------------

const _kSessionId = 'sess-bash-stream';
const _kMessageId = 'msg_bash_001';
const _kPartId = 'part_bash_stream_001';

/// First update: tool has started, partial output available.
const _kBashPartRunningShape = {
  'id': _kPartId,
  'sessionID': _kSessionId,
  'messageID': _kMessageId,
  'type': 'tool',
  'callID': 'call_bash_stream_001',
  'tool': 'bash',
  'state': {
    'status': 'running',
    'input': {
      'command': 'for i in 1 2 3; do echo \$i; sleep 0.1; done',
      'description': 'Count to 3',
    },
    'output': '1\n2\n',
    'title': 'Bash: counting',
    'metadata': {},
    'time': {'start': 1718000010000},
  },
};

/// Second update: tool completed, full output available.
const _kBashPartCompletedShape = {
  'id': _kPartId,
  'sessionID': _kSessionId,
  'messageID': _kMessageId,
  'type': 'tool',
  'callID': 'call_bash_stream_001',
  'tool': 'bash',
  'state': {
    'status': 'completed',
    'input': {
      'command': 'for i in 1 2 3; do echo \$i; sleep 0.1; done',
      'description': 'Count to 3',
    },
    'output': '1\n2\n3\n',
    'title': 'Bash: counting',
    'metadata': {},
    'time': {'start': 1718000010000, 'end': 1718000010500},
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  group(
      'bash-tool-streaming: bash tool output renders incrementally via '
      'successive message.part.updated events', () {
    test(
        'c1: first message.part.updated (running) sets toolOutput to partial '
        'output immediately — no wait for completion', () async {
      final (:ctrl, :repo) = _buildController();
      addTearDown(ctrl.dispose);
      await ctrl.initialize();

      // Emit the running update (partial output).
      repo.emit(MessagePartUpdatedMessage(
        sessionId: _kSessionId,
        part: Map<String, dynamic>.from(_kBashPartRunningShape),
      ));
      await Future<void>.delayed(Duration.zero);

      final parts = ctrl.chatPartsFor(_kMessageId);
      expect(parts, hasLength(1), reason: 'Exactly one part must exist.');

      final part = parts.first;
      expect(part.type, equals('tool'),
          reason: 'Part type must be "tool".');
      expect(part.toolName, equals('bash'),
          reason: 'Tool name must be "bash".');
      expect(part.toolStatus, equals('running'),
          reason: 'c3: toolStatus must reflect the running state immediately.');
      expect(
        part.toolOutput,
        equals('1\n2\n'),
        reason: 'c1: toolOutput must be the partial output string from the '
            'first message.part.updated — the widget should show live output.',
      );
    });

    test(
        'c2: second message.part.updated (completed) updates toolOutput to '
        'full output in-place; part count stays at 1', () async {
      final (:ctrl, :repo) = _buildController();
      addTearDown(ctrl.dispose);
      await ctrl.initialize();

      // First update: running, partial output.
      repo.emit(MessagePartUpdatedMessage(
        sessionId: _kSessionId,
        part: Map<String, dynamic>.from(_kBashPartRunningShape),
      ));
      await Future<void>.delayed(Duration.zero);

      // Second update: completed, full output.
      repo.emit(MessagePartUpdatedMessage(
        sessionId: _kSessionId,
        part: Map<String, dynamic>.from(_kBashPartCompletedShape),
      ));
      await Future<void>.delayed(Duration.zero);

      final parts = ctrl.chatPartsFor(_kMessageId);
      expect(parts, hasLength(1),
          reason: 'c2: a second part.updated for the same partId must update '
              'in-place, not append a duplicate part.');

      final part = parts.first;
      expect(
        part.toolOutput,
        equals('1\n2\n3\n'),
        reason: 'c2: toolOutput must reflect the full output from the '
            'completed update.',
      );
      expect(part.toolStatus, equals('completed'),
          reason: 'c3: toolStatus must be "completed" after the final update.');
    });

    test(
        'c2-grow: toolOutput grows between the running and completed events — '
        'confirms the value actually changed', () async {
      final (:ctrl, :repo) = _buildController();
      addTearDown(ctrl.dispose);
      await ctrl.initialize();

      // Running (partial).
      repo.emit(MessagePartUpdatedMessage(
        sessionId: _kSessionId,
        part: Map<String, dynamic>.from(_kBashPartRunningShape),
      ));
      await Future<void>.delayed(Duration.zero);

      final outputAfterRunning = ctrl.chatPartsFor(_kMessageId).first.toolOutput;

      // Completed (full).
      repo.emit(MessagePartUpdatedMessage(
        sessionId: _kSessionId,
        part: Map<String, dynamic>.from(_kBashPartCompletedShape),
      ));
      await Future<void>.delayed(Duration.zero);

      final outputAfterCompleted =
          ctrl.chatPartsFor(_kMessageId).first.toolOutput;

      expect(
        (outputAfterCompleted?.length ?? 0),
        greaterThan(outputAfterRunning?.length ?? 0),
        reason: 'c2-grow: toolOutput must grow between the running update and '
            'the completed update, confirming incremental streaming.',
      );
    });
  });
}
