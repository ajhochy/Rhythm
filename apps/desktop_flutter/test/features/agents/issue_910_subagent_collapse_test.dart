/// #910 — subagent group collapse/expand in the session list tree.
///
/// Pumps the real [SessionListBody] with a hand-built parent+children session
/// list (no repository/network involved — filteredSessions is supplied
/// directly) and asserts:
///   - children render by default (expanded)
///   - tapping the subagent-group summary collapses them to one line
///   - tapping again re-expands them
///   - the "Collapse all" / "Expand all" toggle flips every group at once
///
/// Run with:
///   flutter test test/features/agents/issue_910_subagent_collapse_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_session_list_body.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Fakes (mirrored from inspector_collapse_state_test.dart)
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
  bool send(Map<String, dynamic> msg) => true;

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

class _FakeAgentConfigsDataSource extends AgentConfigsDataSource {
  _FakeAgentConfigsDataSource(this._configs);

  final List<AgentConfig> _configs;

  @override
  Future<List<AgentConfig>> list() async => _configs;
}

final _claudeCodeConfig = AgentConfig(
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'assets/icons/claude_code.png',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
);

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

AgentSession _makeSession(String id, {String? parentId, String? name}) =>
    AgentSession(
      id: id,
      agentId: 'claude-code',
      name: name ?? 'Session $id',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
      parentId: parentId,
    );

AgentsController _buildController() {
  final repo = _StubAgentsRepository();
  return AgentsController(
    repo,
    _ReadyAgentServerController(),
    LocalNotificationService(),
    NotificationsController(
      NotificationsRepository(NotificationsDataSource()),
    ),
  );
}

Future<Widget> _buildTestApp(AgentsController controller) async {
  final sessions = [
    _makeSession('parent-1', name: 'Root Session'),
    _makeSession('child-1', parentId: 'parent-1', name: 'Subagent A'),
    _makeSession('child-2', parentId: 'parent-1', name: 'Subagent B'),
  ];

  final agentServerController = _ReadyAgentServerController();
  final agentConfigsController = AgentConfigsController(
    AgentConfigsRepository(_FakeAgentConfigsDataSource([_claudeCodeConfig])),
  );
  await agentConfigsController.refresh();

  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentServerController>.value(
        value: agentServerController,
      ),
      ChangeNotifierProvider<AgentConfigsController>.value(
        value: agentConfigsController,
      ),
      ChangeNotifierProvider<AgentsController>.value(value: controller),
    ],
    child: MaterialApp(
      home: Scaffold(
        body: SizedBox(
          width: 320,
          height: 600,
          child: SessionListBody(
            filteredSessions: sessions,
            resumableSectionExpanded: false,
            onToggleResumable: () {},
            archivedSectionExpanded: false,
            onToggleArchived: () {},
            multiSelected: const {},
            onRowTap: (_) {},
          ),
        ),
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'subagent group renders expanded by default, collapses and re-expands on tap',
    (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final controller = _buildController();
      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // Expanded by default: both child rows visible, summary shows "expand_more".
      expect(find.text('Subagent A'), findsOneWidget);
      expect(find.text('Subagent B'), findsOneWidget);
      expect(find.text('2 subagents'), findsOneWidget);

      // Tap the summary to collapse.
      await tester.tap(find.text('2 subagents'));
      await tester.pump();

      expect(find.text('Subagent A'), findsNothing);
      expect(find.text('Subagent B'), findsNothing);
      expect(find.text('2 subagents'), findsOneWidget);

      // Tap again to expand.
      await tester.tap(find.text('2 subagents'));
      await tester.pump();

      expect(find.text('Subagent A'), findsOneWidget);
      expect(find.text('Subagent B'), findsOneWidget);

      controller.dispose();
    },
  );

  testWidgets('Collapse all / Expand all toggles every subagent group at once',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(1600, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final controller = _buildController();
    await tester.pumpWidget(await _buildTestApp(controller));
    await tester.pump();

    expect(find.text('Collapse all'), findsOneWidget);
    expect(find.text('Subagent A'), findsOneWidget);

    await tester.tap(find.text('Collapse all'));
    await tester.pump();

    expect(find.text('Subagent A'), findsNothing);
    expect(find.text('Expand all'), findsOneWidget);

    await tester.tap(find.text('Expand all'));
    await tester.pump();

    expect(find.text('Subagent A'), findsOneWidget);
    expect(find.text('Collapse all'), findsOneWidget);

    controller.dispose();
  });

  testWidgets('subagent disclosure exposes expanded button semantics',
      (tester) async {
    final controller = _buildController();
    await tester.pumpWidget(await _buildTestApp(controller));
    await tester.pump();

    final disclosure = find.byKey(const ValueKey('subagent-group-disclosure'));
    expect(
      tester.getSemantics(disclosure),
      containsSemantics(isButton: true, isExpanded: true),
    );

    controller.dispose();
  });

  testWidgets('child session rows meet the 28px desktop minimum',
      (tester) async {
    final controller = _buildController();
    await tester.pumpWidget(await _buildTestApp(controller));
    await tester.pump();

    // Regression: compact child rows shrank to about 21px, too small for
    // desktop pointer and keyboard targeting.
    expect(
      tester.getSize(find.byType(ChildSessionRow).first).height,
      greaterThanOrEqualTo(28),
      reason: 'Interactive child rows must be at least 28px tall',
    );

    controller.dispose();
  });
}
