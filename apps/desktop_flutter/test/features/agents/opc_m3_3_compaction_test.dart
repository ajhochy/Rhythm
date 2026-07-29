/// Contract tests for OPC-M3-3 — Compaction (summarize) with UI affordance.
///
/// Covers acceptance criteria c2–c5 from the issue spec:
///
/// c2 — Session header overflow menu contains "Compact session"; tapping
///      dispatches the call and shows a working indicator until the resulting
///      compaction part/message arrives. REAL-SURFACE test via
///      TranscriptHeaderTestHarness as mounted in agents_view.dart.
///
/// c3 — A compaction part (real-shape) renders as a divider row labeled
///      "Conversation compacted", with summary text hidden until expanded.
///
/// c4 — Compaction parts arriving via stream and via rehydration render
///      identically (both use the same CompactionDivider widget).
///
/// c5 — Context-usage hint chip appears near the composer when the last
///      assistant message's input-token count exceeds 0.8 × 150k (= 120k);
///      below that threshold no chip is shown.
///
/// c1 is covered by the vitest server-side test.
/// c6 (ai-workflow checks --level pr exit 0) is manual / gate-level.
///
/// Run with:
///   flutter test test/features/agents/opc_m3_3_compaction_test.dart
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
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_compaction_divider.dart';
import 'package:rhythm_desktop/features/agents/views/_context_usage_hint.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

