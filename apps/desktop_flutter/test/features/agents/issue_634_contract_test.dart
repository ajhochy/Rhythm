/// Acceptance contract for issue #634 — mini-bubble truncates assistant
/// responses.
///
/// This test MUST fail before implementation and pass after the fix.
///
/// Diagnosis (from failure-triage):
///   _MiniMessageBlock (assistant/output role) renders its Text with
///   `maxLines: 5` + `overflow: TextOverflow.ellipsis`, silently truncating
///   long assistant replies inside the 360×460 session bubble.
///
///   _MiniLiveBlock renders its Text with `maxLines: 10` +
///   `overflow: TextOverflow.ellipsis`, silently truncating live PTY output.
///
/// The fix: remove the maxLines + overflow constraints from the non-input
/// branch of _MiniMessageBlock and from _MiniLiveBlock so the bubble scrolls
/// rather than clips. (A ScrollView wrapping each block is fine, but the
/// simplest fix is to drop the capping entirely and let the outer ListView
/// handle scroll.)
///
/// Test strategy (option 1 from contract):
///   Pump AgentBubbleOverlayLayer with a fake controller + overlay that
///   produce one *expanded* session bubble containing a long assistant message
///   and long live output, then find.byType(Text) and assert maxLines == null
///   on the matching widgets.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_bubble_overlay.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/agents/overlay_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Fakes / stubs
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

class _StubAgentsRepository implements AgentsRepository {
  final StreamController<AgentWsMessage> _msg =
      StreamController<AgentWsMessage>.broadcast();
  final StreamController<bool> _conn = StreamController<bool>.broadcast();

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
  void send(Map<String, dynamic> msg) {}

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
  }) async =>
      [
        AgentSession(
          id: 'session-634',
          agentId: 'claude-code',
          name: 'Test Session',
          cwd: '/tmp',
          status: AgentSessionStatus.idle,
          createdAt: _kEpoch,
          updatedAt: _kEpoch,
        ),
      ];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    final session = AgentSession(
      id: 'session-634',
      agentId: 'claude-code',
      name: 'Test Session',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );
    return (session: session, messages: const <AgentSessionMessage>[]);
  }

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

/// AgentsController subclass that pre-loads a transcript and live output for
/// session-634 without hitting the network.
class _PreloadedAgentsController extends AgentsController {
  _PreloadedAgentsController(
    AgentsRepository repo,
    AgentServerController agentServer,
    LocalNotificationService notifService,
    NotificationsController notifController,
  ) : super(repo, agentServer, notifService, notifController);

  static final _longText = 'A' * 800;

  @override
  List<AgentSession> get sessions => [
        AgentSession(
          id: 'session-634',
          agentId: 'claude-code',
          name: 'Test Session',
          cwd: '/tmp',
          status: AgentSessionStatus.idle,
          createdAt: _kEpoch,
          updatedAt: _kEpoch,
        ),
      ];

  @override
  List<AgentSessionMessage> transcriptFor(String sessionId) {
    if (sessionId == 'session-634') {
      return [
        AgentSessionMessage(
          id: 1,
          sessionId: 'session-634',
          role: 'output', // assistant / non-input role → triggers maxLines:5 bug
          rawText: _longText,
          strippedText: _longText,
          createdAt: DateTime.fromMillisecondsSinceEpoch(0),
        ),
      ];
    }
    return const [];
  }

  @override
  String liveOutputFor(String sessionId) => '';

  @override
  bool isWorking(String sessionId) => false;

  @override
  List<PendingTrigger> get pendingTriggers => const [];

  @override
  Future<void> reconnectSession(String id) async {}
}

/// Same as above but returns no transcript messages and non-empty live output
/// so _MiniLiveBlock gets rendered (for c2).
class _LiveOutputAgentsController extends AgentsController {
  _LiveOutputAgentsController(
    AgentsRepository repo,
    AgentServerController agentServer,
    LocalNotificationService notifService,
    NotificationsController notifController,
  ) : super(repo, agentServer, notifService, notifController);

  static final _longLive = 'L' * 800;

  @override
  List<AgentSession> get sessions => [
        AgentSession(
          id: 'session-634',
          agentId: 'claude-code',
          name: 'Test Session',
          cwd: '/tmp',
          status: AgentSessionStatus.working,
          createdAt: _kEpoch,
          updatedAt: _kEpoch,
        ),
      ];

  @override
  List<AgentSessionMessage> transcriptFor(String sessionId) => const [];

  @override
  String liveOutputFor(String sessionId) =>
      sessionId == 'session-634' ? _longLive : '';

  @override
  bool isWorking(String sessionId) => false;

  @override
  List<PendingTrigger> get pendingTriggers => const [];

