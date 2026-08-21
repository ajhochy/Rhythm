import 'dart:convert';

import 'package:file_picker/file_picker.dart';
import 'package:file_picker/src/platform/file_picker_platform_interface.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
/// leaves the parent-owned controller's imported tabs intact.
class _StubFilePickerPlatform extends FilePickerPlatform {
  @override
  Future<FilePickerResult?> pickFiles({
    String? dialogTitle,
    String? initialDirectory,
    FileType type = FileType.any,
    List<String>? allowedExtensions,
    Function(FilePickerStatus)? onFileLoading,
    int compressionQuality = 0,
    bool allowMultiple = false,
    bool withData = false,
    bool withReadStream = false,
    bool lockParentWindow = false,
    bool readSequential = false,
    bool cancelUploadOnWindowBlur = true,
  }) async =>
      FilePickerResult([
        PlatformFile(
          name: 'worship-calendar.html',
          size: _fixture.length,
          bytes: Uint8List.fromList(_fixture),
        ),
      ]);
}

final _fixture = utf8.encode(
  '<!doctype html><title>Worship Calendar</title><main>Calendar</main>',
);

class _RecordingPreferences extends UserPreferencesDataSource {
  _RecordingPreferences() : super(baseUrl: 'http://localhost');

  List<String> saved = const [];

  @override
  Future<Map<String, dynamic>> updateArtifactTabIds(List<String> ids) async {
    saved = List.of(ids);
    return const {};
  }
}

void main() {
  testWidgets('#1381: imported tab survives workspace navigation/remount',
      (tester) async {
    // Regression: a real picker import is persisted, but remounting Dashboard
    // clears the shared controller and makes the imported tab disappear.
    final originalPicker = FilePickerPlatform.instance;
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    const windowManagerChannel = MethodChannel('window_manager');
    messenger.setMockMethodCallHandler(windowManagerChannel, (_) async => null);
    FilePickerPlatform.instance = _StubFilePickerPlatform();
    addTearDown(() {
      FilePickerPlatform.instance = originalPicker;
      messenger.setMockMethodCallHandler(windowManagerChannel, null);
    });
    final preferences = _RecordingPreferences();
    final controller = LiveArtifactsController(
      LiveArtifactsDataSource(baseUrl: 'http://localhost'),
      preferences,
    );
    addTearDown(controller.dispose);
    await controller.restore(7, const []);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: DashboardArtifactTabs(
            controller: controller,
            onImport: (title, bundle) async {
              expect(title, 'Worship Calendar');
              expect(bundle.html, contains('<main>Calendar</main>'));
              await controller.open(
                LiveArtifact(
                  id: 'stable-imported-artifact-id',
                  title: title,
                  updatedAt: DateTime(2026, 8, 19),
                ),
              );
            },
          ),
        ),
      ),
    );
    await tester.tap(find.byTooltip('Open live artifact'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Import HTML').first);
    await tester.pumpAndSettle();
    // The picker is a custom OverlayEntry; dismiss its transparent outside
    // layer after the modal route is installed so the dialog receives taps.
    await tester.tapAt(const Offset(4, 4));
    await tester.pumpAndSettle();
    final chooseFile = find.descendant(
      of: find.byType(AlertDialog),
      matching: find.widgetWithText(TextButton, 'Choose HTML file'),
    );
    await tester.runAsync(() async {
      await tester.tap(chooseFile);
      await Future<void>.delayed(const Duration(milliseconds: 50));
    });
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Import'));
    await tester.pumpAndSettle();

    expect(controller.tabs.single.id, 'stable-imported-artifact-id');
    expect(preferences.saved, ['stable-imported-artifact-id']);

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
    expect(
      find.bySemanticsLabel('Worship Calendar artifact tab'),
      findsOneWidget,
    );
    expect(controller.tabs.single.id, 'stable-imported-artifact-id');

    // Navigate away: replace the workspace, disposing its State.
    await tester
        .pumpWidget(const MaterialApp(home: Scaffold(body: SizedBox.shrink())));
    // Navigate back: a brand-new workspace State is created (remount).
    await tester.pumpWidget(workspace());
    await tester.pump();

    expect(
      find.bySemanticsLabel('Worship Calendar artifact tab'),
      findsOneWidget,
    );
    expect(controller.tabs.single.id, 'stable-imported-artifact-id');
    expect(preferences.saved, ['stable-imported-artifact-id']);
  });
}
