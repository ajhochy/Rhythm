/// OCU-22 (#1063) — branch badge + dirty count in the transcript header.
/// OCU-25 (#1066) — "Prepare project for agents" (session.init) header action.
///
/// Both flt-halves land in `_TranscriptHeader`, so they share one test file
/// and the same fakes. REAL-SURFACE tests use [TranscriptHeaderTestHarness]
/// (the actual private `_TranscriptHeader` widget), mirroring the pattern
/// established by opc_m3_3_compaction_test.dart.
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

class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msg = StreamController.broadcast(),
        _conn = StreamController.broadcast();
  final StreamController<AgentWsMessage> _msg;
  final StreamController<bool> _conn;

  int getVcsCallCount = 0;
  Map<String, dynamic> vcsInfoResponse = const {};
  List<Map<String, dynamic>> vcsStatusResponse = const [];

  int initProjectCallCount = 0;
  String? lastInitSessionId;
  bool initShouldThrow = false;

  void emit(AgentWsMessage m) => _msg.add(m);

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
  bool send(Map<String, dynamic> msg) => true;
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
  Future<Map<String, dynamic>> getVcs(String sessionId) async {
    getVcsCallCount++;
    return vcsInfoResponse;
  }

  @override
  Future<List<Map<String, dynamic>>> getVcsStatus(String sessionId) async =>
      vcsStatusResponse;

  @override
  Future<void> initProject(String sessionId) async {
    initProjectCallCount++;
    lastInitSessionId = sessionId;
    if (initShouldThrow) throw Exception('init failed');
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

({AgentsController ctrl, _StubAgentsRepository repo}) _build() {
  final repo = _StubAgentsRepository();
  final ctrl = AgentsController(
    repo,
    _ReadyAgentServerController(),
    LocalNotificationService(),
    NotificationsController(
      NotificationsRepository(NotificationsDataSource()),
    ),
  );
  return (ctrl: ctrl, repo: repo);
}

Future<AgentConfigsController> _makeConfigsController() async {
  final dataSource = AgentConfigsDataSource();
  final repository = AgentConfigsRepository(dataSource);
  final ctrl = AgentConfigsController(repository);
  await ctrl.refresh();
  return ctrl;
}

Widget _wrapWithProviders({
  required AgentConfigsController configsCtrl,
  required AgentsController agentsCtrl,
  required AgentServerController agentServerCtrl,
  required Widget child,
}) {
  return MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(
      body: MultiProvider(
        providers: [
          ChangeNotifierProvider<AgentConfigsController>.value(
              value: configsCtrl),
          ChangeNotifierProvider<AgentsController>.value(value: agentsCtrl),
          ChangeNotifierProvider<AgentServerController>.value(
              value: agentServerCtrl),
        ],
        child: Center(child: child),
      ),
    ),
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _StubAgentsRepository repo;
  late AgentsController ctrl;

  setUp(() {
    final built = _build();
    repo = built.repo;
    ctrl = built.ctrl;
  });

  tearDown(() => ctrl.dispose());

  // ── OCU-22 (#1063): branch badge ──────────────────────────────────────────

  group('OCU-22 (#1063): branch badge + dirty count', () {
    testWidgets(
      'REAL-SURFACE: badge hidden for a non-git session (vcsInfoFor is null)',
      (tester) async {
        final configsCtrl = await _makeConfigsController();
        addTearDown(configsCtrl.dispose);
        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);
        final session = _makeSession('s-nogit');

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: ctrl,
          agentServerCtrl: agentServerCtrl,
          child: TranscriptHeaderTestHarness(session: session),
        ));
        await tester.pump();

        expect(find.byKey(const ValueKey('vcs-branch-badge')), findsNothing);
      },
    );

    testWidgets(
      'REAL-SURFACE: badge shows branch name + dirty count once fetched',
      (tester) async {
        final configsCtrl = await _makeConfigsController();
        addTearDown(configsCtrl.dispose);
        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);
        final session = _makeSession('s-git');

        ctrl.setVcsInfoForTest(
          session.id,
          info: const {'branch': 'feature/foo'},
          status: const [
            {'file': 'a.ts', 'status': 'modified'},
            {'file': 'b.ts', 'status': 'added'},
          ],
        );

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: ctrl,
          agentServerCtrl: agentServerCtrl,
          child: TranscriptHeaderTestHarness(session: session),
        ));
        await tester.pump();

        expect(find.byKey(const ValueKey('vcs-branch-badge')), findsOneWidget);
        expect(find.text('feature/foo'), findsOneWidget);
        expect(find.text('(2)'), findsOneWidget);
      },
    );

    testWidgets(
      'REAL-SURFACE: clean tree shows the branch with no dirty count',
      (tester) async {
        final configsCtrl = await _makeConfigsController();
        addTearDown(configsCtrl.dispose);
        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);
        final session = _makeSession('s-clean');

        ctrl.setVcsInfoForTest(session.id, info: const {'branch': 'main'});

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: ctrl,
          agentServerCtrl: agentServerCtrl,
          child: TranscriptHeaderTestHarness(session: session),
        ));
        await tester.pump();

        expect(find.text('main'), findsOneWidget);
        expect(find.byKey(const ValueKey('vcs-dirty-count')), findsNothing);
      },
    );

    test('selectSession fetches vcs info and populates vcsInfoFor', () async {
      repo.vcsInfoResponse = const {'branch': 'main'};
      repo.vcsStatusResponse = const [
        {'file': 'x.ts', 'status': 'modified'},
      ];

      await ctrl.selectSession('s1');
      await Future<void>.delayed(Duration.zero);

      expect(ctrl.vcsInfoFor('s1'), isNotNull);
      expect(ctrl.vcsInfoFor('s1')!['branch'], equals('main'));
      expect(ctrl.vcsStatusFor('s1'), hasLength(1));
    });

    test(
      'a non-git response (no branch key) resolves vcsInfoFor to null',
      () async {
        repo.vcsInfoResponse = const {}; // engine: no branch → not a git dir
        await ctrl.selectSession('s1');
        await Future<void>.delayed(Duration.zero);
        expect(ctrl.vcsInfoFor('s1'), isNull);
      },
    );

    test(
      'vcs.branch.updated WS frame refetches the selected session (live-update)',
      () async {
        await ctrl.initialize(); // subscribes to the repository's WS stream
        repo.vcsInfoResponse = const {'branch': 'main'};
        await ctrl.selectSession('s1');
        await Future<void>.delayed(Duration.zero);
        final callsAfterSelect = repo.getVcsCallCount;

        // Agent ran `git checkout -b feature/x` — engine emits the event and
        // the bridge relays it (project-scoped, no sessionID on the frame).
        repo.vcsInfoResponse = const {'branch': 'feature/x'};
        repo.emit(const VcsBranchUpdatedMessage(branch: 'feature/x'));
        await Future<void>.delayed(Duration.zero);

        expect(repo.getVcsCallCount, greaterThan(callsAfterSelect));
        expect(ctrl.vcsInfoFor('s1')!['branch'], equals('feature/x'));
      },
    );
  });

  // ── OCU-25 (#1066): "Prepare project for agents" ──────────────────────────

  group('OCU-25 (#1066): "Prepare project for agents" header action', () {
    testWidgets(
      'REAL-SURFACE: overflow menu contains "Prepare project for agents"',
      (tester) async {
        final configsCtrl = await _makeConfigsController();
        addTearDown(configsCtrl.dispose);
        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);
        final session = _makeSession('s-init');

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: ctrl,
          agentServerCtrl: agentServerCtrl,
          child: TranscriptHeaderTestHarness(session: session),
        ));
        await tester.pump();

        await tester.tap(find.byIcon(Icons.more_vert));
        await tester.pumpAndSettle();

        expect(find.text('Prepare project for agents'), findsOneWidget);
      },
    );

    testWidgets(
      'REAL-SURFACE: tapping the action dispatches initializeProject',
      (tester) async {
        final configsCtrl = await _makeConfigsController();
        addTearDown(configsCtrl.dispose);
        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);
        const sessionId = 's-init-dispatch';
        final session = _makeSession(sessionId);

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: ctrl,
          agentServerCtrl: agentServerCtrl,
          child: TranscriptHeaderTestHarness(session: session),
        ));
        await tester.pump();

        await tester.tap(find.byIcon(Icons.more_vert));
        await tester.pumpAndSettle();
        await tester.tap(find.text('Prepare project for agents'));
        // Same reasoning as the compact-session test: avoid pumpAndSettle()
        // while the spinner (CircularProgressIndicator) is animating.
        await tester.pump(Duration.zero);
        await tester.pump(const Duration(milliseconds: 50));

        expect(repo.initProjectCallCount, equals(1));
        expect(repo.lastInitSessionId, equals(sessionId));
      },
    );

    testWidgets(
      'REAL-SURFACE: spinner shown while init is in-flight',
      (tester) async {
        final configsCtrl = await _makeConfigsController();
        addTearDown(configsCtrl.dispose);
        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);
        const sessionId = 's-init-spinner';
        final session = _makeSession(sessionId);

        ctrl.setInitializingForTest(sessionId, true);

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: ctrl,
          agentServerCtrl: agentServerCtrl,
          child: TranscriptHeaderTestHarness(session: session),
        ));
        await tester.pump();

        expect(find.byType(CircularProgressIndicator), findsOneWidget);
      },
    );

    test('isInitializingProject clears after initializeProject resolves',
        () async {
      const sessionId = 's-init-clears';
      await ctrl.initializeProject(sessionId);
      expect(ctrl.isInitializingProject(sessionId), isFalse);
      expect(repo.initProjectCallCount, equals(1));
    });

    test('isInitializingProject clears on initializeProject error', () async {
      const sessionId = 's-init-error';
      repo.initShouldThrow = true;
      await ctrl.initializeProject(sessionId);
      expect(ctrl.isInitializingProject(sessionId), isFalse);
    });
  });
}
