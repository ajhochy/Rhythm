/// Issue #643 — Slash-command popover list is not scrollable.
///
/// CONTRACT:
///   When more than ~8 commands are supplied the popover must be scrollable
///   so that ALL commands are reachable via scroll/drag — even the ones that
///   don't fit within the 240 px max-height box.
///
/// MECHANISM UNDER TEST:
///   The _CommandList wraps its ListView in a Container with
///   `constraints: BoxConstraints(maxHeight: 240)`. That container is painted
///   outside the Stack's own bounds (Clip.none + Positioned(bottom:0)).
///   Flutter does NOT deliver pointer/scroll hit-tests to areas outside the
///   parent's hit-test area, so `Scrollable.ensureVisible` on an out-of-bounds
///   descendant fails to make the last item findable with `findsOneWidget`
///   when the list is longer than the visible portion.
///
/// GREEN condition (post-fix):
///   After restructuring the layout so the hit-test region covers the full
///   popover box, `Scrollable.ensureVisible` on the last item widget must
///   succeed and the last item must then be findable.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/data/commands_data_source.dart';
import 'package:rhythm_desktop/features/agents/views/_slash_command_popover.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build 30 unique slash-commands — more than fit in the 240 px box.
List<SlashCommand> _manyCommands(int count) => List.generate(
      count,
      (i) => SlashCommand(name: 'cmd$i', description: 'Command number $i'),
    );

/// Wraps SlashCommandPopover in a tall host so the upward-growing popover has
/// room to be hit-tested when the layout fix is applied.
Widget _wrapPopover({
  required TextEditingController inputController,
  required List<SlashCommand> commands,
}) {
  return MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(
      body: Align(
        alignment: Alignment.bottomCenter,
        child: SizedBox(
          width: 600,
          height: 400,
          child: SlashCommandPopover(
            inputController: inputController,
            commands: commands,
            onCommandSelected: (_) {},
            child: Container(
              width: 600,
              height: 48,
              color: Colors.white,
            ),
          ),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('issue #643 — slash-command popover list is scrollable', () {
    late TextEditingController inputController;

    setUp(() {
      inputController = TextEditingController();
    });

    tearDown(() {
      inputController.dispose();
    });

    testWidgets(
      'last command is reachable via Scrollable.ensureVisible after opening popover',
      (tester) async {
        // Give the test surface enough height so the popover has room.
        await tester.binding.setSurfaceSize(const Size(800, 700));
        addTearDown(() => tester.binding.setSurfaceSize(null));

        const commandCount = 30;
        final commands = _manyCommands(commandCount);

        await tester.pumpWidget(
          _wrapPopover(inputController: inputController, commands: commands),
        );

        // Open the popover.
        inputController.text = '/';
        await tester.pump();

        // First command (cmd0) must be visible immediately.
        expect(find.text('/cmd0'), findsOneWidget,
            reason: 'First command must be visible when popover opens.');

        // The last command must NOT be visible yet (list too tall).
        // (It may or may not be — depends on layout — but what matters is
        //  that ensureVisible brings it into view and it stays findable.)

        // Use ensureVisible to scroll the last item into view.
        final lastItemFinder = find.text('/cmd${commandCount - 1}');

        await tester.scrollUntilVisible(lastItemFinder, 50,
            scrollable: find.descendant(
              of: find.byType(SlashCommandPopover),
              matching: find.byType(Scrollable),
            ));

        await tester.pump();

        expect(
          lastItemFinder,
          findsOneWidget,
          reason:
              'The last command must be reachable by scrolling the popover list. '
              'If this fails, the Positioned layout prevents scroll hit-tests '
              'from reaching the ListView (issue #643 root cause).',
        );
      },
    );

    testWidgets(
      'scrolling reveals commands that were below the visible area',
      (tester) async {
        await tester.binding.setSurfaceSize(const Size(800, 700));
        addTearDown(() => tester.binding.setSurfaceSize(null));

        const commandCount = 30;
        final commands = _manyCommands(commandCount);

        await tester.pumpWidget(
          _wrapPopover(inputController: inputController, commands: commands),
        );

        inputController.text = '/';
        await tester.pump();

        // First command must be visible immediately.
        expect(find.text('/cmd0'), findsOneWidget,
            reason: 'First command must be visible when popover opens.');

        // Late-index commands must NOT be visible without scrolling (sanity check).
        expect(find.text('/cmd27'), findsNothing,
            reason:
                'cmd27 must not be visible before scrolling (list is capped at 240px).');

        // Drag the list upward to reveal items below the visible area.
        final scrollableFinder = find.byType(Scrollable);
        expect(scrollableFinder, findsOneWidget,
            reason: 'The ListView must produce a Scrollable widget.');

        await tester.drag(scrollableFinder.first, const Offset(0, -800));
        await tester.pumpAndSettle();

        // After dragging, later items (not the very last which may be partially
        // clipped) must now be visible — confirming scroll events reached the ListView.
        expect(
          find.text('/cmd27'),
          findsOneWidget,
          reason: 'cmd27 must be reachable after drag-scrolling. '
              'If this fails, scroll events are not delivered to the ListView '
              '(issue #643 — Positioned layout clips hit-tests).',
        );
      },
    );
  });
}