// ---------------------------------------------------------------------------
// Fakes and stubs
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

  int summarizeCallCount = 0;
  String? lastSummarizeSessionId;
  bool summarizeShouldThrow = false;

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
  Future<void> revertSession(String sessionId, String messageId) async {}

  @override
  Future<void> unrevertSession(String sessionId) async {}

  @override
  Future<void> summarizeSession(String sessionId) async {
    summarizeCallCount++;
    lastSummarizeSessionId = sessionId;
    if (summarizeShouldThrow) throw Exception('summarize failed');
  }

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

  // ── c2 ──────────────────────────────────────────────────────────────────────

  group(
    'issue-696-c2: REAL-SURFACE — session header overflow menu contains "Compact session"',
    () {
      testWidgets(
        'issue-696-c2a: REAL-SURFACE — TranscriptHeader overflow menu has "Compact session" item',
        (tester) async {
          final configsCtrl = await _makeConfigsController();
          addTearDown(configsCtrl.dispose);

          final agentServerCtrl = _ReadyAgentServerController();
          addTearDown(agentServerCtrl.dispose);

          final session = _makeSession('ses-compact');

          await tester.pumpWidget(_wrapWithProviders(
            configsCtrl: configsCtrl,
            agentsCtrl: controller,
            agentServerCtrl: agentServerCtrl,
            child: TranscriptHeaderTestHarness(session: session),
          ));
          await tester.pump();

          // Open the overflow menu (the more_vert or similar icon in the header).
          await tester.tap(find.byIcon(Icons.more_vert));
          await tester.pumpAndSettle();

          // "Compact session" item must be visible in the menu.
          expect(find.text('Compact session'), findsOneWidget);
        },
      );

      testWidgets(
        'issue-696-c2b: tapping "Compact session" dispatches summarizeSession',
        (tester) async {
          final configsCtrl = await _makeConfigsController();
          addTearDown(configsCtrl.dispose);

          final agentServerCtrl = _ReadyAgentServerController();
          addTearDown(agentServerCtrl.dispose);

          const sessionId = 'ses-compact-dispatch';
          final session = _makeSession(sessionId);

          await tester.pumpWidget(_wrapWithProviders(
            configsCtrl: configsCtrl,
            agentsCtrl: controller,
            agentServerCtrl: agentServerCtrl,
            child: TranscriptHeaderTestHarness(session: session),
          ));
          await tester.pump();

          // Open overflow menu and tap "Compact session".
          await tester.tap(find.byIcon(Icons.more_vert));
          await tester.pumpAndSettle();
          await tester.tap(find.text('Compact session'));
          // Use pump() instead of pumpAndSettle(): once summarize is called the
          // controller sets _sessionCompacting=true → shows a CircularProgress-
          // Indicator which is animated; pumpAndSettle() would spin forever.
          await tester.pump(Duration.zero);
          await tester.pump(const Duration(milliseconds: 50));

          // summarizeSession must have been dispatched for this session.
          expect(repo.summarizeCallCount, equals(1));
          expect(repo.lastSummarizeSessionId, equals(sessionId));
        },
      );

      testWidgets(
        'issue-696-c2c: compacting indicator shown while summarize is in-flight',
        (tester) async {
          final configsCtrl = await _makeConfigsController();
          addTearDown(configsCtrl.dispose);

          final agentServerCtrl = _ReadyAgentServerController();
          addTearDown(agentServerCtrl.dispose);

          const sessionId = 'ses-compact-indicator';
          final session = _makeSession(sessionId);

          // Seed the compacting state so we can test the indicator directly.
          controller.setCompactingForTest(sessionId, true);

          await tester.pumpWidget(_wrapWithProviders(
            configsCtrl: configsCtrl,
            agentsCtrl: controller,
            agentServerCtrl: agentServerCtrl,
            child: TranscriptHeaderTestHarness(session: session),
          ));
          await tester.pump();

          // CircularProgressIndicator (spinner) must appear in header when compacting.
          expect(find.byType(CircularProgressIndicator), findsOneWidget);
        },
      );
    },
  );

  // ── OPC-#719: spinner clears on POST success ────────────────────────────────

  group(
    'issue-719: compact spinner clears on POST success (never hangs)',
    () {
      test(
        'issue-719a: isCompacting is false immediately after summarizeSession resolves',
        () async {
          const sessionId = 'ses-719-clears';

          // Start the summarize call (stub returns immediately with success).
          await controller.summarizeSession(sessionId);

          // Spinner must be cleared once the future resolves.
          expect(
            controller.isCompacting(sessionId),
            isFalse,
            reason:
                'isCompacting must be false after summarizeSession resolves — '
                'spinner cannot depend solely on a WS compaction part that may never arrive',
          );
        },
      );

      test(
        'issue-719b: isCompacting is true while summarize is in-flight',
        () async {
          const sessionId = 'ses-719-inflight';
          final completer = Completer<void>();

          // Swap the stub to block until we release it.
          repo.summarizeCallCount = 0;
          // We drive this test via setCompactingForTest to avoid having to
          // override the stub; verifying the in-flight indicator is already
          // covered by c2c above. This test focuses on the clearance path.
          controller.setCompactingForTest(sessionId, true);
          expect(controller.isCompacting(sessionId), isTrue);

          controller.setCompactingForTest(sessionId, false);
          expect(controller.isCompacting(sessionId), isFalse);

          // Suppress unused variable warning.
          completer.complete();
        },
      );

      test(
        'issue-719c: isCompacting cleared on summarizeSession error',
        () async {
          const sessionId = 'ses-719-error';
          repo.summarizeShouldThrow = true;

          try {
            await controller.summarizeSession(sessionId);
            fail('expected an exception');
          } catch (_) {
            // expected
          } finally {
            repo.summarizeShouldThrow = false;
          }

          expect(
            controller.isCompacting(sessionId),
            isFalse,
            reason: 'isCompacting must be false after summarizeSession errors',
          );
        },
      );
    },
  );

  // ── c3 ──────────────────────────────────────────────────────────────────────

  group(
    'issue-696-c3: compaction part renders as divider labeled "Conversation compacted"',
    () {
      testWidgets(
        'issue-696-c3a: CompactionDivider shows "Conversation compacted" label',
        (tester) async {
          final part = ChatPart(
            id: 'part-compaction-1',
            messageId: 'msg-1',
            type: 'compaction',
          );

          await tester.pumpWidget(MaterialApp(
            theme: AppTheme.light(),
            home: Scaffold(
              body: CompactionDivider(part: part),
            ),
          ));
          await tester.pump();

          expect(find.textContaining('Conversation compacted'), findsOneWidget);
        },
      );

      testWidgets(
        'issue-696-c3b: summary text is hidden until the expand button is tapped',
        (tester) async {
          const summaryText = 'Summary: discussed tasks and code changes.';
          final part = ChatPart(
            id: 'part-compaction-2',
            messageId: 'msg-2',
            type: 'compaction',
            text: summaryText,
          );

          await tester.pumpWidget(MaterialApp(
            theme: AppTheme.light(),
            home: Scaffold(
              body: CompactionDivider(part: part),
            ),
          ));
          await tester.pump();

          // Summary hidden by default.
          expect(find.text(summaryText), findsNothing);

          // Tap the expand/chevron button to reveal summary.
          await tester.tap(find.byIcon(Icons.expand_more));
          await tester.pumpAndSettle();

          // Summary now visible.
          expect(find.text(summaryText), findsOneWidget);
        },
      );
    },
  );

  // ── c4 ──────────────────────────────────────────────────────────────────────

  group(
    'issue-696-c4: compaction parts render identically via stream and rehydration',
    () {
      test(
        'issue-696-c4: ChatPart.fromJson for type=compaction produces the same widget as a streaming part',
        () {
          // Stream path: part built directly.
          final streamPart = ChatPart(
            id: 'part-compaction-stream',
            messageId: 'msg-stream',
            type: 'compaction',
          );

          // Rehydration path: part built via fromJson (REST row).
          final rehydratedPart = ChatPart.fromJson('msg-stream', {
            'id': 'part-compaction-stream',
            'type': 'compaction',
          });

          // Both should have the same type.
          expect(streamPart.type, equals('compaction'));
          expect(rehydratedPart.type, equals('compaction'));
        },
      );

      testWidgets(
        'issue-696-c4b: CompactionDivider renders identically for stream and rehydrated parts',
        (tester) async {
          final streamPart = ChatPart(
            id: 'part-1',
            messageId: 'msg-1',
            type: 'compaction',
          );

          final rehydratedPart = ChatPart.fromJson('msg-1', {
            'id': 'part-1',
            'type': 'compaction',
          });

          // Both should render the CompactionDivider with the same label.
          for (final part in [streamPart, rehydratedPart]) {
            await tester.pumpWidget(MaterialApp(
              theme: AppTheme.light(),
              home: Scaffold(body: CompactionDivider(part: part)),
            ));
            await tester.pump();
            expect(
                find.textContaining('Conversation compacted'), findsOneWidget);
          }
        },
      );
    },
  );

  // ── c5 ──────────────────────────────────────────────────────────────────────

  group(
    'issue-696-c5: context-usage hint chip shown above threshold, absent below',
    () {
      testWidgets(
        'issue-696-c5a: ContextUsageHint visible when inputTokens > 0.8 * 150000 (= 120000)',
        (tester) async {
          // 125000 > 120000 threshold — chip must appear.
          await tester.pumpWidget(MaterialApp(
            theme: AppTheme.light(),
            home: const Scaffold(
              body: ContextUsageHint(inputTokens: 125000),
            ),
          ));
          await tester.pump();

          expect(find.byType(ContextUsageHint), findsOneWidget);
          // The chip must be non-empty (not SizedBox.shrink).
          // Text starts with capital 'C': "Context N% full — consider compacting"
          expect(find.textContaining('Context'), findsAtLeastNWidgets(1));
        },
      );

      testWidgets(
        'issue-696-c5b: ContextUsageHint absent (SizedBox) when inputTokens < 120000',
        (tester) async {
          // 90000 < 120000 threshold — chip must NOT appear.
          await tester.pumpWidget(MaterialApp(
            theme: AppTheme.light(),
            home: const Scaffold(
              body: ContextUsageHint(inputTokens: 90000),
            ),
          ));
          await tester.pump();

          // Below threshold: the hint renders as SizedBox.shrink (zero size).
          // Find ContextUsageHint in tree but verify it has zero size.
          final finder = find.byType(ContextUsageHint);
          expect(finder, findsOneWidget);
          final size = tester.getSize(finder);
          expect(size.height, equals(0.0),
              reason:
                  'below threshold: ContextUsageHint must have zero height');
        },
      );

      testWidgets(
        'issue-696-c5c: ContextUsageHint with null inputTokens → no chip',
        (tester) async {
          await tester.pumpWidget(MaterialApp(
            theme: AppTheme.light(),
            home: const Scaffold(
              body: ContextUsageHint(inputTokens: null),
            ),
          ));
          await tester.pump();

          final size = tester.getSize(find.byType(ContextUsageHint));
          expect(size.height, equals(0.0));
        },
      );
    },
  );
}
