import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:rhythm_desktop/app/core/agents/agent_server_controller.dart';
import 'package:rhythm_desktop/app/core/agents/curated_mcp_auto_installer.dart';
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
class _FakeCuratedAutoInstaller extends CuratedMcpAutoInstaller {
  _FakeCuratedAutoInstaller({required this.result});

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

  group('CuratedMcpAutoInstaller.ensure', () {
    // c1: POSTs to the curated ensure endpoint with the right body + returns
    // true on 2xx.
    test(
      'POSTs apiToken + apiUrl to the local agent curated ensure endpoint',
      () async {
        late Map<String, dynamic> body;
        late Uri calledUri;
        late Map<String, String> headers;
        final client = MockClient((req) async {
          calledUri = req.url;
          headers = req.headers;
          body = jsonDecode(req.body) as Map<String, dynamic>;
          return http.Response('{"changed":true,"registered":true}', 200);
        });

        final installer = CuratedMcpAutoInstaller(httpClient: client);
        final ok = await installer.ensure(
          apiToken: 'tok-1',
          apiUrl: 'https://api.vcrcapps.com',
        );

        expect(ok, true);
        expect(calledUri.path, '/opencode/mcp/curated/ensure');
        expect(calledUri.host, 'localhost');
        expect(calledUri.port, 4001);
        expect(headers['Content-Type'], contains('application/json'));
        expect(body['apiToken'], 'tok-1');
        expect(body['apiUrl'], 'https://api.vcrcapps.com');
      },
    );

    // c2: returns false (non-fatal) on a 4xx/5xx server error.
    test('returns false (non-fatal) on a server error', () async {
      final client = MockClient((_) async => http.Response('boom', 500));
      final installer = CuratedMcpAutoInstaller(httpClient: client);
      expect(await installer.ensure(apiToken: 't', apiUrl: 'u'), false);
    });

    test('returns false (non-fatal) on a client error', () async {
      final client = MockClient((_) async => http.Response('nope', 400));
      final installer = CuratedMcpAutoInstaller(httpClient: client);
      expect(await installer.ensure(apiToken: 't', apiUrl: 'u'), false);
    });

    // c2: returns false (never throws) when the client throws.
    test('returns false (non-fatal) when the client throws', () async {
      final client = MockClient((_) async => throw Exception('network down'));
      final installer = CuratedMcpAutoInstaller(httpClient: client);
      expect(await installer.ensure(apiToken: 't', apiUrl: 'u'), false);
    });
  });

  // c3: pure gate is true only when all three flags hold; false otherwise.
  group('shouldAutoInstallCuratedMcp pure gate', () {
    test('returns true only when all three conditions hold', () {
      expect(
        shouldAutoInstallCuratedMcp(
          engineReady: true,
          authenticated: true,
          isCloudServer: true,
        ),
        isTrue,
      );
    });

    test('returns false when the engine is not ready', () {
      expect(
        shouldAutoInstallCuratedMcp(
          engineReady: false,
          authenticated: true,
          isCloudServer: true,
        ),
        isFalse,
      );
    });

    test('returns false when not authenticated', () {
      expect(
        shouldAutoInstallCuratedMcp(
          engineReady: true,
          authenticated: false,
          isCloudServer: true,
        ),
        isFalse,
      );
    });

    test('returns false when the server is not the cloud API', () {
      expect(
        shouldAutoInstallCuratedMcp(
          engineReady: true,
          authenticated: true,
          isCloudServer: false,
        ),
        isFalse,
      );
    });

    test('returns false when all three are false', () {
      expect(
        shouldAutoInstallCuratedMcp(
          engineReady: false,
          authenticated: false,
          isCloudServer: false,
        ),
        isFalse,
      );
    });
  });

  group('AgentServerController curated auto-install de-dupe', () {
    setUp(() => AuthSessionStore.setSessionToken(null));
    tearDown(() => AuthSessionStore.setSessionToken(null));

    // Drives initialize() to ready while the gate is CLOSED (no token), so the
    // initialize-time auto-install attempt is a no-op and the test fully
    // controls subsequent onAuthChanged() fires.
    Future<AgentServerController> readyController(
      _FakeCuratedAutoInstaller installer,
    ) async {
      AuthSessionStore.setSessionToken(null);
      final controller = AgentServerController(
        _FakeApiServerService(),
        curatedAutoInstaller: installer,
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

    // c4: invokes ensure() once per distinct token — same token twice → one
    // POST.
    test(
      'successful ensure() records token → second call is de-duped',
      () async {
        final installer = _FakeCuratedAutoInstaller(result: true);
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
        expect(installer.tokensSeen, ['tok-1']);
      },
    );

    test('failed ensure() does NOT record token → next call retries', () async {
      final installer = _FakeCuratedAutoInstaller(result: false);
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
  });
}
