import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/app/core/auth/auth_session_store.dart';
import 'package:rhythm_desktop/features/agents/data/agent_model_visibility_data_source.dart';
import 'package:rhythm_desktop/features/agents/data/agent_models_data_source.dart';
import 'package:rhythm_desktop/features/agents/data/agents_data_source.dart';
import 'package:rhythm_desktop/features/agents/data/usage_budget_data_source.dart';

void main() {
  setUp(() => AuthSessionStore.setSessionToken('stale-cloud-token'));
  tearDown(() => AuthSessionStore.setSessionToken(null));

  test(
    'issue-1358-c1: agent-local data sources never send the cloud bearer',
    () async {
      // Regression: a stale cloud token on loopback produces a 401. Every
      // agent-local request must therefore omit Authorization at the transport.
      final captured = <http.Request>[];
      final client = MockClient((request) async {
        captured.add(request);
        final body = request.url.path.endsWith('/usage-budget')
            ? {'providers': <Object>[]}
            : <Object>[];
        if (request.url.path == '/agent-sessions') {
          return http.Response(jsonEncode({'sessions': <Object>[]}), 200);
        }
        return http.Response(jsonEncode(body), 200);
      });

      await AgentsDataSource(client: client).listSessions();
      await AgentModelsDataSource(client: client).fetchCatalog();
      await UsageBudgetDataSource(client: client).fetch();
      await AgentModelVisibilityDataSource(client: client).fetchVisibility();

      expect(captured, hasLength(4));
      for (final request in captured) {
        expect(
          request.headers.containsKey('authorization'),
          isFalse,
          reason: '${request.url} leaked the cloud bearer to loopback',
        );
      }
    },
  );

  test('issue-1358-c2: cloud request headers retain bearer authentication', () {
    // Regression: separating loopback auth must not silently sign users out of
    // hosted/cloud requests that continue to use headers().
    expect(
      AuthSessionStore.headers()['Authorization'],
      'Bearer stale-cloud-token',
    );
    expect(AuthSessionStore.localHeaders(json: true), {
      'Content-Type': 'application/json',
    });
  });

  test('issue-1466-c3: nested API children feed Flutter session grouping',
      () async {
    // Regression caught: the API switches to nested children but Flutter only
    // decodes the root array, making every delegated child disappear.
    final client = MockClient((_) async => http.Response(
          jsonEncode({
            'sessions': [
              {
                'id': 'root-session',
                'name': 'Root session',
                'children': [
                  {
                    'id': 'child-session',
                    'name': 'Child session',
                    'parentSessionId': 'root-session',
                  },
                ],
              },
            ],
          }),
          200,
        ));

    final sessions = await AgentsDataSource(client: client).listSessions();
    expect(sessions.map((session) => session.id), [
      'root-session',
      'child-session',
    ]);
    expect(sessions.last.parentId, 'root-session');
  });
}
