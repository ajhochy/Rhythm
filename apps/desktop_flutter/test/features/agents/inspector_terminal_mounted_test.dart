/// Mounted tests for the interactive xterm Terminal tab (issue #708).
///
/// Replaces the one-shot command-runner: the Terminal tab now creates a PTY
/// over the local agent server, binds an xterm [Terminal] to the PTY proxy
/// WebSocket, and tears the PTY down on dispose / session-switch.
///
/// The WebSocket transport is injected via [TerminalTab.channelFactory] so no
/// real socket/engine is required — a fake [StreamChannel] backed by
/// [StreamController]s lets the test drive inbound bytes and capture outbound
/// keystrokes.
///
/// Run with:
///   flutter test test/features/agents/inspector_terminal_mounted_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:stream_channel/stream_channel.dart';

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
import 'package:rhythm_desktop/features/agents/views/_terminal_tab.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

import 'package:xterm/xterm.dart';

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

/// Stub repository that records PTY lifecycle calls and returns a known ptyId.
class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  String ptyIdToReturn = 'pty-123';
  final List<String> createPtyCalls = [];
  final List<String> killPtyCalls = [];
  final List<(String, int, int)> resizePtyCalls = [];

  @override
  Future<String> createPty(String sessionId) async {
    createPtyCalls.add(sessionId);
    return ptyIdToReturn;
  }

  @override
  Future<void> resizePty(String ptyId, int cols, int rows) async {
    resizePtyCalls.add((ptyId, cols, rows));
  }

  @override
  Future<void> killPty(String ptyId) async {
    killPtyCalls.add(ptyId);
  }

  @override
  String ptyWsUrl(String ptyId) => 'ws://localhost:4001/ws/pty/$ptyId';

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
  Future<List<Map<String, dynamic>>> fetchSessionTodos(String id) async =>
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
  Future<List<Map<String, dynamic>>> fetchChildSessions(
          String parentSessionId) async =>
      const [];

  @override
  Future<List<AgentSessionMessage>> fetchChildMessages(
          String parentSessionId, String childSdkId) async =>
      const [];

  @override
  Future<AgentSession> forkSession(String sessionId, String messageId) async {
    throw UnimplementedError();
  }

  @override
  Future<List<AgentInfo>> fetchAvailableAgents({String? cwd}) async => const [];

  @override
  Future<String> runShellCommand(String sessionId, String command) async =>
      'msg-shell-default';

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// A fake bidirectional channel: [incoming] feeds bytes into the terminal,
/// [outgoingSink] captures keystrokes the widget sends.
class _FakeChannel {
  _FakeChannel() : _incoming = StreamController<dynamic>.broadcast();

  final StreamController<dynamic> _incoming;

  /// Everything the widget sent to the channel sink.
  final List<dynamic> outgoing = [];

  bool sinkClosed = false;

  StreamChannel<dynamic> get channel => StreamChannel<dynamic>(
        _incoming.stream,
        _CapturingSink(outgoing, () => sinkClosed = true),
      );

  void pushInbound(dynamic data) => _incoming.add(data);

  Future<void> close() async {
    if (!_incoming.isClosed) await _incoming.close();
  }
}

class _CapturingSink implements StreamSink<dynamic> {
  _CapturingSink(this._captured, this._onClose);

  final List<dynamic> _captured;
  final void Function() _onClose;
  final Completer<void> _done = Completer<void>();

  @override
  void add(dynamic event) => _captured.add(event);

  @override
  void addError(Object error, [StackTrace? stackTrace]) {}

  @override
  Future<void> addStream(Stream<dynamic> stream) =>
      stream.forEach(_captured.add);

  @override
  Future<void> close() {
    _onClose();
    if (!_done.isCompleted) _done.complete();
    return _done.future;
  }

