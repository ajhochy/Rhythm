import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/core/ui/rhythm_inspector.dart';
import 'package:rhythm_desktop/app/core/ui/tokens/rhythm_theme.dart';

// ---------------------------------------------------------------------------
// Acceptance-contract tests for issue #675 — part B (create mode).
//
// These tests target the NEW public entry point
// `showRhythmTaskCreateInspector` (full inspector in create/edit mode,
// replacing showRhythmTaskCreateDialog for the Weekly Planner). Before the
// implementation lands this file fails to COMPILE — that is the expected red
// state for a contract on a not-yet-existing API.
//
// c3: create inspector seeded with a scheduled day → saving calls onCreate
//     with that scheduledDate (day-column "Add task" path).
// c4: create inspector with no seed date → saving calls onCreate with null
//     scheduledDate (backlog "+" path).
// c5: notes / due date / preferred agent are settable during creation —
//     notes round-trip into the onCreate request; the schedule controls and
//     agent dropdown render in create mode. Collaborator controls are hidden
//     for an unsaved task (issue-blessed "simplest" design).
// c6: Cancel dismisses the create inspector without calling onCreate.
// ---------------------------------------------------------------------------

const kDay = '2026-06-16';

Widget wrap(Widget widget) {
  return MaterialApp(
    theme: ThemeData.light().copyWith(
      extensions: const [RhythmColorRoles.light],
    ),
    home: Scaffold(body: widget),
  );
}

Future<void> openCreateInspector(
  WidgetTester tester, {
  String? scheduledDate,
  required RhythmTaskInspectorSave onCreate,
}) async {
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
          onPressed: () => showRhythmTaskCreateInspector(
            context,
            scheduledDate: scheduledDate,
            workspaceMembers: const [],
            onCreate: onCreate,
          ),
          child: const Text('Open'),
        ),
      ),
    ),
  );

  await tester.tap(find.text('Open'));
  await tester.pumpAndSettle();
}

Future<void> enterTitle(WidgetTester tester, String title) async {
  final titleField = find.widgetWithText(TextField, 'Task title');
  expect(
    titleField,
    findsOneWidget,
    reason: 'Create inspector must open with an editable title field',
  );
  await tester.enterText(titleField.first, title);
  await tester.pump();
}

void main() {
  testWidgets(
    'issue-675-c3: day-column create inspector seeds the selected day '
    'and saving creates with that scheduledDate',
    (tester) async {
      RhythmTaskInspectorSaveRequest? created;
      await openCreateInspector(
        tester,
        scheduledDate: kDay,
        onCreate: (request) async => created = request,
      );

      await enterTitle(tester, 'New planner task');
      await tester.tap(find.text('Create task'));
      await tester.pumpAndSettle();

      expect(
        created,
        isNotNull,
        reason: 'Saving must invoke the create callback',
      );
      expect(created!.title, 'New planner task');
      expect(
        created!.scheduledDate,
        kDay,
        reason: 'The selected day must be pre-seeded and persisted',
      );
    },
  );

  testWidgets('issue-675-c4: backlog create inspector has no scheduled date '
      'and saving creates a backlog task', (tester) async {
    RhythmTaskInspectorSaveRequest? created;
    await openCreateInspector(
      tester,
      scheduledDate: null,
      onCreate: (request) async => created = request,
    );

    await enterTitle(tester, 'New backlog task');
    await tester.tap(find.text('Create task'));
    await tester.pumpAndSettle();

    expect(created, isNotNull);
    expect(
      created!.scheduledDate,
      isNull,
      reason: 'Backlog "+" must not seed a scheduled date',
    );
  });

  testWidgets('issue-675-c5: notes, due date, and preferred agent are settable '
      'during creation; collaborator controls hidden for unsaved task', (
    tester,
  ) async {
    RhythmTaskInspectorSaveRequest? created;
    await openCreateInspector(
      tester,
      scheduledDate: kDay,
      onCreate: (request) async => created = request,
    );

    // Schedule + automation controls render in create mode.
    expect(
      find.text('Set due date'),
      findsOneWidget,
      reason: 'Due date must be settable during creation',
    );
    expect(
      find.text('Default agent for this task'),
      findsOneWidget,
      reason: 'Preferred agent must be settable during creation',
    );
    // No collaborator add for a task that has no id yet.
    expect(
      find.text('Add collaborator'),
      findsNothing,
      reason: 'Collaborator controls are hidden until first save',
    );

    await enterTitle(tester, 'Task with notes');
    final notesField = find.byWidgetPredicate(
      (w) =>
          w is TextField &&
          (w.decoration?.hintText ?? '').startsWith('Add notes'),
    );
    expect(
      notesField,
      findsOneWidget,
      reason: 'Notes must be editable during creation',
    );
    await tester.enterText(notesField, 'Prep detail');
    await tester.pump();

    await tester.tap(find.text('Create task'));
    await tester.pumpAndSettle();

    expect(created, isNotNull);
    expect(
      created!.notes,
      'Prep detail',
      reason: 'Notes typed during creation must reach the create call',
    );
  });

  testWidgets(
    'issue-675-c6: Cancel discards the new task without creating it',
    (tester) async {
      var createCalls = 0;
      await openCreateInspector(
        tester,
        scheduledDate: kDay,
        onCreate: (_) async => createCalls++,
      );

      await enterTitle(tester, 'Doomed task');
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();

      expect(createCalls, 0, reason: 'Cancel must not create the task');
      expect(
        find.text('Create task'),
        findsNothing,
        reason: 'Cancel must dismiss the create inspector',
      );
    },
  );
}
