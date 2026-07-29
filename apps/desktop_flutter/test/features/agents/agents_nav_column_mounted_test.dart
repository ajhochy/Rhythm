/// Mounted-surface test for the Odysseus-style AgentsNavColumn (Phase A + B + B2/C3/D2).
///
/// Pumps the REAL AgentsView with a real provider tree and asserts:
///   1. The nav column renders (key: 'agents-nav-column').
///   2. The CHATS section label is present.
///   3. A session row renders when the controller has sessions.
///   4. The "By Project" selector is present (key: 'by-project-selector').
///   5. The Search field filters rows — a non-matching query hides a session.
///   6. Each TOOLS row (Brain, Deep Research, Tasks, Webhooks, Profiles,
///      Cookbook, Email, Gallery) is found by its key.
///   7. The footer Settings affordance is present (key: 'nav-col-settings').
///   8. [RICH ROW CONTRACT] Session rows show a MODEL BADGE (agent kind pill)
///      — locks rich SessionRow rendering so it cannot silently regress to
///      lean inline rows that omit the badge.
///   9. [RICH ROW CONTRACT] The Archived section header renders in the CHATS
///      body (key: 'archived-section-header') — ensures SessionListBody is
///      mounted, not a plain list.
///
/// Run with:
///   flutter test test/features/agents/agents_nav_column_mounted_test.dart
library;

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
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/data/agent_models_data_source.dart';
import 'package:rhythm_desktop/features/agents/models/agent_model_route.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/catalog_model_entry.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/agents/views/_session_list_body.dart';
import 'package:rhythm_desktop/app/core/layout/navigation_sidebar.dart';
import 'package:rhythm_desktop/features/messages/controllers/messages_controller.dart';
import 'package:rhythm_desktop/features/messages/data/messages_data_source.dart';
import 'package:rhythm_desktop/features/messages/repositories/messages_repository.dart';
import 'package:rhythm_desktop/features/session_history/controllers/session_history_controller.dart';
import 'package:rhythm_desktop/features/session_history/data/session_history_data_source.dart';
import 'package:rhythm_desktop/features/session_history/models/session_transcript_message.dart';
import 'package:rhythm_desktop/features/session_history/repositories/session_history_repository.dart';
import 'package:rhythm_desktop/features/session_history/views/session_history_view.dart';
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

// ---------------------------------------------------------------------------
// Stubs / fakes (mirrored from inspector_collapse_mounted_test.dart)
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

class _StubAgentsRepository implements AgentsRepository {
  final List<AgentSession> _sessions;

  _StubAgentsRepository(this._sessions);

  final List<({AgentSession session, List<AgentSessionMessage> messages})>
      getSessionResults = [];

  final StreamController<AgentWsMessage> _msgCtrl =
      StreamController<AgentWsMessage>.broadcast();
  final StreamController<bool> _connCtrl = StreamController<bool>.broadcast();

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

  /// Captures the last scope passed to [listSessions] so tests can assert the
  /// `?scope=` param (#1025).
  String? lastScope;

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async {
    if (!archivedOnly) lastScope = scope;
    return archivedOnly ? const [] : _sessions;
  }

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async {
    if (getSessionResults.isNotEmpty) return getSessionResults.removeAt(0);
    return (
      session: _sessions.firstWhere((s) => s.id == id),
      messages: const <AgentSessionMessage>[],
    );
  }

  @override
  Future<List<Map<String, dynamic>>> fetchSessionDiff(String id) async =>
      const [];

