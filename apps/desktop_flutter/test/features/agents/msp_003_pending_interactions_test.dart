/// MSP-003 acceptance contract for acknowledgement-based desktop cards.
///
/// Regression caught: both cards switched to a terminal/hidden state before
/// the server confirmed the engine reply. A failed reply therefore erased the
/// only retry affordance and left the engine blocked.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_permission_card.dart';
import 'package:rhythm_desktop/features/agents/views/_question_tool_card.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';
import 'package:rhythm_desktop/features/settings/services/destructive_modal_service.dart';

class _FakeApiServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null, failureMessage: null);

  @override
  Future<void> stop() async {}
}

class _ReadyServerController extends AgentServerController {
  _ReadyServerController() : super(_FakeApiServerService());

  @override
  bool get isReady => true;

  @override
  bool get hasAnyAgent => true;

  @override
  Future<void> initialize() async {}
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

class _ControlledRepository implements AgentsRepository {
  Completer<void> permission = Completer<void>();
  Completer<void> question = Completer<void>();

  @override
  Future<void> respondPermission(
    String sessionId,
    String permissionId,
    String decision, {
    String? message,
  }) =>
      permission.future;

  @override
  Future<void> replyQuestion(
    String sessionId,
    String callId,
    List<List<String>> answers,
  ) =>
      question.future;

  @override
  Future<void> rejectQuestion(String sessionId, String callId) =>
      question.future;

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

AgentsController _controller(_ControlledRepository repository) =>
    AgentsController(
      repository,
      _ReadyServerController(),
      LocalNotificationService(),
      _FakeNotificationsController(),
    );

Widget _permissionHost(AgentsController controller) => MultiProvider(
      providers: [
        ChangeNotifierProvider<AgentsController>.value(value: controller),
        ChangeNotifierProvider<DestructiveModalService>(
          create: (_) => DestructiveModalService(),
        ),
      ],
      child: const MaterialApp(
        home: Scaffold(
          body: PermissionCard(
            sessionId: 'local-1',
            permissionId: 'per-1',
            title: 'Allow edit?',
            toolName: 'read',
          ),
        ),
      ),
    );

ChatPart _questionPart() => ChatPart(
      id: 'part-1',
      messageId: 'message-1',
      type: 'tool',
      toolName: 'question',
      toolCallId: 'call-1',
      toolStatus: 'running',
      toolArgs: const {
        'questions': [
          {
            'header': 'Choice',
            'question': 'Which option?',
            'options': [
              {'label': 'A', 'description': 'first'},
            ],
          },
        ],
      },
    );

Widget _questionHost(AgentsController controller) =>
    ChangeNotifierProvider<AgentsController>.value(
      value: controller,
      child: MaterialApp(
        home: Scaffold(
          body: QuestionToolCard(part: _questionPart(), sessionId: 'local-1'),
        ),
      ),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'issue-3-c9: permission card remains until acknowledgement and retries after failure',
    (tester) async {
      final repository = _ControlledRepository();
      final controller = _controller(repository);
      addTearDown(controller.dispose);
      await tester.pumpWidget(_permissionHost(controller));

      await tester.tap(find.text('Accept'));
      await tester.pump();
      expect(find.text('Allow edit?'), findsOneWidget);

      repository.permission.completeError(StateError('engine unavailable'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Allow edit?'), findsOneWidget);
      expect(find.textContaining('engine unavailable'), findsOneWidget);
      expect(find.text('Accept'), findsOneWidget);
    },
  );

  testWidgets(
    'issue-3-c10: question card remains until acknowledgement and retries after failure',
    (tester) async {
      final repository = _ControlledRepository();
      final controller = _controller(repository);
      addTearDown(controller.dispose);
      await tester.pumpWidget(_questionHost(controller));

      await tester.tap(find.text('A'));
      await tester.pump();
      expect(find.text('Which option?'), findsOneWidget);

      repository.question.completeError(StateError('reply failed'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Which option?'), findsOneWidget);
      expect(find.textContaining('reply failed'), findsOneWidget);
      expect(find.text('A'), findsOneWidget);
    },
  );
}
