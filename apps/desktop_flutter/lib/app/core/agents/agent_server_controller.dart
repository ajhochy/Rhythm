import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../auth/auth_session_store.dart';
import '../constants/app_constants.dart';
import '../server/api_server_service.dart';
import '../services/server_config_service.dart';
import 'curated_mcp_auto_installer.dart';
import 'health_poller.dart';
import 'rhythm_mcp_auto_installer.dart';

enum AgentServerStatus { starting, ready, failed }

class AgentServerController extends ChangeNotifier {
  AgentServerController(
    this._service, {
    RhythmMcpAutoInstaller? autoInstaller,
    CuratedMcpAutoInstaller? curatedAutoInstaller,
    ServerConfigService? serverConfigService,
  })  : _autoInstaller = autoInstaller ?? RhythmMcpAutoInstaller(),
        _curatedAutoInstaller =
            curatedAutoInstaller ?? CuratedMcpAutoInstaller(),
        _serverConfigService = serverConfigService;

  final ApiServerService _service;

  /// F2: installs/refreshes the rhythm MCP server inside the opencode engine
  /// once the engine is ready, a user is authed, and the cloud server is in
  /// use. Failures are non-fatal inside the installer.
  final RhythmMcpAutoInstaller _autoInstaller;

  /// MCP-5: installs/refreshes the curated MCP servers inside the opencode
  /// engine under the same gate as the rhythm installer. Failures are
  /// non-fatal inside the installer.
  final CuratedMcpAutoInstaller _curatedAutoInstaller;

  /// Optional live source of the configured server URL. When absent we fall
  /// back to [AppConstants.apiBaseUrl] (the cloud baseline).
  final ServerConfigService? _serverConfigService;

  /// De-dupes auto-install attempts: we only call the installer when the
  /// session token differs from the last token we installed for.
  String? _lastInstalledToken;

  /// MCP-5: separate de-dupe for the curated installer so a failure of one
  /// installer never blocks a retry of the other for the same token.
  String? _lastCuratedInstalledToken;
  AgentServerStatus _status = AgentServerStatus.starting;
  AgentServerFailureReason? _failureReason;
  String? _stderrTail;

  /// Rich failure message surfaced by the service (e.g. ABI rebuild command).
  String? _richFailureMessage;
  Map<String, bool> _capabilities = const {};

  /// OPC-M1-3: provider-id → agent-kind mapping fetched from
  /// GET /agents/capabilities as the `providerToAgentKind` field.
  /// Offline fallback: the hardcoded constants below.
  Map<String, String> _providerToAgentKind = const {
    'anthropic': 'claude-code',
    'github-copilot': 'claude-code',
    'openai': 'codex',
    'google': 'gemini-cli',
  };

  HealthPoller? _poller;

  AgentServerStatus get status => _status;
  bool get isReady => _status == AgentServerStatus.ready;
  AgentServerFailureReason? get failureReason => _failureReason;
  String? get stderrTail => _stderrTail;

  String? get errorMessage {
    // If a rich failure message was surfaced (e.g. ABI rebuild command), use it.
    if (_richFailureMessage != null) return _richFailureMessage;
    switch (_failureReason) {
      case AgentServerFailureReason.nodeNotFound:
        return "Couldn't find Node.js on this Mac. Install Node 20 or newer "
            'from nodejs.org and click Retry.';
      case AgentServerFailureReason.bundleNotFound:
        return 'The CLI server bundle is missing from this Rhythm install. '
            'Please reinstall Rhythm from the latest release.';
      case AgentServerFailureReason.spawnThrew:
        return "Couldn't start the CLI server process. See technical details "
            'below.';
      case AgentServerFailureReason.healthCheckTimeout:
        return "The CLI server started but didn't respond in time. See "
            'technical details below.';
      case AgentServerFailureReason.lostConnection:
        return 'The agent server stopped responding. Click Restart to bring it back.';
      case AgentServerFailureReason.approvalCredentialsUnavailable:
        return 'Rhythm could not unlock its human-approval identity in Keychain. '
            'Unlock your Mac and click Restart.';
      case null:
        return null;
    }
  }

