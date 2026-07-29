import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/ui/rhythm_inspector.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/models/task_collaborator.dart';

// ---------------------------------------------------------------------------
// Issue #1084: mirrored (prod-authoritative) tasks are refreshed from the
// production API every 10 minutes, silently reverting local edits. The task
// inspector must make this visible: prod_mirror tasks open read-only with an
// explanatory subtitle, and expose no edit affordance.
// ---------------------------------------------------------------------------

void main() {
  Widget wrap(Widget widget) => MaterialApp(
    theme: ThemeData.light().copyWith(
      extensions: const [RhythmColorRoles.light],
    ),
    home: Scaffold(body: widget),
  );

  Task makeTask({String? sourceType}) => Task(
    id: 'test-1',
    title: 'Mirrored task',
    status: TaskStatus.open,
    collaborators: const <TaskCollaborator>[],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    sourceType: sourceType,
  );

  Future<void> openInspector(WidgetTester tester, Task task) async {
    await tester.binding.setSurfaceSize(const Size(1400, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final savedOnError = FlutterError.onError;
    FlutterError.onError = (details) {
      if (details.exceptionAsString().contains('overflowed')) return;
      savedOnError?.call(details);
    };
    addTearDown(() => FlutterError.onError = savedOnError);

    await tester.pumpWidget(
      wrap(
        Builder(
          builder: (context) => ElevatedButton(
            onPressed: () => showRhythmTaskInspector(
              context,
              task: task,
              workspaceMembers: const [],
              onSaveDetails: (_) async {},
            ),
            child: const Text('Open'),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();
  }

  const prodSubtitle =
      'This task mirrors the production system, which is the source of truth. '
      'Local edits here are overwritten on the next sync.';

  testWidgets('prod_mirror task opens read-only with an explanatory subtitle', (
    tester,
  ) async {
    await openInspector(tester, makeTask(sourceType: 'prod_mirror'));

    expect(find.text('TASK INSPECTOR · READ ONLY'), findsOneWidget);
    expect(find.text(prodSubtitle), findsOneWidget);
    // No edit affordance: the mirror is overwritten on the next sync.
    expect(find.text('Edit details'), findsNothing);
    expect(find.text('Save changes'), findsNothing);
  });

  testWidgets('editable task shows the edit affordance and no prod notice', (
    tester,
  ) async {
    await openInspector(tester, makeTask(sourceType: null));

    expect(find.text('TASK INSPECTOR · READ ONLY'), findsNothing);
    expect(find.text(prodSubtitle), findsNothing);
    // A normal task defaults to edit mode (issue #675), so Save is present.
    expect(find.text('Save changes'), findsOneWidget);
  });
}
