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
import 'package:rhythm_desktop/app/theme/app_theme.dart';

LiveArtifactsController controller({String? error}) {
  final result = LiveArtifactsController(
    LiveArtifactsDataSource(baseUrl: 'http://localhost'),
    UserPreferencesDataSource(baseUrl: 'http://localhost'),
  );
  result.debugSetForTest(
    tabs: [
      LiveArtifactTab(
          id: 'one',
          status: LiveArtifactTabStatus.ready,
          artifact: LiveArtifact(
              id: 'one', title: 'Service Notes', updatedAt: DateTime(2026))),
      LiveArtifactTab(
          id: 'two',
          status: LiveArtifactTabStatus.unavailable,
          message: 'This artifact is unavailable.'),
    ],
    available: [
      LiveArtifact(id: 'one', title: 'Service Notes', updatedAt: DateTime(2026))
    ],
    error: error,
  );
  return result;
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

Widget subject(LiveArtifactsController value,
        {ThemeMode mode = ThemeMode.light}) =>
    ChangeNotifierProvider.value(
      value: value,
      child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light(),
          darkTheme: AppTheme.dark(),
          themeMode: mode,
          home: Scaffold(body: DashboardArtifactTabs(controller: value))),
    );

Widget workspaceSubject(LiveArtifactsController value,
        {ThemeMode mode = ThemeMode.light}) =>
    MultiProvider(
      providers: [
        ChangeNotifierProvider.value(value: value),
        ChangeNotifierProvider(
            create: (_) => AuthSessionService(
                AuthDataSource(baseUrl: 'http://localhost'))),
      ],
      child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: AppTheme.light(),
          darkTheme: AppTheme.dark(),
          themeMode: mode,
          home: Scaffold(
              body: DashboardArtifactWorkspace(
                  workspaceId: 1,
                  dashboard: const SizedBox.expand(),
                  controller: value,
                  manageAuthLifecycle: false))),
    );

