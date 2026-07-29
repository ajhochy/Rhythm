/// OCU-21 (#1062) — Inspector Files tab: browse + preview + git-status dots.
///
/// REAL-SURFACE widget tests mount the real [FilesTab] widget (via the
/// mounted [SessionSidePanel], same pattern as
/// opc_m3_1_changes_tab_mounted_test.dart) with a mocked file-tree fixture.
library;

import 'dart:async';
import 'dart:convert';

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
  }) async => const [];
  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
  getSession(String id) async =>
      (session: _makeSession(id), messages: const <AgentSessionMessage>[]);

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

  /// Directory listings, keyed by 'path' as requested.
  Map<String, List<Map<String, dynamic>>> filesByPath = {};
  @override
  Future<List<Map<String, dynamic>>> listSessionFiles(
    String sessionId, {
    String path = '.',
  }) async => filesByPath[path] ?? const [];

  List<Map<String, dynamic>> gitStatus = const [];
  @override
  Future<List<Map<String, dynamic>>> filesGitStatus(String sessionId) async =>
      gitStatus;

  Map<String, Map<String, dynamic>> contentByPath = {};
  @override
  Future<Map<String, dynamic>> fileContent(
    String sessionId,
    String path,
  ) async {
    final content = contentByPath[path];
    if (content == null) throw Exception('not found: $path');
    return content;
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

/// A minimal valid 1x1 PNG, base64-encoded (matches opc_m4_1_attachments_test
/// fixture bytes).
const _kFixturePngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVQI12P4z8AAAAACAAHiIbwzAAAAAElFTkSuQmCC';

void main() {
  late _StubAgentsRepository repo;
  late AgentsController controller;

  setUp(() {
    repo = _StubAgentsRepository();
    controller = _buildController(repo);
  });

  tearDown(() => controller.dispose());

  testWidgets(
    'REAL-SURFACE: mounted SessionSidePanel Files tab browses into nested dirs',
    (tester) async {
      final session = _makeSession('s1');
      repo.filesByPath['.'] = [
        {
          'name': 'src',
          'path': 'src',
          'absolute': '/tmp/src',
          'type': 'directory',
          'ignored': false,
        },
        {
          'name': 'README.md',
          'path': 'README.md',
          'absolute': '/tmp/README.md',
          'type': 'file',
          'ignored': false,
        },
      ];
      repo.filesByPath['src'] = [
        {
          'name': 'main.dart',
          'path': 'src/main.dart',
          'absolute': '/tmp/src/main.dart',
          'type': 'file',
          'ignored': false,
        },
      ];

      await tester.pumpWidget(
        _wrap(controller, SessionSidePanel(session: session)),
      );
      await tester.pump();

      await tester.tap(find.text('Files'));
      await tester.pump();
      await tester.pump();

      expect(find.text('src'), findsOneWidget);
      expect(find.text('README.md'), findsOneWidget);

      await tester.tap(find.text('src'));
      await tester.pump();
      await tester.pump();

      expect(find.text('main.dart'), findsOneWidget);
      expect(find.text('README.md'), findsNothing);

      // "Up" navigates back to the root listing.
      await tester.tap(find.byKey(const ValueKey('files-tab-up-button')));
      await tester.pump();
      await tester.pump();
      expect(find.text('README.md'), findsOneWidget);
    },
  );

  testWidgets('REAL-SURFACE: modified files show a git-status dot', (
    tester,
  ) async {
    final session = _makeSession('s1');
    repo.filesByPath['.'] = [
      {
        'name': 'a.dart',
        'path': 'a.dart',
        'absolute': '/tmp/a.dart',
        'type': 'file',
        'ignored': false,
      },
      {
        'name': 'b.dart',
        'path': 'b.dart',
        'absolute': '/tmp/b.dart',
        'type': 'file',
        'ignored': false,
      },
    ];
    repo.gitStatus = const [
      {'path': 'a.dart', 'added': 1, 'removed': 0, 'status': 'modified'},
    ];

    await tester.pumpWidget(
      _wrap(controller, SessionSidePanel(session: session)),
    );
    await tester.pump();
    await tester.tap(find.text('Files'));
    await tester.pump();
    await tester.pump();

    // Exactly one status dot (for a.dart, not b.dart).
    final entryA = find.byKey(const ValueKey('files-tab-entry-a.dart'));
    final entryB = find.byKey(const ValueKey('files-tab-entry-b.dart'));
    expect(
      find.descendant(of: entryA, matching: find.byType(Tooltip)),
      findsOneWidget,
    );
    expect(
      find.descendant(of: entryB, matching: find.byType(Tooltip)),
      findsNothing,
    );
  });

  testWidgets('REAL-SURFACE: tapping a text file previews its content', (
    tester,
  ) async {
    final session = _makeSession('s1');
    repo.filesByPath['.'] = [
      {
        'name': 'a.dart',
        'path': 'a.dart',
        'absolute': '/tmp/a.dart',
        'type': 'file',
        'ignored': false,
      },
    ];
    repo.contentByPath['a.dart'] = {
      'type': 'text',
      'content': 'void main() {}\n',
    };

    await tester.pumpWidget(
      _wrap(controller, SessionSidePanel(session: session)),
    );
    await tester.pump();
    await tester.tap(find.text('Files'));
    await tester.pump();
    await tester.pump();

    await tester.tap(find.byKey(const ValueKey('files-tab-entry-a.dart')));
    await tester.pump();
    await tester.pump();

    expect(
      find.byKey(const ValueKey('files-tab-preview-text')),
      findsOneWidget,
    );
    expect(find.text('void main() {}\n'), findsOneWidget);

    // Back button returns to the listing.
    await tester.tap(
      find.byKey(const ValueKey('files-tab-preview-back-button')),
    );
    await tester.pump();
    expect(
      find.byKey(const ValueKey('files-tab-entry-a.dart')),
      findsOneWidget,
    );
  });

  testWidgets('REAL-SURFACE: tapping an image file previews it inline', (
    tester,
  ) async {
    final session = _makeSession('s1');
    repo.filesByPath['.'] = [
      {
        'name': 'logo.png',
        'path': 'logo.png',
        'absolute': '/tmp/logo.png',
        'type': 'file',
        'ignored': false,
      },
    ];
    repo.contentByPath['logo.png'] = {
      'type': 'binary',
      'content': _kFixturePngBase64,
      'encoding': 'base64',
      'mimeType': 'image/png',
    };

    await tester.pumpWidget(
      _wrap(controller, SessionSidePanel(session: session)),
    );
    await tester.pump();
    await tester.tap(find.text('Files'));
    await tester.pump();
    await tester.pump();

    await tester.tap(find.byKey(const ValueKey('files-tab-entry-logo.png')));
    await tester.pump();
    await tester.pump();

    expect(
      find.byKey(const ValueKey('files-tab-preview-image')),
      findsOneWidget,
    );
  });

  testWidgets(
    'REAL-SURFACE: a non-image binary file shows the "Binary file" stub',
    (tester) async {
      final session = _makeSession('s1');
      repo.filesByPath['.'] = [
        {
          'name': 'archive.zip',
          'path': 'archive.zip',
          'absolute': '/tmp/archive.zip',
          'type': 'file',
          'ignored': false,
        },
      ];
      repo.contentByPath['archive.zip'] = {
        'type': 'binary',
        'content': base64Encode([1, 2, 3]),
        'encoding': 'base64',
        'mimeType': 'application/zip',
      };

      await tester.pumpWidget(
        _wrap(controller, SessionSidePanel(session: session)),
      );
      await tester.pump();
      await tester.tap(find.text('Files'));
      await tester.pump();
      await tester.pump();

      await tester.tap(
        find.byKey(const ValueKey('files-tab-entry-archive.zip')),
      );
      await tester.pump();
      await tester.pump();

      expect(
        find.byKey(const ValueKey('files-tab-preview-binary')),
        findsOneWidget,
      );
      expect(find.text('Binary file'), findsOneWidget);
    },
  );

  testWidgets('REAL-SURFACE: a >2MB file refuses gracefully with a message', (
    tester,
  ) async {
    final session = _makeSession('s1');
    repo.filesByPath['.'] = [
      {
        'name': 'huge.log',
        'path': 'huge.log',
        'absolute': '/tmp/huge.log',
        'type': 'file',
        'ignored': false,
      },
    ];
    // fileContent throws when the path isn't registered — mirrors the
    // server's 413 (>2MB cap) surfacing as an AppError.
    // (contentByPath intentionally left unset for 'huge.log'.)

    await tester.pumpWidget(
      _wrap(controller, SessionSidePanel(session: session)),
    );
    await tester.pump();
    await tester.tap(find.text('Files'));
    await tester.pump();
    await tester.pump();

    await tester.tap(find.byKey(const ValueKey('files-tab-entry-huge.log')));
    await tester.pump();
    await tester.pump();

    expect(
      find.byKey(const ValueKey('files-tab-preview-error')),
      findsOneWidget,
    );
  });

  testWidgets(
    'REAL-SURFACE: refresh re-fetches the current directory listing',
    (tester) async {
      final session = _makeSession('s1');
      repo.filesByPath['.'] = const [];

      await tester.pumpWidget(
        _wrap(controller, SessionSidePanel(session: session)),
      );
      await tester.pump();
      await tester.tap(find.text('Files'));
      await tester.pump();
      await tester.pump();

      expect(find.text('Empty directory'), findsOneWidget);

      // A file appears server-side; refresh must pick it up.
      repo.filesByPath['.'] = [
        {
          'name': 'new.dart',
          'path': 'new.dart',
          'absolute': '/tmp/new.dart',
          'type': 'file',
          'ignored': false,
        },
      ];
      await tester.tap(find.byKey(const ValueKey('files-tab-refresh-button')));
      await tester.pump();
      await tester.pump();

      expect(find.text('new.dart'), findsOneWidget);
    },
  );
}
