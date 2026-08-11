import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/features/agents/data/agents_data_source.dart';

void main() {
  test(
    'issue-1365-c1: desktop create and selection PATCH send profileId',
    () async {
      // Regression: sending an engine agent as legacy agentId updates only
      // agent_kind, leaving the authoritative profile_id null for mobile.
      final requests = <http.Request>[];
      final client = MockClient((request) async {
        requests.add(request);
        return http.Response(
          jsonEncode({
            'id': 'session-1365',
            'agentId': 'build',
            'profileId': 'profile-coding',
            'status': 'idle',
            'cwd': '/tmp',
            'name': 'Bound chat',
            'createdAt': '2026-08-10T00:00:00Z',
            'updatedAt': '2026-08-10T00:00:00Z',
          }),
          request.method == 'POST' ? 201 : 200,
        );
      });
      final dataSource = AgentsDataSource(client: client);

      await dataSource.createSession(
        profileId: 'profile-coding',
        cwd: '/tmp',
        name: 'Bound chat',
      );
      await dataSource.updateSession(
        'session-1365',
        profileId: 'profile-research',
      );

      expect(jsonDecode(requests[0].body), {
        'profileId': 'profile-coding',
        'cwd': '/tmp',
        'name': 'Bound chat',
      });
      expect(jsonDecode(requests[1].body), {'profileId': 'profile-research'});
      expect(requests[0].body, isNot(contains('agentId')));
      expect(requests[1].body, isNot(contains('agentId')));
    },
  );

  test(
    'issue-1365-c2: unrelated desktop PATCH does not overwrite profileId',
    () async {
      // Regression: making profileId a default PATCH field would overwrite an
      // explicit stored binding during rename/model/permission updates.
      late http.Request captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({
            'id': 'session-1365',
            'agentId': 'build',
            'profileId': 'profile-existing',
            'status': 'idle',
            'cwd': '/tmp',
            'name': 'Renamed',
            'createdAt': '2026-08-10T00:00:00Z',
            'updatedAt': '2026-08-10T00:00:00Z',
          }),
          200,
        );
      });

      await AgentsDataSource(client: client).updateSession(
        'session-1365',
        name: 'Renamed',
      );

      expect(jsonDecode(captured.body), {'name': 'Renamed'});
    },
  );
}
