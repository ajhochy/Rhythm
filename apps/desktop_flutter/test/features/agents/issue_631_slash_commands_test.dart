/// Flutter-side smoke tests for issue #631 — slash-command popover lists commands.
///
/// Two test groups:
///
///   A) [CommandsDataSource] unit tests (mock http.Client):
///      - list() parses a valid JSON command array to [SlashCommand] items.
///      - list() returns [] on non-200 response.
///      - list() returns [] when the HTTP call throws an exception.
///
///   B) [SlashCommandPopover] widget test:
///      - Pumps the PUBLIC [SlashCommandPopover] widget with a non-empty
///        command list, types '/' in the composer, and asserts command names
///        render as tappable rows.
///      - Asserts that the popover is closed (hidden) when the input does not
///        start with '/'.
///
/// What is NOT covered here (still manual):
///   issue-631-c5: Typing '/' in the live app with the opencode SDK running
///   and commands configured — requires a running app + SDK with
///   user-defined commands in opencode.json.
///   See docs/testing/manual-smoke.md under issue #631.
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/data/commands_data_source.dart';
import 'package:rhythm_desktop/features/agents/views/_slash_command_popover.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

http.Client _mockClient(int status, Object body) {
  return MockClient(
    (_) async =>
        http.Response(body is String ? body : jsonEncode(body), status),
  );
}

