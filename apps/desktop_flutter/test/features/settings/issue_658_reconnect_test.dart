/// Acceptance contract (client) for issue #658 — Claude "Reconnect" must give
/// visible feedback: a spinner while in-flight, an enabled+tappable button
/// otherwise.
///
/// The full AiAccountSection drives its tiles from un-injectable global `http`
/// calls (the Claude tile only renders when `/opencode/auth/sources` reports
/// claudeCode:true), so the SnackBar + force=true end-to-end is covered by the
/// server tests (opencode_auth_routes / credentials_bridge_service) plus manual
/// smoke. Here we lock the presentational contract of the reconnect tile.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/settings/widgets/ai_account_section.dart';

Widget _wrap(Widget child) => MaterialApp(
      theme: AppTheme.light(),
      home: Scaffold(body: Center(child: child)),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
      'issue-658-c3a: SubscriptionTile shows a spinner (not a label) while '
      'saving', (tester) async {
    await tester.pumpWidget(_wrap(
      const SubscriptionTile(
        label: 'Claude',
        description: 'Use your existing Claude Code subscription',
        connected: true,
        isSaving: true,
        onConnect: _noop,
      ),
    ));

    expect(find.byType(CircularProgressIndicator), findsOneWidget,
        reason:
            'while saving, the reconnect button must show a spinner (#658)');
    expect(find.text('Reconnect'), findsNothing,
        reason: 'label is replaced by the spinner while saving');
  });

  testWidgets(
      'issue-658-c3b: when not saving, the button shows "Reconnect" and a tap '
      'fires onConnect', (tester) async {
    var taps = 0;
    await tester.pumpWidget(_wrap(
      SubscriptionTile(
        label: 'Claude',
        description: 'Use your existing Claude Code subscription',
        connected: true,
        isSaving: false,
        onConnect: () => taps++,
      ),
    ));

    expect(find.text('Reconnect'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);

    await tester.tap(find.text('Reconnect'));
    await tester.pump();
    expect(taps, 1,
        reason:
            'an enabled reconnect button must fire onConnect on tap (#658)');
  });

  testWidgets(
      'issue-658-c3c: not-connected tile reads "Use Claude subscription"',
      (tester) async {
    await tester.pumpWidget(_wrap(
      const SubscriptionTile(
        label: 'Claude',
        description: 'Use your existing Claude Code subscription',
        connected: false,
        isSaving: false,
        onConnect: _noop,
      ),
    ));
    expect(find.text('Use Claude subscription'), findsOneWidget);
  });
}

void _noop() {}
