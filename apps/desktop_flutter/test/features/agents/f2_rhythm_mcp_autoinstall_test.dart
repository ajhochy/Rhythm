import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/app/core/agents/rhythm_mcp_auto_installer.dart';

void main() {
  group('RhythmMcpAutoInstaller.ensure', () {
    test('POSTs apiToken + apiUrl to the local agent ensure endpoint', () async {
      late Map<String, dynamic> body;
      late Uri calledUri;
      final client = MockClient((req) async {
        calledUri = req.url;
        body = jsonDecode(req.body) as Map<String, dynamic>;
        return http.Response('{"changed":true,"registered":true}', 200);
      });

      final installer = RhythmMcpAutoInstaller(httpClient: client);
      final ok = await installer.ensure(
        apiToken: 'tok-1',
        apiUrl: 'https://api.vcrcapps.com',
      );

      expect(ok, true);
      expect(calledUri.path, '/opencode/mcp/rhythm/ensure');
      expect(calledUri.host, 'localhost');
      expect(calledUri.port, 4001);
      expect(body['apiToken'], 'tok-1');
      expect(body['apiUrl'], 'https://api.vcrcapps.com');
    });

    test('returns false (non-fatal) on a server error', () async {
      final client = MockClient((_) async => http.Response('boom', 500));
      final installer = RhythmMcpAutoInstaller(httpClient: client);
      expect(
        await installer.ensure(apiToken: 't', apiUrl: 'u'),
        false,
      );
    });

    test('returns false (non-fatal) when the client throws', () async {
      final client = MockClient((_) async => throw Exception('network down'));
      final installer = RhythmMcpAutoInstaller(httpClient: client);
      expect(
        await installer.ensure(apiToken: 't', apiUrl: 'u'),
        false,
      );
    });
  });
}
