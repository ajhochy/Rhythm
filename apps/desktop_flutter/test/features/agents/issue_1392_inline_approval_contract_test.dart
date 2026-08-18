import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agent_cookbook/controllers/agent_cookbook_controller.dart';
import 'package:rhythm_desktop/features/agent_cookbook/data/agent_cookbook_data_source.dart';
import 'package:rhythm_desktop/features/agent_cookbook/models/cookbook_recipe.dart';
import 'package:rhythm_desktop/features/agent_cookbook/repositories/agent_cookbook_repository.dart';
import 'package:rhythm_desktop/features/agent_email/controllers/agent_email_controller.dart';
import 'package:rhythm_desktop/features/agent_email/data/agent_email_data_source.dart';
import 'package:rhythm_desktop/features/agent_email/models/gmail_signal.dart';
import 'package:rhythm_desktop/features/agent_email/repositories/agent_email_repository.dart';
import 'package:rhythm_desktop/features/agent_gallery/controllers/agent_gallery_controller.dart';
import 'package:rhythm_desktop/features/agent_gallery/data/agent_gallery_data_source.dart';
import 'package:rhythm_desktop/features/agent_gallery/models/agent_design.dart';
import 'package:rhythm_desktop/features/agent_gallery/repositories/agent_gallery_repository.dart';
import 'package:rhythm_desktop/features/agent_projects/controllers/agent_projects_controller.dart';
import 'package:rhythm_desktop/features/agent_projects/data/agent_projects_remote_data_source.dart';
import 'package:rhythm_desktop/features/agent_projects/models/agent_project.dart';
import 'package:rhythm_desktop/features/agent_projects/repositories/agent_projects_repository.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/notifications/controllers/agent_approvals_controller.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/agent_approvals_data_source.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/models/agent_approval.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';
import 'package:rhythm_desktop/features/settings/services/destructive_modal_service.dart';
import 'package:rhythm_desktop/features/tasks/controllers/tasks_controller.dart';
import 'package:rhythm_desktop/features/tasks/data/tasks_local_data_source.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/repositories/tasks_repository.dart';

class _Api extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null, failureMessage: null);
  @override
  void stop() {}
}

class _AgentServer extends AgentServerController {
  _AgentServer() : super(_Api());
  @override
  AgentServerStatus get status => AgentServerStatus.ready;
  @override
  bool get isReady => true;
  @override
  bool get hasAnyAgent => true;
  @override
  bool isAgentAvailable(String kind) => true;
}