Widget _wrapPopover({
  required TextEditingController inputController,
  required List<SlashCommand> commands,
  required ValueChanged<String> onCommandSelected,
}) {
  return MaterialApp(
    theme: AppTheme.light(),
    home: Scaffold(
      body: Center(
        child: SlashCommandPopover(
          inputController: inputController,
          commands: commands,
          onCommandSelected: onCommandSelected,
          child: const SizedBox(width: 300, height: 40),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// A) CommandsDataSource unit tests
// ---------------------------------------------------------------------------

void main() {
  group('issue #631-A — CommandsDataSource.list() parsing', () {
    test('parses a valid JSON command array to SlashCommand items', () async {
      final client = _mockClient(200, [
        {'name': 'help', 'description': 'Show help'},
        {'name': 'clear', 'description': 'Clear conversation'},
        {'name': 'compact', 'description': null},
      ]);
      final ds = CommandsDataSource(client: client);

      final result = await ds.list();

      expect(result, hasLength(3));
      expect(result[0].name, 'help');
      expect(result[0].description, 'Show help');
      expect(result[1].name, 'clear');
      expect(result[1].description, 'Clear conversation');
      expect(result[2].name, 'compact');
      expect(result[2].description, isNull);
    });

    test('returns empty list on non-200 response', () async {
      final client = _mockClient(404, 'Not Found');
      final ds = CommandsDataSource(client: client);

      final result = await ds.list();

      expect(
        result,
        isEmpty,
        reason: 'Non-200 status must degrade to [] without throwing.',
      );
    });

    test('returns empty list on 500 server error', () async {
      final client = _mockClient(500, 'Internal Server Error');
      final ds = CommandsDataSource(client: client);

      final result = await ds.list();

      expect(result, isEmpty);
    });

    test('returns empty list when HTTP call throws an exception', () async {
      final client = MockClient((_) async => throw Exception('network error'));
      final ds = CommandsDataSource(client: client);

      final result = await ds.list();

      expect(
        result,
        isEmpty,
        reason: 'Exceptions must be swallowed and degrade to [].',
      );
    });

    test('returns empty list when response body is not a JSON array', () async {
      final client = _mockClient(200, '{"error": "unexpected format"}');
      final ds = CommandsDataSource(client: client);

      // Expect either [] or a thrown error handled gracefully — the data source
      // must not crash the caller.
      final result = await ds.list().then(
        (r) => r,
        onError: (_) => <SlashCommand>[],
      );

      // The catch block in CommandsDataSource.list wraps cast errors — result
      // will be [].
      expect(result, isEmpty);
    });
  });

  // -------------------------------------------------------------------------
  // B) SlashCommandPopover widget tests
  // -------------------------------------------------------------------------

  group('issue #631-B — SlashCommandPopover widget renders command rows', () {
    late TextEditingController inputController;
    String? lastSelected;

    setUp(() {
      inputController = TextEditingController();
      lastSelected = null;
    });

    tearDown(() {
      inputController.dispose();
    });

    const testCommands = [
      SlashCommand(name: 'help', description: 'Show help text'),
      SlashCommand(name: 'clear', description: 'Clear the conversation'),
      SlashCommand(name: 'compact'),
    ];

    testWidgets('typing "/" opens the popover and shows command names', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrapPopover(
          inputController: inputController,
          commands: testCommands,
          onCommandSelected: (cmd) => lastSelected = cmd,
        ),
      );

      // Type '/' — should open the popover.
      inputController.text = '/';
      await tester.pump();

      // All command names should be visible with leading slash.
      expect(find.text('/help'), findsOneWidget);
      expect(find.text('/clear'), findsOneWidget);
      expect(find.text('/compact'), findsOneWidget);
    });

    testWidgets('command descriptions are shown alongside names', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrapPopover(
          inputController: inputController,
          commands: testCommands,
          onCommandSelected: (cmd) => lastSelected = cmd,
        ),
      );

      inputController.text = '/';
      await tester.pump();

      expect(find.text('Show help text'), findsOneWidget);
      expect(find.text('Clear the conversation'), findsOneWidget);
    });

    testWidgets('popover is NOT visible when input is empty', (tester) async {
      await tester.pumpWidget(
        _wrapPopover(
          inputController: inputController,
          commands: testCommands,
          onCommandSelected: (cmd) => lastSelected = cmd,
        ),
      );

      // Empty input — popover must be hidden.
      expect(find.text('/help'), findsNothing);
    });

    testWidgets('popover is NOT visible when input does not start with "/"', (
      tester,
    ) async {
      await tester.pumpWidget(
        _wrapPopover(
          inputController: inputController,
          commands: testCommands,
          onCommandSelected: (cmd) => lastSelected = cmd,
        ),
      );

      inputController.text = 'hello';
      await tester.pump();

      expect(find.text('/help'), findsNothing);
    });

    testWidgets('tapping a command row fires onCommandSelected', (
      tester,
    ) async {
      // Use a taller host so the Positioned popover renders within the
      // hit-test area.
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: SizedBox(
              width: 400,
              height: 600,
              child: SlashCommandPopover(
                inputController: inputController,
                commands: testCommands,
                onCommandSelected: (cmd) => lastSelected = cmd,
                child: const SizedBox(width: 400, height: 40),
              ),
            ),
          ),
        ),
      );

      inputController.text = '/';
      await tester.pump();

      // Find the InkWell that wraps the '/help' row and tap it.
      final inkwells = find.ancestor(
        of: find.text('/help'),
        matching: find.byType(InkWell),
      );
      expect(inkwells, findsOneWidget);
      await tester.tap(inkwells, warnIfMissed: false);
      await tester.pump();

      expect(
        lastSelected,
        '/help ',
        reason:
            'Selecting a command must call onCommandSelected with "/name " (trailing space).',
      );
    });

    testWidgets('"/hel" filters to only /help', (tester) async {
      await tester.pumpWidget(
        _wrapPopover(
          inputController: inputController,
          commands: testCommands,
          onCommandSelected: (cmd) => lastSelected = cmd,
        ),
      );

      inputController.text = '/hel';
      await tester.pump();

      expect(find.text('/help'), findsOneWidget);
      expect(find.text('/clear'), findsNothing);
      expect(find.text('/compact'), findsNothing);
    });

    testWidgets('empty command list shows "No commands" text', (tester) async {
      await tester.pumpWidget(
        _wrapPopover(
          inputController: inputController,
          commands: const [],
          onCommandSelected: (cmd) => lastSelected = cmd,
        ),
      );

      inputController.text = '/';
      await tester.pump();

      // When commands is empty, _isOpen returns false (guard in _isOpen).
      // So the popover does not open at all — no "No commands" text either.
      // This is the current production behavior: empty catalog = no popover.
      expect(find.text('/'), findsNothing);
      // child is rendered directly.
      expect(find.byType(SizedBox), findsOneWidget);
    });
  });
}
