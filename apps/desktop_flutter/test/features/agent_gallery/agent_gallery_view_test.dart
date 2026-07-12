/// Widget tests for AgentGalleryView.
///
/// Asserts:
///   1. Design grid renders titles from a fake controller.
///   2. Empty-state widget renders when designs list is empty.
///   3. "Launch designer" button is present.
///   4. "Open in Canva" link is present for a design with a canvaUrl.
///   5. Tapping the button calls createSession with mcpRole 'graphic-designer'.
///   6. Tapping the button calls selectSession on the returned session.
///   7. Tapping the button stages a composer draft for the new session.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agent_gallery/controllers/agent_gallery_controller.dart';
import 'package:rhythm_desktop/features/agent_gallery/data/agent_gallery_data_source.dart';
import 'package:rhythm_desktop/features/agent_gallery/models/agent_design.dart';
import 'package:rhythm_desktop/features/agent_gallery/repositories/agent_gallery_repository.dart';
import 'package:rhythm_desktop/features/agent_gallery/views/agent_gallery_view.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Stubs
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
  Future<void> initialize() async {}
}

class _StubAgentsRepository implements AgentsRepository {
  final StreamController<AgentWsMessage> _msgCtrl =
      StreamController<AgentWsMessage>.broadcast();
  final StreamController<bool> _connCtrl = StreamController<bool>.broadcast();

  String? lastMcpRole;

  @override
  Stream<AgentWsMessage> get messages => _msgCtrl.stream;

  @override
  Stream<bool> get connectivityStream => _connCtrl.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msgCtrl.close();
    await _connCtrl.close();
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
      getSession(String id) async {
    final now = DateTime.now();
    return (
      session: AgentSession(
        id: id,
        agentId: '',
        name: '',
        cwd: '',
        status: AgentSessionStatus.idle,
        createdAt: now,
        updatedAt: now,
      ),
      messages: const <AgentSessionMessage>[],
    );
  }

  @override
  Future<AgentSession> createSession({
    String? agentId,
    String? taskId,
    required String cwd,
    String name = '',
    String? branch,
    String? stash,
    bool createBranch = false,
    String? mcpRole,
    String? anthropicAccountId,
  }) async {
    lastMcpRole = mcpRole;
    final now = DateTime.now();
    return AgentSession(
      id: 'test-session-id',
      agentId: agentId ?? '',
      name: name,
      cwd: cwd,
      status: AgentSessionStatus.idle,
      createdAt: now,
      updatedAt: now,
    );
  }

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

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
}

class _FakeGalleryDataSource extends AgentGalleryDataSource {
  _FakeGalleryDataSource(this._designs);

  final List<AgentDesign> _designs;

  @override
  Future<List<AgentDesign>> list() async => _designs;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

AgentDesign _makeDesign(String id, String title, {String? canvaUrl}) =>
    AgentDesign(
      id: id,
      title: title,
      canvaUrl: canvaUrl,
      createdAt: DateTime.fromMillisecondsSinceEpoch(0).toIso8601String(),
    );

Future<Widget> _buildApp({
  required AgentGalleryController galleryController,
  required AgentsController agentsController,
}) async {
  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentGalleryController>.value(
        value: galleryController,
      ),
      ChangeNotifierProvider<AgentsController>.value(
        value: agentsController,
      ),
    ],
    child: const MaterialApp(home: AgentGalleryView()),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late _StubAgentsRepository stubRepo;
  late AgentsController agentsController;

  setUp(() {
    stubRepo = _StubAgentsRepository();
    agentsController = AgentsController(
      stubRepo,
      _ReadyAgentServerController(),
      _FakeLocalNotificationService(),
      _FakeNotificationsController(),
    );
  });

  tearDown(() {
    agentsController.dispose();
  });

