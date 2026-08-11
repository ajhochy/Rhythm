/// Executable acceptance contract for issue #1362.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/agents/models/agent_session_message.dart';
import 'package:rhythm_desktop/features/agents/views/_artifacts_tab.dart';
import 'package:rhythm_desktop/features/live_artifacts/controllers/live_artifacts_controller.dart';
import 'package:rhythm_desktop/features/live_artifacts/data/live_artifacts_data_source.dart';
import 'package:rhythm_desktop/features/live_artifacts/models/live_artifact.dart';
import 'package:rhythm_desktop/features/settings/data/user_preferences_data_source.dart';

const _a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const _b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

class _Source extends LiveArtifactsDataSource {
  _Source(this.artifacts) : super(baseUrl: 'http://contract.invalid');
  final Map<String, LiveArtifact> artifacts;

  @override
  Future<LiveArtifact> get(String id) async => artifacts[id]!;

  @override
  Future<String> render(String id) async => '<main>$id</main>';
}

class _Preferences extends UserPreferencesDataSource {
  _Preferences() : super(baseUrl: 'http://contract.invalid');

  @override
  Future<Map<String, dynamic>> updateArtifactTabIds(List<String> ids) async =>
      const {};
}

AgentSessionMessage _mutation(int id, String artifactId) => AgentSessionMessage(
      id: id,
      sessionId: 'session',
      role: 'output',
      rawText: '',
      strippedText: '',
      createdAt: DateTime.fromMillisecondsSinceEpoch(id * 1000, isUtc: true),
      sdkMessageId: 'message-$id',
      parts: [
        {
          'type': 'tool',
          'tool': 'rhythm_update_live_artifact_state',
          'state': {
            'status': 'completed',
            'input': {'id': artifactId},
          },
        },
      ],
    );

LiveArtifact _artifact(String id, String title) => LiveArtifact(
      id: id,
      title: title,
      updatedAt: DateTime.utc(2026, 8, 10),
    );

Future<LiveArtifactsController> _pump(
  WidgetTester tester, {
  String title = 'Alpha',
  double width = 360,
}) async {
  final source = _Source({
    _a: _artifact(_a, title),
    _b: _artifact(_b, 'Beta'),
  });
  final controller = LiveArtifactsController(source, _Preferences());
  await tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: SizedBox(
          width: width,
          height: 700,
          child: ArtifactsTab(
            sessionId: 'session',
            userId: 7,
            initialMessages: [_mutation(1, _a), _mutation(2, _b)],
            dataSource: source,
            dashboardController: controller,
            onNavigateToDashboard: () {},
            enableNativeRuntime: false,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return controller;
}

void main() {
  testWidgets(
    'issue-1362-c1: selector and preview actions are keyboard operable',
    (tester) async {
      final controller = await _pump(tester);
      addTearDown(controller.dispose);

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.sendKeyEvent(LogicalKeyboardKey.space);
      await tester.pumpAndSettle();
      expect(find.text('Alpha'), findsWidgets);
      expect(find.text('Beta'), findsWidgets);

      await tester.sendKeyEvent(LogicalKeyboardKey.arrowUp);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(
          find.byKey(const ValueKey('artifact-preview-$_a')), findsOneWidget);

      await tester.sendKeyEvent(LogicalKeyboardKey.tab);
      await tester.sendKeyEvent(LogicalKeyboardKey.enter);
      await tester.pumpAndSettle();
      expect(controller.selectedId, _a);
    },
  );

  testWidgets(
    'issue-1362-c2: selected artifact, status, and actions have VoiceOver labels',
    (tester) async {
      final semantics = tester.ensureSemantics();
      addTearDown(semantics.dispose);
      final controller = await _pump(tester);
      addTearDown(controller.dispose);

      expect(
        find.bySemanticsLabel(
          'Artifact selector. Selected Beta. Status Available',
        ),
        findsOneWidget,
      );
      expect(find.bySemanticsLabel('Open Beta in Dashboard'), findsOneWidget);
      expect(find.bySemanticsLabel('Reload Beta'), findsOneWidget);
      expect(find.byTooltip('Reload artifact'), findsOneWidget);
      expect(find.byTooltip('Share artifact'), findsNothing);
    },
  );

  testWidgets('issue-1362-c3: every inspector control is at least 44px',
      (tester) async {
    final controller = await _pump(tester);
    addTearDown(controller.dispose);
    for (final key in const [
      'artifact-selector-target',
      'artifact-open-dashboard-button',
      'artifact-reload-button',
    ]) {
      final size = tester.getSize(find.byKey(ValueKey(key)));
      expect(size.width, greaterThanOrEqualTo(44), reason: key);
      expect(size.height, greaterThanOrEqualTo(44), reason: key);
    }
  });

  testWidgets(
    'issue-1362-c4: long title truncates visually but keeps its full semantic name',
    (tester) async {
      const title =
          'A very long worship planning artifact title that cannot fit the inspector';
      final semantics = tester.ensureSemantics();
      addTearDown(semantics.dispose);
      final controller = await _pump(tester, title: title, width: 300);
      addTearDown(controller.dispose);

      expect(tester.takeException(), isNull);
      expect(find.bySemanticsLabel('Artifact $title. Status Available'),
          findsOneWidget);
      final titleWidgets = tester.widgetList<Text>(find.text(title));
      expect(titleWidgets.any((text) => text.overflow == TextOverflow.ellipsis),
          isTrue);
    },
  );

  test('issue-1362-c5: env-gated real macOS lifecycle flow is committed', () {
    final source = File(
      'integration_test/session_inspector_artifacts_macos_test.dart',
    ).readAsStringSync();
    expect(source, contains("bool.fromEnvironment('RHYTHM_INSPECTOR_E2E')"));
    expect(source, contains("'type': 'session.input'"));
    expect(source, contains('runJavaScriptReturningResult'));
    expect(source, contains('dashboardController.selectedId, _artifactId'));
  });

  test('issue-1362-c6: manual smoke names every required lifecycle check', () {
    final smoke = File('../../docs/testing/manual-smoke.md').readAsStringSync();
    for (final phrase in const [
      'Session Inspector artifact previewer',
      'narrow layout',
      'VoiceOver',
      'session switch',
      'provider-account switch',
      'revoked/deleted',
      'Dashboard handoff',
    ]) {
      expect(smoke, contains(phrase), reason: phrase);
    }
  });
}