  @override
  Future<void> reconnectSession(String id) async {}
}

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0, isUtc: true);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Builds the providers needed by AgentBubbleOverlayLayer and
/// returns an OverlayController with the given session's bubble pre-expanded.
Widget _makeTestWidget({
  required AgentsController agentsController,
  required AgentServerController agentServerController,
}) {
  final overlay = OverlayController(agentsController);
  // Pre-expand the bubble for our session so _ExpandedSessionBubble renders.
  overlay.toggleExpand('session-634');

  final agentConfigsController = AgentConfigsController(
    AgentConfigsRepository(AgentConfigsDataSource()),
  );

  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentsController>.value(value: agentsController),
      ChangeNotifierProvider<AgentServerController>.value(
          value: agentServerController),
      ChangeNotifierProvider<OverlayController>.value(value: overlay),
      ChangeNotifierProvider<AgentConfigsController>.value(
          value: agentConfigsController),
    ],
    child: MaterialApp(
      home: Scaffold(
        body: Stack(
          children: const [
            AgentBubbleOverlayLayer(),
          ],
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('issue-634-c1: MiniMessageBlock assistant text must not be capped at maxLines 5',
      () {
    testWidgets(
      'Text widget for long assistant message must have maxLines == null',
      (tester) async {
        final agentServer = _ReadyAgentServerController();
        final notifService = _FakeLocalNotificationService();
        final notifController = _FakeNotificationsController();
        final repo = _StubAgentsRepository();
        final agentsController = _PreloadedAgentsController(
          repo,
          agentServer,
          notifService,
          notifController,
        );
        addTearDown(agentsController.dispose);
        addTearDown(agentServer.dispose);

        await tester.pumpWidget(
          _makeTestWidget(
            agentsController: agentsController,
            agentServerController: agentServer,
          ),
        );
        await tester.pump(); // process initState post-frame callbacks

        // Find the Text widget that contains our 800-char assistant message.
        // There may be multiple Text widgets; we target the one whose data
        // starts with 'AAA' (the long assistant output).
        final longText = 'A' * 800;
        final textWidgets = tester
            .widgetList<Text>(find.byType(Text))
            .where((t) => t.data == longText || (t.data?.startsWith('AAA') ?? false))
            .toList();

        expect(
          textWidgets,
          isNotEmpty,
          reason:
              'Expected to find a Text widget with the long assistant message.',
        );

        for (final tw in textWidgets) {
          // c1: maxLines must be null (no truncation)
          expect(
            tw.maxLines,
            isNull,
            reason:
                'Text widget for assistant message must NOT have maxLines set '
                '(found maxLines: ${tw.maxLines}). Remove maxLines: 5 from '
                '_MiniMessageBlock output branch.',
          );

          // c1: overflow must not be ellipsis
          expect(
            tw.overflow,
            isNot(equals(TextOverflow.ellipsis)),
            reason:
                'Text widget for assistant message must NOT use '
                'overflow: TextOverflow.ellipsis (found overflow: '
                '${tw.overflow}). Remove overflow: TextOverflow.ellipsis from '
                '_MiniMessageBlock output branch.',
          );
        }
      },
    );
  });

  group('issue-634-c2: MiniLiveBlock live output must not be capped at maxLines 10',
      () {
    testWidgets(
      'Text widget for live output must have maxLines == null',
      (tester) async {
        final agentServer = _ReadyAgentServerController();
        final notifService = _FakeLocalNotificationService();
        final notifController = _FakeNotificationsController();
        final repo = _StubAgentsRepository();
        final agentsController = _LiveOutputAgentsController(
          repo,
          agentServer,
          notifService,
          notifController,
        );
        addTearDown(agentsController.dispose);
        addTearDown(agentServer.dispose);

        await tester.pumpWidget(
          _makeTestWidget(
            agentsController: agentsController,
            agentServerController: agentServer,
          ),
        );
        await tester.pump();

        // _MiniLiveBlock strips ANSI and uses the last 500 chars if > 500.
        // Our 800-char 'L' string will be truncated to the last 500 chars:
        // 'L' * 500.
        final expectedDisplay = 'L' * 500;
        final textWidgets = tester
            .widgetList<Text>(find.byType(Text))
            .where((t) =>
                t.data == expectedDisplay ||
                (t.data?.startsWith('LLL') ?? false))
            .toList();

        expect(
          textWidgets,
          isNotEmpty,
          reason:
              'Expected to find a Text widget with the live output text.',
        );

        for (final tw in textWidgets) {
          // c2: maxLines must be null
          expect(
            tw.maxLines,
            isNull,
            reason:
                'Text widget for live output must NOT have maxLines set '
                '(found maxLines: ${tw.maxLines}). Remove maxLines: 10 from '
                '_MiniLiveBlock.',
          );

          // c2: overflow must not be ellipsis
          expect(
            tw.overflow,
            isNot(equals(TextOverflow.ellipsis)),
            reason:
                'Text widget for live output must NOT use '
                'overflow: TextOverflow.ellipsis (found overflow: '
                '${tw.overflow}). Remove overflow: TextOverflow.ellipsis from '
                '_MiniLiveBlock.',
          );
        }
      },
    );
  });
}
