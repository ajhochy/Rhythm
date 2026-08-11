import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rhythm_desktop/app/theme/app_theme.dart';
import 'package:rhythm_desktop/features/agents/mcp_apps/mcp_app_readonly_host.dart';
import 'package:rhythm_desktop/features/agents/models/chat_models.dart';
import 'package:rhythm_desktop/features/agents/views/_tool_call_part.dart';

ChatPart _part() => ChatPart.fromJson('message', {
      'id': 'part',
      'type': 'tool',
      'tool': 'descriptor_owned_tool',
      'callID': 'call',
      'state': {
        'status': 'completed',
        'input': {'document': 'demo'},
        'output': 'Readable text fallback',
        'mcpResult': {
          'structuredContent': {'document': 'demo'},
        },
        'mcpAppResource': {
          'sessionID': 'session',
          'callID': 'call',
          'serverName': 'origin-server',
          'resourceUri': 'ui://origin-server/view',
          'advertisedAt': '2026-08-10T20:00:00.000Z',
          'expiresAt': '2026-08-10T20:10:00.000Z',
        },
      },
    });

Widget _wrap(Widget child) => MaterialApp(
      theme: AppTheme.light(),
      home: Scaffold(body: SizedBox(width: 700, child: child)),
    );

void main() {
  testWidgets(
    'issue-1351-c1-c2-c4: descriptor host keeps fallback before load and on resource error',
    (tester) async {
      final pending = Completer<McpAppHtmlResource>();
      var reads = 0;
      await tester.pumpWidget(_wrap(ToolCallPart(
        part: _part(),
        mcpAppsMode: 'readonly',
        enableMcpAppNativeRuntime: false,
        mcpAppResourceFetcher: ({required sessionId, required callId}) {
          reads++;
          expect((sessionId, callId), ('session', 'call'));
          return pending.future;
        },
      )));

      expect(reads, 1);
      expect(find.text('Readable text fallback'), findsOneWidget);
      pending.completeError(StateError('offline'));
      await tester.pump();
      await tester.pump();
      expect(find.text('Readable text fallback'), findsOneWidget);
      expect(find.textContaining('result remains above'), findsOneWidget);
    },
  );

  testWidgets('issue-1351-c5: off mode remains generic card and reads nothing',
      (tester) async {
    var reads = 0;
    await tester.pumpWidget(_wrap(ToolCallPart(
      part: _part(),
      mcpAppsMode: 'off',
      enableMcpAppNativeRuntime: false,
      mcpAppResourceFetcher: ({required sessionId, required callId}) async {
        reads++;
        return const McpAppHtmlResource(
          mimeType: 'text/html;profile=mcp-app',
          text: '<main>must not load</main>',
        );
      },
    )));

    expect(reads, 0);
    expect(find.text('descriptor_owned_tool'), findsOneWidget);
    expect(find.text('Readable text fallback'), findsNothing);
    await tester.tap(find.text('descriptor_owned_tool'));
    await tester.pump();
    expect(find.text('Readable text fallback'), findsOneWidget);
  });
}
