/// OCU-24 (#1065) — `!cmd` runs a shell command in the session; `\!` escapes
/// to a literal leading "!".
///
/// [parseComposerShellPrefix] is a pure function (unit-tested directly), and
/// the REAL-SURFACE widget tests drive it through the actual composer
/// (`InputAreaTestHarness`, wrapping the private `_InputArea`), matching the
/// pattern used by opc_m3_3_compaction_test.dart / opc_m3_4_command_dispatch.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
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
      : _msg = StreamController.broadcast(),
        _conn = StreamController.broadcast();
  final StreamController<AgentWsMessage> _msg;
  final StreamController<bool> _conn;

  int shellCallCount = 0;
  String? lastShellSessionId;
  String? lastShellCommand;

  final List<Map<String, dynamic>> sentFrames = [];

  @override
  Stream<AgentWsMessage> get messages => _msg.stream;
  @override
  Stream<bool> get connectivityStream => _conn.stream;
  @override
  bool get isConnected => true;
  @override
  Future<void> connect() async {}
  @override
  Future<void> dispose() async {
    await _msg.close();
    await _conn.close();
  }

  @override
  void send(Map<String, dynamic> msg) => sentFrames.add(msg);

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async =>
      [_makeSession('s1')];
  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async =>
          (session: _makeSession(id), messages: const <AgentSessionMessage>[]);

  @override
  Future<void> shellCommand(String sessionId, String command) async {
    shellCallCount++;
    lastShellSessionId = sessionId;
    lastShellCommand = command;
  }

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

Future<AgentsController> _buildSelected(_StubAgentsRepository repo) async {
  final ctrl = AgentsController(
    repo,
    _ReadyAgentServerController(),
    LocalNotificationService(),
    NotificationsController(
      NotificationsRepository(NotificationsDataSource()),
    ),
  );
  await ctrl.selectSession('s1');
  return ctrl;
}

/// Empty AgentConfigsController for the composer's provider tree — the real
/// _InputArea contains AgentSelectorPill, which reads this controller; with no
/// profiles loaded it falls back to the opencode agent list (mirrors
/// opc_m4_1_attachments_test.dart's _buildConfigsController).
AgentConfigsController _buildConfigsController() => AgentConfigsController(
      AgentConfigsRepository(AgentConfigsDataSource()),
    );

Widget _wrap(AgentsController controller) => MultiProvider(
      providers: [
        ChangeNotifierProvider<AgentsController>.value(value: controller),
        ChangeNotifierProvider<AgentConfigsController>.value(
          value: _buildConfigsController(),
        ),
      ],
      child: MaterialApp(
        theme: AppTheme.light(),
        home: const Scaffold(body: InputAreaTestHarness()),
      ),
    );

void main() {
  // ── Pure-function unit tests ────────────────────────────────────────────

  group('parseComposerShellPrefix (pure)', () {
    test('"!ls -la" parses as a shell command', () {
      final r = parseComposerShellPrefix('!ls -la');
      expect(r.command, equals('ls -la'));
      expect(r.text, isNull);
    });

    test(r'"\!ls -la" escapes to literal text "!ls -la"', () {
      final r = parseComposerShellPrefix(r'\!ls -la');
      expect(r.command, isNull);
      expect(r.text, equals('!ls -la'));
    });

    test('plain text with no prefix passes through unchanged', () {
      final r = parseComposerShellPrefix('hello world');
      expect(r.command, isNull);
      expect(r.text, equals('hello world'));
    });

    test('bare "!" parses as an empty shell command', () {
      final r = parseComposerShellPrefix('!');
      expect(r.command, equals(''));
    });

    test(r'only a leading "\!" (nothing else) unescapes to "!"', () {
      final r = parseComposerShellPrefix(r'\!');
      expect(r.text, equals('!'));
    });
  });

  // ── REAL-SURFACE: the actual composer widget ────────────────────────────

  group('REAL-SURFACE: composer !-prefix dispatch (InputAreaTestHarness)', () {
    late _StubAgentsRepository repo;
    late AgentsController controller;

    setUp(() async {
      repo = _StubAgentsRepository();
      controller = await _buildSelected(repo);
    });

    tearDown(() => controller.dispose());

    testWidgets('"!ls -la" dispatches runShellCommand and clears the input',
        (tester) async {
      await tester.pumpWidget(_wrap(controller));
      await tester.pump();

      await tester.enterText(
        find.byKey(const ValueKey('agent-composer-input')),
        '!ls -la',
      );
      await tester.pump();
      await tester.tap(find.text('Send'));
      await tester.pump();

      expect(repo.shellCallCount, equals(1));
      expect(repo.lastShellSessionId, equals('s1'));
      expect(repo.lastShellCommand, equals('ls -la'));
      expect(
        repo.sentFrames.where((f) => f['type'] == 'session.input'),
        isEmpty,
        reason: 'a shell dispatch must not also send a session.input frame',
      );

      final field = tester.widget<TextField>(
        find.byKey(const ValueKey('agent-composer-input')),
      );
      expect(field.controller!.text, isEmpty);
    });

    testWidgets(
      r'"\!not-a-command" unescapes to literal text and does NOT dispatch a shell command',
      (tester) async {
        await tester.pumpWidget(_wrap(controller));
        await tester.pump();

        await tester.enterText(
          find.byKey(const ValueKey('agent-composer-input')),
          r'\!not-a-command',
        );
        await tester.pump();
        await tester.tap(find.text('Send'));
        await tester.pump();

        expect(repo.shellCallCount, equals(0));
        // InputAreaTestHarness's onSend is a no-op stub (the real dispatch to
        // session.input is _sendInput in the parent _TranscriptPanelState, not
        // reachable from this narrower harness) — but _send() rewrites the
        // composer text to the unescaped literal before delegating to onSend,
        // which is the REAL-SURFACE behavior under test here.
        final field = tester.widget<TextField>(
          find.byKey(const ValueKey('agent-composer-input')),
        );
        expect(field.controller!.text, equals('!not-a-command'));
      },
    );

    testWidgets('plain text with no prefix does not dispatch a shell command',
        (tester) async {
      await tester.pumpWidget(_wrap(controller));
      await tester.pump();

      await tester.enterText(
        find.byKey(const ValueKey('agent-composer-input')),
        'hello world',
      );
      await tester.pump();
      await tester.tap(find.text('Send'));
      await tester.pump();

      expect(repo.shellCallCount, equals(0));
    });
  });
}
