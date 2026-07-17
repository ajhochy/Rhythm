/// OCU-20 (#1061) — Composer @-mention fuzzy file attach.
///
/// REAL-SURFACE widget tests drive the actual composer
/// (`InputAreaTestHarness`, wrapping the private `_InputArea` +
/// `AtMentionPopover`) with a mocked [AgentsRepository] find-files/content
/// proxy, mirroring opc_m4_1_attachments_test.dart's pattern.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
import 'package:rhythm_desktop/features/agents/views/_at_mention_popover.dart';
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

  List<String> findFilesResult = const [];
  int findFilesCallCount = 0;
  String? lastFindFilesQuery;

  Map<String, dynamic> fileContentResult = const {
    'type': 'text',
    'content': 'file body',
  };

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
    String? scope,
  }) async =>
      [_makeSession('s1')];
  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async =>
          (session: _makeSession(id), messages: const <AgentSessionMessage>[]);

  @override
  Future<List<String>> findFiles(
    String sessionId,
    String query, {
    int? limit,
    String? type,
  }) async {
    findFilesCallCount++;
    lastFindFilesQuery = query;
    return findFilesResult;
  }

  @override
  Future<Map<String, dynamic>> fileContent(String sessionId, String path) =>
      Future.value(fileContentResult);

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
  late _StubAgentsRepository repo;
  late AgentsController controller;

  setUp(() async {
    repo = _StubAgentsRepository();
    controller = await _buildSelected(repo);
  });

  tearDown(() => controller.dispose());

  testWidgets(
    'REAL-SURFACE: typing "@" shows matching files after the 300ms debounce',
    (tester) async {
      repo.findFilesResult = const ['lib/foo.dart', 'lib/foobar.dart'];

      await tester.pumpWidget(_wrap(controller));
      await tester.pump();

      await tester.enterText(
        find.byKey(const ValueKey('agent-composer-input')),
        'check @foo',
      );
      await tester.pump(); // synchronous rebuild — no results yet
      expect(find.byKey(const ValueKey('at-mention-list')), findsNothing);

      await tester.pump(const Duration(milliseconds: 300));

      expect(repo.findFilesCallCount, equals(1));
      expect(repo.lastFindFilesQuery, equals('foo'));
      expect(find.byKey(const ValueKey('at-mention-list')), findsOneWidget);
      expect(find.text('lib/foo.dart'), findsOneWidget);
      expect(find.text('lib/foobar.dart'), findsOneWidget);
    },
  );

  testWidgets(
    'REAL-SURFACE: picking a result removes the @token and attaches a chip',
    (tester) async {
      repo.findFilesResult = const ['lib/foo.dart'];
      repo.fileContentResult = const {'type': 'text', 'content': 'hello'};

      await tester.pumpWidget(_wrap(controller));
      await tester.pump();

      await tester.enterText(
        find.byKey(const ValueKey('agent-composer-input')),
        'check @foo',
      );
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byKey(const ValueKey('at-mention-item-0')), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('at-mention-item-0')));
      await tester.pump();
      await tester.pump(); // let the content-fetch future resolve

      // The '@foo' token is removed from the composer text.
      final field = tester.widget<TextField>(
        find.byKey(const ValueKey('agent-composer-input')),
      );
      expect(field.controller!.text, equals('check'));

      // A pending attachment chip appears, named after the picked file.
      expect(find.byKey(const ValueKey('attachment-chip-0')), findsOneWidget);
      expect(
        controller.pendingAttachmentsFor('s1').single['filename'],
        equals('foo.dart'),
      );
      expect(
        controller.pendingAttachmentsFor('s1').single['text'],
        equals('hello'),
      );
    },
  );

  // These two dismiss tests pump [AtMentionPopover] directly (still the REAL
  // feature widget, exported from `_at_mention_popover.dart`) with a bare
  // autofocus TextField rather than the full nested composer stack. The full
  // composer nests it under SlashCommandPopover + the composer's own
  // Enter-to-send Focus + TextField; `WidgetTester.sendKeyEvent` targets
  // `primaryFocus`, which in that deep stack does not reliably land on a node
  // whose key-event ancestor chain includes the popover during a headless
  // test. Isolating the popover keeps focus targeting unambiguous while still
  // exercising its real dismiss logic (`_handleKeyEvent` / `_isOpen`).
  Widget wrapMentionOnly(TextEditingController textController) =>
      ChangeNotifierProvider<AgentsController>.value(
        value: controller,
        child: MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: AtMentionPopover(
              inputController: textController,
              sessionId: 's1',
              onFileSelected: (_) {},
              child: TextField(
                key: const ValueKey('mention-only-field'),
                controller: textController,
                autofocus: true,
              ),
            ),
          ),
        ),
      );

  testWidgets(
    'REAL-SURFACE (isolated popover): escape dismisses the popover cleanly',
    (tester) async {
      repo.findFilesResult = const ['lib/foo.dart'];
      final textController = TextEditingController(text: '@foo');
      addTearDown(textController.dispose);

      await tester.pumpWidget(wrapMentionOnly(textController));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byKey(const ValueKey('at-mention-list')), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.escape);
      await tester.pump();

      expect(find.byKey(const ValueKey('at-mention-list')), findsNothing);
      // The composer text is untouched by Escape (only the popover closes).
      expect(textController.text, equals('@foo'));
    },
  );

  testWidgets(
    'REAL-SURFACE (isolated popover): backspacing past "@" dismisses the popover',
    (tester) async {
      repo.findFilesResult = const ['lib/foo.dart'];
      final textController = TextEditingController(text: '@foo');
      addTearDown(textController.dispose);

      await tester.pumpWidget(wrapMentionOnly(textController));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      expect(find.byKey(const ValueKey('at-mention-list')), findsOneWidget);

      // Simulate backspacing all the way past the '@' (no trigger left).
      await tester.enterText(
        find.byKey(const ValueKey('mention-only-field')),
        '',
      );
      await tester.pump();

      expect(find.byKey(const ValueKey('at-mention-list')), findsNothing);
    },
  );

  testWidgets(
    'REAL-SURFACE: >100KB text content is truncated per the existing cap',
    (tester) async {
      repo.findFilesResult = const ['lib/big.txt'];
      repo.fileContentResult = {
        'type': 'text',
        'content': 'x' * (150 * 1024), // 150KB > the 100KB cap
      };

      await tester.pumpWidget(_wrap(controller));
      await tester.pump();

      await tester.enterText(
        find.byKey(const ValueKey('agent-composer-input')),
        '@big',
      );
      await tester.pump(const Duration(milliseconds: 300));
      await tester.tap(find.byKey(const ValueKey('at-mention-item-0')));
      await tester.pump();
      await tester.pump();

      final text =
          controller.pendingAttachmentsFor('s1').single['text'] as String;
      expect(text.length, lessThan(150 * 1024));
      expect(text, contains('truncated'));
    },
  );
}
