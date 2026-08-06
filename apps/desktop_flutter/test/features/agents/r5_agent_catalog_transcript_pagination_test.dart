import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/data/agents_data_source.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

class _FakeApiServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null, failureMessage: null);

  @override
  Future<void> stop() async {}
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

  @override
  Future<void> retry() async {}
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

class _PagingRepository implements AgentsRepository {
  _PagingRepository()
      : _messages = StreamController<AgentWsMessage>.broadcast(),
        _connectivity = StreamController<bool>.broadcast();

  final StreamController<AgentWsMessage> _messages;
  final StreamController<bool> _connectivity;
  final List<String?> requestedBefore = [];

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
      [_session('session-r5')];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async =>
          (session: _session(id), messages: _messagesFor(id, 51, 100));

  @override
  Future<
          ({
            List<AgentSessionMessage> messages,
            String? nextCursor,
            bool hasMore
          })>
      fetchTranscriptPage(String id, {int limit = 50, String? before}) async {
    requestedBefore.add(before);
    return (
      messages: _messagesFor(id, 1, 50),
      nextCursor: null,
      hasMore: false,
    );
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

AgentSession _session(String id) => AgentSession(
      id: id,
      agentId: 'engine-safe',
      status: AgentSessionStatus.idle,
      cwd: '/tmp/r5',
      name: 'R5 session',
      createdAt: DateTime.fromMillisecondsSinceEpoch(0),
      updatedAt: DateTime.fromMillisecondsSinceEpoch(0),
    );

List<AgentSessionMessage> _messagesFor(String sessionId, int start, int end) =>
    [
      for (var id = start; id <= end; id++)
        AgentSessionMessage(
          id: id,
          sessionId: sessionId,
          role: id.isEven ? 'output' : 'input',
          rawText: 'message-$id',
          strippedText: 'message-$id',
          createdAt: DateTime.fromMillisecondsSinceEpoch(id * 1000),
          sdkMessageId: 'msg-$id',
          parts: [
            {'type': 'text', 'text': 'message-$id'},
          ],
        ),
    ];

Map<String, dynamic> _sessionDetailJson(int messageCount) => {
      'session': {
        'id': 'session-r5',
        'agentId': 'engine-safe',
        'status': 'idle',
        'cwd': '/tmp/r5',
        'name': 'R5 session',
        'createdAt': '2026-07-30T00:00:00.000Z',
        'updatedAt': '2026-07-30T00:00:00.000Z',
      },
      'messages': [
        for (var id = 1; id <= messageCount; id++)
          {
            'id': id,
            'sessionId': 'session-r5',
            'role': id.isEven ? 'output' : 'input',
            'rawText': 'message-$id',
            'strippedText': 'message-$id',
            'createdAt': '2026-07-30T00:00:00.000Z',
            'sdkMessageId': 'msg-$id',
            'parts': [
              {'type': 'text', 'text': 'message-$id'},
            ],
            'tokens': null,
            'cost': null,
          },
      ],
      'transcriptPage': {
        'nextCursor': messageCount == 50 ? '1' : null,
        'hasMore': messageCount == 50,
      },
    };

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  test(
    'r5-c8: desktop requests the picker DTO and a 50-message recent detail',
    () async {
      // Regression caught: Flutter silently returns to the legacy 1.77 MB
      // catalog or asks session detail to serialize the unbounded transcript.
      final requests = <Uri>[];
      final client = MockClient((request) async {
        requests.add(request.url);
        if (request.url.path.endsWith('/agents')) {
          return http.Response(jsonEncode({'agents': []}), 200);
        }
        return http.Response(jsonEncode(_sessionDetailJson(50)), 200);
      });
      final dataSource = AgentsDataSource(client: client);
      addTearDown(dataSource.dispose);

      await dataSource.fetchAvailableAgents(cwd: '/tmp/r5');
      await dataSource.getSession('session-r5');

      expect(requests[0].queryParameters, {'cwd': '/tmp/r5', 'view': 'picker'});
      expect(requests[1].queryParameters['transcriptLimit'], '50');
    },
  );

  test(
    'r5-c9: controller prepends older pages without losing live messages',
    () async {
      // Regression caught: loading an older page appends it after the newest
      // message or replaces WS-streamed state accumulated after initial load.
      final repository = _PagingRepository();
      final controller = AgentsController(
        repository,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );
      addTearDown(controller.dispose);

      await controller.load();
      await controller.selectSession('session-r5');
      controller.setMessageForTest(
        ChatMessage(
          id: 'live-101',
          sessionId: 'session-r5',
          role: 'assistant',
          createdAt: DateTime.fromMillisecondsSinceEpoch(101000),
        ),
      );

      final dynamic pagingController = controller;
      expect(pagingController.hasOlderTranscript('session-r5'), isTrue);
      await pagingController.loadOlderTranscript('session-r5');

      final ids =
          controller.chatMessagesFor('session-r5').map((message) => message.id);
      expect(ids.first, 'msg-1');
      expect(ids.last, 'live-101');
      expect(ids.toSet(), hasLength(101));
      expect(repository.requestedBefore, ['51']);
      expect(pagingController.hasOlderTranscript('session-r5'), isFalse);
    },
  );

  test(
    'r5-c10: large session JSON uses an isolate and the UI exposes paging',
    () {
      // Regression caught: a multi-megabyte response is jsonDecoded on the UI
      // isolate, or the controller has pagination but no user-triggerable affordance.
      final dataSource = File(
        'lib/features/agents/data/agents_data_source.dart',
      ).readAsStringSync();
      final view = File(
        'lib/features/agents/views/agents_view.dart',
      ).readAsStringSync();

      expect(dataSource, contains('compute('));
      expect(dataSource, contains('largeJsonDecodeThresholdBytes'));
      expect(view, contains("Key('load-older-transcript-button')"));
    },
  );
}