  Map<String, bool> get capabilities => _capabilities;

  /// OPC-M1-3: provider-id → agent-kind map. Fetched from capabilities
  /// endpoint; falls back to the compile-time defaults when offline.
  Map<String, String> get providerToAgentKind => _providerToAgentKind;

  bool isAgentAvailable(String kind) => _capabilities[kind] == true;
  bool get hasAnyAgent => _capabilities.values.any((v) => v);

  Future<void> initialize() async {
    _status = AgentServerStatus.starting;
    _failureReason = null;
    _stderrTail = null;
    _richFailureMessage = null;
    _capabilities = const {};
    _providerToAgentKind = const {
      'anthropic': 'claude-code',
      'github-copilot': 'claude-code',
      'openai': 'codex',
      'google': 'gemini-cli',
    };
    notifyListeners();

    final result = await _service.start();
    _status = result.ok ? AgentServerStatus.ready : AgentServerStatus.failed;
    _failureReason = result.reason;
    _stderrTail = result.stderrTail;
    _richFailureMessage = result.failureMessage;
    notifyListeners();

    if (result.ok) {
      // Fire-and-forget; failures are non-fatal. After capabilities are
      // detected, attempt the rhythm MCP auto-install (F2) — also fire-and-
      // forget, gated and de-duped inside _maybeAutoInstallRhythmMcp.
      unawaited(
        refreshCapabilities().whenComplete(() {
          unawaited(_maybeAutoInstallRhythmMcp());
          unawaited(_maybeAutoInstallCuratedMcp());
        }),
      );

      _poller = HealthPoller(
        checkFn: () => _service.checkHealth(AppConstants.agentLocalBaseUrl),
        onHealthChanged: _onHealthChanged,
        interval: const Duration(seconds: 15),
      );
      _poller!.start();
    }
  }

  void _onHealthChanged(bool healthy) {
    if (!healthy && _status == AgentServerStatus.ready) {
      _status = AgentServerStatus.failed;
      _failureReason = AgentServerFailureReason.lostConnection;
      notifyListeners();
    } else if (healthy &&
        _status == AgentServerStatus.failed &&
        _failureReason == AgentServerFailureReason.lostConnection) {
      _status = AgentServerStatus.ready;
      _failureReason = null;
      notifyListeners();
    }
  }

  Future<void> refreshCapabilities() async {
    try {
      final response = await http.get(
        Uri.parse('http://localhost:4001/agents/capabilities'),
      );
      if (response.statusCode != 200) {
        stderr.writeln(
          '[AgentServerController] capabilities fetch returned '
          'HTTP ${response.statusCode}; leaving capabilities empty.',
        );
        return;
      }
      final decoded = jsonDecode(response.body);
      if (decoded is! Map<String, dynamic>) {
        stderr.writeln(
          '[AgentServerController] capabilities response was not a JSON object; '
          'leaving capabilities empty.',
        );
        return;
      }
      // OPC-M1-3: The capabilities response now contains two kinds of values:
      //   - boolean flags  (e.g. { 'claude-code': true, 'codex': false })
      //   - providerToAgentKind: { 'anthropic': 'claude-code', ... }
      // Extract each separately; casting all values to bool would lose the map.
      final boolCaps = <String, bool>{};
      Map<String, String>? newProviderMap;
      for (final entry in decoded.entries) {
        if (entry.key == 'providerToAgentKind') {
          final raw = entry.value;
          if (raw is Map) {
            newProviderMap =
                raw.map((k, v) => MapEntry(k.toString(), v.toString()));
          }
        } else {
          boolCaps[entry.key] = entry.value == true;
        }
      }
      _capabilities = boolCaps;
      if (newProviderMap != null && newProviderMap.isNotEmpty) {
        _providerToAgentKind = newProviderMap;
      }
      notifyListeners();
    } catch (e) {
      stderr.writeln(
        '[AgentServerController] failed to fetch capabilities: $e',
      );
      // _capabilities stays empty; status is unchanged.
    }
  }

