/// Mounted tests for the interactive xterm Terminal tab (issue #708 +
/// session-scoped-terminal smoke fix).
///
/// The Terminal tab is now a thin VIEW that binds to a session-keyed
/// [PtyTerminalSession] owned by [AgentsController]. The PTY's lifetime is tied
/// to the SESSION, not to the widget: collapsing the side panel or switching
/// the panel tabs disposes the [TerminalTab] widget, but the PTY (and its
/// scrollback buffer) MUST survive and be reused on remount. The PTY is torn
/// down only when the session is closed/deleted.
///
/// The WebSocket transport is injected via the controller's
/// [AgentsController.ptyChannelFactoryForTest] seam so no real socket/engine is
/// required — a fake [StreamChannel] backed by [StreamController]s lets the
/// test drive inbound bytes and capture outbound keystrokes.
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
          String parentSessionId, String childSdkId,
          {String? cwd}) async =>
      const [];

  @override
  Future<AgentSession> forkSession(String sessionId, String messageId) async {
    throw UnimplementedError();
  }

  @override
  Future<List<AgentInfo>> fetchAvailableAgents({String? cwd}) async => const [];

  // closeSession / deleteSession / archiveSession are exercised by teardown
  // tests; the _ReadyAgentServerController reports ready, so these await the
  // repository. Record nothing here — just resolve.
  @override
  Future<void> closeSession(String id) async {}

  @override
  Future<void> deleteSession(String id) async {}

  @override
  Future<AgentSession> archiveSession(String id) async => _makeSession(id);

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// A fake bidirectional channel: [pushInbound] feeds bytes into the terminal,
/// [outgoing] captures keystrokes the widget sends.
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
      controller.ptyChannelFactoryForTest = (_) => fake.channel;

      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          controller,
          TerminalTab(sessionId: session.id),
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
      controller.ptyChannelFactoryForTest = (_) => fake.channel;

      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          controller,
          TerminalTab(sessionId: session.id),
        ));
        await Future<void>.delayed(const Duration(milliseconds: 10));
        fake.pushInbound('hello\r\n');
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      final terminal = controller.terminalSessionFor(session.id).terminal;
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
      controller.ptyChannelFactoryForTest = (_) => fake.channel;

      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          controller,
          TerminalTab(sessionId: session.id),
        ));
        await Future<void>.delayed(const Duration(milliseconds: 10));

        final terminal = controller.terminalSessionFor(session.id).terminal;
        terminal.onOutput!('ls\n');
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(fake.outgoing, contains('ls\n'));

      await fake.close();
    },
  );

  testWidgets(
    'smoke-fix: PTY survives widget remount (panel collapse / tab switch) — '
    'createPty once, killPty never, same Terminal + buffer reused',
    (tester) async {
      const sid = 's-reuse';
      final fake = _FakeChannel();
      controller.ptyChannelFactoryForTest = (_) => fake.channel;

      // Mount the Terminal tab for the session.
      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          controller,
          TerminalTab(sessionId: sid),
        ));
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(repo.createPtyCalls, equals([sid]),
          reason: 'first mount creates exactly one PTY');
      expect(find.byType(TerminalView), findsOneWidget);

      // Capture the Terminal instance and push some bytes BEFORE the remount so
      // we can assert the scrollback buffer survives.
      final terminalBefore = controller.terminalSessionFor(sid).terminal;
      await tester.runAsync(() async {
        fake.pushInbound('persisted-line\r\n');
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();
      expect(terminalBefore.buffer.lines[0].getText(), contains('persisted'));

      // Simulate panel collapse / tab switch: remove TerminalTab from the tree.
      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(controller, const SizedBox.shrink()));
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      // Re-add the TerminalTab for the SAME session (panel re-expanded / tab
      // re-selected).
      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          controller,
          TerminalTab(sessionId: sid),
        ));
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      // BUG-FIX assertions: the PTY was reused, not recreated or killed.
      expect(repo.createPtyCalls, equals([sid]),
          reason: 'remount must REUSE the PTY — createPty stays at 1 call');
      expect(repo.killPtyCalls, isEmpty,
          reason: 'remount (collapse/tab-switch) must NOT kill the PTY');

      // Same Terminal instance + buffer preserved.
      final terminalAfter = controller.terminalSessionFor(sid).terminal;
      expect(identical(terminalBefore, terminalAfter), isTrue,
          reason: 'the same xterm Terminal instance must be reused');
      expect(terminalAfter.buffer.lines[0].getText(), contains('persisted'),
          reason: 'scrollback buffer must survive the remount');
      expect(find.byType(TerminalView), findsOneWidget);

      // Inbound still works after remount.
      await tester.runAsync(() async {
        fake.pushInbound('after-remount\r\n');
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();
      final text = [
        for (var i = 0; i < 4; i++) terminalAfter.buffer.lines[i].getText(),
      ].join('\n');
      expect(text, contains('after-remount'),
          reason: 'inbound bytes still render after remount');

      // Outbound (keystroke → sink) still works after remount.
      await tester.runAsync(() async {
        terminalAfter.onOutput!('echo hi\n');
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();
      expect(fake.outgoing, contains('echo hi\n'),
          reason: 'keystrokes still flow to the sink after remount');

      await fake.close();
    },
  );

  testWidgets(
    'smoke-fix: closing the session tears down the terminal — killPty called',
    (tester) async {
      const sid = 's-close';
      final fake = _FakeChannel();
      controller.ptyChannelFactoryForTest = (_) => fake.channel;

      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          controller,
          TerminalTab(sessionId: sid),
        ));
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(repo.createPtyCalls, equals([sid]));
      expect(repo.killPtyCalls, isEmpty);

      // Close the session → terminal must be disposed (PTY killed once).
      await tester.runAsync(() async {
        await controller.deleteSession(sid);
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(repo.killPtyCalls, equals(['pty-123']),
          reason:
              'closing/deleting the session must kill the PTY exactly once');
      expect(fake.sinkClosed, isTrue,
          reason: 'the channel sink must be closed on session teardown');

      await fake.close();
    },
  );

  testWidgets(
    'leak-fix: archiving a session tears down its terminal — killPty called',
    (tester) async {
      const sid = 's-archive';
      final fake = _FakeChannel();
      controller.ptyChannelFactoryForTest = (_) => fake.channel;

      // Open the Terminal tab so a PTY is created and registered.
      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          controller,
          TerminalTab(sessionId: sid),
        ));
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(repo.createPtyCalls, equals([sid]));
      expect(repo.killPtyCalls, isEmpty);

      // Archive the session — PTY must be torn down.
      await tester.runAsync(() async {
        // Seed the session into the active list so archiveSession finds it.
        controller.setActiveSessionForTest(sid, _makeSession(sid));
        await controller.archiveSession(sid);
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(repo.killPtyCalls, equals(['pty-123']),
          reason: 'archiving a session must kill its PTY exactly once');

      await fake.close();
    },
  );

  testWidgets(
    'leak-fix: online closeSession tears down terminal directly (belt-and-suspenders)',
    (tester) async {
      const sid = 's-online-close';
      final fake = _FakeChannel();
      controller.ptyChannelFactoryForTest = (_) => fake.channel;

      // Open the Terminal tab so a PTY is created and registered.
      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          controller,
          TerminalTab(sessionId: sid),
        ));
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(repo.createPtyCalls, equals([sid]));
      expect(repo.killPtyCalls, isEmpty);

      // closeSession with server ready → online path. PTY must be torn down
      // directly here (not only deferred to the WS SessionClosed echo).
      await tester.runAsync(() async {
        await controller.closeSession(sid);
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(repo.killPtyCalls, equals(['pty-123']),
          reason: 'online closeSession must kill the PTY directly; '
              'a later WS echo calling _disposeTerminal again is a safe no-op');

      await fake.close();
    },
  );

  testWidgets(
    'issue-708: Retry from live-error state kills old PTY before starting fresh',
    (tester) async {
      const firstPtyId = 'pty-first';
      const secondPtyId = 'pty-second';

      final firstFake = _FakeChannel();
      final secondFake = _FakeChannel();

      StreamChannel<dynamic> channelFactory(String ptyId) {
        if (ptyId == firstPtyId) return firstFake.channel;
        return secondFake.channel;
      }

      final patchedRepo = _SequencedStubRepo(
        firstId: firstPtyId,
        secondId: secondPtyId,
        delegate: repo,
      );
      final patchedController = _buildController(patchedRepo);
      patchedController.ptyChannelFactoryForTest = channelFactory;

      await tester.runAsync(() async {
        await tester.pumpWidget(_wrap(
          patchedController,
          const TerminalTab(sessionId: 's-retry'),
        ));
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(find.byType(TerminalView), findsOneWidget);
      expect(patchedRepo.createPtyCalls, equals(['s-retry']));

      // Push an error on the live channel → error state.
      await tester.runAsync(() async {
        firstFake._incoming.addError(Exception('connection reset'));
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(find.text('Retry'), findsOneWidget);

      await tester.runAsync(() async {
        await tester.tap(find.text('Retry'));
        await Future<void>.delayed(const Duration(milliseconds: 10));
      });
      await tester.pump();

      expect(
        patchedRepo.killPtyCalls,
        contains(firstPtyId),
        reason: 'Retry must call killPty on the old live PTY to avoid a leak',
      );
      expect(patchedRepo.createPtyCalls.length, equals(2),
          reason: 'createPty should be called again after Retry');
      expect(patchedRepo.createPtyCalls.last, equals('s-retry'));
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
