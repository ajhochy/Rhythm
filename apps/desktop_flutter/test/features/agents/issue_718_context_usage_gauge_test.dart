/// Contract tests for Issue #718 — Context-usage gauge in the Context tab.
///
/// Acceptance criteria verified here:
///
///   c1 — sessionTotalInputTokens() on [AgentsController] returns 0 when the
///        session has no messages, and correctly sums the `input` field across
///        all messages otherwise.
///
///   c2 — _ContextUsageGauge shows "No messages yet" when tokensUsed == 0.
///
///   c3 — _ContextUsageGauge shows a formatted label and a
///        [LinearProgressIndicator] when tokensUsed > 0.
///
///   c4 — The progress bar value is capped at 1.0 when tokensUsed exceeds
///        the 200k context window (e.g. 250k tokens → fraction = 1.0).
///
///   c5 — contextWindowForSession() returns the catalog contextLimit when
///        the session's providerId+modelId match a catalog entry, and null
///        when no match is found.
///
///   c6 — _ContextUsageGauge with contextWindow: 1 000 000 (1M) shows "1000k"
///        in the capacity label, proving the real window is used as denominator.
///
/// Run with:
///   flutter test test/features/agents/issue_718_context_usage_gauge_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';

import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agent_configs/controllers/agent_configs_controller.dart';
import 'package:rhythm_desktop/features/agent_configs/data/agent_configs_data_source.dart';
import 'package:rhythm_desktop/features/agent_configs/repositories/agent_configs_repository.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/catalog_model_entry.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_session_side_panel.dart';
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
}

class _StubAgentsRepository implements AgentsRepository {
  _StubAgentsRepository()
      : _msgController = StreamController.broadcast(),
        _connectivityController = StreamController.broadcast();

  final StreamController<AgentWsMessage> _msgController;
  final StreamController<bool> _connectivityController;

  @override
  Stream<AgentWsMessage> get messages => _msgController.stream;

  @override
  Stream<bool> get connectivityStream => _connectivityController.stream;

  @override
  bool get isConnected => true;

  @override
  Future<void> connect() async {}

  @override
  Future<void> dispose() async {
    await _msgController.close();
    await _connectivityController.close();
  }

  @override
  void send(Map<String, dynamic> msg) {}

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
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
  Future<void> revertSession(String sessionId, String messageId) async {}

  @override
  Future<void> unrevertSession(String sessionId) async {}

