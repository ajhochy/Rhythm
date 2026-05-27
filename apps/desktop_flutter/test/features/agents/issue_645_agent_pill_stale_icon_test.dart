/// Acceptance contract for issue #645 — Agent/model pill graphic does not
/// update when the session's agent changes.
///
/// MECHANISM
/// ---------
/// The agent badge renders in FOUR places. All four must use the same
/// provider→agent-kind resolver (provider 'openai' → 'codex', 'google' →
/// 'gemini-cli', etc.) so they remain consistent when setSessionModel updates
/// session.providerId but not session.agentId.
///
/// FOUR RENDER SITES:
///   1. _SessionRow         (agents_view.dart ~777)    — AgentKindBadgeTestHarness
///   2. _ResumableSessionRow (agents_view.dart ~846)   — ResumableSessionRowTestHarness
///   3. _TranscriptHeader   (agents_view.dart ~1339)   — TranscriptHeaderTestHarness
///   4. _BubbleHeader /     (agent_bubble_overlay.dart) — BubbleHeaderTestHarness /
///      _CollapsedBubble                                  CollapsedBubbleTestHarness
///
/// ROOT CAUSE (confirmed from smoke on 2026-05-26):
/// - Sites #2 and #3 called _AgentKindBadge(agentId: session.agentId) without
///   passing providerId, so the provider→agent-kind mapping was never applied.
/// - Site #4 used entry.agentId (stale AgentBubbleEntry snapshot) and looked
///   up AgentConfig via context.read (no subscription); did not use providerId.
/// - When setSessionModel PATCHed provider='google' and the server broadcast a
///   session.updated WS frame updating agentId='gemini-cli', the session-list
///   badge (#1) correctly showed "Gemini CLI" (already fixed in the first pass),
///   but the transcript header (#3) and expanded bubble (#4) still showed a
///   stale label because they did not thread providerId.
///
/// FIX:
///   Sites #2 and #3: pass providerId: session.providerId to _AgentKindBadge.
///   Site #4: thread providerId through AgentBubbleEntry; resolve via the same
///   _kBubbleProviderToAgentKind map in agent_bubble_overlay.dart; switch from
///   context.read to context.watch for AgentConfigsController.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_bubble_overlay.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/agents/overlay_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/models/agent_config.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

final _claudeConfig = AgentConfig(
  id: 'claude-code',
  label: 'Claude Code',
  icon: 'terminal',
  enabled: true,
  isAgent: true,
  sortOrder: 0,
);

final _codexConfig = AgentConfig(
  id: 'codex',
  label: 'Codex',
  icon: 'terminal',
  enabled: true,
  isAgent: true,
  sortOrder: 1,
);

final _geminiConfig = AgentConfig(
  id: 'gemini-cli',
  label: 'Gemini CLI',
  icon: 'terminal',
  enabled: true,
  isAgent: true,
  sortOrder: 2,
);

final _allConfigs = [_claudeConfig, _codexConfig, _geminiConfig];

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

// A minimal session with agentId=null→'claude-code' (server default) and
// providerId='anthropic', mirroring the smoke ground truth: TEst session whose
// TRUE agent is claude-code even though agentId was null on the server.
AgentSession _makeSession({
  String id = 'session-645',
  String agentId = 'claude-code',
  String? providerId = 'anthropic',
  String name = 'TEst',
}) {
  return AgentSession(
    id: id,
    agentId: agentId,
    providerId: providerId,
    name: name,
    cwd: '/tmp',
    status: AgentSessionStatus.idle,
    createdAt: _kEpoch,
    updatedAt: _kEpoch,
  );
}

// ---------------------------------------------------------------------------
// Fake data source — returns a controlled list of configs.
// ---------------------------------------------------------------------------

class _FakeAgentConfigsDataSource extends AgentConfigsDataSource {
  _FakeAgentConfigsDataSource(this._configs);
  final List<AgentConfig> _configs;

