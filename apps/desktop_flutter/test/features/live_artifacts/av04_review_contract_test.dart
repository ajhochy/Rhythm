import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:provider/provider.dart';
import 'package:rhythm_desktop/features/live_artifacts/controllers/live_artifacts_controller.dart';
import 'package:rhythm_desktop/features/live_artifacts/data/live_artifacts_data_source.dart';
import 'package:rhythm_desktop/features/live_artifacts/models/live_artifact.dart';
import 'package:rhythm_desktop/features/live_artifacts/widgets/dashboard_artifact_tabs.dart';
import 'package:rhythm_desktop/features/settings/data/user_preferences_data_source.dart';

class _Artifacts extends LiveArtifactsDataSource {
  _Artifacts(this.getters) : super(baseUrl: 'http://localhost');
  final Map<String, Future<LiveArtifact>> getters;

  @override
  Future<List<LiveArtifact>> list() async => [];

  @override
  Future<LiveArtifact> get(String id) => getters[id]!;
}

class _SequencedArtifacts extends LiveArtifactsDataSource {
  _SequencedArtifacts(this.responses) : super(baseUrl: 'http://localhost');

  final List<Future<LiveArtifact>> responses;
  int getCalls = 0;

  @override
  Future<List<LiveArtifact>> list() async => [];

  @override
  Future<LiveArtifact> get(String id) => responses[getCalls++];
}

class _Preferences extends UserPreferencesDataSource {
  _Preferences() : super(baseUrl: 'http://localhost');

  @override
  Future<Map<String, dynamic>> updateArtifactTabIds(List<String> ids) async =>
      {};
}

LiveArtifact _artifact(String id, {String? title}) => LiveArtifact(
      id: id,
      title: title ??
          'A deliberately long artifact title that must truncate visibly',
      updatedAt: DateTime(2026, 8, 8),
      updatedByUserId: 7,
    );

Widget _subject(LiveArtifactsController controller) =>
    ChangeNotifierProvider.value(
      value: controller,
      child: MaterialApp(
        home: Scaffold(body: DashboardArtifactTabs(controller: controller)),
      ),
    );