  /// F2: re-fire the rhythm MCP auto-install when the auth session changes
  /// (sign-in / token rotation). Safe to call eagerly — the gate and the
  /// per-token de-dupe make repeat calls cheap no-ops. Wire this wherever the
  /// app reacts to auth changes.
  void onAuthChanged() {
    unawaited(_maybeAutoInstallRhythmMcp());
    unawaited(_maybeAutoInstallCuratedMcp());
  }

  /// Attempts the rhythm MCP auto-install if and only if the engine is ready,
  /// a user is authenticated, and the configured server is the cloud API.
  /// De-dupes on the session token so the same token is never installed twice.
  /// Belt-and-suspenders: the whole body is guarded — never throws.
  Future<void> _maybeAutoInstallRhythmMcp() async {
    try {
      final token = AuthSessionStore.sessionToken;
      final url = _serverConfigService?.url ?? AppConstants.apiBaseUrl;
      final gateOpen = shouldAutoInstallRhythmMcp(
        engineReady: isReady,
        authenticated: token != null && token.isNotEmpty,
        isCloudServer: url.contains('api.vcrcapps.com'),
      );
      if (!gateOpen) return;
      // token is non-null here because the gate required authenticated == true.
      if (token == _lastInstalledToken) return;
      // Only mark this token as installed when the installer actually
      // succeeds. On a false/throw, leave _lastInstalledToken unchanged so a
      // later trigger (ready hook or onAuthChanged) retries the same token.
      final installed =
          await _autoInstaller.ensure(apiToken: token!, apiUrl: url);
      if (installed) {
        _lastInstalledToken = token;
      }
    } catch (err) {
      stderr.writeln(
        '[AgentServerController] rhythm MCP auto-install attempt failed: $err',
      );
    }
  }

  /// MCP-5: attempts the curated MCP auto-install under the same gate as the
  /// rhythm installer (engine ready, authenticated, cloud server). De-dupes on
  /// the session token via its own [_lastCuratedInstalledToken] so the same
  /// token is never installed twice. Belt-and-suspenders: never throws.
  Future<void> _maybeAutoInstallCuratedMcp() async {
    try {
      final token = AuthSessionStore.sessionToken;
      final url = _serverConfigService?.url ?? AppConstants.apiBaseUrl;
      final gateOpen = shouldAutoInstallCuratedMcp(
        engineReady: isReady,
        authenticated: token != null && token.isNotEmpty,
        isCloudServer: url.contains('api.vcrcapps.com'),
      );
      if (!gateOpen) return;
      // token is non-null here because the gate required authenticated == true.
      if (token == _lastCuratedInstalledToken) return;
      // Only mark this token as installed when the installer actually
      // succeeds. On a false/throw, leave the token unchanged so a later
      // trigger (ready hook or onAuthChanged) retries the same token.
      final installed =
          await _curatedAutoInstaller.ensure(apiToken: token!, apiUrl: url);
      if (installed) {
        _lastCuratedInstalledToken = token;
      }
    } catch (err) {
      stderr.writeln(
        '[AgentServerController] curated MCP auto-install attempt failed: $err',
      );
    }
  }

  /// Exposed for testing only — drives [_onHealthChanged] directly so tests
  /// can verify status transitions without running a real [HealthPoller] timer.
  @visibleForTesting
  void simulateHealthChange(bool healthy) => _onHealthChanged(healthy);

  Future<void> retry() {
    _poller?.dispose();
    _poller = null;
    return initialize();
  }

  /// Gracefully stop the server and clean up. Returns a Future that completes
  /// once the process has exited (or been force-killed after 2 s).
  Future<void> stopAndDispose() async {
    _poller?.dispose();
    _poller = null;
    await _service.stopGracefully();
  }

  @override
  void dispose() {
    _poller?.dispose();
    _poller = null;
    _service.stop();
    super.dispose();
  }
}
