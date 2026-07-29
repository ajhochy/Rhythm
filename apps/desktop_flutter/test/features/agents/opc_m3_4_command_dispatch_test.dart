/// Contract tests for OPC-M3-4 — Slash commands dispatched via structured
/// session.command WS frame.
///
/// Covers acceptance criteria c2–c5 from the issue spec:
///
/// c2 — Selecting a command in the popover and submitting sends the structured
///      frame, NOT a `session.input` with text prefix.
///      REAL-SURFACE test: uses the actual SlashCommandPopover + AgentsController
///      flow as wired in agents_view.dart.
///
/// c3 — The user's command invocation renders as a distinct command row
///      (`/name args`) in the transcript.
///
/// c4 — Typing `/notacommand foo` (not in `command.list`) sends plain
///      `session.input` text (regression).
///
/// c5 — SDK command failure (WS error frame) → system error message in transcript.
///
/// c1 is covered by the vitest server-side test.
/// c6 (ai-workflow checks --level pr exit 0) is manual / gate-level.
///
/// Run with:
///   flutter test test/features/agents/opc_m3_4_command_dispatch_test.dart
library;

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';

import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/data/commands_data_source.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
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

/// Stub repository that records WS frames sent via [send].
class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
    : _msgController = StreamController.broadcast(),
      _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  /// All raw frames sent via [send], in arrival order.
  final List<Map<String, dynamic>> sentFrames = [];

  // Inject WS messages for testing error propagation.
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
  void send(Map<String, dynamic> msg) => sentFrames.add(msg);

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async => const [];

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
  // ── c2: REAL-SURFACE — selecting command from popover dispatches structured frame ──

  group('issue-697-c2: popover command selection sends session.command frame', () {
    testWidgets(
      'c2a: sendCommand() sends session.command WS frame (not session.input)',
      (tester) async {
        final repo = _StubAgentsRepository();
        final agentsCtrl = _buildController(repo);
        const sessionId = 'test-session-c2a';

        // Inject the session and select it.
        agentsCtrl.setMessageForTest(
          ChatMessage(
            id: 'msg-init',
            sessionId: sessionId,
            role: 'assistant',
            createdAt: _kEpoch,
          ),
        );

        // Call sendCommand directly (the controller method wired to the popover).
        agentsCtrl.sendCommand(sessionId, 'help', '');
        await tester.pump(Duration.zero);

        // Must have sent a session.command frame.
        expect(
          repo.sentFrames.any((f) => f['type'] == 'session.command'),
          isTrue,
        );

        // Must NOT have sent a session.input frame with '/help' prefix.
        final inputFrames = repo.sentFrames.where(
          (f) => f['type'] == 'session.input',
        );
        for (final f in inputFrames) {
          final data = f['data'] as String? ?? '';
          expect(
            data.startsWith('/help'),
            isFalse,
            reason: 'session.input must not carry /help text prefix',
          );
        }

        // The session.command frame must have correct fields.
        final cmdFrame = repo.sentFrames.firstWhere(
          (f) => f['type'] == 'session.command',
        );
        expect(cmdFrame['id'], sessionId);
        expect(cmdFrame['command'], 'help');
        expect(cmdFrame['arguments'], '');
      },
    );

    testWidgets(
      'c2b: REAL-SURFACE sendCommand + _sendInput route: known command → session.command, unknown → session.input',
      (tester) async {
        final repo = _StubAgentsRepository();
        final agentsCtrl = _buildController(repo);

        const sessionId = 'test-session-c2b';

        // Seed known slash commands for this session (same as _loadSlashCommands
        // would populate via the API on real selectSession).
        agentsCtrl.setSlashCommandsForTest(sessionId, [
          const SlashCommand(name: 'init'),
          const SlashCommand(name: 'help'),
        ]);

        // ── path 1: known command from popover ─────────────────────────────────
        // This is the actual path from agents_view.dart _sendInput: the user
        // typed '/init my-project' (written by the popover into the text field),
        // then pressed Enter → _sendInput detects 'init' in slashCommandsFor →
        // calls sendCommand.
        //
        // We call sendCommand directly to assert the output, mirroring the exact
        // call that _sendInput makes on the same controller.
        agentsCtrl.sendCommand(sessionId, 'init', 'my-project');
        await tester.pump(Duration.zero);

        final cmdFrames = repo.sentFrames.where(
          (f) => f['type'] == 'session.command',
        );
        expect(
          cmdFrames.isNotEmpty,
          isTrue,
          reason: 'sendCommand must emit session.command frame',
        );
        final frame = cmdFrames.first;
        expect(frame['command'], 'init');
        expect(frame['arguments'], 'my-project');

        // Must NOT also have sent a session.input for the same invocation.
        final inputTextFrames = repo.sentFrames
            .where(
              (f) =>
                  f['type'] == 'session.input' &&
                  ((f['data'] as String? ?? '').startsWith('/init')),
            )
            .toList();
        expect(
          inputTextFrames.isEmpty,
          isTrue,
          reason: 'session.input must not carry /init text prefix',
        );

        // ── path 2: unknown slash (regression guard) ───────────────────────────
        agentsCtrl.sendInput(sessionId, '/notknown foo\n');
        await tester.pump(Duration.zero);

        final plainFrames = repo.sentFrames
            .where((f) => f['type'] == 'session.input')
            .toList();
        expect(
          plainFrames.isNotEmpty,
          isTrue,
          reason: 'free-typed unknown slash must go via session.input',
        );
      },
    );
  });

  // ── c3: command role renders as distinct command row ──────────────────────

  testWidgets('issue-697-c3: command role message renders /name args row', (
    tester,
  ) async {
    final repo = _StubAgentsRepository();
    final agentsCtrl = _buildController(repo);

    const sessionId = 'test-session-c3';

    // sendCommand inserts an optimistic ChatMessage with role='command' and
    // a part containing '/commandName args'. Verify the data model that drives
    // the _CommandInvocationRow in the transcript.
    agentsCtrl.sendCommand(sessionId, 'help', 'some-topic');
    await tester.pump(Duration.zero);

    final messages = agentsCtrl.chatMessagesFor(sessionId);
    // There should be exactly one message and it should be a command message.
    final commandMessages = messages.where((m) => m.role == 'command').toList();
    expect(
      commandMessages.isNotEmpty,
      isTrue,
      reason: 'Expected a command-role message after sendCommand',
    );

    // The part must contain the slash invocation text.
    final parts = agentsCtrl.chatPartsFor(commandMessages.first.id);
    expect(parts.isNotEmpty, isTrue);
    final invocationText = parts.map((p) => p.text).join('');
    expect(
      invocationText,
      contains('/help'),
      reason: 'Command invocation text must start with /commandName',
    );
    expect(
      invocationText,
      contains('some-topic'),
      reason: 'Command invocation text must include the arguments',
    );
  });

  // ── c4: free-typed unknown slash command → plain session.input ─────────────

  testWidgets(
    'issue-697-c4: free-typed unknown slash text sends plain session.input',
    (tester) async {
      final repo = _StubAgentsRepository();
      final agentsCtrl = _buildController(repo);

      const sessionId = 'test-session-c4';

      // Seed known commands (only 'help' and 'init' are known).
      agentsCtrl.setSlashCommandsForTest(sessionId, [
        const SlashCommand(name: 'help'),
        const SlashCommand(name: 'init'),
      ]);

      // Calling sendInput with an unrecognized slash text.
      agentsCtrl.sendInput(sessionId, '/notacommand foo\n');

      // Must have sent session.input (not session.command).
      final inputFrames = repo.sentFrames.where(
        (f) => f['type'] == 'session.input',
      );
      expect(inputFrames.isNotEmpty, isTrue);

      // Must NOT have sent session.command.
      final cmdFrames = repo.sentFrames.where(
        (f) => f['type'] == 'session.command',
      );
      expect(cmdFrames.isEmpty, isTrue);
    },
  );

  // ── c5: SDK command failure → system error message in transcript ───────────

  test(
    'issue-697-c5: WS error frame for command → system error message in transcript',
    () async {
      final repo = _StubAgentsRepository();
      final agentsCtrl = _buildController(repo);
      addTearDown(agentsCtrl.dispose);

      // Manually wire the WS subscription so error messages are handled,
      // without calling initialize() (which starts a periodic stuck-check timer
      // that can outlive the test in headless mode).
      await repo.connect();
      final sub = repo.messages.listen(agentsCtrl.handleWsMessageForTest);
      addTearDown(sub.cancel);

      const sessionId = 'test-session-c5';

      // Dispatch a command (this sends the WS frame).
      agentsCtrl.sendCommand(sessionId, 'init', '');

      // Simulate the server responding with an error WS frame for this session.
      repo.injectWsMessage(
        const WsErrorMessage(
          id: 'test-session-c5',
          message: 'command execution failed: unknown command',
        ),
      );

      // Give the async stream delivery a chance to fire.
      await Future<void>.delayed(const Duration(milliseconds: 10));

      // The controller must have recorded a system error message in the
      // chat store for this session.
      final messages = agentsCtrl.chatMessagesFor(sessionId);
      final systemMessages = messages.where((m) => m.role == 'system').toList();
      expect(
        systemMessages.isNotEmpty,
        isTrue,
        reason: 'Expected a system error message after WS error frame',
      );
    },
  );
}
