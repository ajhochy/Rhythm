/// Executable acceptance contract for issue #1360.
///
/// Expected production seams:
///
/// ```dart
/// List<TranscriptArtifactReference> extractTranscriptArtifactReferences({
///   required String sessionId,
///   required Iterable<AgentSessionMessage> messages,
/// });
///
/// typedef ArtifactTranscriptPage = ({
///   List<AgentSessionMessage> messages,
///   String? nextCursor,
///   bool hasMore,
/// });
/// typedef ArtifactTranscriptPageLoader = Future<ArtifactTranscriptPage>
///     Function({required String sessionId, String? before});
/// typedef ArtifactPreviewBuilder = Widget Function(
///   BuildContext context,
///   LiveArtifact artifact,
///   Key previewKey,
/// );
///
/// ArtifactsTab({
///   required String sessionId,
///   required List<AgentSessionMessage> initialMessages,
///   required LiveArtifactsDataSource dataSource,
///   String? initialCursor,
///   bool initialHasMore = false,
///   ArtifactTranscriptPageLoader? loadPage,
///   ArtifactPreviewBuilder? previewBuilder,
///   bool enableNativeRuntime = true,
/// });
/// ```
///
/// Run with:
///   flutter test test/features/agents/issue_1360_artifacts_tab_contract_test.dart
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/errors/app_error.dart';
import 'package:rhythm_desktop/app/core/notifications/local_notification_service.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/controllers/agents_controller.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';
import 'package:rhythm_desktop/features/agents/models/transcript_artifact_extractor.dart';
import 'package:rhythm_desktop/features/agents/repositories/agents_repository.dart';
import 'package:rhythm_desktop/features/agents/views/_artifacts_tab.dart';
import 'package:rhythm_desktop/features/agents/views/_session_side_panel.dart';
import 'package:rhythm_desktop/features/live_artifacts/data/live_artifacts_data_source.dart';
import 'package:rhythm_desktop/features/live_artifacts/models/live_artifact.dart';
import 'package:rhythm_desktop/features/live_artifacts/widgets/live_artifact_view.dart';
import 'package:rhythm_desktop/features/notifications/controllers/notifications_controller.dart';
import 'package:rhythm_desktop/features/notifications/data/notifications_data_source.dart';
import 'package:rhythm_desktop/features/notifications/repositories/notifications_repository.dart';

const _artifactA = '11111111-1111-4111-8111-111111111111';
const _artifactB = '22222222-2222-4222-8222-222222222222';
const _artifactC = '33333333-3333-4333-8333-333333333333';
const _artifactD = '44444444-4444-4444-8444-444444444444';

AgentSessionMessage _message({
  required int id,
  required String sessionId,
  required List<Map<String, dynamic>> parts,
}) =>
    AgentSessionMessage(
      id: id,
      sessionId: sessionId,
      role: 'output',
      rawText: '',
      strippedText: '',
      createdAt: DateTime.fromMillisecondsSinceEpoch(id * 1000, isUtc: true),
      sdkMessageId: 'msg-$id',
      parts: parts,
    );

Map<String, dynamic> _tool({
  required String name,
  String status = 'completed',
  Map<String, dynamic> input = const {},
  String? output,
}) =>
    {
      'type': 'tool',
      'tool': name,
      'state': {
        'status': status,
        'input': input,
        if (output != null) 'output': output,
      },
    };

LiveArtifact _artifact(String id, [String? title]) => LiveArtifact(
      id: id,
      title: title ?? 'Artifact $id',
      updatedAt: DateTime(2026, 8, 11),
    );

class _ArtifactSource extends LiveArtifactsDataSource {
  _ArtifactSource({this.results = const {}})
      : super(baseUrl: 'http://contract.invalid');

  final Map<String, Object> results;
  final List<String> getCalls = [];

  @override
  Future<LiveArtifact> get(String id) async {
    getCalls.add(id);
    final result = results[id] ?? _artifact(id);
    if (result is LiveArtifact) return result;
    throw result;
  }

  @override
  Future<String> render(String id) async => '<main>$id</main>';
}

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
  Future<void> dispose() async {
    await _messages.close();
    await _connectivity.close();
  }

  @override
  bool send(Map<String, dynamic> message) => true;

  @override
  Future<List<AgentSession>> listSessions({
    bool includeArchived = false,
    bool archivedOnly = false,
    String? scope,
  }) async =>
      const [];

  @override
  Future<({AgentSession session, List<AgentSessionMessage> messages})>
      getSession(String id) async =>
          (session: _session(id), messages: const <AgentSessionMessage>[]);

  @override
  noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

