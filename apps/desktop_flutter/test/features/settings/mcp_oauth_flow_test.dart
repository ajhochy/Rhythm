/// OA3 — Flutter MCP "Connect" drives the backend remote-OAuth flow.
///
/// The backend now performs the full MCP remote-OAuth dance itself (opencode's
/// SDK auth path is broken). New endpoints on the local agent server:
///
///   POST /opencode/mcp/:name/oauth/start  → { authorizationUrl: "https://…" }
///   GET  /opencode/mcp/:name/oauth/status → { status: "pending"|"connected"|
///                                              "failed:<msg>"|"unknown" }
///
/// Flutter must, for a REMOTE/OAuth server: start OAuth, open the URL, poll
/// status on a bounded schedule, and refresh the row to "connected" when done.
/// NON-OAuth servers keep the existing plain connect path.
///
/// Run with:
///   flutter test test/features/settings/mcp_oauth_flow_test.dart
library;

import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

import 'package:rhythm_desktop/features/settings/controllers/mcp_controller.dart';
import 'package:rhythm_desktop/features/settings/data/mcp_data_source.dart';

// ---------------------------------------------------------------------------
// Fake data source — extends the OPC-M4-3 fake with OAuth methods.
// ---------------------------------------------------------------------------

class _FakeMcpDataSource implements McpDataSource {
  _FakeMcpDataSource({
    this.listResult = const [],
    this.startOAuthUrl,
    this.statusScript = const ['connected'],
  });

  /// What [listServers] returns. Can be swapped between calls.
  List<McpServerEntry> listResult;

  /// What [startOAuth] returns.
  final String? startOAuthUrl;

  /// Ordered statuses returned by successive [oauthStatus] calls. The last
  /// element repeats once exhausted.
  final List<String> statusScript;

  int listCallCount = 0;

  int connectCallCount = 0;
  String? lastConnectName;

  int startOAuthCallCount = 0;
  String? lastStartOAuthName;

  int statusCallCount = 0;
  String? lastStatusName;

  @override
  Future<List<McpServerEntry>> listServers() async {
    listCallCount++;
    return listResult;
  }

  @override
  Future<void> addServer({
    required String name,
    String? command,
    String? url,
    Map<String, String>? environment,
  }) async {}

  @override
  Future<String?> connectServer(String name) async {
    connectCallCount++;
    lastConnectName = name;
    return null;
  }

  @override
  Future<String?> startOAuth(String name) async {
    startOAuthCallCount++;
    lastStartOAuthName = name;
    return startOAuthUrl;
  }

  @override
  Future<String> oauthStatus(String name) async {
    lastStatusName = name;
    final idx = statusCallCount;
    statusCallCount++;
    if (idx < statusScript.length) return statusScript[idx];
    return statusScript.last;
  }

  @override
  Future<void> disconnectServer(String name) async {}

  @override
  Future<void> removeServer(String name) async {}

