/// Unit tests for PTY REST methods + ws-url helper on [AgentsDataSource].
///
/// Mirrors the pattern from opc_terminal_button_http_test.dart:
/// inject a MockClient at the network boundary; assert the outgoing request
/// shape and the parsed return value. AuthSessionStore state is cleared in
/// setUp/tearDown so tests are independent of each other.
///
/// Run with:
///   flutter test test/features/agents/inspector_terminal_datasource_test.dart
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:rhythm_desktop/app/core/auth/auth_session_store.dart';
import 'package:rhythm_desktop/app/core/constants/app_constants.dart';
import 'package:rhythm_desktop/features/agents/data/agents_data_source.dart';

void main() {
  setUp(() {
    // Ensure a clean auth state for every test.
    AuthSessionStore.setSessionToken(null);
  });

  tearDown(() {
    AuthSessionStore.setSessionToken(null);
  });

  // --------------------------------------------------------------------------
  // createPty
  // --------------------------------------------------------------------------

  test(
    'createPty POSTs to /agent-sessions/:id/pty and returns ptyId',
    () async {
      late http.Request captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response(
          jsonEncode({'ptyId': 'pty_1'}),
          200,
          headers: {'content-type': 'application/json'},
        );
      });

      final ds = AgentsDataSource(client: client);
      final ptyId = await ds.createPty('s1');

      expect(captured.method, 'POST');
      expect(
        captured.url.toString(),
        '${AppConstants.agentLocalBaseUrl}/agent-sessions/s1/pty',
      );
      expect(ptyId, 'pty_1');
    },
  );

  // --------------------------------------------------------------------------
  // resizePty
  // --------------------------------------------------------------------------

  test(
    'resizePty PATCHes /pty/:id with JSON body {cols, rows}',
    () async {
      late http.Request captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response('', 204);
      });

      final ds = AgentsDataSource(client: client);
      await ds.resizePty('pty_1', 80, 24);

      expect(captured.method, 'PATCH');
      expect(
        captured.url.toString(),
        '${AppConstants.agentLocalBaseUrl}/pty/pty_1',
      );
      final body = jsonDecode(captured.body) as Map<String, dynamic>;
      expect(body['cols'], 80);
      expect(body['rows'], 24);
    },
  );

  // --------------------------------------------------------------------------
  // killPty
  // --------------------------------------------------------------------------

  test(
    'killPty DELETEs /pty/:id',
    () async {
      late http.Request captured;
      final client = MockClient((request) async {
        captured = request;
        return http.Response('', 204);
      });

      final ds = AgentsDataSource(client: client);
      await ds.killPty('pty_1');

      expect(captured.method, 'DELETE');
      expect(
        captured.url.toString(),
        '${AppConstants.agentLocalBaseUrl}/pty/pty_1',
      );
    },
  );

  // --------------------------------------------------------------------------
  // ptyWsUrl
  // --------------------------------------------------------------------------

  test(
    'ptyWsUrl returns ws://localhost:4001/ws/pty/:id',
    () {
      // No HTTP call for this one — it is a pure URL builder.
      final ds = AgentsDataSource();
      expect(
        ds.ptyWsUrl('pty_1'),
        '${AppConstants.agentLocalWsBase}/ws/pty/pty_1',
      );
    },
  );
}
