import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/features/agents/data/agents_data_source.dart';

void main() {
  test(
    'issue-1345-c4: Flutter has no direct MCP transport and uses localhost API',
    () async {
      // Regression caught: Flutter receives/constructs an MCP server URI or
      // forwards caller authority. The captured request must be the fixed local
      // API route and contain only persisted session/call identifiers.
      late http.Request captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'mimeType': 'text/html;profile=mcp-app',
            'text': '<main>calendar</main>',
          }),
          200,
          headers: {'content-type': 'application/json'},
        );
      });
      final dataSource = AgentsDataSource(client: client);

      final result = await (dataSource as dynamic).fetchMcpAppResource(
        sessionId: 'session-local',
        toolCallId: 'call-origin',
      );

      expect(captured.method, 'GET');
      expect(captured.url.scheme, 'http');
      expect(captured.url.host, 'localhost');
      expect(captured.url.port, 4001);
      expect(
        captured.url.path,
        '/agent-sessions/session-local/mcp-app-resource/call-origin',
      );
      expect(captured.url.queryParameters, isEmpty);
      expect(jsonEncode(result), contains('text/html;profile=mcp-app'));
      expect(jsonEncode(result), contains('<main>calendar</main>'));

      await dataSource.dispose();
    },
  );
}