void main() {
  testWidgets('picker distinguishes no HTML artifacts from no search matches',
      (tester) async {
    // Regression: an empty picker was presented as a failed search.
    final controller = LiveArtifactsController(_Artifacts({}), _Preferences());
    controller.debugSetForTest(available: []);
    await tester.pumpWidget(_subject(controller));
    await tester.tap(find.byTooltip('Open live artifact'));
    await tester.pump();
    expect(find.text('No HTML live artifacts are available.'), findsOneWidget);
  });

  testWidgets('picker exposes no invented session provenance', (tester) async {
    // Regression: updatedByUserId was shown to users as a session identifier.
    final controller = LiveArtifactsController(_Artifacts({}), _Preferences());
    controller.debugSetForTest(available: [_artifact('one')]);
    await tester.pumpWidget(_subject(controller));
    await tester.tap(find.byTooltip('Open live artifact'));
    await tester.pump();
    expect(find.textContaining('session '), findsNothing);
  });

  testWidgets('artifact tabs have a 44 pixel minimum target', (tester) async {
    final controller = LiveArtifactsController(_Artifacts({}), _Preferences());
    controller.debugSetForTest(
      tabs: [
        LiveArtifactTab(
            id: 'one',
            status: LiveArtifactTabStatus.ready,
            artifact: _artifact('one'))
      ],
    );
    await tester.pumpWidget(_subject(controller));
    expect(
        tester
            .getSize(find.widgetWithText(TextButton, _artifact('one').title))
            .height,
        greaterThanOrEqualTo(44));
  });

  testWidgets('keyboard navigation has one tab stop and closes a focused tab',
      (tester) async {
    final controller = LiveArtifactsController(_Artifacts({}), _Preferences());
    controller.debugSetForTest(tabs: [
      LiveArtifactTab(
          id: 'one',
          status: LiveArtifactTabStatus.ready,
          artifact: _artifact('one')),
    ]);
    await tester.pumpWidget(_subject(controller));
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    expect(FocusManager.instance.primaryFocus!.debugLabel, 'artifact-tab-one');
    await tester.sendKeyEvent(LogicalKeyboardKey.delete);
    await tester.pump();
    expect(controller.tabs, isEmpty);
    expect(FocusManager.instance.primaryFocus!.debugLabel,
        'artifact-dashboard-tab');
  });

  testWidgets('picker returns focus to an already-open selected tab',
      (tester) async {
    final controller = LiveArtifactsController(_Artifacts({}), _Preferences());
    controller.debugSetForTest(
      tabs: [
        LiveArtifactTab(
            id: 'one',
            status: LiveArtifactTabStatus.ready,
            artifact: _artifact('one')),
      ],
      available: [_artifact('one')],
    );
    await tester.pumpWidget(_subject(controller));
    await tester.tap(find.byTooltip('Open live artifact'));
    await tester.pump();
    await tester.tap(find.text(_artifact('one').title).last);
    await tester.pump();
    expect(controller.selectedId, 'one');
    expect(FocusManager.instance.primaryFocus!.debugLabel, 'artifact-tab-one');
  });

  test('closing during an artifact load cannot resurrect the tab', () async {
    // Regression: a late detail response replaced a tab after the user closed it.
    final detail = Completer<LiveArtifact>();
    final controller = LiveArtifactsController(
        _Artifacts({'one': detail.future}), _Preferences());
    final restoring = controller.restore(1, ['one']);
    await Future<void>.delayed(Duration.zero);
    unawaited(controller.close('one'));
    detail.complete(_artifact('one'));
    await restoring;
    expect(controller.tabs, isEmpty);
  });

  test('a prior user restore cannot overwrite the current user tabs', () async {
    // Regression: an old user detail response wrote at the same list index.
    final first = Completer<LiveArtifact>();
    final second = Completer<LiveArtifact>();
    final controller = LiveArtifactsController(
      _Artifacts({'one': first.future, 'two': second.future}),
      _Preferences(),
    );
    final restoringFirst = controller.restore(1, ['one']);
    await Future<void>.delayed(Duration.zero);
    final restoringSecond = controller.restore(2, ['two']);
    await Future<void>.delayed(Duration.zero);
    first.complete(_artifact('one'));
    second.complete(_artifact('two'));
    await Future.wait([restoringFirst, restoringSecond]);
    expect(controller.tabs.single.id, 'two');
  });

  test('close then reopen of the same ID discards the old detail response',
      () async {
    // Regression: matching user, generation, and ID let a closed tab's late
    // response overwrite the distinct tab instance reopened with that same ID.
    final oldResponse = Completer<LiveArtifact>();
    final newResponse = Completer<LiveArtifact>();
    final controller = LiveArtifactsController(
      _SequencedArtifacts([oldResponse.future, newResponse.future]),
      _Preferences(),
    );
    final restoring = controller.restore(1, ['one']);
    await Future<void>.delayed(Duration.zero);
    await controller.close('one');
    await controller.open(_artifact('one'));
    final reloading = controller.retryTab('one');
    newResponse.complete(_artifact('new', title: 'New response'));
    await reloading;
    oldResponse.complete(_artifact('old', title: 'Old response'));
    await restoring;

    expect(controller.tabs.single.artifact!.title, 'New response');
  });

  test('a newer reload of the same tab invalidates its prior request',
      () async {
    // Regression: a reload's fresh detail was replaced by its own late prior
    // request because both requests shared an ID and restore generation.
    final oldResponse = Completer<LiveArtifact>();
    final newResponse = Completer<LiveArtifact>();
    final controller = LiveArtifactsController(
      _SequencedArtifacts([oldResponse.future, newResponse.future]),
      _Preferences(),
    );
    final restoring = controller.restore(1, ['one']);
    await Future<void>.delayed(Duration.zero);
    final reloading = controller.retryTab('one');
    newResponse.complete(_artifact('new', title: 'New response'));
    await reloading;
    oldResponse.complete(_artifact('old', title: 'Old response'));
    await restoring;

    expect(controller.tabs.single.artifact!.title, 'New response');
  });

  test('a conflict has distinct recovery copy from a generic load error',
      () async {
    final controller = LiveArtifactsController(
      _Artifacts({
        'one': Future<LiveArtifact>.delayed(
            Duration.zero, () => throw Exception('409 conflict')),
      }),
      _Preferences(),
    );
    await controller.restore(1, ['one']);
    expect(controller.tabs.single.status, LiveArtifactTabStatus.conflict);
    expect(controller.tabs.single.message,
        'This artifact changed elsewhere. Refresh and try again.');
  });
}
