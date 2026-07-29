/// Regression: answering an agent "ask question" card must hang no more.
///
/// Root cause (confirmed against the running opencode 1.14.x binary): the
/// `question` (AskUserQuestion) tool is answered through opencode's dedicated
/// Question API — `POST /question/{requestID}/reply`. The card previously
/// replied with a plain `session.input` prompt, which never completes the
/// pending question, so the tool stayed `status: running` forever and the
/// session hung.
///
/// CONTRACT:
///   c1: Tapping an option calls AgentsRepository.replyQuestion (the Question
///       API path), NOT send()/session.input.
///   c2: The answer is shaped as List<List<String>> (one selected-label list
///       per question — opencode's QuestionAnswer = string[]).
///   c3: The card exposes a Dismiss affordance that calls rejectQuestion, so a
///       question can always be escaped (the agent unblocks either way).
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_question_tool_card.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Fakes
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

/// Records the question-handshake calls and asserts session.input is NOT used.
class _RecordingRepository implements AgentsRepository {
  final List<Map<String, dynamic>> sends = [];
  String? replyCallId;
  List<List<String>>? replyAnswers;
  String? rejectCallId;

  @override
  void send(Map<String, dynamic> msg) => sends.add(msg);

  @override
  Future<void> replyQuestion(
    String sessionId,
    String callId,
    List<List<String>> answers,
  ) async {
    replyCallId = callId;
    replyAnswers = answers;
  }

  @override
  Future<void> rejectQuestion(String sessionId, String callId) async {
    rejectCallId = callId;
  }

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

({AgentsController ctrl, _RecordingRepository repo}) _buildController() {
  final repo = _RecordingRepository();
  final ctrl = AgentsController(
    repo,
    _ReadyAgentServerController(),
    _FakeLocalNotificationService(),
    _FakeNotificationsController(),
  );
  return (ctrl: ctrl, repo: repo);
}

Widget _host(AgentsController ctrl, ChatPart part) {
  return ChangeNotifierProvider<AgentsController>.value(
    value: ctrl,
    child: MaterialApp(
      home: Scaffold(
        body: QuestionToolCard(part: part, sessionId: 'sid-1'),
      ),
    ),
  );
}

ChatPart _questionPart() => ChatPart(
  id: 'part-1',
  messageId: 'msg-1',
  type: 'tool',
  toolName: 'question',
  toolCallId: 'toolu_abc',
  toolArgs: const {
    'questions': [
      {
        'header': 'Test question',
        'question': 'Which option do you prefer?',
        'options': [
          {'label': 'Option A', 'description': 'first'},
          {'label': 'Option B', 'description': 'second'},
        ],
      },
    ],
  },
  toolStatus: 'running',
);

void main() {
  testWidgets(
    'c1+c2: tapping an option replies via the Question API (not session.input)',
    (tester) async {
      final h = _buildController();
      await tester.pumpWidget(_host(h.ctrl, _questionPart()));
      await tester.pump();

      await tester.tap(find.text('Option A'));
      await tester.pump();

      expect(
        h.repo.replyCallId,
        'toolu_abc',
        reason: 'the answer must go through replyQuestion keyed by tool callId',
      );
      expect(
        h.repo.replyAnswers,
        const [
          ['Option A'],
        ],
        reason:
            'answers must be List<List<String>> — one selected-label list '
            'per question (opencode QuestionAnswer = string[])',
      );
      expect(
        h.repo.sends.where((m) => m['type'] == 'session.input'),
        isEmpty,
        reason:
            'answering a question must NOT send a session.input prompt — '
            'that never completes the pending question tool (the hang bug)',
      );
    },
  );

  testWidgets('c3: Dismiss calls rejectQuestion', (tester) async {
    final h = _buildController();
    await tester.pumpWidget(_host(h.ctrl, _questionPart()));
    await tester.pump();

    await tester.tap(find.text('Dismiss'));
    await tester.pump();

    expect(h.repo.rejectCallId, 'toolu_abc');
    expect(h.repo.sends.where((m) => m['type'] == 'session.input'), isEmpty);
  });
}
