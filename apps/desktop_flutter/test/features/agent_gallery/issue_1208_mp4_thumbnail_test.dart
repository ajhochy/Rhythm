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

class _GallerySource extends AgentGalleryDataSource {
  _GallerySource(this.design);

  final AgentDesign design;

  @override
  Future<List<AgentDesign>> list() async => [design];
}

class _ServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null, failureMessage: null);

  @override
  void stop() {}
}

class _ServerController extends AgentServerController {
  _ServerController() : super(_ServerService());

  @override
  AgentServerStatus get status => AgentServerStatus.ready;

  @override
  bool get isReady => true;

  @override
  bool get hasAnyAgent => true;

  @override
  Future<void> initialize() async {}
}

class _AgentsRepository implements AgentsRepository {
  final _messages = StreamController<AgentWsMessage>.broadcast();
  final _connectivity = StreamController<bool>.broadcast();

  @override
  Stream<AgentWsMessage> get messages => _messages.stream;

  @override
  Stream<bool> get connectivityStream => _connectivity.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _messages.close();
    await _connectivity.close();
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
      getSession(String id) => throw UnimplementedError();

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
    bool isolateWorktree = false,
    String? worktreeName,
  }) =>
      throw UnimplementedError();

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _NotificationService extends LocalNotificationService {
  @override
  Future<void> showMessageNotification({
    required int id,
    required String title,
    required String body,
  }) async {}
}

class _NotificationsController extends NotificationsController {
  _NotificationsController()
      : super(NotificationsRepository(NotificationsDataSource()));
}

AgentDesign _design({String? artifactUrl}) => AgentDesign(
      id: 'video-1',
      title: 'Sunday recap',
      provider: 'built-in',
      artifactUrl: artifactUrl,
      artifactType: 'mp4',
      createdAt: DateTime.fromMillisecondsSinceEpoch(0).toIso8601String(),
    );

Future<void> _pumpGallery(WidgetTester tester, AgentDesign design) async {
  final gallery = AgentGalleryController(
    AgentGalleryRepository(_GallerySource(design)),
  );
  await gallery.loadDesigns();
  final agents = AgentsController(
    _AgentsRepository(),
    _ServerController(),
    _NotificationService(),
    _NotificationsController(),
  );
  addTearDown(gallery.dispose);
  addTearDown(agents.dispose);
  await tester.binding.setSurfaceSize(const Size(900, 700));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: gallery),
        ChangeNotifierProvider.value(value: agents),
      ],
      child: const MaterialApp(home: AgentGalleryView()),
    ),
  );
  await tester.pump();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'issue-1208-c1: local MP4 card renders its authenticated poster-frame route',
    (tester) async {
      // Regression caught: MP4 remains a generic placeholder; this network
      // image assertion fails when the card never requests a poster frame.
      await _pumpGallery(tester, _design());

      final image = tester.widget<Image>(
        find.byKey(const ValueKey('gallery-poster-video-1')),
      );
      expect(
        (image.image as NetworkImage).url,
        endsWith('/agent-designs/video-1/thumbnail'),
      );
    },
  );

  testWidgets(
    'issue-1208-c3: remote MP4 records never render a thumbnail network image',
    (tester) async {
      // Regression caught: an untrusted remote artifact/thumbnail is fetched;
      // the poster key must remain absent for remote records.
      await _pumpGallery(
        tester,
        _design(artifactUrl: 'https://untrusted.example/video.mp4'),
      );

      expect(
        find.byKey(const ValueKey('gallery-poster-video-1')),
        findsNothing,
      );
    },
  );

  testWidgets(
    'issue-1208-c4: local MP4 open action remains bound to the artifact route',
    (tester) async {
      // Regression caught: poster URL replaces the deliverable target; the
      // action's stable key identifies its original artifact route binding.
      await _pumpGallery(tester, _design());

      expect(
        find.byKey(
          const ValueKey(
            'gallery-open-/agent-designs/video-1/artifact',
          ),
        ),
        findsOneWidget,
      );
    },
  );
}