class _AgentsRepo implements AgentsRepository {
  _AgentsRepo(this.session);
  final AgentSession session;
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
  bool send(Map<String, dynamic> message) => true;
  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async =>
      archivedOnly ? const [] : [session];
  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async =>
          (session: session, messages: const <AgentSessionMessage>[]);
  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];
  @override
  Future<void> dispose() async {
    await _messages.close();
    await _connectivity.close();
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _ApprovalsDataSource implements AgentApprovalsDataSource {
  _ApprovalsDataSource(this.items);
  List<AgentApproval> items;
  @override
  Future<List<AgentApproval>> listPending() async => items;
  @override
  Future<void> decide(AgentApproval approval, {required bool approve}) async {}
}

class _ConfigsDataSource extends AgentConfigsDataSource {
  @override
  Future<List<AgentConfig>> list() async => [
        AgentConfig(
          id: 'claude-code',
          label: 'Claude Code',
          icon: '',
          enabled: true,
          isAgent: true,
          sortOrder: 0,
        ),
      ];
}

class _ProjectsDataSource extends AgentProjectsRemoteDataSource {
  @override
  Future<List<AgentProject>> list({bool includeArchived = false}) async => [];
}

class _TasksDataSource extends TasksLocalDataSource {
  @override
  Future<List<Task>> fetchAll() async => [];
}

class _CookbookDataSource extends AgentCookbookDataSource {
  @override
  Future<List<CookbookRecipe>> list() async => [];
}

class _EmailDataSource extends AgentEmailDataSource {
  _EmailDataSource() : super(baseUrl: 'http://localhost');
  @override
  Future<List<AgentEmailGmailSignal>> listSignals() async => [];
}

class _GalleryDataSource extends AgentGalleryDataSource {
  @override
  Future<List<AgentDesign>> list() async => [];
}

AgentApproval _approval({required String id, required String sessionId}) =>
    AgentApproval.fromJson({
      'id': id,
      'sessionId': sessionId,
      'action': 'Authorize notification.send ($id)',
      'preview': 'Send a harmless approval test notification',
      'consequence': 'A local notification will be delivered',
      'status': 'pending',
      'createdAt': '2026-08-14T19:00:00.000Z',
      'decisionNonce': 'nonce-$id',
      'payloadDigest': 'digest-$id',
    });

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'issue-1392-c4: matching pending approval renders inline and nonmatching approval stays out of the transcript',
    (tester) async {
      // Regression caught: approvals only appear in the bell panel, or every
      // pending approval leaks into whichever chat happens to be open. The
      // matching action assertion and nonmatching absence assertion fail those
      // two regressions independently.
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final now = DateTime.fromMillisecondsSinceEpoch(0);
      final session = AgentSession(
        id: 'session-open',
        sdkSessionId: 'sdk-session-open',
        agentId: 'claude-code',
        name: 'Open approval chat',
        cwd: '/tmp',
        status: AgentSessionStatus.idle,
        createdAt: now,
        updatedAt: now,
      );
      final agents = AgentsController(
        _AgentsRepo(session),
        _AgentServer(),
        LocalNotificationService(),
        NotificationsController(
          NotificationsRepository(NotificationsDataSource()),
        ),
      )..setActiveSessionForTest(session.id, session);
      final approvals = AgentApprovalsController(
        _ApprovalsDataSource([
          _approval(id: 'approval-matching', sessionId: session.id),
          _approval(id: 'approval-other', sessionId: 'session-other'),
        ]),
      );
      approvals.startPolling();
      await tester.pump();
      addTearDown(agents.dispose);
      addTearDown(approvals.dispose);

      final configs = AgentConfigsController(
        AgentConfigsRepository(_ConfigsDataSource()),
      );
      await configs.refresh();

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AgentServerController>.value(
              value: _AgentServer(),
            ),
            ChangeNotifierProvider<AgentConfigsController>.value(
                value: configs),
            ChangeNotifierProvider<AgentsController>.value(value: agents),
            ChangeNotifierProvider<AgentApprovalsController>.value(
              value: approvals,
            ),
            ChangeNotifierProvider<TasksController>(
              create: (_) => TasksController(
                TasksRepository(_TasksDataSource()),
              ),
            ),
            ChangeNotifierProvider<AgentProjectsController>(
              create: (_) => AgentProjectsController(
                AgentProjectsRepository(_ProjectsDataSource()),
              ),
            ),
            ChangeNotifierProvider<DestructiveModalService>(
              create: (_) => DestructiveModalService(),
            ),
            ChangeNotifierProvider<AgentCookbookController>(
              create: (_) => AgentCookbookController(
                AgentCookbookRepository(_CookbookDataSource()),
              ),
            ),
            ChangeNotifierProvider<AgentEmailController>(
              create: (_) => AgentEmailController(
                AgentEmailRepository(_EmailDataSource()),
              ),
            ),
            ChangeNotifierProvider<AgentGalleryController>(
              create: (_) => AgentGalleryController(
                AgentGalleryRepository(_GalleryDataSource()),
              ),
            ),
          ],
          child: const MaterialApp(home: Scaffold(body: AgentsView())),
        ),
      );
      await tester.pump();
      approvals.stopPolling();

      expect(
        find.text('Authorize notification.send (approval-matching)'),
        findsOneWidget,
        reason: 'The pending approval for the open session must be composed '
            'into that session transcript as an actionable card.',
      );
      expect(
        find.text('Authorize notification.send (approval-other)'),
        findsNothing,
        reason:
            'An approval from another session must not leak into this chat.',
      );
      expect(find.widgetWithText(TextButton, 'Approve'), findsOneWidget);
      expect(find.widgetWithText(TextButton, 'Reject'), findsOneWidget);
    },
  );
}
