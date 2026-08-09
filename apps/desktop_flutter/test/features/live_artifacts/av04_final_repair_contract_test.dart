import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/app/core/auth/auth_data_source.dart';
import 'package:rhythm_desktop/app/core/auth/auth_session_service.dart';
import 'package:rhythm_desktop/features/live_artifacts/controllers/live_artifacts_controller.dart';
import 'package:rhythm_desktop/features/live_artifacts/data/live_artifacts_data_source.dart';
import 'package:rhythm_desktop/features/live_artifacts/models/live_artifact.dart';
import 'package:rhythm_desktop/features/live_artifacts/widgets/dashboard_artifact_tabs.dart';
import 'package:rhythm_desktop/features/settings/data/user_preferences_data_source.dart';

class _Artifacts extends LiveArtifactsDataSource {
  _Artifacts() : super(baseUrl: 'http://localhost');

  @override
  Future<List<LiveArtifact>> list() async => [];
}

class _DeferredArtifacts extends LiveArtifactsDataSource {
  _DeferredArtifacts(this.responses) : super(baseUrl: 'http://localhost');

  final Map<String, Future<LiveArtifact>> responses;

  @override
  Future<List<LiveArtifact>> list() async => [];

  @override
  Future<LiveArtifact> get(String id) => responses[id]!;
}

class _SequencedListArtifacts extends LiveArtifactsDataSource {
  _SequencedListArtifacts(this.responses) : super(baseUrl: 'http://localhost');

  final List<Future<List<LiveArtifact>>> responses;
  int listCalls = 0;

  @override
  Future<List<LiveArtifact>> list() => responses[listCalls++];
}

class _SaveRequest {
  const _SaveRequest(this.userId, this.ids);

  final int userId;
  final List<String> ids;
}

/// Models the preference row a PATCH actually writes.
///
/// The write targets whichever user the auth header identifies when the request
/// is *issued*, and lands in [stored] only when that request *completes* — so a
/// stale or out-of-order save is observable as corrupted final state, not just
/// as an extra request.
class _PreferencesServer extends UserPreferencesDataSource {
  _PreferencesServer() : super(baseUrl: 'http://localhost');

  int authenticatedUserId = 1;
  final stored = <int, List<String>>{};
  final issued = <_SaveRequest>[];
  final applied = <_SaveRequest>[];
  final pending = <Completer<Map<String, dynamic>>>[];
  int inFlight = 0;
  int maxInFlight = 0;

  List<List<String>> get requests =>
      issued.map((request) => request.ids).toList(growable: false);

  @override
  Future<Map<String, dynamic>> updateArtifactTabIds(List<String> ids) {
    final request = _SaveRequest(authenticatedUserId, List.of(ids));
    issued.add(request);
    inFlight++;
    maxInFlight = maxInFlight > inFlight ? maxInFlight : inFlight;
    final response = Completer<Map<String, dynamic>>();
    pending.add(response);
    return response.future.then((body) {
      stored[request.userId] = request.ids;
      applied.add(request);
      return body;
    }).whenComplete(() => inFlight--);
  }

  /// The newest request still on the wire — the adversarial completion order.
  ///
  /// A correct serialized queue only ever has one request in flight, so this is
  /// identical to FIFO for it. An implementation that fires mutations
  /// concurrently completes newest-first here and persists a stale order.
  Completer<Map<String, dynamic>>? get _next {
    for (final response in pending.reversed) {
      if (!response.isCompleted) return response;
    }
    return null; // A dropped save shows up in [applied]/[stored], not a throw.
  }

  Future<void> completeNext() async {
    _next?.complete(const {});
    await pumpEventQueue();
  }

  Future<void> failNext() async {
    _next?.completeError(Exception('offline'));
    await pumpEventQueue();
  }

  void completeAll() {
    for (final response in pending) {
      if (!response.isCompleted) response.complete(const {});
    }
  }
}

LiveArtifact _artifact(String id, String title) => LiveArtifact(
      id: id,
      title: title,
      updatedAt: DateTime(2026, 8, 8),
      updatedByUserId: 1,
    );

Widget _workspace(LiveArtifactsController controller) => MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: controller),
        ChangeNotifierProvider(
          create: (_) =>
              AuthSessionService(AuthDataSource(baseUrl: 'http://localhost')),
        ),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: DashboardArtifactWorkspace(
            dashboard: SizedBox.expand(),
            controller: controller,
          ),
        ),
      ),
    );

Widget _tabs(LiveArtifactsController controller) => MaterialApp(
      home: Scaffold(body: DashboardArtifactTabs(controller: controller)),
    );