  @override
  Future<void> summarizeSession(String sessionId) async {}

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

final _kEpoch = DateTime.fromMillisecondsSinceEpoch(0);

AgentSession _makeSession(String id) => AgentSession(
      id: id,
      agentId: 'claude-code',
      name: 'Test Session',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: _kEpoch,
      updatedAt: _kEpoch,
    );

AgentsController _buildController(_StubAgentsRepository repo) =>
    AgentsController(
      repo,
      _ReadyAgentServerController(),
      LocalNotificationService(),
      NotificationsController(
        NotificationsRepository(NotificationsDataSource()),
      ),
    );

Future<AgentConfigsController> _makeConfigsController() async {
  final dataSource = AgentConfigsDataSource();
  final repository = AgentConfigsRepository(dataSource);
  final ctrl = AgentConfigsController(repository);
  await ctrl.refresh();
  return ctrl;
}

Widget _wrapWithProviders({
  required AgentConfigsController configsCtrl,
  required AgentsController agentsCtrl,
  required AgentServerController agentServerCtrl,
  required Widget child,
}) {
  return MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(
      body: MultiProvider(
        providers: [
          ChangeNotifierProvider<AgentConfigsController>.value(
              value: configsCtrl),
          ChangeNotifierProvider<AgentsController>.value(value: agentsCtrl),
          ChangeNotifierProvider<AgentServerController>.value(
              value: agentServerCtrl),
        ],
        child: Center(child: child),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  late _StubAgentsRepository repo;
  late AgentsController controller;

  setUp(() {
    repo = _StubAgentsRepository();
    controller = _buildController(repo);
  });

  tearDown(() {
    controller.dispose();
  });

  // ── c1: sessionTotalInputTokens ──────────────────────────────────────────

  group('issue-718-c1: sessionTotalInputTokens()', () {
    test(
      'issue-718-c1a: returns 0 when session has no messages',
      () {
        expect(controller.sessionTotalInputTokens('no-session'), equals(0));
      },
    );

    test(
      'issue-718-c1b: sums input tokens across all messages',
      () {
        const sessionId = 'ses-tokens';
        // Inject two assistant messages with token data.
        controller.setMessageForTest(ChatMessage(
          id: 'msg-1',
          sessionId: sessionId,
          role: 'assistant',
          createdAt: _kEpoch,
          tokens: {'input': 50000, 'output': 1000},
        ));
        controller.setMessageForTest(ChatMessage(
          id: 'msg-2',
          sessionId: sessionId,
          role: 'assistant',
          createdAt: _kEpoch,
          tokens: {'input': 75000, 'output': 2000},
        ));
        // Total input = 50000 + 75000 = 125000.
        expect(
          controller.sessionTotalInputTokens(sessionId),
          equals(125000),
        );
      },
    );

    test(
      'issue-718-c1c: ignores messages with null tokens',
      () {
        const sessionId = 'ses-null-tokens';
        controller.setMessageForTest(ChatMessage(
          id: 'msg-user',
          sessionId: sessionId,
          role: 'user',
          createdAt: _kEpoch,
          // No tokens field — typical for user messages.
        ));
        controller.setMessageForTest(ChatMessage(
          id: 'msg-asst',
          sessionId: sessionId,
          role: 'assistant',
          createdAt: _kEpoch,
          tokens: {'input': 30000, 'output': 500},
        ));
        expect(
          controller.sessionTotalInputTokens(sessionId),
          equals(30000),
        );
      },
    );
  });

  // ── c1': sessionContextTokens — the metric the gauge actually uses ───────
  group(
      'issue-718-c1prime: sessionContextTokens() is current occupancy, not a sum',
      () {
    test('returns the LATEST turn prompt size (input + cache), NOT the sum',
        () {
      const sessionId = 'ses-ctx';
      controller.setMessageForTest(ChatMessage(
        id: 'm1',
        sessionId: sessionId,
        role: 'assistant',
        createdAt: _kEpoch,
        tokens: {'input': 50000, 'output': 1000},
      ));
      controller.setMessageForTest(ChatMessage(
        id: 'm2',
        sessionId: sessionId,
        role: 'assistant',
        createdAt: _kEpoch,
        tokens: {'input': 75000, 'output': 2000},
      ));
      // NOT 125000 (the buggy sum) — the latest turn's prompt is 75000.
      expect(controller.sessionContextTokens(sessionId), equals(75000));
    });

    test('counts cached input (cache read+write) toward the prompt size', () {
      const sessionId = 'ses-cache';
      // Mirrors the real bug report: input 5, cache 45795 → 45800, not 100%.
      controller.setMessageForTest(ChatMessage(
        id: 'm1',
        sessionId: sessionId,
        role: 'assistant',
        createdAt: _kEpoch,
        tokens: {
          'input': 5,
          'output': 19,
          'cache': {'read': 45795, 'write': 0},
        },
      ));
      expect(controller.sessionContextTokens(sessionId), equals(45800));
    });

    test('returns 0 for a session with no token-bearing messages', () {
      expect(controller.sessionContextTokens('nope'), equals(0));
    });
  });

  // ── c2: gauge shows placeholder when tokensUsed == 0 ────────────────────

  group('issue-718-c2: _ContextUsageGauge zero-tokens placeholder', () {
    testWidgets(
      'issue-718-c2: shows "No messages yet" when session has no token data',
      (tester) async {
        final configsCtrl = await _makeConfigsController();
        addTearDown(configsCtrl.dispose);

        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);

        final session = _makeSession('ses-zero');

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: controller,
          agentServerCtrl: agentServerCtrl,
          child: SessionSidePanel(session: session),
        ));
        await tester.pump();

        // The Context tab is selected by default.
        expect(find.text('No messages yet'), findsOneWidget);
        // No progress bar when there are no tokens.
        expect(find.byType(LinearProgressIndicator), findsNothing);
      },
    );
  });

  // ── c3: gauge shows bar + label when tokensUsed > 0 ─────────────────────