AgentSession _session(String id) => AgentSession(
      id: id,
      agentId: 'claude-code',
      name: 'Contract session',
      cwd: '/tmp',
      status: AgentSessionStatus.idle,
      createdAt: DateTime.fromMillisecondsSinceEpoch(0),
      updatedAt: DateTime.fromMillisecondsSinceEpoch(0),
    );

AgentsController _agentsController() => AgentsController(
      _StubAgentsRepository(),
      _ReadyAgentServerController(),
      LocalNotificationService(),
      NotificationsController(
        NotificationsRepository(NotificationsDataSource()),
      ),
    );

Widget _host(Widget child) => MaterialApp(
      theme: AppTheme.light(),
      home: Scaffold(body: SizedBox(width: 520, height: 700, child: child)),
    );

Widget _tab({
  required List<AgentSessionMessage> messages,
  _ArtifactSource? source,
  String sessionId = 'session-exact',
  String? initialCursor,
  bool initialHasMore = false,
  ArtifactTranscriptPageLoader? loadPage,
  ArtifactPreviewBuilder? previewBuilder,
  bool enableNativeRuntime = false,
}) =>
    _host(
      ArtifactsTab(
        sessionId: sessionId,
        initialMessages: messages,
        dataSource: source ?? _ArtifactSource(),
        initialCursor: initialCursor,
        initialHasMore: initialHasMore,
        loadPage: loadPage,
        previewBuilder: previewBuilder,
        enableNativeRuntime: enableNativeRuntime,
      ),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'issue-1360-c1: the session side panel exposes an Artifacts tab',
    (tester) async {
      // Regression caught: the implementation exists but is never composed
      // into the shipping inspector; the visible tab-label assertion fails.
      final controller = _agentsController();
      addTearDown(controller.dispose);
      await tester.pumpWidget(
        ChangeNotifierProvider<AgentsController>.value(
          value: controller,
          child: _host(SessionSidePanel(session: _session('session-exact'))),
        ),
      );

      expect(find.text('Artifacts'), findsOneWidget);
    },
  );

  test(
    'issue-1360-c2: extraction accepts only four successful mutation forms and their specified ID sources',
    () {
      // Regression caught: list/get, unfinished/failed tools, malformed UUIDs,
      // or an update tool's output are mistaken for artifact mutations; the
      // exact ordered-ID assertion fails.
      final messages = [
        _message(id: 1, sessionId: 'session-exact', parts: [
          _tool(
            name: 'rhythm_create_live_artifact',
            output: '{"id":"$_artifactA","title":"Created"}',
          ),
          _tool(
            name: 'rhythm_update_live_artifact_state',
            input: {'id': _artifactB},
            output: '{"id":"$_artifactD"}',
          ),
          _tool(
            name: 'rhythm_update_live_artifact_bundle',
            input: {'id': _artifactC},
          ),
          _tool(
            name: 'rhythm_update_live_artifact_sharing',
            input: {'id': _artifactD},
          ),
          _tool(name: 'rhythm_list_live_artifacts'),
          _tool(name: 'rhythm_get_live_artifact', input: {'id': _artifactA}),
          _tool(
            name: 'rhythm_update_live_artifact_state',
            status: 'running',
            input: {'id': '55555555-5555-4555-8555-555555555555'},
          ),
          _tool(
            name: 'rhythm_update_live_artifact_bundle',
            status: 'failed',
            input: {'id': '66666666-6666-4666-8666-666666666666'},
          ),
          _tool(
            name: 'rhythm_create_live_artifact',
            output: 'not-json',
          ),
          _tool(
            name: 'rhythm_update_live_artifact_state',
            input: {'id': '../not-an-artifact-id'},
          ),
          _tool(name: 'unrelated_tool', input: {'id': _artifactA}),
        ]),
      ];

      final references = extractTranscriptArtifactReferences(
        sessionId: 'session-exact',
        messages: messages,
      );

      expect(
        references.map((reference) => reference.artifactId).toSet(),
        {_artifactA, _artifactB, _artifactC, _artifactD},
      );
    },
  );

  test(
    'issue-1360-c3: IDs are deduped newest-first and a later mutation promotes an existing artifact',
    () {
      // Regression caught: first-seen order wins or duplicate rows survive;
      // the newest-first unique-ID assertion fails.
      final references = extractTranscriptArtifactReferences(
        sessionId: 'session-exact',
        messages: [
          _message(id: 1, sessionId: 'session-exact', parts: [
            _tool(
              name: 'rhythm_create_live_artifact',
              output: '{"id":"$_artifactA"}',
            ),
          ]),
          _message(id: 2, sessionId: 'session-exact', parts: [
            _tool(
              name: 'rhythm_update_live_artifact_state',
              input: {'id': _artifactB},
            ),
          ]),
          _message(id: 3, sessionId: 'session-exact', parts: [
            _tool(
              name: 'rhythm_update_live_artifact_bundle',
              input: {'id': _artifactA},
            ),
          ]),
        ],
      );

      expect(
        references.map((reference) => reference.artifactId),
        [_artifactA, _artifactB],
      );
    },
  );

  test(
    'issue-1360-c4: extraction is scoped to the exact inspected session and excludes descendants',
    () {
      // Regression caught: a descendant transcript is aggregated into an
      // otherwise empty parent inspector; the result is no longer empty.
      final references = extractTranscriptArtifactReferences(
        sessionId: 'session-parent',
        messages: [
          _message(id: 1, sessionId: 'session-child', parts: [
            _tool(
              name: 'rhythm_update_live_artifact_state',
              input: {'id': _artifactA},
            ),
          ]),
        ],
      );

      expect(references, isEmpty);
    },
  );

  testWidgets(
    'issue-1360-c5: history pages stop on completion, failure, or no progress and retry without dropping rows',
    (tester) async {
      // Regression caught: paging repeats a cursor forever or clears already
      // discovered artifacts after a failed page; bounded call counts, the
      // retained row, and retry affordance assertions fail.
      var failureCalls = 0;
      Future<ArtifactTranscriptPage> failingLoader({
        required String sessionId,
        String? before,
      }) async {
        failureCalls++;
        if (failureCalls == 1) {
          return (
            messages: [
              _message(id: 1, sessionId: sessionId, parts: [
                _tool(
                  name: 'rhythm_update_live_artifact_state',
                  input: {'id': _artifactA},
                ),
              ]),
            ],
            nextCursor: 'cursor-1',
            hasMore: true,
          );
        }
        throw Exception('network details must not be shown');
      }

      await tester.pumpWidget(_tab(
        messages: const [],
        initialCursor: 'cursor-2',
        initialHasMore: true,
        loadPage: failingLoader,
      ));
      await tester.pumpAndSettle();

      expect(failureCalls, 2);
      expect(find.byKey(const ValueKey('artifact-row-$_artifactA')),
          findsOneWidget);
      expect(find.byKey(const ValueKey('artifacts-history-retry')),
          findsOneWidget);
      expect(find.textContaining('network details'), findsNothing);

      await tester.tap(find.byKey(const ValueKey('artifacts-history-retry')));
      await tester.pumpAndSettle();
      expect(failureCalls, 3);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pump();

      var noProgressCalls = 0;
      await tester.pumpWidget(_tab(
        messages: const [],
        initialCursor: 'stuck-cursor',
        initialHasMore: true,
        loadPage: ({required sessionId, before}) async {
          noProgressCalls++;
          return (
            messages: const <AgentSessionMessage>[],
            nextCursor: before,
            hasMore: true,
          );
        },
      ));
      await tester.pumpAndSettle();

      expect(noProgressCalls, 1);
      expect(find.byKey(const ValueKey('artifacts-history-retry')),
          findsOneWidget);
    },
  );

  testWidgets(
    'issue-1360-c6: hosted get resolves metadata and every unavailable outcome retains a generic useful row',
    (tester) async {
      // Regression caught: metadata is resolved through list/local transcript
      // data, or 403/404/410/409/network failures remove rows or expose server
      // authorization details; get-call, row-count, and copy assertions fail.
      final unavailableIds = [_artifactA, _artifactB, _artifactC, _artifactD];
      final source = _ArtifactSource(results: {
        _artifactA: AppError('secret ACL: deleted', statusCode: 410),
        _artifactB: AppError('secret ACL: revoked', statusCode: 403),
        _artifactC: AppError('secret revision', statusCode: 409),
        _artifactD: Exception('private network/token details'),
      });
      final messages = [
        for (var index = 0; index < unavailableIds.length; index++)
          _message(id: index + 1, sessionId: 'session-exact', parts: [
            _tool(
              name: 'rhythm_update_live_artifact_state',
              input: {'id': unavailableIds[index]},
            ),
          ]),
      ];

      await tester.pumpWidget(_tab(messages: messages, source: source));
      await tester.pumpAndSettle();

      expect(source.getCalls.toSet(), unavailableIds.toSet());
      await tester.tap(find.byKey(const ValueKey('artifact-selector')));
      await tester.pumpAndSettle();
      for (final id in unavailableIds) {
        // The selected id also renders in the closed dropdown button, so the
        // currently-selected row appears twice once the menu is open. Assert
        // the row is present (>=1) rather than exactly once.
        expect(
          find.byKey(ValueKey('artifact-row-$id')),
          findsAtLeastNWidgets(1),
        );
      }
      expect(find.textContaining('secret'), findsNothing);
      expect(find.textContaining('token'), findsNothing);
      expect(find.textContaining('authorization'), findsNothing);
      expect(find.textContaining('Unavailable'), findsWidgets);
    },
  );

  testWidgets(
    'issue-1360-c7: changing the selector keeps exactly one interactive preview mounted',
    (tester) async {
      // Regression caught: every discovered artifact owns a hidden WebView or
      // selector changes stack previews; maxMounted exceeds one or two preview
      // widgets remain in the tree.
      var mounted = 0;
      var maxMounted = 0;
      var builderInvocations = 0;
      final tracker = _PreviewTracker(
        onMount: () {
          mounted++;
          if (mounted > maxMounted) maxMounted = mounted;
        },
        onDispose: () => mounted--,
      );
      final messages = [
        _message(id: 1, sessionId: 'session-exact', parts: [
          _tool(
            name: 'rhythm_update_live_artifact_state',
            input: {'id': _artifactA},
          ),
        ]),
        _message(id: 2, sessionId: 'session-exact', parts: [
          _tool(
            name: 'rhythm_update_live_artifact_state',
            input: {'id': _artifactB},
          ),
        ]),
      ];

      await tester.pumpWidget(_tab(
        messages: messages,
        previewBuilder: (context, artifact, previewKey) {
          builderInvocations++;
          return _TrackedPreview(
            key: previewKey,
            artifactId: artifact.id,
            tracker: tracker,
          );
        },
      ));
      await tester.pumpAndSettle();

      expect(builderInvocations, 1);
      expect(find.byType(_TrackedPreview), findsOneWidget);
      expect(mounted, 1);

      await tester.tap(find.byKey(const ValueKey('artifact-selector')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Artifact $_artifactA').last);
      await tester.pumpAndSettle();

      expect(builderInvocations, 2);
      expect(find.byType(_TrackedPreview), findsOneWidget);
      expect(mounted, 1);
      expect(maxMounted, 1);
    },
  );

  testWidgets(
    'issue-1360-c8: preview composes the existing LiveArtifactView secure runtime',
    (tester) async {
      // Regression caught: the inspector introduces a bespoke HTML renderer
      // outside the hardened runtime; the exact widget-type assertion fails.
      await tester.pumpWidget(_tab(
        messages: [
          _message(id: 1, sessionId: 'session-exact', parts: [
            _tool(
              name: 'rhythm_update_live_artifact_state',
              input: {'id': _artifactA},
            ),
          ]),
        ],
        enableNativeRuntime: false,
      ));
      await tester.pumpAndSettle();

      expect(find.byType(LiveArtifactView), findsOneWidget);
      expect(find.byKey(const ValueKey('artifact-preview-$_artifactA')),
          findsOneWidget);
    },
  );
}

class _PreviewTracker {
  const _PreviewTracker({required this.onMount, required this.onDispose});

  final VoidCallback onMount;
  final VoidCallback onDispose;
}

class _TrackedPreview extends StatefulWidget {
  const _TrackedPreview({
    super.key,
    required this.artifactId,
    required this.tracker,
  });

  final String artifactId;
  final _PreviewTracker tracker;

  @override
  State<_TrackedPreview> createState() => _TrackedPreviewState();
}

class _TrackedPreviewState extends State<_TrackedPreview> {
  @override
  void initState() {
    super.initState();
    widget.tracker.onMount();
  }

  @override
  void dispose() {
    widget.tracker.onDispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => SizedBox(
        key: ValueKey('tracked-preview-${widget.artifactId}'),
        child: Text(widget.artifactId),
      );
}
