import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

import '../data/mcp_data_source.dart';

enum McpControllerStatus { idle, loading, ready, error }

/// Signature for opening an external URL (the OAuth consent page). Injectable
/// so tests can assert the launch without hitting the platform launcher.
typedef McpUrlLauncher = Future<bool> Function(Uri uri);

/// Default launcher — opens the URL in the user's external browser.
Future<bool> _defaultMcpUrlLauncher(Uri uri) =>
    launchUrl(uri, mode: LaunchMode.externalApplication);

/// ChangeNotifier controller for MCP server management (OPC-M4-3).
///
/// Follows the existing Rhythm feature-layer pattern:
///   data source → controller → view
///
/// The controller owns the list of MCP servers, per-server inline error state,
/// and async operations (refresh, add, connect, disconnect, remove).
class McpController extends ChangeNotifier {
  McpController(
    this._dataSource, {
    McpUrlLauncher? urlLauncher,
    Duration pollDelay = const Duration(seconds: 2),
    int maxPollAttempts = 75,
  })  : _urlLauncher = urlLauncher ?? _defaultMcpUrlLauncher,
        _pollDelay = pollDelay,
        _maxPollAttempts = maxPollAttempts;

  final McpDataSource _dataSource;

  /// Opens the OAuth consent URL returned by [connectServer]. Injectable for
  /// tests; defaults to launching the system browser.
  final McpUrlLauncher _urlLauncher;

  /// OA3: delay between OAuth status polls. Defaults to ~2s in production;
  /// tests inject [Duration.zero] so they don't actually wait.
  final Duration _pollDelay;

  /// OA3: maximum number of OAuth status polls before giving up. Default 75
  /// at ~2s ≈ 2.5 min. Injectable so tests can use a tiny budget.
  final int _maxPollAttempts;

  McpControllerStatus _status = McpControllerStatus.idle;
  List<McpServerEntry> _servers = const [];
  String? _errorMessage;

  /// Per-server inline error messages (keyed by server name).
  final Map<String, String> _serverErrors = {};

  McpControllerStatus get status => _status;
  List<McpServerEntry> get servers => _servers;
  String? get errorMessage => _errorMessage;

  /// Returns the per-server inline error for [name], or null if none.
  String? errorFor(String name) => _serverErrors[name];

  // ── Refresh ──────────────────────────────────────────────────────────────

  Future<void> refresh() async {
    if (_status == McpControllerStatus.loading) return;
    _status = McpControllerStatus.loading;
    _errorMessage = null;
    notifyListeners();
    try {
      _servers = await _dataSource.listServers();
      _status = McpControllerStatus.ready;
    } catch (e) {
      _status = McpControllerStatus.error;
      _errorMessage = e.toString();
    }
    notifyListeners();
  }

  // ── Add server ────────────────────────────────────────────────────────────

  Future<void> addServer({
    required String name,
    String? command,
    String? url,
    Map<String, String>? environment,
  }) async {
    try {
      await _dataSource.addServer(
        name: name,
        command: command,
        url: url,
        environment: environment,
      );
      // Refresh to pick up the newly added server.
      await refresh();
    } catch (e) {
      _serverErrors[name] = e.toString();
      notifyListeners();
      rethrow;
    }
  }

  // ── Connect ───────────────────────────────────────────────────────────────

  Future<void> connectServer(String name) async {
    _serverErrors.remove(name);
    notifyListeners();

    if (_isOAuthServer(name)) {
      await _connectViaOAuth(name);
      return;
    }

    // Non-OAuth (local / key-based) servers keep the existing plain path.
    try {
      final authorizationUrl = await _dataSource.connectServer(name);
      // A remote server may still hand back a consent URL — open it so the
      // user can authorize. Already-authed servers return null.
      if (authorizationUrl != null && authorizationUrl.isNotEmpty) {
        final uri = Uri.tryParse(authorizationUrl);
        if (uri != null) {
          await _urlLauncher(uri);
        }
      }
      // Refresh so the row's status updates after the user completes OAuth.
      await refresh();
    } catch (e) {
      _serverErrors[name] = e.toString();
      notifyListeners();
    }
  }

  /// OA3: true when the named server is a remote OAuth server. Detection lives
  /// on [McpServerEntry.isOAuth] (remote URL + no required env, or a
  /// `needs_auth` status). Unknown names default to non-OAuth.
  bool _isOAuthServer(String name) {
    for (final s in _servers) {
      if (s.name == name) return s.isOAuth;
    }
    return false;
  }

  /// OA3: backend-driven remote-OAuth flow — start, open the consent URL, then
  /// poll status on a bounded schedule until connected / failed / budget
  /// exhausted. The only engine `listServers` call is the final [refresh].
  Future<void> _connectViaOAuth(String name) async {
    try {
      final authorizationUrl = await _dataSource.startOAuth(name);
      if (authorizationUrl != null && authorizationUrl.isNotEmpty) {
        final uri = Uri.tryParse(authorizationUrl);
        if (uri != null) {
          await _urlLauncher(uri);
        }
      }

      for (var attempt = 0; attempt < _maxPollAttempts; attempt++) {
        await Future<void>.delayed(_pollDelay);
        final status = await _dataSource.oauthStatus(name);
        if (status == 'connected') {
          _serverErrors.remove(name);
          await refresh();
          return;
        }
        if (status.startsWith('failed:')) {
          _serverErrors[name] = status.substring('failed:'.length);
          notifyListeners();
          return;
        }
        // 'pending' / 'unknown' → keep polling within budget.
      }

      // Budget exhausted: gentle inline note, then a final refresh.
      _serverErrors[name] =
          'Authorization still pending — refresh after completing sign-in.';
      notifyListeners();
      await refresh();
    } catch (e) {
      _serverErrors[name] = e.toString();
      notifyListeners();
    }
  }

  // ── Credentials ─────────────────────────────────────────────────────────

  /// MCP-4: submits credentials for a curated key-based server, then refreshes
  /// so the row flips to connected (or shows the server's real error). Mirrors
  /// [connectServer]'s catch — failures surface inline, never silently.
  Future<void> setCredentials(String name, Map<String, String> env) async {
    _serverErrors.remove(name);
    notifyListeners();
    try {
      await _dataSource.setCredentials(name, env);
      await refresh();
    } catch (e) {
      _serverErrors[name] = e.toString();
      notifyListeners();
    }
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  Future<void> disconnectServer(String name) async {
    _serverErrors.remove(name);
    notifyListeners();
    try {
      await _dataSource.disconnectServer(name);
      await refresh();
    } catch (e) {
      _serverErrors[name] = e.toString();
      notifyListeners();
    }
  }

  // ── Remove ────────────────────────────────────────────────────────────────

  Future<void> removeServer(String name) async {
    _serverErrors.remove(name);
    notifyListeners();
    try {
      await _dataSource.removeServer(name);
      await refresh();
    } catch (e) {
      _serverErrors[name] = e.toString();
      notifyListeners();
    }
  }
}