  @override
  Future<void> get done => _done.future;
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

Widget _wrap(AgentsController controller, Widget child) =>
    ChangeNotifierProvider<AgentsController>.value(
      value: controller,
      child: MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(body: child),
      ),
    );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  late _StubAgentsRepository repo;
  late AgentsController controller;

  setUp(() {
    repo = _StubAgentsRepository();
    controller = _buildController(repo);
  });

  tearDown(() => controller.dispose());

  testWidgets(
    'issue-708: mount creates a PTY and renders a TerminalView',
    (tester) async {
      final session = _makeSession('s-mount');
      final fake = _FakeChannel();

      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          controller,
          TerminalTab(
            sessionId: session.id,
            channelFactory: (_) => fake.channel,
          ),
        ));
        // Let the async createPty resolve.
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(repo.createPtyCalls, equals(['s-mount']));
      expect(find.byType(TerminalView), findsOneWidget);

      await fake.close();
    },
  );

  testWidgets(
    'issue-708: inbound bytes are written into the terminal buffer',
    (tester) async {
      final session = _makeSession('s-inbound');
      final fake = _FakeChannel();

      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          controller,
          TerminalTab(
            sessionId: session.id,
            channelFactory: (_) => fake.channel,
          ),
        ));
        await Future<void>.delayed(const Duration(milliseconds: 10));
        fake.pushInbound('hello\r\n');
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      final state = tester.state(find.byType(TerminalTab));
      final terminal = (state as dynamic).debugTerminal as Terminal;
      final firstLine = terminal.buffer.lines[0].getText();
      expect(firstLine, contains('hello'));

      await fake.close();
    },
  );

  testWidgets(
    'issue-708: keystrokes are forwarded to the channel sink',
    (tester) async {
      final session = _makeSession('s-outbound');
      final fake = _FakeChannel();

      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          controller,
          TerminalTab(
            sessionId: session.id,
            channelFactory: (_) => fake.channel,
          ),
        ));
        await Future<void>.delayed(const Duration(milliseconds: 10));

        final state = tester.state(find.byType(TerminalTab));
        final terminal = (state as dynamic).debugTerminal as Terminal;
        terminal.onOutput!('ls\n');
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(fake.outgoing, contains('ls\n'));

      await fake.close();
    },
  );

  testWidgets(
    'issue-708: dispose kills the PTY and closes the channel',
    (tester) async {
      final session = _makeSession('s-dispose');
      final fake = _FakeChannel();

      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          controller,
          TerminalTab(
            sessionId: session.id,
            channelFactory: (_) => fake.channel,
          ),
        ));
        await Future<void>.delayed(const Duration(milliseconds: 10));

        // Replace the widget to trigger dispose.
        await tester.pumpWidget(_wrap(
          controller,
          const SizedBox.shrink(),
        ));
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(repo.killPtyCalls, equals(['pty-123']));
      expect(fake.sinkClosed, isTrue);

      await fake.close();
    },
  );

  testWidgets(
    'issue-708: Retry from live-error state kills old PTY before starting fresh one',
    (tester) async {
      // The first PTY that gets created. We want to confirm it is killed on
      // Retry even though the stream ended in error (not a clean close).
      const firstPtyId = 'pty-first';
      const secondPtyId = 'pty-second';

      // Use a StreamController we control so we can push an error after
      // connect, simulating a live-channel failure.
      final firstFake = _FakeChannel();
      final secondFake = _FakeChannel();

      // Track which fake the factory should hand out.
      StreamChannel<dynamic> channelFactory(String ptyId) {
        if (ptyId == firstPtyId) return firstFake.channel;
        return secondFake.channel;
      }

      // Use a sequenced stub that returns different ptyIds on successive calls.
      final patchedRepo = _SequencedStubRepo(
        firstId: firstPtyId,
        secondId: secondPtyId,
        delegate: repo,
      );
      final patchedController = _buildController(patchedRepo);

      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          patchedController,
          TerminalTab(
            sessionId: 's-retry',
            channelFactory: channelFactory,
          ),
        ));
        // Let async createPty + stream setup finish.
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      // Widget should be connected (TerminalView).
      expect(find.byType(TerminalView), findsOneWidget);
      expect(patchedRepo.createPtyCalls, equals(['s-retry']));

      // Now push an error on the live channel → widget goes to error state.
      await tester.runAsync(() async {
        firstFake._incoming.addError(Exception('connection reset'));
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      // Widget should show the Retry button.
      expect(find.text('Retry'), findsOneWidget);

      // Tap Retry.
      await tester.runAsync(() async {
        await tester.tap(find.text('Retry'));
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      // The old PTY MUST have been killed.
      expect(
        patchedRepo.killPtyCalls,
        contains(firstPtyId),
        reason: 'Retry must call killPty on the old live PTY to avoid a leak',
      );

      // A fresh PTY must have been created.
      expect(patchedRepo.createPtyCalls.length, equals(2),
          reason: 'createPty should be called again after Retry');
      expect(patchedRepo.createPtyCalls.last, equals('s-retry'));

      // The first fake channel's sink must be closed.
      expect(firstFake.sinkClosed, isTrue,
          reason: 'Old channel sink must be closed on Retry');

      await firstFake.close();
      await secondFake.close();
      patchedController.dispose();
    },
  );
}

/// Variant of [_StubAgentsRepository] that returns a different ptyId on the
/// second [createPty] call.
class _SequencedStubRepo extends _StubAgentsRepository {
  _SequencedStubRepo({
    required this.firstId,
    required this.secondId,
    required _StubAgentsRepository delegate,
  }) : _delegate = delegate;

  final String firstId;
  final String secondId;
  final _StubAgentsRepository _delegate;
  int _callCount = 0;

  @override
  final List<String> createPtyCalls = [];

  @override
  final List<String> killPtyCalls = [];

  @override
  Future<String> createPty(String sessionId) async {
    createPtyCalls.add(sessionId);
    _callCount++;
    return _callCount == 1 ? firstId : secondId;
  }

  @override
  Future<void> killPty(String ptyId) async {
    killPtyCalls.add(ptyId);
    await _delegate.killPty(ptyId);
  }
}