  /// #903 — supports the rename test below. Mutates the in-memory session
  /// list so a subsequent read reflects the new name, mirroring the real
  /// repository's PATCH-then-return-updated-row contract.
  @override
  Future<AgentSession> updateSession(
    String id, {
    String? name,
    String? providerId,
    String? modelId,
    bool clearProvider = false,
    bool clearModel = false,
    String? permissionMode,
    bool? fastMode,
    String? anthropicAccountId,
    String? agentId,
  }) async {
    final index = _sessions.indexWhere((s) => s.id == id);
    final updated = _sessions[index].copyWith(name: name);
    _sessions[index] = updated;
    return updated;
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

class _EmptyCookbookDataSource extends AgentCookbookDataSource {
  @override
  Future<List<CookbookRecipe>> list() async => [];
}

class _EmptyEmailDataSource extends AgentEmailDataSource {
  _EmptyEmailDataSource() : super(baseUrl: 'http://localhost');

  @override
  Future<List<AgentEmailGmailSignal>> listSignals() async => [];
}

class _EmptyGalleryDataSource extends AgentGalleryDataSource {
  @override
  Future<List<AgentDesign>> list() async => [];
}

/// selectSession() fires `_loadModelRoutes` fire-and-forget (uncaught) — a
/// real HTTP call. Inject an empty models data source so the row-tap tests
/// that open the interactive detail don't raise an unhandled network error.
class _EmptyModelsDataSource extends AgentModelsDataSource {
  @override
  Future<List<AgentModelRoute>> fetchRoutes(String agentId) async => const [];

  @override
  Future<List<CatalogModelEntry>> fetchCatalog() async => const [];
}

/// #1027 (USO A4) — fake that returns a canned transcript so the reused
/// [SessionTranscriptView] renders a message without a live backend.
class _FakeSessionHistoryController extends SessionHistoryController {
  _FakeSessionHistoryController()
      : super(SessionHistoryRepository(SessionHistoryDataSource()));

  final _msgs = <SessionTranscriptMessage>[
    SessionTranscriptMessage(
      id: 1,
      sessionId: 'any',
      role: 'output',
      text: 'Scheduled run transcript line',
      createdAt: DateTime.fromMillisecondsSinceEpoch(0),
    ),
  ];

  @override
  Future<void> loadTranscript(String sessionId) async {}

  @override
  List<SessionTranscriptMessage> transcriptFor(String sessionId) => _msgs;
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

AgentSession _makeSession(String id, String name) => AgentSession(
      id: id,
      agentId: 'claude-code',
      name: name,
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

/// A session carrying (or lacking) an `sdkSessionId` — drives the composer
/// resumability gate. A run with an sdkSessionId can be continued (WS input
/// auto-resumes via that id); one without is a legacy/dead row.
AgentSession _makeRunSession(
  String id,
  String name, {
  required bool hasSdk,
  AgentSessionStatus status = AgentSessionStatus.idle,
}) =>
    AgentSession(
      id: id,
      agentId: 'claude-code',
      name: name,
      cwd: '/tmp',
      status: status,
      sdkSessionId: hasSdk ? 'sdk-$id' : null,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

final _claudeCodeConfig = AgentConfig(
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'assets/icons/claude_code.png',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
);

Future<Widget> _buildTestApp(AgentsController agentsController) async {
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
      ChangeNotifierProvider<AgentCookbookController>(
        create: (_) => AgentCookbookController(
          AgentCookbookRepository(_EmptyCookbookDataSource()),
        ),
      ),
      ChangeNotifierProvider<AgentEmailController>(
        create: (_) => AgentEmailController(
          AgentEmailRepository(_EmptyEmailDataSource()),
        ),
      ),
      ChangeNotifierProvider<AgentGalleryController>(
        create: (_) => AgentGalleryController(
          AgentGalleryRepository(_EmptyGalleryDataSource()),
        ),
      ),
      // #1027 (USO A4) — the reused transcript detail view resolves this.
      ChangeNotifierProvider<SessionHistoryController>(
        create: (_) => _FakeSessionHistoryController(),
      ),
    ],
    child: const MaterialApp(home: Scaffold(body: AgentsView())),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  /// Creates a controller with sessions already set via [setActiveSessionForTest],
  /// avoiding [initialize()] (which starts a periodic timer that fires after tests).
  ///
  /// Uses [setActiveSessionForTest] with only the id (no session object) after
  /// accumulating sessions via the two-arg form, so all sessions are in _sessions
  /// but the last call that specifies a session object will also mark it selected.
  /// To avoid duplicate text from SessionSidePanel, pass an id that is not in the
  /// list to clear selection — but there's no public API for that.
  ///
  /// Therefore tests asserting session text should use [findsWidgets] / at-least-1
  /// when sessions exist, since the SessionSidePanel may also render the selected
  /// session's name.
  AgentsController _makeControllerWithSessions(List<AgentSession> sessions) {
    final repo = _StubAgentsRepository(sessions);
    final controller = AgentsController(
      repo,
      _ReadyAgentServerController(),
      _FakeLocalNotificationService(),
      _FakeNotificationsController(),
    );
    // Inject sessions. The last call sets selectedSessionId to the last session id.
    for (final s in sessions) {
      controller.setActiveSessionForTest(s.id, s);
    }
    return controller;
  }

  group('AgentsNavColumn — mounted surface', () {
    testWidgets('nav column renders with CHATS section and session list',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final sessions = [
        _makeSession('s1', 'Alpha Session'),
        _makeSession('s2', 'Beta Session'),
      ];
      final controller = _makeControllerWithSessions(sessions);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // (1) Nav column renders
      expect(
        find.byKey(const ValueKey('agents-nav-column')),
        findsOneWidget,
        reason: 'Agents nav column should render',
      );

      // (2) CHATS section label present
      expect(
        find.text('CHATS'),
        findsOneWidget,
        reason: 'CHATS section label should be present',
      );

      // (3) Session rows render (use at-least-1 since the selected session's
      // name may also appear in the SessionSidePanel header).
      expect(
        find.text('Alpha Session'),
        findsAtLeastNWidgets(1),
        reason: 'Session row Alpha Session should render',
      );
      expect(
        find.text('Beta Session'),
        findsAtLeastNWidgets(1),
        reason: 'Session row Beta Session should render',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    testWidgets('"By Project" selector is present', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final controller = _makeControllerWithSessions([]);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // (4) By Project selector present
      expect(
        find.byKey(const ValueKey('by-project-selector')),
        findsOneWidget,
        reason: '"By Project" dropdown selector should render in CHATS',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    testWidgets('Search field filters session rows', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final sessions = [
        _makeSession('s1', 'Alpha Session'),
        _makeSession('s2', 'Beta Session'),
      ];
      final controller = _makeControllerWithSessions(sessions);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // Both sessions visible in the nav column initially.
      // (use descendant to scope to the nav column, avoiding inspector panel)
      final navCol = find.byKey(const ValueKey('agents-nav-column'));
      expect(
        find.descendant(of: navCol, matching: find.text('Alpha Session')),
        findsOneWidget,
        reason: 'Alpha Session should be visible in nav column initially',
      );
      expect(
        find.descendant(of: navCol, matching: find.text('Beta Session')),
        findsOneWidget,
        reason: 'Beta Session should be visible in nav column initially',
      );

      // (5) Type a query that matches only Alpha.
      await tester.enterText(
        find.byKey(const ValueKey('nav-search-field')),
        'Alpha',
      );
      await tester.pump();

      expect(
        find.descendant(of: navCol, matching: find.text('Alpha Session')),
        findsOneWidget,
        reason: 'Alpha Session should still be visible after "Alpha" query',
      );
      expect(
        find.descendant(of: navCol, matching: find.text('Beta Session')),
        findsNothing,
        reason:
            'Beta Session should be hidden in nav column after "Alpha" query',
      );

      // Clearing restores both.
      await tester.enterText(
        find.byKey(const ValueKey('nav-search-field')),
        '',
      );
      await tester.pump();
      expect(
        find.descendant(of: navCol, matching: find.text('Beta Session')),
        findsOneWidget,
        reason: 'Beta Session should be visible again after clearing query',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    testWidgets('TOOLS rows are present and tappable', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final controller = _makeControllerWithSessions([]);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // (6) Each TOOLS row is present by its key.
      expect(
        find.byKey(const ValueKey('tools-row-brain')),
        findsOneWidget,
        reason: 'Brain tools row should be present',
      );
      expect(
        find.byKey(const ValueKey('tools-row-research')),
        findsOneWidget,
        reason: 'Deep Research tools row should be present',
      );
      expect(
        find.byKey(const ValueKey('tools-row-tasks')),
        findsOneWidget,
        reason: 'Tasks tools row should be present',
      );
      expect(
        find.byKey(const ValueKey('tools-row-webhooks')),
        findsOneWidget,
        reason: 'Webhooks tools row should be present',
      );
      expect(
        find.byKey(const ValueKey('tools-row-profiles')),
        findsOneWidget,
        reason: 'Profiles tools row should be present',
      );

      // TOOLS label itself.
      expect(find.text('TOOLS'), findsOneWidget);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    testWidgets('footer Settings affordance is present', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final controller = _makeControllerWithSessions([]);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // (7) Footer Settings icon.
      expect(
        find.byKey(const ValueKey('nav-col-settings')),
        findsOneWidget,
        reason: 'Footer Settings affordance should render',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    // ── (8) Rich rows: model badge present ──────────────────────────────────

    testWidgets('session rows show agent icon (compact SessionRow rendering)',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      // Session with agentId='claude-code' → resolves to the claude-code config.
      final sessions = [_makeSession('s1', 'Model Badge Session')];
      final controller = _makeControllerWithSessions(sessions);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // The compact SessionRow renders an icon-only agent identity
      // (AgentKindIcon) plus the session title — no agent label/"description".
      final navCol = find.byKey(const ValueKey('agents-nav-column'));
      expect(
        find.descendant(of: navCol, matching: find.byType(AgentKindIcon)),
        findsAtLeastNWidgets(1),
        reason: 'Compact SessionRow must render the agent icon',
      );
      expect(
        find.descendant(of: navCol, matching: find.text('Model Badge Session')),
        findsOneWidget,
        reason: 'Compact SessionRow must render the session title',
      );
      // The agent label ("Claude Code") is intentionally dropped in the
      // compact row.
      expect(
        find.descendant(of: navCol, matching: find.text('Claude Code')),
        findsNothing,
        reason: 'Compact SessionRow shows icon only, no agent label',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    // ── (9) Rich rows: Archived section header from SessionListBody ──────────

    testWidgets('Archived section header renders in CHATS body',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final sessions = [_makeSession('s1', 'Alpha Session')];
      final controller = _makeControllerWithSessions(sessions);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // (9) The Archived section header (key: 'archived-section-header') must
      // be present — it is rendered by SessionListBody, not the old lean inline
      // list. Its presence guarantees SessionListBody is actually mounted.
      final navCol = find.byKey(const ValueKey('agents-nav-column'));
      expect(
        find.descendant(
          of: navCol,
          matching: find.byKey(const ValueKey('archived-section-header')),
        ),
        findsOneWidget,
        reason:
            'SessionListBody must be mounted (archived-section-header must render)',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    // ── (10) B2/C3/D2: Cookbook, Email, Gallery TOOLS rows present ───────────

    testWidgets('Cookbook, Email, Gallery TOOLS rows are present',
        (tester) async {
      // Use extra height to accommodate the full TOOLS section (8 rows).
      await tester.binding.setSurfaceSize(const Size(1600, 1100));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final controller = _makeControllerWithSessions([]);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      expect(
        find.byKey(const ValueKey('tools-row-cookbook')),
        findsOneWidget,
        reason: 'Cookbook TOOLS row should be present',
      );
      expect(
        find.byKey(const ValueKey('tools-row-email')),
        findsOneWidget,
        reason: 'Email TOOLS row should be present',
      );
      expect(
        find.byKey(const ValueKey('tools-row-gallery')),
        findsOneWidget,
        reason: 'Gallery TOOLS row should be present',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    // ── (11) Short-surface: no overflow, footer and TOOLS reachable ──────────

    testWidgets(
        'no overflow at short surface (680px); footer and TOOLS rows reachable',
        (tester) async {
      // This is the regression test for the layout fix: at 680px height the
      // non-flexible chrome (header + 8 TOOLS rows + footer) previously
      // exceeded available space and caused a ~52px RenderFlex overflow.
      await tester.binding.setSurfaceSize(const Size(1200, 680));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final controller = _makeControllerWithSessions([]);

      // The test itself acts as the overflow assertion — flutter_test fails
      // on uncaught RenderFlex overflow exceptions when they cross the
      // FlutterError handler threshold.
      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // Nav column still renders.
      expect(
        find.byKey(const ValueKey('agents-nav-column')),
        findsOneWidget,
        reason: 'Nav column must render at 680px height',
      );

      // Footer Settings affordance is directly visible (pinned).
      expect(
        find.byKey(const ValueKey('nav-col-settings')),
        findsOneWidget,
        reason:
            'Footer Settings must be visible without scrolling (pinned footer)',
      );

      // Scroll the middle region to reach a TOOLS row.
      // The outer CustomScrollView is the primary scrollable inside the nav
      // column. Use the first Scrollable descendant which corresponds to it.
      final navScrollable = find
          .descendant(
            of: find.byKey(const ValueKey('agents-nav-column')),
            matching: find.byType(Scrollable),
          )
          .first;

      await tester.scrollUntilVisible(
        find.byKey(const ValueKey('tools-row-brain')),
        50,
        scrollable: navScrollable,
      );
      expect(
        find.byKey(const ValueKey('tools-row-brain')),
        findsOneWidget,
        reason: 'Brain TOOLS row must be reachable by scrolling at 680px',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // #903 — sort menu + rename
  // ---------------------------------------------------------------------------

  group('AgentsNavColumn — #903 sort + rename', () {
    testWidgets('sort menu reorders sessions by name', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final sessions = [
        AgentSession(
          id: 's1',
          agentId: 'claude-code',
          name: 'Zebra Session',
          cwd: '/tmp',
          status: AgentSessionStatus.idle,
          createdAt: DateTime.fromMillisecondsSinceEpoch(1000),
          updatedAt: _kEpoch,
        ),
        AgentSession(
          id: 's2',
          agentId: 'claude-code',
          name: 'Alpha Session',
          cwd: '/tmp',
          status: AgentSessionStatus.idle,
          createdAt: DateTime.fromMillisecondsSinceEpoch(2000),
          updatedAt: _kEpoch,
        ),
      ];
      final controller = _makeControllerWithSessions(sessions);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      final navCol = find.byKey(const ValueKey('agents-nav-column'));

      // Default sort is dateNewest: s2 (Alpha, createdAt=2000) comes first.
      Finder rowsInOrder() => find.descendant(
            of: navCol,
            matching: find.byType(SessionRow),
          );
      expect(
        tester.widgetList<SessionRow>(rowsInOrder()).first.session.id,
        's2',
        reason: 'Default sort (date newest) should put the newer session first',
      );

      // Switch to name sort.
      await tester.tap(find.byKey(const ValueKey('session-sort-menu')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Name'));
      await tester.pumpAndSettle();

      expect(
        tester.widgetList<SessionRow>(rowsInOrder()).first.session.id,
        's2',
        reason: '"Alpha Session" should sort first alphabetically',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    testWidgets('Rename menu item updates the session name', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final sessions = [_makeSession('s1', 'Old Name')];
      final controller = _makeControllerWithSessions(sessions);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      final navCol = find.byKey(const ValueKey('agents-nav-column'));
      expect(
        find.descendant(of: navCol, matching: find.text('Old Name')),
        findsOneWidget,
      );

      // Open the session's ⋯ menu and tap Rename.
      await tester.tap(find.byType(SessionRowMenu).first);
      await tester.pumpAndSettle();
      await tester.tap(find.text('Rename'));
      await tester.pumpAndSettle();

      // Dialog opens pre-filled with the current name; clear and type a new one.
      final field = find.byKey(const ValueKey('rename-session-field'));
      expect(field, findsOneWidget);
      await tester.enterText(field, 'New Name');
      await tester.tap(find.widgetWithText(FilledButton, 'Save'));
      await tester.pumpAndSettle();

      expect(controller.sessions.first.name, 'New Name');
      expect(
        find.descendant(of: navCol, matching: find.text('New Name')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: navCol, matching: find.text('Old Name')),
        findsNothing,
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });
  });

  // ---------------------------------------------------------------------------
  // USO Phase A — #1025 (scope filter) / #1026 (status sort) / #1027 (A4)
  // ---------------------------------------------------------------------------

  group('USO Phase A — nav column', () {
    // (A2) category dropdown renders + switching scope reloads with the correct
    // `?scope=` param and the list still renders rows.
    testWidgets('#1025 scope dropdown switches scope and reloads',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final repo = _StubAgentsRepository([
        _makeSession('s1', 'Scheduled Alpha'),
      ]);
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // Dropdown renders; default scope is chats.
      expect(
        find.byKey(const ValueKey('session-scope-dropdown')),
        findsOneWidget,
        reason: 'Category scope dropdown should render at the CHATS header',
      );
      expect(controller.scope, AgentSessionScope.chats);

      // Open the dropdown and pick "Scheduled Tasks".
      await tester.tap(find.byKey(const ValueKey('session-scope-dropdown')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Scheduled Tasks'));
      await tester.pumpAndSettle();

      expect(controller.scope, AgentSessionScope.scheduled);
      expect(
        repo.lastScope,
        'scheduled',
        reason: 'Switching scope must reload with ?scope=scheduled',
      );

      // The scoped list still renders its rows.
      final navCol = find.byKey(const ValueKey('agents-nav-column'));
      expect(
        find.descendant(of: navCol, matching: find.text('Scheduled Alpha')),
        findsAtLeastNWidgets(1),
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    // (A2) empty scope shows the empty-state (no error, no infinite spinner).
    testWidgets('#1025 empty scope renders without error/spinner',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final repo = _StubAgentsRepository(<AgentSession>[]);
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
      );
      await controller.loadSessions(AgentSessionScope.selfImprovement);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      expect(controller.scope, AgentSessionScope.selfImprovement);
      expect(controller.status, AgentsLoadStatus.idle);
      // Nav column still renders; no CircularProgressIndicator stuck in it.
      final navCol = find.byKey(const ValueKey('agents-nav-column'));
      expect(navCol, findsOneWidget);
      expect(
        find.descendant(
          of: navCol,
          matching: find.byType(CircularProgressIndicator),
        ),
        findsNothing,
        reason: 'Empty scope must not spin forever',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    // (A3) status sort reorders within the active scope.
    testWidgets('#1026 status sort orders working before idle', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final sessions = [
        AgentSession(
          id: 'idle1',
          agentId: 'claude-code',
          name: 'Idle Session',
          cwd: '/tmp',
          status: AgentSessionStatus.idle,
          createdAt: DateTime.fromMillisecondsSinceEpoch(3000),
          updatedAt: _kEpoch,
        ),
        AgentSession(
          id: 'working1',
          agentId: 'claude-code',
          name: 'Working Session',
          cwd: '/tmp',
          status: AgentSessionStatus.working,
          createdAt: DateTime.fromMillisecondsSinceEpoch(1000),
          updatedAt: _kEpoch,
        ),
      ];
      final controller = _makeControllerWithSessions(sessions);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      final navCol = find.byKey(const ValueKey('agents-nav-column'));
      Finder rows() =>
          find.descendant(of: navCol, matching: find.byType(SessionRow));

      // Switch sort to Status.
      await tester.tap(find.byKey(const ValueKey('session-sort-menu')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Status'));
      await tester.pumpAndSettle();

      expect(
        tester.widgetList<SessionRow>(rows()).first.session.id,
        'working1',
        reason: 'Status sort must place working before idle',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    // Smoke follow-up (1): the By-Project filter is hidden outside the chats
    // scope; the category dropdown + sort menu remain in every scope.
    testWidgets('By-Project filter hidden outside chats scope', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final repo = _StubAgentsRepository([_makeSession('s1', 'Alpha')]);
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
        modelsDataSource: _EmptyModelsDataSource(),
      );

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      // Chats (default): By-Project selector visible.
      expect(
        find.byKey(const ValueKey('by-project-selector')),
        findsOneWidget,
        reason: 'By-Project filter must be visible in the CHATS scope',
      );

      // Switch to Scheduled Tasks.
      await tester.tap(find.byKey(const ValueKey('session-scope-dropdown')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Scheduled Tasks'));
      await tester.pumpAndSettle();

      expect(controller.scope, AgentSessionScope.scheduled);
      // By-Project selector hidden; category dropdown + sort menu still there.
      expect(
        find.byKey(const ValueKey('by-project-selector')),
        findsNothing,
        reason: 'By-Project filter must be hidden outside the CHATS scope',
      );
      expect(
        find.byKey(const ValueKey('session-scope-dropdown')),
        findsOneWidget,
      );
      expect(find.byKey(const ValueKey('session-sort-menu')), findsOneWidget);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    // Smoke follow-up (2b): a scheduled row WITH an sdkSessionId opens the SAME
    // interactive chat detail a normal chat row opens — not the read-only
    // transcript view — with a usable composer input.
    testWidgets(
        'scheduled row with sdkSessionId opens interactive chat detail (usable input)',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final repo = _StubAgentsRepository([
        _makeRunSession('sch1', 'Nightly Digest', hasSdk: true),
      ]);
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
        modelsDataSource: _EmptyModelsDataSource(),
      );
      await controller.loadSessions(AgentSessionScope.scheduled);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      final navCol = find.byKey(const ValueKey('agents-nav-column'));
      await tester.tap(
        find.descendant(of: navCol, matching: find.byType(SessionRow)).first,
      );
      await tester.pumpAndSettle();

      // The read-only transcript route is NOT used any more.
      expect(
        find.byType(SessionTranscriptView),
        findsNothing,
        reason: 'Rows now open the interactive chat detail, not the '
            'read-only transcript view',
      );
      // Same interactive surface a chat row opens: the session is selected and
      // the composer input is present + enabled.
      expect(controller.selectedSessionId, 'sch1');
      final input = find.byKey(const ValueKey('agent-composer-input'));
      expect(input, findsOneWidget, reason: 'Interactive composer must render');
      expect(
        tester.widget<TextField>(input).enabled,
        isTrue,
        reason: 'A resumable scheduled run must have a usable input',
      );
      expect(
        find.byKey(const ValueKey('composer-disabled-reason')),
        findsNothing,
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    testWidgets(
        'open headless detail refreshes transcript and idle badge after polling',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final starting = _makeRunSession(
        'headless1',
        'Scheduled Briefing',
        hasSdk: true,
        status: AgentSessionStatus.starting,
      );
      final idle = starting.copyWith(status: AgentSessionStatus.idle);
      final repo = _StubAgentsRepository([starting]);
      repo.getSessionResults.addAll([
        (session: starting, messages: const <AgentSessionMessage>[]),
        (
          session: idle,
          messages: [
            AgentSessionMessage(
              id: 1,
              sessionId: starting.id,
              role: 'input',
              rawText: 'Prepare the scheduled briefing',
              strippedText: 'Prepare the scheduled briefing',
              createdAt: _kEpoch,
            ),
            AgentSessionMessage(
              id: 2,
              sessionId: starting.id,
              role: 'output',
              rawText: 'The scheduled briefing is ready.',
              strippedText: 'The scheduled briefing is ready.',
              createdAt: _kEpoch,
            ),
          ],
        ),
      ]);
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
        modelsDataSource: _EmptyModelsDataSource(),
      );
      await controller.loadSessions(AgentSessionScope.scheduled);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      final navCol = find.byKey(const ValueKey('agents-nav-column'));
      await tester.tap(
        find.descendant(of: navCol, matching: find.byType(SessionRow)).first,
      );
      await tester.pumpAndSettle();

      expect(find.text('Starting'), findsOneWidget);
      expect(find.text('Session started. Waiting for output…'), findsOneWidget);

      await tester.pump(const Duration(seconds: 4));
      await tester.pump();

      expect(find.text('The scheduled briefing is ready.'), findsOneWidget);
      expect(find.text('Idle'), findsOneWidget);
      expect(controller.selectedSessionId, starting.id);

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    // Smoke follow-up (2c): an unresumable row (no sdkSessionId) still opens the
    // interactive detail (full history) but disables the composer with a reason
    // — it never crashes and never drops the user into a dead input.
    testWidgets(
        'unresumable row opens interactive detail with input disabled + reason',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(1600, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      // A genuinely TERMINATED run with no engine session — the only case the
      // composer is disabled. A starting/working/idle no-sdk session stays
      // enabled (it's live/initializing, not ended).
      final repo = _StubAgentsRepository([
        _makeRunSession('old1', 'Legacy Run',
            hasSdk: false, status: AgentSessionStatus.error),
      ]);
      final controller = AgentsController(
        repo,
        _ReadyAgentServerController(),
        _FakeLocalNotificationService(),
        _FakeNotificationsController(),
        modelsDataSource: _EmptyModelsDataSource(),
      );
      await controller.loadSessions(AgentSessionScope.selfImprovement);

      await tester.pumpWidget(await _buildTestApp(controller));
      await tester.pump();

      final navCol = find.byKey(const ValueKey('agents-nav-column'));
      await tester.tap(
        find.descendant(of: navCol, matching: find.byType(SessionRow)).first,
      );
      await tester.pumpAndSettle();

      // Interactive detail opened (session selected), input disabled + reason.
      expect(controller.selectedSessionId, 'old1');
      expect(
        find.byKey(const ValueKey('composer-disabled-reason')),
        findsOneWidget,
        reason: 'Unresumable run must show an inline reason',
      );
      final input = find.byKey(const ValueKey('agent-composer-input'));
      expect(input, findsOneWidget);
      expect(
        tester.widget<TextField>(input).enabled,
        isFalse,
        reason: 'Unresumable run must disable the composer input',
      );
      // Reaching here without a thrown exception is the "no crash" assertion.

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      controller.dispose();
    });

    // (A4) the Session History nav item is gone from the sidebar.
    testWidgets('#1027 Session History nav item is removed', (tester) async {
      await tester.binding.setSurfaceSize(const Size(1200, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final messages = MessagesController(
        MessagesRepository(MessagesDataSource()),
        notifications: _FakeLocalNotificationService(),
      );

      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<MessagesController>.value(value: messages),
          ],
          child: MaterialApp(
            home: Scaffold(
              body: NavigationSidebar(
                selectedIndex: 0,
                collapsed: false,
                onItemSelected: (_) {},
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Agents'), findsOneWidget);
      expect(
        find.text('Session History'),
        findsNothing,
        reason: 'Session History nav item must be retired (#1027)',
      );

      await tester.pumpWidget(const MaterialApp(home: SizedBox()));
      messages.dispose();
    });
  });
}
