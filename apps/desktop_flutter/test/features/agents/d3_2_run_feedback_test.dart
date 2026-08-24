/// D3.2 — explicit run feedback (thumbs up/down/partial) on the Context tab.
///
/// Pumps the REAL AgentsView with a selected session so SessionSidePanel
/// mounts and the Context tab (default) renders the new
/// `_RunFeedbackSection`. Mirrors the harness in
/// `inspector_context_mounted_test.dart`; the only faked boundary is
/// [AgentsRepository].
///
/// Covers:
///  - no recorded outcome yet -> feedback controls stay hidden (never a
///    control that would 404 on tap);
///  - a recorded outcome with no explicit feedback yet -> controls visible,
///    no "Marked:" verdict shown;
///  - a recorded outcome with a prior explicit verdict -> that verdict is
///    shown, read from the latest explicit_user event;
///  - tapping a different verdict submits a NEW event (append-only) and the
///    displayed verdict updates to match;
///  - the buttons disable while a submission is in flight and a confirmation
///    snackbar shows on success;
///  - a server refusal surfaces its own message, not a generic failure;
///  - an optional reason typed before tapping a verdict is sent along with
///    it, and leaving it blank sends no reason at all.
///
/// Run with:
///   flutter test test/features/agents/d3_2_run_feedback_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/errors/app_error.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/run_outcome_feedback.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/agent_projects/controllers/agent_projects_controller.dart';
import 'package:rhythm_desktop/features/agent_projects/data/agent_projects_remote_data_source.dart';
import 'package:rhythm_desktop/features/agent_projects/models/agent_project.dart';
import 'package:rhythm_desktop/features/agent_projects/repositories/agent_projects_repository.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';
import 'package:rhythm_desktop/features/settings/services/destructive_modal_service.dart';
import 'package:rhythm_desktop/features/tasks/controllers/tasks_controller.dart';
import 'package:rhythm_desktop/features/tasks/data/tasks_local_data_source.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/repositories/tasks_repository.dart';

// ---------------------------------------------------------------------------
// Stubs / fakes (mirror inspector_context_mounted_test.dart)
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

/// Fake [AgentsRepository] whose run-outcome-feedback methods are
/// controllable per test; every other member falls through to
/// [noSuchMethod] since this file never exercises them.
class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository();

  final StreamController<AgentWsMessage> _msgCtrl =
      StreamController<AgentWsMessage>.broadcast();
  final StreamController<bool> _connCtrl = StreamController<bool>.broadcast();

  /// Keyed by session id. Absent means the server has no outcome recorded
  /// (GET returns 404 -> data source returns null).
  final Map<String, RunOutcomeFeedback?> outcomeBySession = {};

  /// If set, throws this for every postRunFeedback call instead of recording it.
  AppError? postFeedbackError;

  /// If set, postRunFeedback awaits this before proceeding — lets a test
  /// inspect the in-flight (submitting) UI state before letting it resolve.
  Completer<void>? postFeedbackGate;

  final List<RunFeedbackVerdict> postedVerdicts = [];
  final List<String?> postedReasons = [];
  final List<String> postedSessionIds = [];

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
      getSession(String id) async => (
            session: _makeSession(id),
            messages: const <AgentSessionMessage>[],
          );

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

  @override
  Future<RunOutcomeFeedback?> fetchRunOutcomeFeedback(String id) async =>
      outcomeBySession[id];

  @override
  Future<void> postRunFeedback(
    String id,
    RunFeedbackVerdict verdict, {
    String? reason,
  }) async {
    if (postFeedbackGate != null) await postFeedbackGate!.future;
    if (postFeedbackError != null) throw postFeedbackError!;
    postedVerdicts.add(verdict);
    postedReasons.add(reason);
    postedSessionIds.add(id);
    outcomeBySession[id] = RunOutcomeFeedback(explicitUserVerdict: verdict);
  }

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

  @override
  void pushAgentNotification({
    required int id,
    required String title,
    required String body,
  }) {}
}

class _FakeAgentConfigsDataSource extends AgentConfigsDataSource {
  _FakeAgentConfigsDataSource(this._configs);

  final List<AgentConfig> _configs;

  @override
  Future<List<AgentConfig>> list() async => _configs;
}

class _EmptyAgentProjectsRemote extends AgentProjectsRemoteDataSource {
  _EmptyAgentProjectsRemote() : super();

  @override
  Future<List<AgentProject>> list({bool includeArchived = false}) async =>
      const [];
}

class _EmptyTasksLocalDataSource extends TasksLocalDataSource {
  @override
  Future<List<Task>> fetchAll() async => [];
}

