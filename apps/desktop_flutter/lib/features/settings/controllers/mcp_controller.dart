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
  McpController(this._dataSource, {McpUrlLauncher? urlLauncher})
      : _urlLauncher = urlLauncher ?? _defaultMcpUrlLauncher;

  final McpDataSource _dataSource;

  /// Opens the OAuth consent URL returned by [connectServer]. Injectable for
  /// tests; defaults to launching the system browser.
  final McpUrlLauncher _urlLauncher;

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
    try {
      final authorizationUrl = await _dataSource.connectServer(name);
      // Remote OAuth servers (e.g. canva, notion) return a consent URL — open
      // it so the user can authorize. Already-authed servers return null.
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
