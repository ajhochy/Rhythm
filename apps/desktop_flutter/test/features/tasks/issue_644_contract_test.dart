import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/features/tasks/data/collaborators_data_source.dart';

// ---------------------------------------------------------------------------
// Issue #644 — task collaborator assignment does not persist.
//
// Root cause: CollaboratorsDataSource defaulted its baseUrl to the static
// AppConstants.apiBaseUrl, and every construction site built it with no
// baseUrl. The task list, by contrast, is fetched from the user-configurable
// serverConfigService.url. When Settings points anywhere other than the
// static constant, collaborator writes hit a DIFFERENT server than the one
// holding the task — the write 404s/403s, is silently swallowed, and the
// collaborator (and its claude-trigger) never appear.
//
// Contract: CollaboratorsDataSource must route every collaborator request to
// the baseUrl it is given (which callers now derive from serverConfigService),
// never to a hardcoded fallback. baseUrl is required so no site can default it.
// ---------------------------------------------------------------------------

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const collaboratorJson = [
    {'userId': 7, 'name': 'Visalia CRC', 'photoUrl': null},
  ];

  late List<http.BaseRequest> captured;

  MockClient buildClient() {
    captured = [];
    return MockClient((request) async {
      captured.add(request);
      if (request.method == 'DELETE') {
        return http.Response('', 204);
      }
      return http.Response(jsonEncode(collaboratorJson), 200);
    });
  }

  group('issue-644-c1: collaborator requests target the configured server URL',
      () {
    test('addToTask posts to <configured base>/tasks/:id/collaborators',
        () async {
      final ds = CollaboratorsDataSource(
        baseUrl: 'https://configured.example',
        client: buildClient(),
      );

      final result = await ds.addToTask('task-1', 7);

      expect(captured, hasLength(1));
      expect(captured.single.method, 'POST');
      expect(
        captured.single.url.toString(),
        'https://configured.example/tasks/task-1/collaborators',
      );
      expect(result.single.userId, 7);
    });

    test('removeFromTask deletes against the configured base', () async {
      final ds = CollaboratorsDataSource(
        baseUrl: 'https://configured.example',
        client: buildClient(),
      );

      await ds.removeFromTask('task-1', 7);

      expect(captured.single.method, 'DELETE');
      expect(
        captured.single.url.toString(),
        'https://configured.example/tasks/task-1/collaborators/7',
      );
    });

    test('fetchForTask gets from the configured base', () async {
      final ds = CollaboratorsDataSource(
        baseUrl: 'https://configured.example',
        client: buildClient(),
      );

      await ds.fetchForTask('task-1');

      expect(captured.single.method, 'GET');
      expect(
        captured.single.url.toString(),
        'https://configured.example/tasks/task-1/collaborators',
      );
    });

    test('a different configured base routes there (no hardcoded host)',
        () async {
      final ds = CollaboratorsDataSource(
        baseUrl: 'https://other-server.example',
        client: buildClient(),
      );

      await ds.addToTask('task-9', 7);

      expect(
        captured.single.url.toString(),
        'https://other-server.example/tasks/task-9/collaborators',
      );
    });
  });
}