  group('AgentGalleryView', () {
    testWidgets('renders design titles from controller', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1200, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final designs = [
        _makeDesign('d1', 'Alpha Design', canvaUrl: 'https://canva.com/d/1'),
        _makeDesign('d2', 'Beta Design'),
      ];
      final dataSource = _FakeGalleryDataSource(designs);
      final galleryController = AgentGalleryController(
        AgentGalleryRepository(dataSource),
      );
      await galleryController.loadDesigns();

      await tester.pumpWidget(
        await _buildApp(
          galleryController: galleryController,
          agentsController: agentsController,
        ),
      );
      await tester.pump();

      expect(
        find.text('Alpha Design'),
        findsOneWidget,
        reason: 'Alpha Design title should render',
      );
      expect(
        find.text('Beta Design'),
        findsOneWidget,
        reason: 'Beta Design title should render',
      );

      galleryController.dispose();
    });

    testWidgets('renders empty state when designs list is empty',
        (tester) async {
      final dataSource = _FakeGalleryDataSource([]);
      final galleryController = AgentGalleryController(
        AgentGalleryRepository(dataSource),
      );
      await galleryController.loadDesigns();

      await tester.pumpWidget(
        await _buildApp(
          galleryController: galleryController,
          agentsController: agentsController,
        ),
      );
      await tester.pump();

      expect(
        find.byKey(const ValueKey('gallery-empty-state')),
        findsOneWidget,
        reason: 'Empty state should render when designs list is empty',
      );

      galleryController.dispose();
    });

    testWidgets('"Launch designer" button is present', (tester) async {
      final dataSource = _FakeGalleryDataSource([]);
      final galleryController = AgentGalleryController(
        AgentGalleryRepository(dataSource),
      );
      await galleryController.loadDesigns();

      await tester.pumpWidget(
        await _buildApp(
          galleryController: galleryController,
          agentsController: agentsController,
        ),
      );
      await tester.pump();

      expect(
        find.byKey(const ValueKey('launch-designer-btn')),
        findsOneWidget,
        reason: '"Launch designer" button should be present',
      );

      galleryController.dispose();
    });

    testWidgets('"Open in Canva" link renders for design with canvaUrl',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1200, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final designs = [
        _makeDesign('d1', 'Alpha Design', canvaUrl: 'https://canva.com/d/1'),
      ];
      final dataSource = _FakeGalleryDataSource(designs);
      final galleryController = AgentGalleryController(
        AgentGalleryRepository(dataSource),
      );
      await galleryController.loadDesigns();

      await tester.pumpWidget(
        await _buildApp(
          galleryController: galleryController,
          agentsController: agentsController,
        ),
      );
      await tester.pump();

      expect(
        find.text('Open in Canva'),
        findsOneWidget,
        reason: '"Open in Canva" link should render for design with canvaUrl',
      );

      galleryController.dispose();
    });

    testWidgets(
        'tapping launch button calls createSession with mcpRole graphic-designer',
        (tester) async {
      final dataSource = _FakeGalleryDataSource([]);
      final galleryController = AgentGalleryController(
        AgentGalleryRepository(dataSource),
      );

      await tester.pumpWidget(
        await _buildApp(
          galleryController: galleryController,
          agentsController: agentsController,
        ),
      );
      await tester.pump();

      await tester.tap(find.byKey(const ValueKey('launch-designer-btn')));
      await tester.pumpAndSettle();

      expect(
        stubRepo.lastMcpRole,
        equals('graphic-designer'),
        reason: 'createSession must be called with mcpRole graphic-designer',
      );

      galleryController.dispose();
    });

    testWidgets(
        'tapping launch button selects the new session via selectSession',
        (tester) async {
      final dataSource = _FakeGalleryDataSource([]);
      final galleryController = AgentGalleryController(
        AgentGalleryRepository(dataSource),
      );

      await tester.pumpWidget(
        await _buildApp(
          galleryController: galleryController,
          agentsController: agentsController,
        ),
      );
      await tester.pump();

      await tester.tap(find.byKey(const ValueKey('launch-designer-btn')));
      await tester.pumpAndSettle();

      expect(
        agentsController.selectedSessionId,
        equals('test-session-id'),
        reason: 'selectSession must be called with the new session id',
      );

      galleryController.dispose();
    });

    testWidgets(
        'tapping launch button stages a composer draft for the new session',
        (tester) async {
      final dataSource = _FakeGalleryDataSource([]);
      final galleryController = AgentGalleryController(
        AgentGalleryRepository(dataSource),
      );

      await tester.pumpWidget(
        await _buildApp(
          galleryController: galleryController,
          agentsController: agentsController,
        ),
      );
      await tester.pump();

      await tester.tap(find.byKey(const ValueKey('launch-designer-btn')));
      await tester.pumpAndSettle();

      expect(
        agentsController.hasComposerDraft('test-session-id'),
        isTrue,
        reason: 'setComposerDraft must be called for the new session',
      );

      galleryController.dispose();
    });
  });
}