  group('issue-718-c3: _ContextUsageGauge with token data', () {
    testWidgets(
      'issue-718-c3: shows progress bar and formatted label when tokens > 0',
      (tester) async {
        final configsCtrl = await _makeConfigsController();
        addTearDown(configsCtrl.dispose);

        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);

        const sessionId = 'ses-with-tokens';
        final session = _makeSession(sessionId);

        // Seed 128k input tokens.
        controller.setMessageForTest(ChatMessage(
          id: 'msg-a',
          sessionId: sessionId,
          role: 'assistant',
          createdAt: _kEpoch,
          tokens: {'input': 128000, 'output': 1000},
        ));

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: controller,
          agentServerCtrl: agentServerCtrl,
          child: SessionSidePanel(session: session),
        ));
        await tester.pump();

        // Progress bar must be present.
        expect(find.byType(LinearProgressIndicator), findsOneWidget);
        // Label should contain the usage fraction (128k / 200k).
        expect(find.textContaining('128k'), findsOneWidget);
        expect(find.textContaining('200k'), findsOneWidget);
        // No "No messages yet" placeholder.
        expect(find.text('No messages yet'), findsNothing);
      },
    );
  });

  // ── c4: progress bar capped at 1.0 above context window ─────────────────

  group('issue-718-c4: _ContextUsageGauge caps at 100%', () {
    testWidgets(
      'issue-718-c4: LinearProgressIndicator.value capped at 1.0 when tokens > 200k',
      (tester) async {
        final configsCtrl = await _makeConfigsController();
        addTearDown(configsCtrl.dispose);

        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);

        const sessionId = 'ses-overflow';
        final session = _makeSession(sessionId);

        // 250k > 200k context window — fraction must be capped at 1.0.
        controller.setMessageForTest(ChatMessage(
          id: 'msg-b',
          sessionId: sessionId,
          role: 'assistant',
          createdAt: _kEpoch,
          tokens: {'input': 250000, 'output': 5000},
        ));

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: controller,
          agentServerCtrl: agentServerCtrl,
          child: SessionSidePanel(session: session),
        ));
        await tester.pump();

        final indicator = tester.widget<LinearProgressIndicator>(
          find.byType(LinearProgressIndicator),
        );
        // value must be capped at 1.0.
        expect(indicator.value, equals(1.0));
      },
    );
  });

  // ── c5: contextWindowForSession() catalog lookup ─────────────────────────

  group('issue-718-c5: contextWindowForSession()', () {
    test(
      'issue-718-c5a: returns contextLimit from catalog when providerId + modelId match',
      () {
        // Seed catalog with one entry that has a contextLimit.
        controller.setCatalogForTest([
          const CatalogModelEntry(
            agent: 'claude-code',
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-6',
            displayName: 'claude-sonnet-4-6',
            route: 'direct',
            authorized: true,
            authProvider: 'anthropic',
            contextLimit: 200000,
          ),
        ]);

        final session = AgentSession(
          id: 'ses-match',
          agentId: 'claude-code',
          name: 'Match',
          cwd: '/tmp',
          status: AgentSessionStatus.idle,
          createdAt: _kEpoch,
          updatedAt: _kEpoch,
          providerId: 'anthropic',
          modelId: 'claude-sonnet-4-6',
        );

        expect(controller.contextWindowForSession(session), equals(200000));
      },
    );

    test(
      'issue-718-c5b: returns null when session has no providerId',
      () {
        controller.setCatalogForTest([
          const CatalogModelEntry(
            agent: 'claude-code',
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-6',
            displayName: 'claude-sonnet-4-6',
            route: 'direct',
            authorized: true,
            authProvider: 'anthropic',
            contextLimit: 200000,
          ),
        ]);

        final session = _makeSession('ses-no-model'); // no providerId/modelId
        expect(controller.contextWindowForSession(session), isNull);
      },
    );

    test(
      'issue-718-c5c: returns null when catalog has no matching entry',
      () {
        controller.setCatalogForTest([
          const CatalogModelEntry(
            agent: 'claude-code',
            provider: 'anthropic',
            modelId: 'claude-sonnet-4-6',
            displayName: 'claude-sonnet-4-6',
            route: 'direct',
            authorized: true,
            authProvider: 'anthropic',
            contextLimit: 200000,
          ),
        ]);

        final session = AgentSession(
          id: 'ses-no-match',
          agentId: 'claude-code',
          name: 'No-match',
          cwd: '/tmp',
          status: AgentSessionStatus.idle,
          createdAt: _kEpoch,
          updatedAt: _kEpoch,
          providerId: 'openai',
          modelId: 'gpt-5',
        );

        expect(controller.contextWindowForSession(session), isNull);
      },
    );
  });

  // ── c6: gauge uses real context window from catalog ───────────────────────

  group('issue-718-c6: gauge uses real context window (1M token model)', () {
    testWidgets(
      'issue-718-c6: capacity label shows 1000k when contextWindow is 1000000',
      (tester) async {
        final configsCtrl = await _makeConfigsController();
        addTearDown(configsCtrl.dispose);

        final agentServerCtrl = _ReadyAgentServerController();
        addTearDown(agentServerCtrl.dispose);

        const sessionId = 'ses-1m';
        // Seed catalog with a 1M-token model.
        controller.setCatalogForTest([
          const CatalogModelEntry(
            agent: 'claude-code',
            provider: 'anthropic',
            modelId: 'claude-sonnet-1m',
            displayName: 'claude-sonnet-1m',
            route: 'direct',
            authorized: true,
            authProvider: 'anthropic',
            contextLimit: 1000000,
          ),
        ]);

        final session = AgentSession(
          id: sessionId,
          agentId: 'claude-code',
          name: '1M Model',
          cwd: '/tmp',
          status: AgentSessionStatus.idle,
          createdAt: _kEpoch,
          updatedAt: _kEpoch,
          providerId: 'anthropic',
          modelId: 'claude-sonnet-1m',
        );

        // Seed 500k tokens (well within 1M window).
        controller.setMessageForTest(ChatMessage(
          id: 'msg-1m',
          sessionId: sessionId,
          role: 'assistant',
          createdAt: _kEpoch,
          tokens: {'input': 500000, 'output': 1000},
        ));

        await tester.pumpWidget(_wrapWithProviders(
          configsCtrl: configsCtrl,
          agentsCtrl: controller,
          agentServerCtrl: agentServerCtrl,
          child: SessionSidePanel(session: session),
        ));
        await tester.pump();

        // Progress bar must be present.
        expect(find.byType(LinearProgressIndicator), findsOneWidget);
        // Capacity label must show "1000k" (the real 1M window).
        expect(find.textContaining('1000k'), findsOneWidget);
        // Value should be ~0.5 (500k / 1000k).
        final indicator = tester.widget<LinearProgressIndicator>(
          find.byType(LinearProgressIndicator),
        );
        expect(indicator.value, closeTo(0.5, 0.01));
      },
    );
  });
}