void main() {
  testWidgets('toolbar and anchored picker goldens', (tester) async {
    final value = controller();
    await tester.pumpWidget(subject(value));
    await expectLater(find.byType(DashboardArtifactTabs),
        matchesGoldenFile('goldens/av04_toolbar_light.png'));
    await tester.tap(find.byTooltip('Open live artifact'));
    await tester.pump();
    expect(find.text('Open live artifact'), findsOneWidget);
    await expectLater(find.byType(Overlay),
        matchesGoldenFile('goldens/av04_picker_light.png'));
  });

  testWidgets('dark toolbar and picker error goldens', (tester) async {
    final value =
        controller(error: 'Could not load live artifacts. Try again.');
    await tester.pumpWidget(subject(value, mode: ThemeMode.dark));
    await expectLater(find.byType(DashboardArtifactTabs),
        matchesGoldenFile('goldens/av04_toolbar_dark.png'));
    await tester.tap(find.byTooltip('Open live artifact'));
    await tester.pump();
    await expectLater(find.byType(Overlay),
        matchesGoldenFile('goldens/av04_picker_error_dark.png'));
  });

  testWidgets('toolbar exposes Dashboard and artifact tab semantics',
      (tester) async {
    final value = controller();
    await tester.pumpWidget(subject(value));
    expect(find.bySemanticsLabel('Dashboard tab'), findsOneWidget);
    expect(find.bySemanticsLabel('Service Notes artifact tab'), findsOneWidget);
  });

  testWidgets('dashboard Left and Right arrows wrap across artifact tabs',
      (tester) async {
    final value = controller();
    await tester.pumpWidget(subject(value));
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    expect(FocusManager.instance.primaryFocus!.debugLabel,
        'artifact-dashboard-tab');
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    expect(FocusManager.instance.primaryFocus!.debugLabel, 'artifact-tab-two');
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    expect(FocusManager.instance.primaryFocus!.debugLabel,
        'artifact-dashboard-tab');
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowRight);
    expect(FocusManager.instance.primaryFocus!.debugLabel, 'artifact-tab-one');
    await tester.sendKeyEvent(LogicalKeyboardKey.arrowLeft);
    expect(FocusManager.instance.primaryFocus!.debugLabel,
        'artifact-dashboard-tab');
  });

  testWidgets('no-artifact inventory golden', (tester) async {
    final empty = controller();
    empty.debugSetForTest(available: []);
    await tester.pumpWidget(subject(empty));
    await tester.tap(find.byTooltip('Open live artifact'));
    await tester.pump();
    await expectLater(find.byType(Overlay),
        matchesGoldenFile('goldens/av04_picker_empty_light.png'));
  });

  testWidgets('no-match picker with Clear search golden', (tester) async {
    final noMatch = controller();
    await tester.pumpWidget(subject(noMatch));
    await tester.tap(find.byTooltip('Open live artifact'));
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'no matching artifact');
    await tester.pump();
    expect(find.text('Clear search'), findsOneWidget);
    await expectLater(find.byType(Overlay),
        matchesGoldenFile('goldens/av04_picker_no_match_light.png'));
  });

  testWidgets('conflict recovery golden', (tester) async {
    final conflict = controller();
    conflict.debugSetForTest(tabs: [
      const LiveArtifactTab(
          id: 'one',
          status: LiveArtifactTabStatus.conflict,
          message: 'This artifact changed elsewhere. Refresh and try again.')
    ]);
    conflict.select('one');
    await tester.pumpWidget(workspaceSubject(conflict));
    await expectLater(find.byType(DashboardArtifactWorkspace),
        matchesGoldenFile('goldens/av04_conflict_recovery_light.png'));
  });

  testWidgets('conflict and generic errors retain distinct recovery copy',
      (tester) async {
    // Regression: conflicts looked like generic failures and their recovery
    // action did not drive the controller's detail retry.
    final refreshed = Completer<LiveArtifact>();
    final artifacts = _SequencedArtifacts([
      Future.value(LiveArtifact(
          id: 'one', title: 'Initial artifact', updatedAt: DateTime(2026))),
      refreshed.future,
    ]);
    final value = LiveArtifactsController(
      artifacts,
      UserPreferencesDataSource(baseUrl: 'http://localhost'),
    );
    await value.restore(1, ['one']);
    value.debugSetForTest(tabs: const [
      LiveArtifactTab(
          id: 'one',
          status: LiveArtifactTabStatus.conflict,
          message: 'This artifact changed elsewhere. Refresh and try again.')
    ]);
    value.select('one');
    await tester.pumpWidget(workspaceSubject(value));
    expect(find.text('Refresh artifact'), findsOneWidget);
    expect(find.text('Could not load this artifact.'), findsNothing);

    await tester.tap(find.text('Refresh artifact'));
    await tester.pump();
    expect(artifacts.getCalls, 2);
    expect(find.text('Loading artifact…'), findsOneWidget);
    refreshed.complete(LiveArtifact(
        id: 'one', title: 'Recovered artifact', updatedAt: DateTime(2026)));
    await tester.pump();
    await tester.pump();
    expect(find.textContaining('Recovered artifact'), findsWidgets);

    final generic = controller();
    generic.debugSetForTest(tabs: const [
      LiveArtifactTab(
          id: 'two',
          status: LiveArtifactTabStatus.error,
          message: 'Could not load this artifact.')
    ]);
    generic.select('two');
    // This is a distinct controller scenario; unmount the prior conflict view
    // so its stateful viewer cannot satisfy the generic-error assertions.
    await tester.pumpWidget(const SizedBox());
    await tester.pumpWidget(workspaceSubject(generic));
    expect(find.text('Could not load this artifact.'), findsOneWidget);
    expect(find.text('Refresh artifact'), findsOneWidget);
  });

  testWidgets('narrow long-title focused toolbar golden', (tester) async {
    await tester.binding.setSurfaceSize(const Size(420, 90));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final value = controller();
    value.debugSetForTest(tabs: [
      LiveArtifactTab(
          id: 'long',
          status: LiveArtifactTabStatus.ready,
          artifact: LiveArtifact(
              id: 'long',
              title: 'A very long Worship Calendar artifact title for overflow',
              updatedAt: DateTime(2026))),
    ]);
    await tester.pumpWidget(subject(value));
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await expectLater(find.byType(DashboardArtifactTabs),
        matchesGoldenFile('goldens/av04_toolbar_narrow_focus_light.png'));
  });

  testWidgets('narrow long-title focused dark toolbar golden', (tester) async {
    await tester.binding.setSurfaceSize(const Size(420, 90));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final value = controller();
    value.debugSetForTest(tabs: [
      LiveArtifactTab(
          id: 'long',
          status: LiveArtifactTabStatus.ready,
          artifact: LiveArtifact(
              id: 'long',
              title: 'A very long Worship Calendar artifact title for overflow',
              updatedAt: DateTime(2026))),
    ]);
    await tester.pumpWidget(subject(value, mode: ThemeMode.dark));
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.sendKeyEvent(LogicalKeyboardKey.tab);
    await tester.pump();
    await expectLater(find.byType(DashboardArtifactTabs),
        matchesGoldenFile('goldens/av04_toolbar_narrow_focus_dark.png'));
  });
}