  @override
  Future<void> setCredentials(
    String name,
    Map<String, String> environment,
  ) async {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  // ── Data source ─────────────────────────────────────────────────────────

  test(
    'oa3-ds1: startOAuth parses authorizationUrl from the start response',
    () async {
      final client = MockClient((req) async {
        expect(req.method, 'POST');
        expect(req.url.path, '/opencode/mcp/canva/oauth/start');
        return http.Response(
          jsonEncode({'authorizationUrl': 'https://provider/oauth?x'}),
          200,
        );
      });

      String? returned;
      await http.runWithClient(() async {
        returned = await McpDataSource().startOAuth('canva');
      }, () => client);

      expect(returned, 'https://provider/oauth?x');
    },
  );

  test(
    'oa3-ds2: startOAuth returns null when authorizationUrl absent',
    () async {
      final client = MockClient((req) async {
        return http.Response(jsonEncode({'ok': true}), 200);
      });

      String? returned = 'sentinel';
      await http.runWithClient(() async {
        returned = await McpDataSource().startOAuth('canva');
      }, () => client);

      expect(returned, isNull);
    },
  );

  test('oa3-ds3: oauthStatus parses the status field', () async {
    final client = MockClient((req) async {
      expect(req.method, 'GET');
      expect(req.url.path, '/opencode/mcp/notion/oauth/status');
      return http.Response(jsonEncode({'status': 'pending'}), 200);
    });

    String? returned;
    await http.runWithClient(() async {
      returned = await McpDataSource().oauthStatus('notion');
    }, () => client);

    expect(returned, 'pending');
  });

  test(
    'oa3-ds4: oauthStatus defaults to "unknown" when status absent',
    () async {
      final client = MockClient((req) async {
        return http.Response(jsonEncode({}), 200);
      });

      String? returned;
      await http.runWithClient(() async {
        returned = await McpDataSource().oauthStatus('notion');
      }, () => client);

      expect(returned, 'unknown');
    },
  );

  // ── Controller: OAuth server happy path ─────────────────────────────────

  test('oa3-c1: OAuth server — connect starts OAuth, opens URL, polls until '
      'connected, then refreshes; no error', () async {
    final ds = _FakeMcpDataSource(
      listResult: [
        const McpServerEntry(
          name: 'canva',
          status: 'needs_auth',
          url: 'https://mcp.canva.com',
        ),
      ],
      startOAuthUrl: 'https://provider/oauth?x',
      // pending twice, then connected
      statusScript: ['pending', 'pending', 'connected'],
    );
    final opened = <Uri>[];
    final ctrl = McpController(
      ds,
      urlLauncher: (uri) async {
        opened.add(uri);
        return true;
      },
      pollDelay: Duration.zero,
      maxPollAttempts: 10,
    );

    // The section loads the list on mount; mirror that precondition.
    await ctrl.refresh();
    final listBefore = ds.listCallCount;

    await ctrl.connectServer('canva');

    // OAuth path used: startOAuth fired, plain connect NOT used.
    expect(ds.startOAuthCallCount, 1);
    expect(ds.lastStartOAuthName, 'canva');
    expect(
      ds.connectCallCount,
      0,
      reason: 'OAuth server must NOT use the plain connect path',
    );

    // URL opened via injected launcher.
    expect(opened, hasLength(1));
    expect(opened.single.toString(), 'https://provider/oauth?x');

    // Polled until connected.
    expect(ds.statusCallCount, 3);

    // Final refresh occurred (listServers called again) and no error.
    expect(ds.listCallCount, greaterThan(listBefore));
    expect(ctrl.errorFor('canva'), isNull);
  });

  // ── Controller: OAuth server failure ─────────────────────────────────────

  test(
    'oa3-c2: OAuth server — status failed:<msg> surfaces the message inline',
    () async {
      final ds = _FakeMcpDataSource(
        listResult: [
          const McpServerEntry(
            name: 'canva',
            status: 'needs_auth',
            url: 'https://mcp.canva.com',
          ),
        ],
        startOAuthUrl: 'https://provider/oauth?x',
        statusScript: ['pending', 'failed:boom'],
      );
      final ctrl = McpController(
        ds,
        urlLauncher: (uri) async => true,
        pollDelay: Duration.zero,
        maxPollAttempts: 10,
      );

      await ctrl.refresh();
      await ctrl.connectServer('canva');

      final err = ctrl.errorFor('canva');
      expect(err, isNotNull, reason: 'failure must be surfaced, not silenced');
      expect(err, contains('boom'));
    },
  );

  // ── Controller: OAuth server timeout ─────────────────────────────────────

  test(
    'oa3-c3: OAuth server — polling budget exhausted leaves a gentle pending '
    'note and still refreshes',
    () async {
      final ds = _FakeMcpDataSource(
        listResult: [
          const McpServerEntry(
            name: 'canva',
            status: 'needs_auth',
            url: 'https://mcp.canva.com',
          ),
        ],
        startOAuthUrl: 'https://provider/oauth?x',
        statusScript: ['pending'], // never resolves
      );
      final ctrl = McpController(
        ds,
        urlLauncher: (uri) async => true,
        pollDelay: Duration.zero,
        maxPollAttempts: 3,
      );

      await ctrl.refresh();
      final listBefore = ds.listCallCount;

      await ctrl.connectServer('canva');

      expect(
        ds.statusCallCount,
        3,
        reason: 'polling must stop at the attempt budget',
      );
      final note = ctrl.errorFor('canva');
      expect(note, isNotNull);
      expect(note!.toLowerCase(), contains('pending'));
      expect(
        ds.listCallCount,
        greaterThan(listBefore),
        reason: 'a final refresh must occur even on timeout',
      );
    },
  );

  // ── Controller: non-OAuth server keeps plain path ────────────────────────

  test('oa3-c4: non-OAuth (local/key-based) server uses the existing plain '
      'connect path; startOAuth NOT called', () async {
    final ds = _FakeMcpDataSource(
      listResult: [
        const McpServerEntry(name: 'rhythm-mcp', status: 'connected'),
      ],
    );
    final opened = <Uri>[];
    final ctrl = McpController(
      ds,
      urlLauncher: (uri) async {
        opened.add(uri);
        return true;
      },
      pollDelay: Duration.zero,
    );

    await ctrl.connectServer('rhythm-mcp');

    expect(
      ds.connectCallCount,
      1,
      reason: 'non-OAuth server must use plain connect',
    );
    expect(
      ds.startOAuthCallCount,
      0,
      reason: 'non-OAuth server must NOT start OAuth',
    );
    expect(
      ds.statusCallCount,
      0,
      reason: 'non-OAuth server must NOT poll OAuth status',
    );
  });

  // ── Detection: remote URL + no required env ⇒ OAuth even without needs_auth ─

  test(
    'oa3-c5: a remote server with a url and no required env is treated as OAuth',
    () async {
      final ds = _FakeMcpDataSource(
        listResult: [
          const McpServerEntry(
            name: 'notion',
            status: 'disconnected',
            url: 'https://mcp.notion.com',
          ),
        ],
        startOAuthUrl: 'https://provider/oauth?n',
        statusScript: ['connected'],
      );
      final ctrl = McpController(
        ds,
        urlLauncher: (uri) async => true,
        pollDelay: Duration.zero,
        maxPollAttempts: 5,
      );

      await ctrl.refresh();
      await ctrl.connectServer('notion');

      expect(
        ds.startOAuthCallCount,
        1,
        reason: 'remote url + no required env ⇒ OAuth flow',
      );
      expect(ds.connectCallCount, 0);
    },
  );
}
