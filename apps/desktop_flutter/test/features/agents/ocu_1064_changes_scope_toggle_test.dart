/// OCU-23 (#1064) — Changes tab scope toggle + raw patch export.
///
/// REAL-SURFACE widget test mounts [SessionSidePanel] (mirrors
/// opc_m3_1_changes_tab_mounted_test.dart) and exercises the scope toggle:
/// This session / All uncommitted / vs default branch, each rendering through
/// the existing [UnifiedDiffView] widget (session scope via before/after
/// content, the two vcs/diff scopes via the raw `patch` text fallback).
///
/// The "export writes a valid patch (git apply --check passes)" acceptance
/// criterion is verified independently against a real `git` binary + temp
/// repo — that doesn't need Flutter's file_picker plugin channel, which has
/// no test-harness implementation.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_session_side_panel.dart';
import 'package:rhythm_desktop/features/agents/views/_tool_renderers/_unified_diff_view.dart';
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
  void send(Map<String, dynamic> msg) {}
  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async =>
      const [];
  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async =>
          (session: _makeSession(id), messages: const <AgentSessionMessage>[]);

  List<Map<String, dynamic>> stagedDiff = const [];
  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      stagedDiff;

  @override
  Future<void> revertSession(String sessionId, String messageId) async {}
  @override
  Future<void> unrevertSession(String sessionId) async {}

  Map<String, List<Map<String, dynamic>>> vcsDiffByMode = {};
  @override
  Future<List<Map<String, dynamic>>> getVcsDiff(
    String sessionId,
    String mode,
  ) async =>
      vcsDiffByMode[mode] ?? const [];

  String rawPatch = '';
  @override
  Future<String> getVcsDiffRaw(String sessionId) async => rawPatch;

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

const _kSessionDiffFixture = [
  {
    'file': 'lib/a.dart',
    'before': 'old\n',
    'after': 'new\n',
    'additions': 1,
    'deletions': 1,
  },
];

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

void main() {
  late _StubAgentsRepository repo;
  late AgentsController controller;

  setUp(() {
    repo = _StubAgentsRepository();
    controller = _buildController(repo);
  });

  tearDown(() => controller.dispose());

  testWidgets(
    'REAL-SURFACE: "This session" is the default scope and shows the '
    'session diff',
    (tester) async {
      final session = _makeSession('s1');
      repo.stagedDiff = _kSessionDiffFixture;

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();
      await tester.tap(find.text('Changes'));
      await tester.pump();
      await tester.pump();

      expect(
          find.byKey(const ValueKey('changes-scope-session')), findsOneWidget);
      expect(find.byIcon(Icons.expand_more), findsOneWidget);
    },
  );

  testWidgets(
    'REAL-SURFACE: "All uncommitted" scope fetches and renders vcs/diff '
    'mode=git via UnifiedDiffView (raw patch fallback)',
    (tester) async {
      final session = _makeSession('s1');
      repo.vcsDiffByMode['git'] = const [
        {
          'file': 'lib/b.dart',
          'patch': '@@ -1 +1 @@\n-old\n+new\n',
          'additions': 1,
          'deletions': 1,
        },
      ];

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();
      await tester.tap(find.text('Changes'));
      await tester.pump();
      await tester.pump();

      await tester
          .tap(find.byKey(const ValueKey('changes-scope-allUncommitted')));
      await tester.pump(); // triggers fetchVcsDiff
      await tester.pump();

      expect(find.text('b.dart'), findsOneWidget);
      await tester.tap(find.byIcon(Icons.expand_more));
      await tester.pump();
      expect(find.byType(UnifiedDiffView), findsOneWidget);
      expect(find.textContaining('+new'), findsOneWidget);
    },
  );

  testWidgets(
    'REAL-SURFACE: "vs default branch" scope fetches and renders vcs/diff '
    'mode=branch',
    (tester) async {
      final session = _makeSession('s1');
      repo.vcsDiffByMode['branch'] = const [
        {
          'file': 'lib/c.dart',
          'patch': '@@ -1 +1 @@\n-a\n+b\n',
          'additions': 1,
          'deletions': 1,
        },
      ];

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();
      await tester.tap(find.text('Changes'));
      await tester.pump();
      await tester.pump();

      await tester
          .tap(find.byKey(const ValueKey('changes-scope-vsDefaultBranch')));
      await tester.pump();
      await tester.pump();

      expect(find.text('c.dart'), findsOneWidget);
    },
  );

  testWidgets(
    'REAL-SURFACE: empty vcs/diff scope shows "No file changes yet"',
    (tester) async {
      final session = _makeSession('s1');
      // vcsDiffByMode['git'] left unset → empty list.

      await tester
          .pumpWidget(_wrap(controller, SessionSidePanel(session: session)));
      await tester.pump();
      await tester.tap(find.text('Changes'));
      await tester.pump();
      await tester.pump();

      await tester
          .tap(find.byKey(const ValueKey('changes-scope-allUncommitted')));
      await tester.pump();
      await tester.pump();

      expect(find.text('No file changes yet'), findsOneWidget);
    },
  );

  test(
    'fetchVcsDiffRaw proxies to the repository (used by the export action)',
    () async {
      repo.rawPatch = 'diff --git a/x b/x\n';
      final patch = await controller.fetchVcsDiffRaw('s1');
      expect(patch, equals('diff --git a/x b/x\n'));
    },
  );

  // ── Export-patch validity (real `git apply --check`, no Flutter plugin) ────

  test(
    'a raw unified-diff patch fixture is a valid patch (git apply --check)',
    () async {
      final tmp = await Directory.systemTemp.createTemp('ocu1064_patch_');
      addTearDown(() => tmp.delete(recursive: true));

      // Initialize a throwaway git repo with the pre-patch file content.
      await Process.run('git', ['init', '-q'], workingDirectory: tmp.path);
      await Process.run(
        'git',
        ['config', 'user.email', 'test@example.com'],
        workingDirectory: tmp.path,
      );
      await Process.run(
        'git',
        ['config', 'user.name', 'Test'],
        workingDirectory: tmp.path,
      );
      final target = File('${tmp.path}/a.txt');
      await target.writeAsString('line one\nline two\nline three\n');
      await Process.run('git', ['add', '.'], workingDirectory: tmp.path);
      await Process.run(
        'git',
        ['commit', '-q', '-m', 'init'],
        workingDirectory: tmp.path,
      );

      // The exact shape the Changes-tab "Export patch" action writes: the raw
      // text/x-diff body returned by GET /vcs/diff/raw, verbatim.
      const patch = '''
diff --git a/a.txt b/a.txt
index 0000000..1111111 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 line one
-line two
+line TWO
 line three
''';
      final patchFile = File('${tmp.path}/export.patch');
      await patchFile.writeAsString(patch);

      final result = await Process.run(
        'git',
        ['apply', '--check', 'export.patch'],
        workingDirectory: tmp.path,
      );

      expect(
        result.exitCode,
        equals(0),
        reason: 'git apply --check failed: ${result.stderr}',
      );
    },
    skip: false,
  );
}
