import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/ui/rhythm_inspector.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';
import 'package:rhythm_desktop/features/tasks/models/task.dart';
import 'package:rhythm_desktop/features/tasks/models/task_collaborator.dart';

// ---------------------------------------------------------------------------
// Acceptance-contract tests for issue #675 — part A (existing inspector API).
//
// c1: the task inspector opens in EDIT mode by default — Save/Cancel visible
//     immediately, no "Edit details" click required. MUST FAIL before the
//     initialEditMode change lands (today the inspector opens read-first).
//     All three composing views (Weekly Planner, Tasks, Dashboard) call
//     showRhythmTaskInspector without overriding the default, so the
//     entry-fn default is the production input (verified by grep; visual
//     confirmation is on the manual smoke list).
// c2: calendar_shadow_event tasks stay read-only regardless of the new
//     default (regression guard — passes before AND after the change).
//
// Part B (create mode) lives in issue_675_create_contract_test.dart.
// ---------------------------------------------------------------------------

Widget wrap(Widget widget) {
  return MaterialApp(
    theme: ThemeData.light().copyWith(
      extensions: const [RhythmColorRoles.light],
    ),
    home: Scaffold(body: widget),
  );
}

Task makeTask({String? sourceType}) => Task(
      id: 'test-675',
      title: 'Existing task',
      status: TaskStatus.open,
      collaborators: const <TaskCollaborator>[],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      sourceType: sourceType,
    );

Future<void> openInspector(
  WidgetTester tester,
  Task task,
) async {
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

void main() {
  testWidgets(
    'issue-675-c1: inspector opens in edit mode by default '
    '(Save/Cancel visible, no Edit details click required)',
    (tester) async {
      await openInspector(tester, makeTask());

      expect(find.text('Save changes'), findsOneWidget,
          reason: 'Save must be visible immediately on open');
      expect(find.text('Cancel'), findsOneWidget,
          reason: 'Cancel must be visible immediately on open');
      expect(find.text('Edit details'), findsNothing,
          reason: 'No Edit details click should be required');
    },
  );

  testWidgets(
    'issue-675-c2: calendar shadow-event tasks remain read-only '
    'despite the edit-mode default',
    (tester) async {
      await openInspector(
          tester, makeTask(sourceType: 'calendar_shadow_event'));

      expect(find.text('TASK INSPECTOR · READ ONLY'), findsOneWidget,
          reason: 'Read-only kicker must be shown for shadow events');
      expect(find.text('Save changes'), findsNothing,
          reason: 'Shadow events must not be editable');
      expect(find.text('Edit details'), findsNothing,
          reason: 'Shadow events must not offer an edit affordance');
    },
  );
}
