/// Executable acceptance contract for issue #1361.
///
/// The lifecycle issue extends the #1360 surface with these testable inputs:
///
/// ```dart
/// ArtifactsTab({
///   int? userId,
///   LiveArtifactsController? dashboardController,
///   FutureOr<void> Function()? onNavigateToDashboard,
///   // ...the existing #1360 arguments
/// });
///
/// LiveArtifactView({
///   bool compact = false,
///   int reloadToken = 0,
///   // ...the existing secure-runtime arguments
/// });
/// ```
///
/// `sessionId` plus `userId` are the inspector identity boundary. A changed
/// `reloadToken` reloads the existing stable-ID viewer without changing its
/// key. Provider-account identity is deliberately absent from that boundary.
///
/// Run with:
///   flutter test test/features/agents/issue_1361_artifact_lifecycle_contract_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/views/_artifacts_tab.dart';
import 'package:rhythm_desktop/features/live_artifacts/controllers/live_artifacts_controller.dart';
import 'package:rhythm_desktop/features/live_artifacts/data/live_artifacts_data_source.dart';
import 'package:rhythm_desktop/features/live_artifacts/models/live_artifact.dart';
import 'package:rhythm_desktop/features/live_artifacts/widgets/live_artifact_view.dart';
import 'package:rhythm_desktop/features/settings/data/user_preferences_data_source.dart';

const _artifactA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const _artifactB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

AgentSessionMessage _mutation({
  required int id,
  required String sessionId,
  required String artifactId,
  String tool = 'rhythm_update_live_artifact_state',
}) =>
    AgentSessionMessage(
      id: id,
      sessionId: sessionId,
      role: 'output',
      rawText: '',
      strippedText: '',
      createdAt: DateTime.fromMillisecondsSinceEpoch(id * 1000, isUtc: true),
      sdkMessageId: 'msg-$id',
      parts: [
        {
          'type': 'tool',
          'tool': tool,
          'state': {
            'status': 'completed',
            'input': {'id': artifactId},
          },
        },
      ],
    );

LiveArtifact _artifact(
  String id, {
  String? title,
  int bundleRevision = 1,
  int stateRevision = 1,
}) =>
    LiveArtifact(
      id: id,
      title: title ?? 'Artifact $id',
      updatedAt: DateTime(2026, 8, 11),
      currentBundleRevision: bundleRevision,
      currentStateRevision: stateRevision,
    );

class _Preferences extends UserPreferencesDataSource {
  _Preferences() : super(baseUrl: 'http://contract.invalid');

  final List<List<String>> saves = [];

  @override
  Future<Map<String, dynamic>> updateArtifactTabIds(List<String> ids) async {
    saves.add(List.of(ids));
    return const {};
  }
}

class _ArtifactSource extends LiveArtifactsDataSource {
  _ArtifactSource({Map<String, LiveArtifact>? artifacts})
      : artifacts = artifacts ?? {},
        super(baseUrl: 'http://contract.invalid');

  final Map<String, LiveArtifact> artifacts;
  final List<String> getCalls = [];
  final List<String> renderCalls = [];

  @override
  Future<List<LiveArtifact>> list() async => artifacts.values.toList();

  @override
  Future<LiveArtifact> get(String id) async {
    getCalls.add(id);
    return artifacts[id] ?? _artifact(id);
  }

  @override
  Future<String> render(String id) async {
    renderCalls.add(id);
    return '<main>$id</main>';
  }
}

class _RevisionSource extends _ArtifactSource {
  int aGets = 0;

  @override
  Future<LiveArtifact> get(String id) async {
    getCalls.add(id);
    if (id != _artifactA) return _artifact(id);
    aGets++;
    final revision = aGets <= 2 ? 1 : 2;
    return _artifact(
      id,
      title: 'Calendar revision $revision',
      bundleRevision: revision,
      stateRevision: revision,
    );
  }
}

