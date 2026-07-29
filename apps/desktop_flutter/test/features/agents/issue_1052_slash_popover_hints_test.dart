/// Widget/controller tests for #1052 (OCU-11) — slash popover argument hints
/// + popover refresh-on-open, pumping the real production
/// `SlashCommandPopover` widget.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/data/commands_data_source.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_slash_command_popover.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Part A — SlashCommandPopover: argument hint ghost text + onOpen callback
// ---------------------------------------------------------------------------

Widget _wrapPopover({
  required TextEditingController inputController,
  required List<SlashCommand> commands,
  required ValueChanged<String> onCommandSelected,
  VoidCallback? onOpen,
}) {
  return MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(
      body: SizedBox(
        width: 400,
        height: 400,
        child: SlashCommandPopover(
          inputController: inputController,
          commands: commands,
          onCommandSelected: onCommandSelected,
          onOpen: onOpen,
          child: const SizedBox(width: 400, height: 40),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Part B — AgentsController.refreshSlashCommands + arg passthrough
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

/// Stub repository recording WS frames sent via [send].
class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;
  final List<Map<String, dynamic>> sentFrames = [];

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
  }) async =>
      const [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async => (
            session: _makeSession(id),
            messages: const <AgentSessionMessage>[],
          );

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

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('#1052 — SlashCommandPopover argument hints', () {
    late TextEditingController inputController;

    setUp(() {
      inputController = TextEditingController();
    });

    tearDown(() {
      inputController.dispose();
    });

    const testCommands = [
      SlashCommand(
          name: 'deploy-notes',
          description: 'Draft deploy notes',
          hints: ['\$1', '\$2']),
      SlashCommand(name: 'help', description: 'Show help'),
    ];

    testWidgets(
        'argument hint ghost text is shown for a command that declares one',
        (tester) async {
      await tester.pumpWidget(_wrapPopover(
        inputController: inputController,
        commands: testCommands,
        onCommandSelected: (_) {},
      ));

      inputController.text = '/';
      await tester.pump();

      expect(find.text('\$1 \$2'), findsOneWidget);
    });

    testWidgets('no hint text rendered for a command with no arguments',
        (tester) async {
      await tester.pumpWidget(_wrapPopover(
        inputController: inputController,
        commands: testCommands,
        onCommandSelected: (_) {},
      ));

      inputController.text = '/hel';
      await tester.pump();

      expect(find.text('/help'), findsOneWidget);
      expect(find.text('\$1 \$2'), findsNothing);
    });

    testWidgets(
        'onOpen fires once when the input transitions to starting with "/"',
        (tester) async {
      var openCount = 0;
      await tester.pumpWidget(_wrapPopover(
        inputController: inputController,
        commands: testCommands,
        onCommandSelected: (_) {},
        onOpen: () => openCount++,
      ));

      expect(openCount, 0, reason: 'popover starts closed; no open event yet');

      inputController.text = '/';
      await tester.pump();
      expect(openCount, 1);

      // Still open (typing more of the same command) — must not re-fire.
      inputController.text = '/dep';
      await tester.pump();
      expect(openCount, 1);

      // Close then reopen — fires again.
      inputController.text = 'plain text';
      await tester.pump();
      inputController.text = '/';
      await tester.pump();
      expect(openCount, 2);
    });
  });

  group('#1052 — AgentsController.refreshSlashCommands', () {
    testWidgets('bypasses the cache guard and refetches the command list',
        (tester) async {
      final repo = _StubAgentsRepository();
      final controller = _buildController(repo);
      addTearDown(controller.dispose);
      const sessionId = 'sess-refresh';

      controller.setSlashCommandsForTest(sessionId, const [
        SlashCommand(name: 'help'),
      ]);
      expect(controller.slashCommandsFor(sessionId), hasLength(1));

      // refreshSlashCommands clears the cache and re-invokes the (unmocked,
      // real HTTP) data source — which degrades to [] on failure in a test
      // environment with no local agent server. The important assertion is
      // that the stale cached entry is gone, proving the cache was bypassed
      // rather than short-circuited by the containsKey guard.
      await controller.refreshSlashCommands(sessionId);

      expect(
        controller.slashCommandsFor(sessionId),
        isEmpty,
        reason:
            'refreshSlashCommands must clear the stale cache before refetching',
      );
    });
  });

  // ── argument passthrough for a hinted command (existing dispatch path) ──

  testWidgets(
      '#1052 — typed arguments for a hinted command are passed through session.command',
      (tester) async {
    final repo = _StubAgentsRepository();
    final agentsCtrl = _buildController(repo);
    addTearDown(agentsCtrl.dispose);
    const sessionId = 'test-session-1052';

    agentsCtrl.setSlashCommandsForTest(sessionId, const [
      SlashCommand(name: 'deploy-notes', hints: ['\$1', '\$2']),
    ]);

    agentsCtrl.sendCommand(sessionId, 'deploy-notes', 'v1.2.3 hotfix');
    await tester.pump(Duration.zero);

    final cmdFrames =
        repo.sentFrames.where((f) => f['type'] == 'session.command');
    expect(cmdFrames, hasLength(1));
    expect(cmdFrames.first['command'], 'deploy-notes');
    expect(cmdFrames.first['arguments'], 'v1.2.3 hotfix');
  });
}