  @override
  Future<List<AgentConfig>> list() async => _configs;
}

// ---------------------------------------------------------------------------
// Fake infrastructure for AgentsController / AgentServerController
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
  final StreamController<AgentWsMessage> _msg =
      StreamController<AgentWsMessage>.broadcast();
  final StreamController<bool> _conn = StreamController<bool>.broadcast();

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
  }) async =>
      [];

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
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

class _FakeLocalNotificationService extends LocalNotificationService {
  @override
  Future<void> showMessageNotification({
    required int id,
    required String title,
    required String body,
  }) async {}
}

// ---------------------------------------------------------------------------
// Helper: build AgentConfigsController seeded with configs.
// ---------------------------------------------------------------------------

Future<AgentConfigsController> _makeConfigsController(
    List<AgentConfig> configs) async {
  final ctrl = AgentConfigsController(
    AgentConfigsRepository(_FakeAgentConfigsDataSource(configs)),
  );
  await ctrl.refresh();
  return ctrl;
}

// ---------------------------------------------------------------------------
// Helper: minimal Provider tree for badge-only tests (sites #1, #2, #3).
// Requires only AgentConfigsController + (for #3) AgentsController &
// AgentServerController.
// ---------------------------------------------------------------------------

Widget _wrapWithProviders({
  required AgentConfigsController configsCtrl,
  AgentsController? agentsCtrl,
  AgentServerController? agentServerCtrl,
  required Widget child,
}) {
  final providers = <ChangeNotifierProvider>[
    ChangeNotifierProvider<AgentConfigsController>.value(value: configsCtrl),
    if (agentsCtrl != null)
      ChangeNotifierProvider<AgentsController>.value(value: agentsCtrl),
    if (agentServerCtrl != null)
      ChangeNotifierProvider<AgentServerController>.value(
          value: agentServerCtrl),
  ];

  return MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(
      body: MultiProvider(
        providers: providers,
        child: Center(child: child),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Helper: build AgentsController with a fixed session list (no network).
// ---------------------------------------------------------------------------

class _FixedSessionsAgentsController extends AgentsController {
  _FixedSessionsAgentsController(
    AgentsRepository repo,
    AgentServerController agentServer,
    LocalNotificationService notifService,
    NotificationsController notifController,
    this._fixedSessions,
  ) : super(repo, agentServer, notifService, notifController);

  final List<AgentSession> _fixedSessions;

  @override
  List<AgentSession> get sessions => _fixedSessions;

  @override
  bool isWorking(String id) => false;
}

Future<AgentsController> _makeAgentsController(
    List<AgentSession> sessions) async {
  final repo = _StubAgentsRepository();
  final agentServer = _ReadyAgentServerController();
  final notifService = _FakeLocalNotificationService();
  final notifCtrl = _FakeNotificationsController();
  return _FixedSessionsAgentsController(
      repo, agentServer, notifService, notifCtrl, sessions);
}

// ===========================================================================
// TESTS
// ===========================================================================

void main() {
  // =========================================================================
  // GROUP 1: _AgentKindBadge via AgentKindBadgeTestHarness (site #1)
  // =========================================================================
  group('issue #645 — agent pill re-renders when session agent changes', () {
    // -----------------------------------------------------------------------
    // c1: Badge shows correct label for initial agentId.
    // -----------------------------------------------------------------------
    testWidgets(
      'c1: badge shows Claude Code label for agentId=claude-code',
      (tester) async {
        final controller = await _makeConfigsController(_allConfigs);
        addTearDown(controller.dispose);

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: controller,
          child: AgentKindBadgeTestHarness(
            agentId: 'claude-code',
            providerId: null,
          ),
        ));
        await tester.pump();

        expect(
          find.text('Claude Code'),
          findsOneWidget,
          reason:
              'Badge must show the Claude Code label for agentId=claude-code.',
        );
        expect(find.text('Codex'), findsNothing);
        expect(find.text('Gemini CLI'), findsNothing);
      },
    );

    // -----------------------------------------------------------------------
    // c2: Badge updates to Codex when providerId changes to 'openai'.
    //     Uses the REAL production value: session.providerId stores the
    //     provider name ('openai'), NOT the agent config id ('codex').
    //     This is the STRICT fail-first test — FAILS today, PASSES after fix.
    // -----------------------------------------------------------------------
    testWidgets(
      'c2 (STRICT): badge updates to Codex label when providerId switches to openai (real production value)',
      (tester) async {
        final controller = await _makeConfigsController(_allConfigs);
        addTearDown(controller.dispose);

        // Initial state: agentId=claude-code, no providerId override.
        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: controller,
          child: AgentKindBadgeTestHarness(
            agentId: 'claude-code',
            providerId: null,
          ),
        ));
        await tester.pump();

        expect(find.text('Claude Code'), findsOneWidget,
            reason: 'Initial state: Claude Code must be visible.');

        // Simulate setSessionModel for a Codex model:
        //   _applyPick passes entry.provider='openai' as providerId.
        //   The session row stores providerId='openai', agentId stays 'claude-code'.
        //   byId('openai') returns null — the pill must use the provider→agent
        //   mapping: 'openai' → 'codex' → byId('codex') → Codex config.
        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: controller,
          child: AgentKindBadgeTestHarness(
            agentId: 'claude-code',
            providerId: 'openai', // REAL production value (not 'codex')
          ),
        ));
        await tester.pump();

        expect(
          find.text('Codex'),
          findsOneWidget,
          reason:
              'After providerId switches to "openai" (the real value stored by '
              'setSessionModel for a Codex model), the badge must map '
              '"openai" → "codex" and display "Codex". '
              'FAILS today because _AgentKindBadge calls byId("openai") which '
              'returns null — there is no config with id="openai". '
              'PASSES after the provider→agent-kind mapping fix (issue #645).',
        );
        expect(
          find.text('Claude Code'),
          findsNothing,
          reason: 'Claude Code label must not be shown after agent switch.',
        );
      },
    );

    // -----------------------------------------------------------------------
    // c2b: Badge updates to Gemini CLI when providerId changes to 'google'.
    //      Mirrors the real production case for gemini-cli models.
    //      FAILS today (byId('google')=null), PASSES after mapping fix.
    // -----------------------------------------------------------------------
    testWidgets(
      'c2b (STRICT): badge updates to Gemini CLI label when providerId switches to google (real production value)',
      (tester) async {
        final controller = await _makeConfigsController(_allConfigs);
        addTearDown(controller.dispose);

        // Initial state: agentId=claude-code, no providerId override.
        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: controller,
          child: AgentKindBadgeTestHarness(
            agentId: 'claude-code',
            providerId: null,
          ),
        ));
        await tester.pump();

        expect(find.text('Claude Code'), findsOneWidget,
            reason: 'Initial state: Claude Code must be visible.');

        // Simulate setSessionModel for a Gemini model:
        //   entry.provider='google' → session.providerId='google'.
        //   Mapping: 'google' → 'gemini-cli' → byId('gemini-cli') → Gemini CLI.
        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: controller,
          child: AgentKindBadgeTestHarness(
            agentId: 'claude-code',
            providerId: 'google', // REAL production value (not 'gemini-cli')
          ),
        ));
        await tester.pump();

        expect(
          find.text('Gemini CLI'),
          findsOneWidget,
          reason:
              'After providerId switches to "google" (the real value stored by '
              'setSessionModel for a Gemini model), the badge must map '
              '"google" → "gemini-cli" and display "Gemini CLI". '
              'FAILS today because byId("google") returns null (issue #645).',
        );
        expect(
          find.text('Claude Code'),
          findsNothing,
          reason: 'Claude Code label must not be shown after agent switch.',
        );
      },
    );

    // -----------------------------------------------------------------------
    // c3: Badge rebuilds when AgentConfigsController notifies (context.watch).
    //     FAILS today because context.read is used (no subscription).
    // -----------------------------------------------------------------------
    testWidgets(
      'c3 (STRICT): badge rebuilds when AgentConfigsController notifies',
      (tester) async {
        // Start with all three configs.
        final dataSource = _FakeAgentConfigsDataSource(_allConfigs);
        final controller =
            AgentConfigsController(AgentConfigsRepository(dataSource));
        await controller.refresh();
        addTearDown(controller.dispose);

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: controller,
          child: AgentKindBadgeTestHarness(
            agentId: 'codex',
            providerId: null,
          ),
        ));
        await tester.pump();

        // With both configs loaded, codex should be shown.
        expect(find.text('Codex'), findsOneWidget,
            reason: 'Codex config must be resolved initially.');

        // Now manually notify the controller (simulates a refresh or update).
        controller.notifyListeners();
        await tester.pump();

        // With context.watch, the badge rebuilds and still shows Codex.
        expect(
          find.text('Codex'),
          findsOneWidget,
          reason:
              'After AgentConfigsController.notifyListeners(), the badge must '
              'still show the correct label. With context.read the badge does '
              'not subscribe — this may cause stale renders if the config list '
              'changes (issue #645).',
        );
      },
    );
  });

  // =========================================================================
  // GROUP 2: Site #2 — _ResumableSessionRow badge
  // Smoke ground truth: provider='anthropic' → badge shows 'Claude Code'.
  // =========================================================================
  group('issue #645 site #2 — _ResumableSessionRow badge uses providerId', () {
    testWidgets(
      'c4: resumable row shows Claude Code when providerId=anthropic (smoke baseline)',
      (tester) async {
        final configsCtrl = await _makeConfigsController(_allConfigs);
        addTearDown(configsCtrl.dispose);

        // Session with agentId=claude-code + providerId=anthropic — the TEst
        // session ground truth from the smoke. Should show "Claude Code".
        final session = _makeSession(
          agentId: 'claude-code',
          providerId: 'anthropic',
        );

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          child: ResumableSessionRowTestHarness(session: session),
        ));
        await tester.pump();

        expect(
          find.text('Claude Code'),
          findsOneWidget,
          reason:
              'Resumable row badge must show Claude Code when agentId=claude-code '
              'and providerId=anthropic. Both provider→agent mapping and agentId '
              'fallback resolve to claude-code.',
        );
        expect(find.text('Gemini CLI'), findsNothing);
        expect(find.text('Codex'), findsNothing);
      },
    );

    testWidgets(
      'c4b (STRICT): resumable row shows Gemini CLI when providerId=google '
      '— was MISSING providerId before fix (site #2)',
      (tester) async {
        final configsCtrl = await _makeConfigsController(_allConfigs);
        addTearDown(configsCtrl.dispose);

        // A session where setSessionModel persisted provider='google' (gemini).
        // agentId stays 'claude-code' (PATCH does not update agent_id).
        // Before fix: _AgentKindBadge called without providerId → always
        // showed 'Claude Code'. After fix: maps 'google' → 'gemini-cli'.
        final session = _makeSession(
          agentId: 'claude-code',
          providerId: 'google',
        );

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          child: ResumableSessionRowTestHarness(session: session),
        ));
        await tester.pump();

        expect(
          find.text('Gemini CLI'),
          findsOneWidget,
          reason:
              'Resumable row badge must map providerId=google → gemini-cli and '
              'show "Gemini CLI". FAILED before fix (site #2 was missing '
              'providerId argument to _AgentKindBadge).',
        );
        expect(
          find.text('Claude Code'),
          findsNothing,
          reason:
              'Claude Code must NOT show when the persisted provider is google.',
        );
      },
    );

    testWidgets(
      'c4c: resumable row shows Codex when providerId=openai (site #2)',
      (tester) async {
        final configsCtrl = await _makeConfigsController(_allConfigs);
        addTearDown(configsCtrl.dispose);

        final session = _makeSession(
          agentId: 'claude-code',
          providerId: 'openai',
        );

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          child: ResumableSessionRowTestHarness(session: session),
        ));
        await tester.pump();

        expect(
          find.text('Codex'),
          findsOneWidget,
          reason:
              'Resumable row badge must map providerId=openai → codex and show '
              '"Codex". FAILED before fix.',
        );
        expect(find.text('Claude Code'), findsNothing);
      },
    );
  });

  // =========================================================================
  // GROUP 3: Site #3 — _TranscriptHeader badge
  // =========================================================================
  group('issue #645 site #3 — _TranscriptHeader badge uses providerId', () {
    testWidgets(
      'c5: transcript header shows Claude Code when providerId=anthropic (smoke baseline)',
      (tester) async {
        final configsCtrl = await _makeConfigsController(_allConfigs);
        addTearDown(configsCtrl.dispose);

        final agentsCtrl = await _makeAgentsController([_makeSession()]);
        addTearDown(agentsCtrl.dispose);

        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);

        final session = _makeSession(
          agentId: 'claude-code',
          providerId: 'anthropic',
        );

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: agentsCtrl,
          agentServerCtrl: agentServerCtrl,
          child: TranscriptHeaderTestHarness(session: session),
        ));
        await tester.pump();

        expect(
          find.text('Claude Code'),
          findsOneWidget,
          reason:
              'Transcript header badge must show Claude Code when agentId=claude-code '
              'and providerId=anthropic (smoke ground truth).',
        );
        expect(find.text('Gemini CLI'), findsNothing);
      },
    );

    testWidgets(
      'c5b (STRICT): transcript header shows Gemini CLI when providerId=google '
      '— was MISSING providerId before fix (site #3)',
      (tester) async {
        final configsCtrl = await _makeConfigsController(_allConfigs);
        addTearDown(configsCtrl.dispose);

        final agentsCtrl = await _makeAgentsController([]);
        addTearDown(agentsCtrl.dispose);

        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);

        // This models the SMOKE FAILURE: server broadcast session.updated with
        // agentId='gemini-cli' after a successful PATCH for google/gemini.
        // But we test the more general case: even when agentId stays
        // 'claude-code' but providerId='google', the header must show Gemini CLI.
        final session = _makeSession(
          agentId: 'claude-code',
          providerId: 'google',
        );

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: agentsCtrl,
          agentServerCtrl: agentServerCtrl,
          child: TranscriptHeaderTestHarness(session: session),
        ));
        await tester.pump();

        expect(
          find.text('Gemini CLI'),
          findsOneWidget,
          reason:
              'Transcript header badge must map providerId=google → gemini-cli '
              'and show "Gemini CLI". FAILED before fix (site #3 was missing '
              'providerId argument to _AgentKindBadge).',
        );
        expect(
          find.text('Claude Code'),
          findsNothing,
          reason:
              'Claude Code must NOT appear when the persisted provider is google.',
        );
      },
    );

    testWidgets(
      'c5c: transcript header shows Codex when providerId=openai (site #3)',
      (tester) async {
        final configsCtrl = await _makeConfigsController(_allConfigs);
        addTearDown(configsCtrl.dispose);

        final agentsCtrl = await _makeAgentsController([]);
        addTearDown(agentsCtrl.dispose);

        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);

        final session = _makeSession(
          agentId: 'claude-code',
          providerId: 'openai',
        );

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: agentsCtrl,
          agentServerCtrl: agentServerCtrl,
          child: TranscriptHeaderTestHarness(session: session),
        ));
        await tester.pump();

        expect(
          find.text('Codex'),
          findsOneWidget,
          reason: 'Transcript header must show Codex for providerId=openai.',
        );
        expect(find.text('Claude Code'), findsNothing);
      },
    );
  });

  // =========================================================================
  // GROUP 4: Site #4 — _BubbleHeader and _CollapsedBubble badges
  // Bubble widgets now resolve via _kBubbleProviderToAgentKind using
  // entry.providerId (threaded from session.providerId in _sync()).
  // =========================================================================
  group('issue #645 site #4 — bubble badges use providerId', () {
    // Build an AgentBubbleEntry mirroring what _sync() produces from a session.
    AgentBubbleEntry _makeEntry({
      String agentId = 'claude-code',
      String? providerId = 'anthropic',
      String name = 'TEst',
    }) {
      return AgentBubbleEntry(
        key: 'session-645',
        kind: BubbleKind.session,
        label: name,
        agentId: agentId,
        providerId: providerId,
        status: AgentSessionStatus.idle,
        working: false,
        sessionId: 'session-645',
        isExpanded: false,
      );
    }

    // Wrap bubble harnesses — they only need AgentConfigsController +
    // OverlayController (for GestureDetector taps). We pass a minimal overlay
    // to avoid null pointer inside _CollapsedBubble.
    Widget _wrapBubble({
      required AgentConfigsController configsCtrl,
      required Widget child,
    }) {
      return MaterialApp(
        theme: AppTheme.light(),
        home: Scaffold(
          body: ChangeNotifierProvider<AgentConfigsController>.value(
            value: configsCtrl,
            child: Center(child: child),
          ),
        ),
      );
    }

    testWidgets(
      'c6: BubbleHeader shows Claude Code when entry.providerId=anthropic '
      '(smoke baseline)',
      (tester) async {
        final configsCtrl = await _makeConfigsController(_allConfigs);
        addTearDown(configsCtrl.dispose);

        final entry = _makeEntry(
          agentId: 'claude-code',
          providerId: 'anthropic',
        );

        await tester.pumpWidget(_wrapBubble(
          configsCtrl: configsCtrl,
          child: BubbleHeaderTestHarness(entry: entry),
        ));
        await tester.pump();

        expect(
          find.text('Claude Code'),
          findsOneWidget,
          reason: 'Bubble header must show Claude Code for provider=anthropic '
              '(smoke ground truth: TEst session is truly claude-code).',
        );
        expect(find.text('Gemini CLI'), findsNothing);
        expect(find.text('Codex'), findsNothing);
      },
    );

    testWidgets(
      'c6b (STRICT): BubbleHeader shows Gemini CLI when entry.providerId=google '
      '— was showing stale label before fix (site #4)',
      (tester) async {
        final configsCtrl = await _makeConfigsController(_allConfigs);
        addTearDown(configsCtrl.dispose);

        // Smoke scenario: after PATCH succeeded, WS session.updated pushed
        // agentId='gemini-cli', providerId='google'. AgentBubbleEntry was
        // not threaded with providerId (entry.providerId=null), so the header
        // looked up entry.agentId='gemini-cli' via context.read (no watch),
        // which happened to show Gemini CLI ONLY via agentId — but after an
        // error revert the agentId may not update, leaving the bubble stale.
        // After fix: entry.providerId='google' → maps to 'gemini-cli' correctly.
        final entry = _makeEntry(
          agentId: 'claude-code',
          providerId: 'google',
        );

        await tester.pumpWidget(_wrapBubble(
          configsCtrl: configsCtrl,
          child: BubbleHeaderTestHarness(entry: entry),
        ));
        await tester.pump();

        expect(
          find.text('Gemini CLI'),
          findsOneWidget,
          reason:
              'Bubble header must map entry.providerId=google → gemini-cli and '
              'show "Gemini CLI". FAILED before fix because providerId was not '
              'threaded through AgentBubbleEntry and the bubble used '
              'context.read (no subscription).',
        );
        expect(find.text('Claude Code'), findsNothing);
      },
    );

    testWidgets(
      'c6c: BubbleHeader shows Codex when entry.providerId=openai (site #4)',
      (tester) async {
        final configsCtrl = await _makeConfigsController(_allConfigs);
        addTearDown(configsCtrl.dispose);

        final entry = _makeEntry(
          agentId: 'claude-code',
          providerId: 'openai',
        );

        await tester.pumpWidget(_wrapBubble(
          configsCtrl: configsCtrl,
          child: BubbleHeaderTestHarness(entry: entry),
        ));
        await tester.pump();

        expect(
          find.text('Codex'),
          findsOneWidget,
          reason: 'Bubble header must show Codex for entry.providerId=openai.',
        );
        expect(find.text('Claude Code'), findsNothing);
      },
    );

    testWidgets(
      'c7: bubble badge rebuilds when AgentConfigsController notifies '
      '(context.watch fix for site #4)',
      (tester) async {
        final configsCtrl = await _makeConfigsController(_allConfigs);
        addTearDown(configsCtrl.dispose);

        final entry = _makeEntry(
          agentId: 'claude-code',
          providerId: 'anthropic',
        );

        await tester.pumpWidget(_wrapBubble(
          configsCtrl: configsCtrl,
          child: BubbleHeaderTestHarness(entry: entry),
        ));
        await tester.pump();

        expect(find.text('Claude Code'), findsOneWidget);

        // Trigger a controller notification — with context.watch the bubble
        // must rebuild and still show the correct label.
        configsCtrl.notifyListeners();
        await tester.pump();

        expect(
          find.text('Claude Code'),
          findsOneWidget,
          reason:
              'Bubble header must rebuild after AgentConfigsController.notifyListeners() '
              '(context.watch contract). Before fix: context.read was used — '
              'badge did not subscribe to controller changes.',
        );
      },
    );
  });

  // =========================================================================
  // GROUP 5: Cross-site consistency — ALL FOUR sites must agree
  // =========================================================================
  group('issue #645 — all four sites show the same agent label', () {
    testWidgets(
      'c8: anthropic/claude-code session → all four sites show Claude Code',
      (tester) async {
        final configsCtrl = await _makeConfigsController(_allConfigs);
        addTearDown(configsCtrl.dispose);

        final agentsCtrl = await _makeAgentsController([]);
        addTearDown(agentsCtrl.dispose);

        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);

        const agentId = 'claude-code';
        const providerId = 'anthropic';

        final session = _makeSession(
            agentId: agentId, providerId: providerId, name: 'TEst');

        final entry = AgentBubbleEntry(
          key: 'session-645',
          kind: BubbleKind.session,
          label: 'TEst',
          agentId: agentId,
          providerId: providerId,
          status: AgentSessionStatus.idle,
          working: false,
          sessionId: 'session-645',
          isExpanded: false,
        );

        // Test site #1 (AgentKindBadge).
        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          child: AgentKindBadgeTestHarness(
            agentId: agentId,
            providerId: providerId,
          ),
        ));
        await tester.pump();
        expect(find.text('Claude Code'), findsOneWidget,
            reason: 'Site #1 (SessionRow badge) must show Claude Code.');

        // Test site #2 (ResumableSessionRow).
        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          child: ResumableSessionRowTestHarness(session: session),
        ));
        await tester.pump();
        expect(find.text('Claude Code'), findsOneWidget,
            reason: 'Site #2 (ResumableSessionRow) must show Claude Code.');

        // Test site #3 (TranscriptHeader).
        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: agentsCtrl,
          agentServerCtrl: agentServerCtrl,
          child: TranscriptHeaderTestHarness(session: session),
        ));
        await tester.pump();
        expect(find.text('Claude Code'), findsOneWidget,
            reason: 'Site #3 (TranscriptHeader) must show Claude Code.');

        // Test site #4 (BubbleHeader).
        await tester.pumpWidget(MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: ChangeNotifierProvider<AgentConfigsController>.value(
              value: configsCtrl,
              child: Center(child: BubbleHeaderTestHarness(entry: entry)),
            ),
          ),
        ));
        await tester.pump();
        expect(find.text('Claude Code'), findsOneWidget,
            reason: 'Site #4 (BubbleHeader) must show Claude Code.');
      },
    );

    testWidgets(
      'c9 (STRICT): errored model switch — all four sites show Claude Code '
      '(the persisted agent), NOT the stale errored agent label',
      (tester) async {
        // This is the SMOKE FAILURE SCENARIO:
        //
        // The user switched the TEst session toward Gemini CLI. The model
        // change ERRORED. Server still has agentId=null→claude-code,
        // providerId='anthropic'. Local state after error: agentId='claude-code',
        // providerId='anthropic' (updateSession error path did not mutate
        // _sessions). All four sites must show "Claude Code", not "Gemini CLI".
        //
        // Previously sites #2, #3, and #4 showed stale/wrong labels because
        // they didn't thread providerId. Now that they all use provider→agent-kind
        // mapping, they consistently reflect the persisted session state.
        final configsCtrl = await _makeConfigsController(_allConfigs);
        addTearDown(configsCtrl.dispose);

        final agentsCtrl = await _makeAgentsController([]);
        addTearDown(agentsCtrl.dispose);

        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);

        // After error revert: session stays at agentId=claude-code, providerId=anthropic.
        const agentId = 'claude-code';
        const persistedProviderId = 'anthropic';

        final session = _makeSession(
          agentId: agentId,
          providerId: persistedProviderId,
          name: 'TEst',
        );
        final entry = AgentBubbleEntry(
          key: 'session-645',
          kind: BubbleKind.session,
          label: 'TEst',
          agentId: agentId,
          providerId: persistedProviderId,
          status: AgentSessionStatus.idle,
          working: false,
          sessionId: 'session-645',
          isExpanded: false,
        );

        // Site #1.
        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          child: AgentKindBadgeTestHarness(
            agentId: agentId,
            providerId: persistedProviderId,
          ),
        ));
        await tester.pump();
        expect(find.text('Claude Code'), findsOneWidget,
            reason:
                'Site #1 must show Claude Code after errored model switch (persisted state).');
        expect(find.text('Gemini CLI'), findsNothing,
            reason: 'Site #1 must NOT show errored agent label.');

        // Site #2.
        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          child: ResumableSessionRowTestHarness(session: session),
        ));
        await tester.pump();
        expect(find.text('Claude Code'), findsOneWidget,
            reason:
                'Site #2 must show Claude Code after errored model switch.');
        expect(find.text('Gemini CLI'), findsNothing,
            reason: 'Site #2 must NOT show errored agent label.');

        // Site #3.
        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: agentsCtrl,
          agentServerCtrl: agentServerCtrl,
          child: TranscriptHeaderTestHarness(session: session),
        ));
        await tester.pump();
        expect(find.text('Claude Code'), findsOneWidget,
            reason: 'Site #3 must show Claude Code after errored model switch. '
                'SMOKE FAILURE: this site showed "Gemini CLI" (stale) before fix.');
        expect(find.text('Gemini CLI'), findsNothing,
            reason:
                'Site #3 must NOT show stale "Gemini CLI" after errored model switch. '
                'This was the exact smoke failure on 2026-05-26.');

        // Site #4.
        await tester.pumpWidget(MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: ChangeNotifierProvider<AgentConfigsController>.value(
              value: configsCtrl,
              child: Center(child: BubbleHeaderTestHarness(entry: entry)),
            ),
          ),
        ));
        await tester.pump();
        expect(find.text('Claude Code'), findsOneWidget,
            reason: 'Site #4 must show Claude Code after errored model switch. '
                'SMOKE FAILURE: this site showed "Gemini CLI" (stale) before fix.');
        expect(find.text('Gemini CLI'), findsNothing,
            reason:
                'Site #4 must NOT show stale "Gemini CLI" after errored model switch. '
                'This was the exact smoke failure on 2026-05-26.');
      },
    );
  });
}
