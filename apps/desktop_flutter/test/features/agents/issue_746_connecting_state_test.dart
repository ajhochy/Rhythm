/// Widget tests for issue #746 — non-blocking composer during engine cold-start.
///
/// Verifies that [_EngineConnectingState] (exposed via [EngineConnectingStateTestHarness]):
///   1. Renders the "Connecting to agent engine…" banner text.
///   2. Shows a circular progress indicator alongside the banner.
///   3. Renders the text field in a disabled state.
///   4. Renders the Send button in a disabled state (onPressed == null).
///
/// These criteria confirm that the composer is visible immediately when
/// [AgentsController.isCreating] is true, instead of showing a frozen empty
/// state, while preventing accidental sends before the session is ready.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/views/agents_view.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

Widget _wrap(Widget child) {
  return MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(body: SizedBox(width: 800, height: 600, child: child)),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  group('issue #746 — _EngineConnectingState (non-blocking composer)', () {
    testWidgets('renders the connecting banner text', (tester) async {
      await tester.pumpWidget(_wrap(const EngineConnectingStateTestHarness()));
      await tester.pump();

      expect(
        find.text('Connecting to agent engine…'),
        findsOneWidget,
        reason:
            'The connecting banner must be visible while isCreating is true',
      );
    });

    testWidgets('renders a CircularProgressIndicator in the banner', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(const EngineConnectingStateTestHarness()));
      await tester.pump();

      expect(
        find.byType(CircularProgressIndicator),
        findsWidgets,
        reason: 'A spinner must accompany the connecting banner',
      );
    });

    testWidgets('renders the text field (disabled, not interactive)', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(const EngineConnectingStateTestHarness()));
      await tester.pump();

      final textFieldFinder = find.byType(TextField);
      expect(
        textFieldFinder,
        findsOneWidget,
        reason: 'Composer text field must be visible during connecting state',
      );

      // The field must be disabled (enabled == false) so the user cannot type.
      final textField = tester.widget<TextField>(textFieldFinder);
      expect(
        textField.enabled,
        isFalse,
        reason: 'Text field must be disabled while engine is connecting',
      );
    });

    testWidgets('renders the Send button in a disabled state', (tester) async {
      await tester.pumpWidget(_wrap(const EngineConnectingStateTestHarness()));
      await tester.pump();

      final buttonFinder = find.widgetWithText(FilledButton, 'Send');
      expect(
        buttonFinder,
        findsOneWidget,
        reason: 'Send button must be visible during connecting state',
      );

      // onPressed == null means the button is disabled.
      final button = tester.widget<FilledButton>(buttonFinder);
      expect(
        button.onPressed,
        isNull,
        reason: 'Send button must be disabled while engine is connecting',
      );
    });

    testWidgets('shows hint text indicating readiness is pending', (
      tester,
    ) async {
      await tester.pumpWidget(_wrap(const EngineConnectingStateTestHarness()));
      await tester.pump();

      // The hint is on the disabled text field.
      expect(
        find.text('Connecting to engine — ready shortly…'),
        findsOneWidget,
        reason: 'Hint text must communicate that the engine is initializing',
      );
    });
  });
}
