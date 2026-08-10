import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/live_artifacts/controllers/live_artifacts_controller.dart';
import 'package:rhythm_desktop/features/live_artifacts/data/live_artifacts_data_source.dart';
import 'package:rhythm_desktop/features/live_artifacts/models/live_artifact.dart';
import 'package:rhythm_desktop/features/live_artifacts/widgets/dashboard_artifact_tabs.dart';
import 'package:rhythm_desktop/features/live_artifacts/widgets/live_artifact_view.dart';
import 'package:rhythm_desktop/features/settings/data/user_preferences_data_source.dart';

LiveArtifactsController _controller() => LiveArtifactsController(
      LiveArtifactsDataSource(baseUrl: 'http://localhost'),
      UserPreferencesDataSource(baseUrl: 'http://localhost'),
    );

Widget _tabs(LiveArtifactsController controller) => MaterialApp(
      home: Scaffold(body: DashboardArtifactTabs(controller: controller)),
    );

Widget _viewer() => MaterialApp(
      home: Scaffold(
        body: LiveArtifactView(
          artifact: LiveArtifact(
            id: 'artifact-id',
            title: 'Imported calendar',
            updatedAt: DateTime(2026, 8, 10),
          ),
          source: LiveArtifactsDataSource(baseUrl: 'http://localhost'),
          enableNativeRuntime: false,
        ),
      ),
    );

void main() {
  testWidgets('import contract: picker offers HTML import', (tester) async {
    // Regression: users can only select pre-existing artifacts, so HTML cannot
    // start the import journey from the dashboard plus picker.
    await tester.pumpWidget(_tabs(_controller()));
    await tester.tap(find.byTooltip('Open live artifact'));
    await tester.pump();
    expect(find.text('Import HTML'), findsOneWidget);
  });

  testWidgets('import contract: preview validates and explains HTML',
      (tester) async {
    // Regression: a bad or externally-dependent file could upload without a
    // clear client-side error or explanation before the user confirms it.
    await tester.pumpWidget(_tabs(_controller()));
    await tester.tap(find.byTooltip('Open live artifact'));
    await tester.pump();
    expect(find.text('Preview import'), findsOneWidget);
    expect(find.bySemanticsLabel('Import HTML file'), findsOneWidget);
  });

  testWidgets('sharing contract: owner has an accessible Share action',
      (tester) async {
    // Regression: an owner can view an artifact but cannot discover sharing.
    await tester.pumpWidget(_viewer());
    expect(find.bySemanticsLabel('Share artifact'), findsOneWidget);
  });

  testWidgets('sharing contract: dialog provides visibility and collaborators',
      (tester) async {
    // Regression: changing access has no visible owner workflow or revocation
    // warning, so remove may be mistaken for artifact deletion.
    await tester.pumpWidget(_viewer());
    await tester.tap(find.bySemanticsLabel('Share artifact'));
    await tester.pump();
    expect(find.text('Private'), findsOneWidget);
    expect(find.text('Organization'), findsOneWidget);
    expect(find.textContaining('revokes access but does not delete'),
        findsOneWidget);
    expect(find.bySemanticsLabel('Search workspace users'), findsOneWidget);
  });
}
