/// Unit test for AgentsDataSource.createSession mcpRole parameter.
///
/// Asserts that when mcpRole is provided, it is included in the
/// POST /agent-sessions request body.
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:rhythm_desktop/features/agents/data/agents_data_source.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  group('AgentsDataSource.createSession mcpRole', () {
    test('includes mcpRole in request body when provided', () async {
      Map<String, dynamic>? capturedBody;

      final client = MockClient((request) async {
        capturedBody = jsonDecode(request.body) as Map<String, dynamic>;
        // Return a minimal valid AgentSession JSON.
        return http.Response(
          jsonEncode({
            'id': 'test-id',
            'agentId': '',
            'name': '',
            'cwd': '/tmp',
            'status': 'idle',
            'createdAt': DateTime.now().toIso8601String(),
            'updatedAt': DateTime.now().toIso8601String(),
          }),
          201,
          headers: {'content-type': 'application/json'},
        );
      });

      final dataSource = AgentsDataSource(client: client);

      await dataSource.createSession(cwd: '/tmp', mcpRole: 'email-assistant');

      expect(
        capturedBody,
        isNotNull,
        reason: 'Request body should have been captured',
      );
      expect(
        capturedBody!['mcpRole'],
        equals('email-assistant'),
        reason: 'mcpRole should be included in the POST body',
      );
    });

    test('omits mcpRole from request body when not provided', () async {
      Map<String, dynamic>? capturedBody;

      final client = MockClient((request) async {
        capturedBody = jsonDecode(request.body) as Map<String, dynamic>;
        return http.Response(
          jsonEncode({
            'id': 'test-id',
            'agentId': '',
            'name': '',
            'cwd': '/tmp',
            'status': 'idle',
            'createdAt': DateTime.now().toIso8601String(),
            'updatedAt': DateTime.now().toIso8601String(),
          }),
          201,
          headers: {'content-type': 'application/json'},
        );
      });

      final dataSource = AgentsDataSource(client: client);

      await dataSource.createSession(cwd: '/tmp');

      expect(
        capturedBody,
        isNotNull,
        reason: 'Request body should have been captured',
      );
      expect(
        capturedBody!.containsKey('mcpRole'),
        isFalse,
        reason: 'mcpRole should NOT be in the POST body when not provided',
      );
    });
  });
}
