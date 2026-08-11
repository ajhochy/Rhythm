import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/views/_tool_call_part.dart';

const _fallbackText = 'Readable fallback text';

Map<String, dynamic> _toolPart({required Object? structuredContent}) => {
      'id': 'part-issue-1342',
      'messageID': 'msg-issue-1342',
      'sessionID': 'session-issue-1342',
      'type': 'tool',
      'callID': 'call-issue-1342',
      'tool': 'unknown_mcp_app_tool',
      'state': {
        'status': 'completed',
        'input': <String, dynamic>{},
        'title': '',
        'output': _fallbackText,
        'metadata': <String, dynamic>{},
        'mcpResult': {
          'structuredContent': structuredContent,
          '_meta': {
            'source': 'untrusted-contract-server',
          },
          'isError': false,
        },
        'time': {'start': 1, 'end': 2},
      },
    };

Widget _wrap(Widget child) => MaterialApp(
      theme: AppTheme.light(),
      home: Scaffold(body: SizedBox(width: 700, child: child)),
    );

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  testWidgets(
    'issue-1342-c3: unknown structured results render as inert, collapsed JSON',
    (tester) async {
      // Regression caught: an unknown result is silently dropped or interpreted
      // as HTML. The collapsed-label assertion catches dropping; the literal
      // script text after expansion catches executable/rich rendering.
      final part = ChatPart.fromJson(
        'msg-issue-1342',
        _toolPart(
          structuredContent: {
            'kind': 'unregistered-widget',
            'count': 2,
            'hostile': '<script>globalThis.pwned = true</script>',
          },
        ),
      );

      await tester.pumpWidget(_wrap(ToolCallPart(part: part)));

      expect(find.text('Structured result'), findsOneWidget);
      expect(find.textContaining('unregistered-widget'), findsNothing);
      expect(find.byType(HtmlElementView), findsNothing);

      await tester.tap(find.text('Structured result'));
      await tester.pump();

      expect(find.textContaining('unregistered-widget'), findsOneWidget);
      expect(
        find.textContaining('<script>globalThis.pwned = true</script>'),
        findsOneWidget,
      );
      expect(find.text(_fallbackText), findsOneWidget);
    },
  );

  testWidgets(
    'issue-1342-c4: malformed or oversized structured data degrades to text without crashing',
    (tester) async {
      // Regression caught: JSON formatting an unbounded/malformed MCP value
      // throws during build or allocates an enormous widget. A 2 MiB payload
      // must be ignored while the pre-existing text fallback remains usable.
      final oversized = List<String>.filled(2 * 1024 * 1024, 'x').join();
      final part = ChatPart.fromJson(
        'msg-issue-1342',
        _toolPart(structuredContent: {'oversized': oversized}),
      );

      await tester.pumpWidget(_wrap(ToolCallPart(part: part)));
      expect(tester.takeException(), isNull);
      expect(find.text('Structured result'), findsNothing);

      await tester.tap(find.text('unknown_mcp_app_tool'));
      await tester.pump();

      expect(tester.takeException(), isNull);
      expect(find.text(_fallbackText), findsOneWidget);
      expect(find.textContaining(oversized.substring(0, 256)), findsNothing);
    },
  );
}