// ---------------------------------------------------------------------------

final _kCreated = DateTime(2026, 6, 1, 9, 30);
final _kUpdated = DateTime(2026, 6, 2, 14, 15);

AgentSession _makeSession(String id) => AgentSession(
      id: id,
      agentId: 'claude-code',
      name: 'Test Session',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      providerId: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      createdAt: _kCreated,
      updatedAt: _kUpdated,
    );

final _claudeCodeConfig = AgentConfig(
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'assets/icons/claude_code.png',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
);

Future<Widget> _buildTestApp(
    {required AgentsController agentsController}) async {
  final agentServerController = _ReadyAgentServerController();
  final agentConfigsController = AgentConfigsController(
    AgentConfigsRepository(_FakeAgentConfigsDataSource([_claudeCodeConfig])),
  );
  await agentConfigsController.refresh();

  final tasksController = TasksController(
    TasksRepository(_EmptyTasksLocalDataSource()),
  );
  final agentProjectsController = AgentProjectsController(
    AgentProjectsRepository(_EmptyAgentProjectsRemote()),
  );

  return MultiProvider(
    providers: [
      ChangeNotifierProvider<AgentServerController>.value(
        value: agentServerController,
      ),
      ChangeNotifierProvider<AgentConfigsController>.value(
        value: agentConfigsController,
      ),
      ChangeNotifierProvider<AgentsController>.value(
        value: agentsController,
      ),
      ChangeNotifierProvider<TasksController>.value(value: tasksController),
      ChangeNotifierProvider<AgentProjectsController>.value(
        value: agentProjectsController,
      ),
      ChangeNotifierProvider<DestructiveModalService>(
        create: (_) => DestructiveModalService(),
      ),
    ],
    child: const MaterialApp(home: Scaffold(body: AgentsView())),
  );
}

