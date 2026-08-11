import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/features/live_artifacts/controllers/live_artifacts_controller.dart';
import 'package:rhythm_desktop/features/live_artifacts/data/live_artifacts_data_source.dart';
import 'package:rhythm_desktop/features/live_artifacts/models/live_artifact.dart';
import 'package:rhythm_desktop/features/live_artifacts/widgets/dashboard_artifact_tabs.dart';
import 'package:rhythm_desktop/features/settings/data/user_preferences_data_source.dart';

/// #1381 — imported dashboard artifacts vanished on navigate-away/back.
///
/// app_shell renders `views[index]` (not an IndexedStack), so the Dashboard's
/// [DashboardArtifactWorkspace] State is destroyed on navigate-away and rebuilt
/// on return. In non-managed mode (parent owns the controller) the rebuilt
/// State used to `reset()` the SHARED controller on remount — wiping tabs the
/// parent had restored — and never restored them. This pins that a remount
/// leaves the parent-owned controller's tabs intact.
void main() {
  testWidgets('#1381: navigate-away/back keeps parent-owned artifact tabs',
      (tester) async {
    final controller = LiveArtifactsController(
      LiveArtifactsDataSource(baseUrl: 'http://localhost'),
      UserPreferencesDataSource(baseUrl: 'http://localhost'),
    );
    controller.debugSetForTest(tabs: [
      LiveArtifactTab(
        id: 'artifact-id',
        status: LiveArtifactTabStatus.ready,
        artifact: LiveArtifact(
          id: 'artifact-id',
          title: 'Worship Calendar',
          updatedAt: DateTime(2026, 8, 9),
        ),
      ),
    ]);
    expect(controller.tabs, hasLength(1));

    // Mirrors app_shell: parent-owned controller, non-managed, real user id.
    Widget workspace() => MaterialApp(
          home: Scaffold(
            body: DashboardArtifactWorkspace(
              workspaceId: 1,
              dashboard: const SizedBox.expand(),
              controller: controller,
              manageAuthLifecycle: false,
              activeUserId: 7,
              enableNativeRuntime: false,
            ),
          ),
        );

    await tester.pumpWidget(workspace());
    await tester.pump();
    expect(controller.tabs, hasLength(1), reason: 'mount must not wipe tabs');

    // Navigate away: replace the workspace, disposing its State.
    await tester
        .pumpWidget(const MaterialApp(home: Scaffold(body: SizedBox.shrink())));
    // Navigate back: a brand-new workspace State is created (remount).
    await tester.pumpWidget(workspace());
    await tester.pump();

    expect(controller.tabs, hasLength(1),
        reason: 'remount must not reset the parent-owned controller');
    expect(controller.tabs.first.id, 'artifact-id');
  });
}