class _SequencedSource extends _ArtifactSource {
  _SequencedSource(this.responses);

  final Map<String, List<Future<LiveArtifact>>> responses;

  @override
  Future<LiveArtifact> get(String id) {
    getCalls.add(id);
    final queue = responses[id];
    if (queue == null || queue.isEmpty) return Future.value(_artifact(id));
    return queue.removeAt(0);
  }
}

Widget _host(Widget child, {double width = 520}) => MaterialApp(
      home: Scaffold(
        body: SizedBox(width: width, height: 700, child: child),
      ),
    );

ArtifactsTab _tab({
  required Key key,
  required String sessionId,
  required int userId,
  required List<AgentSessionMessage> messages,
  required LiveArtifactsDataSource source,
  LiveArtifactsController? dashboardController,
  FutureOr<void> Function()? onNavigateToDashboard,
}) =>
    ArtifactsTab(
      key: key,
      sessionId: sessionId,
      userId: userId,
      initialMessages: messages,
      dataSource: source,
      dashboardController: dashboardController,
      onNavigateToDashboard: onNavigateToDashboard,
      enableNativeRuntime: false,
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'issue-1361-c1: Open in Dashboard uses the existing controller to select the exact artifact before navigating',
    (tester) async {
      // Regression caught: the handoff navigates without pinning, or pins the
      // first row instead of the selected row; selectedId/navigation assertions
      // fail on the real controller.
      final source = _ArtifactSource(artifacts: {
        _artifactA: _artifact(_artifactA, title: 'Alpha'),
        _artifactB: _artifact(_artifactB, title: 'Beta'),
      });
      final controller = LiveArtifactsController(source, _Preferences());
      addTearDown(controller.dispose);
      var navigations = 0;
      await tester.pumpWidget(_host(_tab(
        key: const ValueKey('inspector'),
        sessionId: 'session-exact',
        userId: 7,
        messages: [
          _mutation(id: 1, sessionId: 'session-exact', artifactId: _artifactA),
          _mutation(id: 2, sessionId: 'session-exact', artifactId: _artifactB),
        ],
        source: source,
        dashboardController: controller,
        onNavigateToDashboard: () => navigations++,
      )));
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const ValueKey('artifact-selector')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Alpha').last);
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('artifact-open-dashboard-button')),
      );
      await tester.pumpAndSettle();

      expect(controller.selectedId, _artifactA);
      expect(controller.tabs.single.id, _artifactA);
      expect(navigations, 1);
    },
  );

  testWidgets(
    'issue-1361-c2: Dashboard handoff preserves one stable ID without a duplicate controller record',
    (tester) async {
      // Regression caught: opening an artifact already pinned in Dashboard
      // appends a second tab or substitutes a transient inspector identity;
      // the one-tab and exact-ID assertions fail.
      final artifact = _artifact(_artifactA, title: 'Stable Calendar');
      final source = _ArtifactSource(artifacts: {_artifactA: artifact});
      final controller = LiveArtifactsController(source, _Preferences());
      addTearDown(controller.dispose);
      controller.debugSetForTest(tabs: [
        LiveArtifactTab(
          id: _artifactA,
          status: LiveArtifactTabStatus.ready,
          artifact: artifact,
        ),
      ]);
      controller.select(null);

      await tester.pumpWidget(_host(_tab(
        key: const ValueKey('inspector'),
        sessionId: 'session-exact',
        userId: 7,
        messages: [
          _mutation(id: 1, sessionId: 'session-exact', artifactId: _artifactA),
        ],
        source: source,
        dashboardController: controller,
        onNavigateToDashboard: () {},
      )));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(const ValueKey('artifact-open-dashboard-button')),
      );
      await tester.pumpAndSettle();

      expect(controller.tabs, hasLength(1));
      expect(controller.tabs.single.id, _artifactA);
      expect(controller.selectedId, _artifactA);
    },
  );

  testWidgets(
    'issue-1361-c3: a later supported mutation reloads the selected preview under the same stable ID',
    (tester) async {
      // Regression caught: transcript updates only refresh selector metadata,
      // or create a replacement identity instead of reloading the selected
      // secure viewer; render count and stable preview-key assertions fail.
      final source = _RevisionSource();
      final first = [
        _mutation(id: 1, sessionId: 'session-exact', artifactId: _artifactA),
      ];
      await tester.pumpWidget(_host(_tab(
        key: const ValueKey('inspector'),
        sessionId: 'session-exact',
        userId: 7,
        messages: first,
        source: source,
      )));
      await tester.pumpAndSettle();
      expect(source.renderCalls, [_artifactA]);

      await tester.pumpWidget(_host(_tab(
        key: const ValueKey('inspector'),
        sessionId: 'session-exact',
        userId: 7,
        messages: [
          ...first,
          _mutation(id: 2, sessionId: 'session-exact', artifactId: _artifactA),
        ],
        source: source,
      )));
      await tester.pumpAndSettle();

      expect(source.renderCalls, [_artifactA, _artifactA]);
      expect(find.byKey(const ValueKey('artifact-preview-$_artifactA')),
          findsOneWidget);
      expect(find.byKey(const ValueKey('artifact-preview-$_artifactB')),
          findsNothing);
    },
  );

  testWidgets(
    'issue-1361-c4: inspector resize and rebuild preserve the mounted viewer state and interaction',
    (tester) async {
      // Regression caught: a layout rebuild gives LiveArtifactView a new key,
      // recreating WKWebView and losing page interaction; State identity and
      // single-render assertions fail.
      final source = _ArtifactSource();
      final messages = [
        _mutation(id: 1, sessionId: 'session-exact', artifactId: _artifactA),
      ];
      final tab = _tab(
        key: const ValueKey('inspector'),
        sessionId: 'session-exact',
        userId: 7,
        messages: messages,
        source: source,
      );
      await tester.pumpWidget(_host(tab, width: 520));
      await tester.pumpAndSettle();
      final before = tester.state(find.byType(LiveArtifactView));

      await tester.pumpWidget(_host(
          _tab(
            key: const ValueKey('inspector'),
            sessionId: 'session-exact',
            userId: 7,
            messages: messages,
            source: source,
          ),
          width: 360));
      await tester.pumpAndSettle();
      final after = tester.state(find.byType(LiveArtifactView));

      expect(identical(after, before), isTrue);
      expect(source.renderCalls, [_artifactA]);
    },
  );

  testWidgets(
    'issue-1361-c5: session and user switches dispose the prior viewer and reject stale late responses',
    (tester) async {
      // Regression caught: an old session/user detail response wins after the
      // identity boundary moves, or its viewer remains mounted; mounted-state,
      // selected-preview, and stale-title assertions fail.
      final stale = Completer<LiveArtifact>();
      final source = _SequencedSource({
        _artifactA: [
          Future.value(_artifact(_artifactA, title: 'A current')),
          Future.value(_artifact(_artifactA, title: 'A current')),
          stale.future,
        ],
        _artifactB: [
          Future.value(_artifact(_artifactB, title: 'B current')),
          Future.value(_artifact(_artifactB, title: 'B current')),
        ],
      });
      final aMessages = [
        _mutation(id: 1, sessionId: 'session-a', artifactId: _artifactA),
      ];
      await tester.pumpWidget(_host(_tab(
        key: const ValueKey('inspector'),
        sessionId: 'session-a',
        userId: 7,
        messages: aMessages,
        source: source,
      )));
      await tester.pumpAndSettle();
      final priorViewer = tester.state(find.byType(LiveArtifactView));

      await tester.pumpWidget(_host(_tab(
        key: const ValueKey('inspector'),
        sessionId: 'session-a',
        userId: 7,
        messages: [
          ...aMessages,
          _mutation(id: 2, sessionId: 'session-a', artifactId: _artifactA),
        ],
        source: source,
      )));
      await tester.pump();

      await tester.pumpWidget(_host(_tab(
        key: const ValueKey('inspector'),
        sessionId: 'session-b',
        userId: 8,
        messages: [
          _mutation(id: 3, sessionId: 'session-b', artifactId: _artifactB),
        ],
        source: source,
      )));
      await tester.pumpAndSettle();
      expect(priorViewer.mounted, isFalse);
      expect(find.byKey(const ValueKey('artifact-preview-$_artifactB')),
          findsOneWidget);

      stale.complete(_artifact(_artifactA, title: 'STALE USER A SECRET'));
      await tester.pumpAndSettle();

      expect(find.textContaining('STALE USER A SECRET'), findsNothing);
      expect(find.byKey(const ValueKey('artifact-preview-$_artifactA')),
          findsNothing);
      expect(find.byKey(const ValueKey('artifact-preview-$_artifactB')),
          findsOneWidget);
    },
  );

  testWidgets(
    'issue-1361-c6: provider-account switch alone does not invalidate or recreate the viewer',
    (tester) async {
      // Regression caught: the inspector keys lifecycle to an Anthropic/OpenAI
      // provider account instead of Rhythm user/session identity; State identity
      // and one-render assertions fail when only that inherited value changes.
      final providerAccount = ValueNotifier<String>('provider-account-a');
      addTearDown(providerAccount.dispose);
      final source = _ArtifactSource();
      final messages = [
        _mutation(id: 1, sessionId: 'session-exact', artifactId: _artifactA),
      ];

      Widget subject() => ValueListenableBuilder<String>(
            valueListenable: providerAccount,
            builder: (context, accountId, _) => Provider<String>.value(
              value: accountId,
              child: _tab(
                key: const ValueKey('inspector'),
                sessionId: 'session-exact',
                userId: 7,
                messages: messages,
                source: source,
              ),
            ),
          );

      await tester.pumpWidget(_host(subject()));
      await tester.pumpAndSettle();
      final before = tester.state(find.byType(LiveArtifactView));

      providerAccount.value = 'provider-account-b';
      await tester.pumpAndSettle();
      final after = tester.state(find.byType(LiveArtifactView));

      expect(identical(after, before), isTrue);
      expect(source.renderCalls, [_artifactA]);
      expect(find.byKey(const ValueKey('artifact-preview-$_artifactA')),
          findsOneWidget);
    },
  );

  testWidgets(
    'issue-1361-c7: existing pin, select, reload, and secure-view behavior remains intact',
    (tester) async {
      // Regression caught: lifecycle integration bypasses the shared controller
      // or replaces the secure view; pin/select/retry identity or exact runtime
      // composition assertions fail.
      final artifact = _artifact(_artifactA, title: 'Regression Calendar');
      final source = _ArtifactSource(artifacts: {_artifactA: artifact});
      final controller = LiveArtifactsController(source, _Preferences());
      addTearDown(controller.dispose);

      await controller.restore(7, const []);
      await controller.open(artifact);
      await controller.retryTab(_artifactA);

      expect(controller.tabs, hasLength(1));
      expect(controller.tabs.single.status, LiveArtifactTabStatus.ready);
      expect(controller.selectedId, _artifactA);

      await tester.pumpWidget(_host(_tab(
        key: const ValueKey('inspector'),
        sessionId: 'session-exact',
        userId: 7,
        messages: [
          _mutation(id: 1, sessionId: 'session-exact', artifactId: _artifactA),
        ],
        source: source,
      )));
      await tester.pumpAndSettle();

      expect(find.byType(LiveArtifactView), findsOneWidget);
      expect(find.byTooltip('Reload artifact'), findsOneWidget);
      expect(find.text('Regression Calendar'), findsWidgets);
    },
  );
}