Future<AgentsController> _pumpWithOutcome(
  WidgetTester tester,
  _StubAgentsRepository repo, {
  required String sessionId,
}) async {
  await tester.binding.setSurfaceSize(const Size(1600, 900));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  final controller = AgentsController(
    repo,
    _ReadyAgentServerController(),
    _FakeLocalNotificationService(),
    _FakeNotificationsController(),
  );

  await tester.runAsync(() async {
    await controller.initialize();
    controller.setActiveSessionForTest(sessionId, _makeSession(sessionId));
  });

  await tester.pumpWidget(await _buildTestApp(agentsController: controller));
  await tester.pump();
  // The inspector panel defaults to collapsed; expand it after the initial
  // pump (mirrors inspector_context_mounted_test.dart's ordering note).
  await controller.setPanelCollapsed(false);
  await tester.pump();
  // Flush the postFrameCallback-triggered fetchRunOutcomeFeedback.
  await tester.pump();
  return controller;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets(
    'hides the feedback controls when the run has no recorded outcome yet',
    (tester) async {
      final repo = _StubAgentsRepository();
      // No entry in outcomeBySession -> fetchRunOutcomeFeedback returns null.
      final controller = await _pumpWithOutcome(tester, repo, sessionId: 's1');

      expect(find.byKey(const ValueKey('run-feedback-success')), findsNothing);
      expect(find.byKey(const ValueKey('run-feedback-partial')), findsNothing);
      expect(find.byKey(const ValueKey('run-feedback-failure')), findsNothing);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );

  testWidgets(
    'shows success/partial/failure controls once an outcome is recorded, '
    'with no verdict displayed yet',
    (tester) async {
      final repo = _StubAgentsRepository()
        ..outcomeBySession['s1'] = const RunOutcomeFeedback();
      final controller = await _pumpWithOutcome(tester, repo, sessionId: 's1');

      expect(
        find.byKey(const ValueKey('run-feedback-success')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('run-feedback-partial')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('run-feedback-failure')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey('run-feedback-current-verdict')),
        findsNothing,
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );

  testWidgets(
    'displays the latest explicit verdict and lets it be changed '
    '(append-only)',
    (tester) async {
      final repo = _StubAgentsRepository()
        ..outcomeBySession['s1'] = const RunOutcomeFeedback(
          explicitUserVerdict: RunFeedbackVerdict.success,
        );
      final controller = await _pumpWithOutcome(tester, repo, sessionId: 's1');

      expect(
        tester
            .widget<Text>(
              find.byKey(const ValueKey('run-feedback-current-verdict')),
            )
            .data,
        'Marked: Success',
      );

      await tester.tap(find.byKey(const ValueKey('run-feedback-partial')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(repo.postedVerdicts, [RunFeedbackVerdict.partial]);
      expect(
        tester
            .widget<Text>(
              find.byKey(const ValueKey('run-feedback-current-verdict')),
            )
            .data,
        'Marked: Partial',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );

  testWidgets(
    'shows a confirmation snackbar and disables buttons while a submission '
    'is in flight',
    (tester) async {
      final completer = Completer<void>();
      final repo = _StubAgentsRepository()
        ..outcomeBySession['s1'] = const RunOutcomeFeedback()
        ..postFeedbackGate = completer;
      final controller = await _pumpWithOutcome(tester, repo, sessionId: 's1');

      await tester.tap(find.byKey(const ValueKey('run-feedback-success')));
      await tester.pump();

      final button = tester.widget<IconButton>(
        find.byKey(const ValueKey('run-feedback-success')),
      );
      expect(button.onPressed, isNull,
          reason: 'buttons must disable while the submission is in flight');

      completer.complete();
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(find.widgetWithText(SnackBar, 'Feedback saved'), findsOneWidget);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );

  testWidgets(
    'a server refusal surfaces its own message, not a generic failure',
    (tester) async {
      final repo = _StubAgentsRepository()
        ..outcomeBySession['s1'] = const RunOutcomeFeedback()
        ..postFeedbackError = AppError(
          'This run has no recorded outcome yet, so feedback cannot be saved.',
          code: 'NOT_FOUND',
          statusCode: 404,
        );
      final controller = await _pumpWithOutcome(tester, repo, sessionId: 's1');

      await tester.tap(find.byKey(const ValueKey('run-feedback-failure')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(
        find.widgetWithText(
          SnackBar,
          'This run has no recorded outcome yet, so feedback cannot be saved.',
        ),
        findsOneWidget,
      );
      // Nothing was recorded — the verdict display stays absent.
      expect(
        find.byKey(const ValueKey('run-feedback-current-verdict')),
        findsNothing,
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );

  testWidgets(
    'a reason typed before tapping a verdict is sent along with it',
    (tester) async {
      final repo = _StubAgentsRepository()
        ..outcomeBySession['s1'] = const RunOutcomeFeedback();
      final controller = await _pumpWithOutcome(tester, repo, sessionId: 's1');

      await tester.enterText(
        find.byKey(const ValueKey('run-feedback-reason')),
        'Fixed it but had to retry twice',
      );
      await tester.tap(find.byKey(const ValueKey('run-feedback-partial')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(repo.postedVerdicts, [RunFeedbackVerdict.partial]);
      expect(repo.postedReasons, ['Fixed it but had to retry twice']);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );

  testWidgets(
    'leaving the reason blank sends no reason',
    (tester) async {
      final repo = _StubAgentsRepository()
        ..outcomeBySession['s1'] = const RunOutcomeFeedback();
      final controller = await _pumpWithOutcome(tester, repo, sessionId: 's1');

      await tester.tap(find.byKey(const ValueKey('run-feedback-success')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(repo.postedVerdicts, [RunFeedbackVerdict.success]);
      expect(repo.postedReasons, [null]);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );

  testWidgets(
    'a reason typed for one session is cleared on session switch and never '
    'posted against a different session',
    (tester) async {
      final repo = _StubAgentsRepository()
        ..outcomeBySession['s1'] = const RunOutcomeFeedback()
        ..outcomeBySession['s2'] = const RunOutcomeFeedback();
      final controller = await _pumpWithOutcome(tester, repo, sessionId: 's1');

      await tester.enterText(
        find.byKey(const ValueKey('run-feedback-reason')),
        'leaked reason meant for session A',
      );
      await tester.pump();
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('run-feedback-reason')),
            )
            .controller!
            .text,
        'leaked reason meant for session A',
      );

      // Switch the mounted view to a different session, as a real
      // session-list selection would.
      controller.setActiveSessionForTest('s2', _makeSession('s2'));
      await tester.pump();
      // Flush the postFrameCallback-triggered fetchRunOutcomeFeedback for s2.
      await tester.pump();

      // The reason field must already be empty for the new session, before
      // any submission happens.
      expect(
        tester
            .widget<TextField>(
              find.byKey(const ValueKey('run-feedback-reason')),
            )
            .controller!
            .text,
        isEmpty,
      );

      await tester.tap(find.byKey(const ValueKey('run-feedback-success')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      expect(repo.postedSessionIds, ['s2']);
      expect(repo.postedVerdicts, [RunFeedbackVerdict.success]);
      expect(
        repo.postedReasons,
        [null],
        reason: "session A's reason must never be attached to session B's "
            'feedback submission',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    },
  );
}
