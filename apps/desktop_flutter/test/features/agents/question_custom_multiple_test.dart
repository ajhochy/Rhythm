/// OCU-06 (#1047): QuestionToolCard honors per-question `custom` (free-text)
/// and `multiple` (multi-select) flags on the REAL mounted card.
///
/// CONTRACT (asserts the reply payload shape string[][] via the Question API):
///   - single-select, custom=false: one-tap fast path, no Submit button.
///   - single-select, custom=true : "Other…" expands a text field; the typed
///     string reaches the agent verbatim.
///   - multiple=true, custom=false: 0..n options staged, Submit sends the set.
///   - multiple=true, custom=true : options + custom string in one submission.
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

class _RecordingRepository implements AgentsRepository {
  final List<Map<String, dynamic>> sends = [];
  String? replyCallId;
  List<List<String>>? replyAnswers;

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
  Future<void> rejectQuestion(String sessionId, String callId) async {}

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

ChatPart _part({
  required bool multiple,
  required bool custom,
}) =>
    ChatPart(
      id: 'part-1',
      messageId: 'msg-1',
      type: 'tool',
      toolName: 'question',
      toolCallId: 'toolu_abc',
      toolArgs: {
        'questions': [
          {
            'header': 'Pick',
            'question': 'Which?',
            'multiple': multiple,
            'custom': custom,
            'options': const [
              {'label': 'Option A'},
              {'label': 'Option B'},
            ],
          }
        ],
      },
      toolStatus: 'running',
    );

void main() {
  testWidgets(
    'single-select custom=false: one-tap fast path, no Submit button',
    (tester) async {
      final h = _buildController();
      await tester
          .pumpWidget(_host(h.ctrl, _part(multiple: false, custom: false)));
      await tester.pump();

      // custom=false hides free-text.
      expect(find.byKey(const ValueKey('question-other-chip')), findsNothing);
      // no staged Submit for a lone single-select.
      expect(find.textContaining('Submit'), findsNothing);

      await tester.tap(find.text('Option A'));
      await tester.pump();

      expect(h.repo.replyCallId, 'toolu_abc');
      expect(h.repo.replyAnswers, const [
        ['Option A']
      ]);
    },
  );

  testWidgets(
    'single-select custom=true: Other… expands text field, typed answer reaches agent',
    (tester) async {
      final h = _buildController();
      await tester
          .pumpWidget(_host(h.ctrl, _part(multiple: false, custom: true)));
      await tester.pump();

      // "Other…" affordance present for custom=true.
      final other = find.byKey(const ValueKey('question-other-chip'));
      expect(other, findsOneWidget);

      await tester.tap(other);
      await tester.pump();

      await tester.enterText(
        find.byKey(const ValueKey('question-custom-field')),
        'my typed answer',
      );
      await tester.pump();

      // Submit appears (custom-only staged flow) and is enabled once typed.
      await tester.tap(find.textContaining('Submit'));
      await tester.pump();

      expect(h.repo.replyAnswers, const [
        ['my typed answer']
      ]);
    },
  );

  testWidgets(
    'multiple=true custom=false: 0..n options staged then submitted',
    (tester) async {
      final h = _buildController();
      await tester
          .pumpWidget(_host(h.ctrl, _part(multiple: true, custom: false)));
      await tester.pump();

      expect(find.byKey(const ValueKey('question-other-chip')), findsNothing);

      // Tapping options should NOT auto-submit for multi-select.
      await tester.tap(find.text('Option A'));
      await tester.pump();
      await tester.tap(find.text('Option B'));
      await tester.pump();
      expect(h.repo.replyAnswers, isNull,
          reason: 'multi-select stages until explicit Submit');

      await tester.tap(find.textContaining('Submit'));
      await tester.pump();

      expect(h.repo.replyAnswers, const [
        ['Option A', 'Option B']
      ]);
    },
  );

  testWidgets(
    'multiple=true custom=true: options + custom string in one submission',
    (tester) async {
      final h = _buildController();
      await tester
          .pumpWidget(_host(h.ctrl, _part(multiple: true, custom: true)));
      await tester.pump();

      await tester.tap(find.text('Option A'));
      await tester.pump();

      await tester.tap(find.byKey(const ValueKey('question-other-chip')));
      await tester.pump();
      await tester.enterText(
        find.byKey(const ValueKey('question-custom-field')),
        'extra note',
      );
      await tester.pump();

      await tester.tap(find.textContaining('Submit'));
      await tester.pump();

      expect(h.repo.replyAnswers, const [
        ['Option A', 'extra note']
      ]);
    },
  );
}