void main() {
  testWidgets('logout frame cannot retain a prior user artifact',
      (tester) async {
    // Regression: the app-level controller survived the auth boundary and drew
    // user A's artifact while the signed-out frame was already visible.
    final controller =
        LiveArtifactsController(_Artifacts(), _PreferencesServer());
    controller.debugSetForTest(
      tabs: [
        LiveArtifactTab(
          id: 'a',
          status: LiveArtifactTabStatus.ready,
          artifact: _artifact('a', 'A private artifact'),
        ),
      ],
    );

    await tester.pumpWidget(_workspace(controller));
    expect(find.text('A private artifact'), findsNothing);
    expect(controller.tabs, isEmpty);
    expect(controller.dashboardSelected, isTrue);
  });

  test('a delayed close then reopen still persists the latest ordered IDs',
      () async {
    // Regression: close's [] PATCH raced the reopen's [a] and completed last,
    // leaving the server holding [] while the toolbar showed [a].
    final server = _PreferencesServer();
    final controller = LiveArtifactsController(_Artifacts(), server);
    await controller.restore(1, const []);
    unawaited(controller.open(_artifact('a', 'Artifact A')));
    unawaited(controller.close('a'));
    unawaited(controller.open(_artifact('a', 'Artifact A')));
    await pumpEventQueue();

    // Coalesced onto one queue: later mutations wait behind the delayed first
    // request instead of racing it, so only one payload is on the wire.
    expect(server.maxInFlight, 1);
    expect(server.requests, [
      ['a']
    ]);

    await server.completeNext();
    await server.completeNext();
    await server.completeNext();

    // Applied order matches mutation order, and the row ends on local state.
    expect(server.maxInFlight, 1);
    expect(server.applied.map((request) => request.ids), [
      ['a'],
      <String>[],
      ['a'],
    ]);
    expect(server.stored[1], ['a']);
    expect(controller.tabs.map((tab) => tab.id), ['a']);
    expect(controller.persistenceError, isNull);
  });

  test('a queued user A save cannot be issued against or alter user B',
      () async {
    // Regression: A's queued PATCH drained after the switch and wrote A's tab
    // order into B's row, because the auth header was already B's by then.
    final server = _PreferencesServer();
    final controller = LiveArtifactsController(_Artifacts(), server);
    await controller.restore(1, const []);
    unawaited(controller.open(_artifact('a1', 'A one')));
    unawaited(controller.open(_artifact('a2', 'A two')));
    await pumpEventQueue();
    expect(server.requests, [
      ['a1']
    ]);

    server.authenticatedUserId = 2;
    await controller.restore(2, const []);
    unawaited(controller.open(_artifact('b', 'B private artifact')));
    await pumpEventQueue();

    // A's in-flight save lands; its queued sibling must be dropped, not sent.
    await server.completeNext();
    await server.completeNext();

    expect(server.requests, [
      ['a1'],
      ['b'],
    ]);
    expect(server.issued.map((request) => request.userId), [1, 2]);
    expect(server.applied.map((request) => request.ids), [
      ['a1'],
      ['b'],
    ]);
    expect(server.stored[2], ['b']);
    expect(server.stored[1], ['a1']);
    expect(controller.tabs.map((tab) => tab.id), ['b']);
  });

  test('a stale user response cannot populate the next user controller',
      () async {
    // Regression: user A's late detail request wrote into user B's workspace.
    final a = Completer<LiveArtifact>();
    final b = Completer<LiveArtifact>();
    final controller = LiveArtifactsController(
      _DeferredArtifacts({'a': a.future, 'b': b.future}),
      _PreferencesServer(),
    );
    final restoringA = controller.restore(1, const ['a']);
    await Future<void>.delayed(Duration.zero);
    controller.reset();
    final restoringB = controller.restore(2, const ['b']);
    await Future<void>.delayed(Duration.zero);
    b.complete(_artifact('b', 'B private artifact'));
    await restoringB;
    expect(controller.tabs.single.artifact!.title, 'B private artifact');

    a.complete(_artifact('a', 'A private artifact'));
    await restoringA;
    expect(controller.tabs.single.artifact!.title, 'B private artifact');
  });

  test('a retry response after logout cannot restore prior inventory or error',
      () async {
    // Regression: an unguarded picker retry rendered user A's inventory after
    // logout; the assertions below fail if its late response writes either
    // available titles or pickerError into the signed-out controller.
    final retry = Completer<List<LiveArtifact>>();
    final controller = LiveArtifactsController(
      _SequencedListArtifacts([
        Future.value([_artifact('a', 'A private artifact')]),
        retry.future,
      ]),
      _PreferencesServer(),
    );
    await controller.restore(1, const []);
    final retrying = controller.retryPicker();
    await Future<void>.delayed(Duration.zero);
    controller.reset();
    final staleFrames = <String>[];
    controller.addListener(() =>
        staleFrames.add('${controller.available}|${controller.pickerError}'));

    retry.complete([_artifact('a', 'A private artifact')]);
    await retrying;

    expect(controller.available, isEmpty);
    expect(controller.pickerError, isNull);
    expect(staleFrames, isEmpty);
  });

  test('a failed A retry cannot notify or overwrite B picker state', () async {
    // Regression: user A's late retry failure replaced user B's picker state.
    // These assertions fail if the stale catch path writes pickerError or
    // notifies a frame that could render A's stale failure.
    final retry = Completer<List<LiveArtifact>>();
    final controller = LiveArtifactsController(
      _SequencedListArtifacts([
        Future.value([_artifact('a', 'A private artifact')]),
        retry.future,
        Future.value([_artifact('b', 'B private artifact')]),
      ]),
      _PreferencesServer(),
    );
    await controller.restore(1, const []);
    final retrying = controller.retryPicker();
    await Future<void>.delayed(Duration.zero);
    controller.reset();
    final frames = <String>[];
    controller.addListener(
        () => frames.add('${controller.available}|${controller.pickerError}'));
    await controller.restore(2, const []);
    final notificationCount = frames.length;

    retry.completeError(Exception('offline'));
    await retrying;

    expect(controller.available.single.title, 'B private artifact');
    expect(controller.pickerError, isNull);
    expect(frames, hasLength(notificationCount));
    expect(frames, everyElement(isNot(contains('A private artifact'))));
    expect(
        frames, everyElement(isNot(contains('Could not load live artifacts'))));
  });

  test('a stale concurrent retry failure cannot notify after newer success',
      () async {
    // Regression: an earlier retry's failure completed after newer success,
    // replacing its inventory/error and notifying a stale picker frame.
    final firstRetry = Completer<List<LiveArtifact>>();
    final secondRetry = Completer<List<LiveArtifact>>();
    final controller = LiveArtifactsController(
      _SequencedListArtifacts([
        Future.value([_artifact('initial', 'Initial inventory')]),
        firstRetry.future,
        secondRetry.future,
      ]),
      _PreferencesServer(),
    );
    await controller.restore(1, const []);
    var notifications = 0;
    controller.addListener(() => notifications++);
    final first = controller.retryPicker();
    final second = controller.retryPicker();
    secondRetry.complete([_artifact('new', 'Latest inventory')]);
    await second;

    expect(controller.available.single.title, 'Latest inventory');
    expect(controller.pickerError, isNull);
    expect(notifications, 1);

    firstRetry.completeError(Exception('offline'));
    await first;

    expect(controller.available.single.title, 'Latest inventory');
    expect(controller.pickerError, isNull);
    expect(notifications, 1);
  });

  test('a failed save still ends with the latest ordered IDs persisted',
      () async {
    // Regression: a rejected PATCH stopped the queue, so the row kept a stale
    // order that no longer matched local state.
    final server = _PreferencesServer();
    final controller = LiveArtifactsController(_Artifacts(), server);
    await controller.restore(1, const []);
    unawaited(controller.open(_artifact('a', 'Artifact A')));
    unawaited(controller.open(_artifact('b', 'Artifact B')));
    await pumpEventQueue();

    await server.failNext();
    expect(controller.persistenceError, 'Could not save live artifact tabs.');

    unawaited(controller.close('a'));
    await server.completeNext();
    await server.completeNext();

    // The failed payload never applied; the queue drained to the latest order.
    expect(server.applied.map((request) => request.ids), [
      ['a', 'b'],
      ['b'],
    ]);
    expect(server.stored[1], ['b']);
    expect(controller.tabs.map((tab) => tab.id), ['b']);
    expect(controller.persistenceError, isNull);
  });

  testWidgets('close moves focus before delayed preference PATCH completes',
      (tester) async {
    // Regression: awaiting persistence left keyboard focus on a removed tab.
    final preferences = _PreferencesServer();
    final controller = LiveArtifactsController(_Artifacts(), preferences);
    controller.debugSetForTest(
      tabs: [
        LiveArtifactTab(
          id: 'a',
          status: LiveArtifactTabStatus.ready,
          artifact: _artifact('a', 'Artifact A'),
        ),
      ],
    );
    controller.select('a');

    await tester.pumpWidget(_tabs(controller));
    await tester.tap(find.byTooltip('Close Artifact A'));
    await tester.pump();

    expect(FocusManager.instance.primaryFocus!.debugLabel,
        'artifact-dashboard-tab');
    preferences.completeAll();
  });

  testWidgets('picker selection focuses its tab before delayed PATCH completes',
      (tester) async {
    // Regression: picker selection awaited persistence and left focus in a
    // dismissed overlay instead of on the selected artifact tab.
    final preferences = _PreferencesServer();
    final controller = LiveArtifactsController(_Artifacts(), preferences);
    await controller.restore(1, const []);
    controller.debugSetForTest(available: [_artifact('a', 'Artifact A')]);

    await tester.pumpWidget(_tabs(controller));
    await tester.tap(find.byTooltip('Open live artifact'));
    await tester.pump();
    await tester.tap(find.text('Artifact A'));
    await tester.pump();

    expect(FocusManager.instance.primaryFocus!.debugLabel, 'artifact-tab-a');
    await tester.sendKeyEvent(LogicalKeyboardKey.escape);
    preferences.completeAll();
  });
}
