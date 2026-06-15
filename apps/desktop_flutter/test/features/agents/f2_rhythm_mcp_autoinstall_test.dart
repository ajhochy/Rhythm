import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/agents/rhythm_mcp_auto_installer.dart';
import 'package:rhythm_desktop/app/core/auth/auth_session_store.dart';
import 'package:rhythm_desktop/app/core/server/api_server_service.dart';
import 'package:rhythm_desktop/app/core/services/server_config_service.dart';

/// Fake server service that lets [AgentServerController.initialize] reach the
/// ready state without spawning a real Node process. Mirrors the
/// `_FakeApiServerService` pattern used in the other agent tests.
class _FakeApiServerService extends ApiServerService {
  @override
  Future<AgentServerStartResult> start() async =>
      (ok: true, reason: null, stderrTail: null, failureMessage: null);

  @override
  Future<bool> checkHealth(String baseUrl) async => true;

  @override
  void stop() {}

  @override
  Future<void> stopGracefully() async {}
}

/// Records [ensure] calls and returns a scripted result, so the controller's
/// retry-on-failure de-dupe can be asserted directly.
class _FakeAutoInstaller extends RhythmMcpAutoInstaller {
  _FakeAutoInstaller({required this.result});

  bool result;
  int ensureCount = 0;
  final List<String> tokensSeen = <String>[];

  @override
  Future<bool> ensure({
    required String apiToken,
    required String apiUrl,
  }) async {
    ensureCount++;
    tokensSeen.add(apiToken);
    return result;
  }
}

void main() {
  // HealthPoller (started inside AgentServerController.initialize) uses a
  // WidgetsBinding-backed timer, so the binding must be initialized.
  TestWidgetsFlutterBinding.ensureInitialized();

  group('RhythmMcpAutoInstaller.ensure', () {
    test('POSTs apiToken + apiUrl to the local agent ensure endpoint',
        () async {
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

  group('shouldAutoInstallRhythmMcp pure gate', () {
    test('returns true only when all three conditions hold', () {
      expect(
        shouldAutoInstallRhythmMcp(
          engineReady: true,
          authenticated: true,
          isCloudServer: true,
        ),
        isTrue,
      );
    });

    test('returns false when the engine is not ready', () {
      expect(
        shouldAutoInstallRhythmMcp(
          engineReady: false,
          authenticated: true,
          isCloudServer: true,
        ),
        isFalse,
      );
    });

    test('returns false when not authenticated', () {
      expect(
        shouldAutoInstallRhythmMcp(
          engineReady: true,
          authenticated: false,
          isCloudServer: true,
        ),
        isFalse,
      );
    });

    test('returns false when the server is not the cloud API', () {
      expect(
        shouldAutoInstallRhythmMcp(
          engineReady: true,
          authenticated: true,
          isCloudServer: false,
        ),
        isFalse,
      );
    });

    test('returns false when all three are false', () {
      expect(
        shouldAutoInstallRhythmMcp(
          engineReady: false,
          authenticated: false,
          isCloudServer: false,
        ),
        isFalse,
      );
    });
  });

  group('AgentServerController auto-install retry de-dupe', () {
    setUp(() => AuthSessionStore.setSessionToken(null));
    tearDown(() => AuthSessionStore.setSessionToken(null));

    // Drives initialize() to ready while the gate is CLOSED (no token), so the
    // initialize-time auto-install attempt is a no-op and the test fully
    // controls subsequent onAuthChanged() fires.
    Future<AgentServerController> readyController(
      _FakeAutoInstaller installer,
    ) async {
      AuthSessionStore.setSessionToken(null);
      final controller = AgentServerController(
        _FakeApiServerService(),
        autoInstaller: installer,
        serverConfigService: ServerConfigService(), // defaults to cloud URL
      );
      await controller.initialize();
      // initialize() fires refreshCapabilities().whenComplete(auto-install);
      // let those microtasks/awaits settle before we assert.
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(controller.isReady, isTrue);
      // Gate was closed (no token), so nothing installed yet.
      expect(installer.ensureCount, 0);
      return controller;
    }

    test('failed ensure() does NOT record token → next call retries', () async {
      final installer = _FakeAutoInstaller(result: false);
      final controller = await readyController(installer);
      addTearDown(controller.dispose);

      AuthSessionStore.setSessionToken('tok-1');

      controller.onAuthChanged();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(installer.ensureCount, 1);

      // ensure returned false → token not recorded → second call retries.
      controller.onAuthChanged();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(installer.ensureCount, 2);
      expect(installer.tokensSeen, ['tok-1', 'tok-1']);
    });

    test('successful ensure() records token → second call is de-duped',
        () async {
      final installer = _FakeAutoInstaller(result: true);
      final controller = await readyController(installer);
      addTearDown(controller.dispose);

      AuthSessionStore.setSessionToken('tok-1');

      controller.onAuthChanged();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(installer.ensureCount, 1);

      // ensure returned true → token recorded → second call de-duped.
      controller.onAuthChanged();
      await Future<void>.delayed(const Duration(milliseconds: 20));
      expect(installer.ensureCount, 1);
    });
  });
}
