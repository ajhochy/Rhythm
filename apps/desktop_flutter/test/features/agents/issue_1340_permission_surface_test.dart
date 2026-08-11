import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/features/agents/data/agents_data_source.dart';
import 'package:rhythm_desktop/features/agents/models/agent_ws_message.dart';

void main() {
  group('#1340 permission server contract', () {
    test(
        'issue-1340-c1: exact permission.asked contract renders an actionable prompt',
        () {
      // Regression caught: the desktop only understood the legacy
      // permissionId/toolName/args/summary shape, so the current server event
      // produced an empty, unanswerable card.
      final message = AgentWsMessage.parse({
        'type': 'permission.asked',
        'sessionId': 'session-1',
        'permissionID': 'permission-1',
        'directory': '/tmp/project',
        'tool': 'bash',
        'patterns': ['git push origin feature/chat-ui'],
        'title': 'Push the feature branch',
        'createdAt': '2026-08-10T19:30:00.000Z',
      });

      expect(message, isA<PermissionAskedMessage>());
      final permission = message as PermissionAskedMessage;
      expect(permission.permissionId, 'permission-1');
      expect(permission.toolName, 'bash');
      expect(permission.summary, 'Push the feature branch');
      expect(permission.args['patterns'], ['git push origin feature/chat-ui']);
      expect(permission.args['directory'], '/tmp/project');
    });

    test(
        'issue-1340-c5: exact permission.replied contract resolves the matching ask',
        () {
      // Regression caught: permission.replied was parsed as UnknownWsMessage,
      // leaving a stale approval card after another client answered it.
      final message = AgentWsMessage.parse({
        'type': 'permission.replied',
        'sessionId': 'session-1',
        'permissionID': 'permission-1',
        'directory': '/tmp/project',
        'tool': 'bash',
        'patterns': ['git push origin feature/chat-ui'],
        'title': 'Push the feature branch',
        'createdAt': '2026-08-10T19:30:00.000Z',
      });

      expect(message, isA<PermissionResolvedMessage>());
      expect(
          (message as PermissionResolvedMessage).permissionId, 'permission-1');
    });

    test(
        'issue-1340-c3: permission replies use the exact REST fallback contract',
        () async {
      // Regression caught: the client posted the decision in path segments
      // using accept/deny, which the new server contract does not expose.
      final requests = <http.Request>[];
      final dataSource = AgentsDataSource(
        client: MockClient((request) async {
          requests.add(request);
          return http.Response('', 204);
        }),
      );

      for (final response in ['once', 'always', 'reject']) {
        await dataSource.respondPermission(
          'session-1',
          'permission-1',
          response,
        );
      }

      expect(requests, hasLength(3));
      for (var i = 0; i < requests.length; i++) {
        final request = requests[i];
        expect(
          request.url.path,
          '/agent-sessions/session-1/permissions/permission-1/reply',
        );
        // Body key MUST be `reply` — the replyPermission handler validates
        // `body.reply`. A `response` key 400s every approve/deny (#1367 f/u).
        expect(jsonDecode(request.body), {
          'reply': ['once', 'always', 'reject'][i]
        });
      }
    });
  });
}
