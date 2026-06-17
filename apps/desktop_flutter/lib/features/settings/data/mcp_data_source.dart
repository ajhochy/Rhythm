import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';

/// A single MCP server entry from the agent-local server.
class McpServerEntry {
  const McpServerEntry({
    required this.name,
    required this.status,
    this.error,
    this.needsCredentials = false,
    this.environment,
    this.url,
  });

  final String name;

  /// 'connected' | 'disconnected' | 'failed' | 'disabled' | 'needs_auth' | …
  final String status;

  /// Present when [status] == 'failed'.
  final String? error;

  /// MCP-1: true when the server is installed but missing required
  /// credentials — either a key-based server with an empty required env value,
  /// or a remote server the SDK reports as `needs_auth`. Computed server-side;
  /// the UI must not recompute this (MCP-4).
  final bool needsCredentials;

  /// MCP-1: the server's env keys with redacted values (e.g. `{API_KEY: '***'}`).
  /// Present only when the persisted config declares an environment map.
  final Map<String, String>? environment;

  /// OA3: the remote server URL, present for `type: 'remote'` servers (the list
  /// response spreads the persisted config, which carries `url`). Local
  /// command-based servers leave this null. Used to detect OAuth servers.
  final String? url;

  /// OA3: true when this is a remote (URL-backed) server with no required
  /// credentials — i.e. an OAuth server. Detection rule: remote URL present
  /// AND no env-based credentials. A `needs_auth` status is also a definite
  /// OAuth signal. Key-based servers (needsCredentials with an env map) are NOT
  /// OAuth.
  bool get isOAuth {
    if (status == 'needs_auth') return true;
    final hasUrl = url != null && url!.isNotEmpty;
    final hasEnv = environment != null && environment!.isNotEmpty;
    return hasUrl && !hasEnv;
  }

  factory McpServerEntry.fromJson(Map<String, dynamic> json) {
    final rawEnv = json['environment'] as Map<String, dynamic>?;
    return McpServerEntry(
      name: json['name'] as String,
      status: json['status'] as String? ?? 'unknown',
      error: json['error'] as String?,
      needsCredentials: json['needsCredentials'] as bool? ?? false,
      environment: rawEnv?.map((k, v) => MapEntry(k, v as String)),
      url: json['url'] as String?,
    );
  }
}

/// Abstract interface for MCP server management operations.
///
/// OPC-M4-3 contract (#702 c5): any concrete implementation must always target
/// the LOCAL agent server at [AppConstants.agentLocalBaseUrl] — NEVER the
/// production server URL from ServerConfigService. See the dual-endpoint
/// architecture in CLAUDE.md.
///
/// The default factory constructor returns a [_McpDataSourceImpl] instance.
abstract class McpDataSource {
  /// Default factory — always targets [AppConstants.agentLocalBaseUrl].
  ///
  /// Pass [baseUrl] only in tests that need to verify the URL directly.
  factory McpDataSource({String? baseUrl}) = _McpDataSourceImpl;

  Future<List<McpServerEntry>> listServers();

  Future<void> addServer({
    required String name,
    String? command,
    String? url,
    Map<String, String>? environment,
  });

  /// Connects (or begins OAuth for) the named MCP server.
  ///
  /// Returns the OAuth consent URL (`authorizationUrl`) when the server needs
  /// the user to authorize in a browser (e.g. canva, notion). Returns `null`
  /// when the server is already authenticated / connected.
  Future<String?> connectServer(String name);

  /// OA3: begins the backend-driven remote-OAuth flow for [name].
  ///
  /// POSTs to `…/opencode/mcp/$name/oauth/start`. Returns the consent
  /// `authorizationUrl` the caller must open in a browser, or `null` if the
  /// response carries no URL.
  Future<String?> startOAuth(String name);

  /// OA3: polls the backend OAuth status for [name].
  ///
  /// GETs `…/opencode/mcp/$name/oauth/status`. Returns the `status` string —
  /// one of `pending` | `connected` | `failed:<msg>` | `unknown` (defaults to
  /// `unknown` when the field is absent).
  Future<String> oauthStatus(String name);

  Future<void> disconnectServer(String name);

  Future<void> removeServer(String name);
}

/// Testing extension — exposes the underlying base URL for contract test c5.
///
/// Extension methods are NOT part of the [McpDataSource] interface contract, so
/// classes that `implements McpDataSource` (e.g. test fakes) are NOT required
/// to provide them.  This is intentional: only the real concrete class needs
/// this getter; fakes should not implement it.
extension McpDataSourceTestExtension on McpDataSource {
  /// Returns the base URL used by this data source.
  ///
  /// Only call this from test code. Production code must not read the URL.
  @visibleForTesting
  String get baseUrlForTest => (this as _McpDataSourceImpl)._baseUrl;
}

// ---------------------------------------------------------------------------
// Concrete implementation
// ---------------------------------------------------------------------------

class _McpDataSourceImpl implements McpDataSource {
  _McpDataSourceImpl({String? baseUrl})
      : _baseUrl = baseUrl ?? AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  // ── List ──────────────────────────────────────────────────────────────────

  @override
  Future<List<McpServerEntry>> listServers() async {
    final response = await http.get(Uri.parse('$_baseUrl/opencode/mcp'));
    if (response.statusCode != 200) {
      throw Exception(
        'Failed to list MCP servers: HTTP ${response.statusCode}',
      );
    }
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((e) => McpServerEntry.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  // ── Add ───────────────────────────────────────────────────────────────────

  @override
  Future<void> addServer({
    required String name,
    String? command,
    String? url,
    Map<String, String>? environment,
  }) async {
    final body = <String, dynamic>{'name': name};
    if (command != null && command.isNotEmpty) body['command'] = command;
    if (url != null && url.isNotEmpty) body['url'] = url;
    // MCP-3: per-server env secrets. Omit entirely when there are no secret
    // rows so existing command/url-only requests stay byte-identical
    // (backward-compat with the MCP-1 backend).
    if (environment != null && environment.isNotEmpty) {
      body['environment'] = environment;
    }

    final response = await http.post(
      Uri.parse('$_baseUrl/opencode/mcp'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode(body),
    );
    if (response.statusCode != 200) {
      String msg = 'HTTP ${response.statusCode}';
      try {
        final b = jsonDecode(response.body) as Map<String, dynamic>;
        final err = b['error'] as Map<String, dynamic>?;
        msg = err?['message'] as String? ?? msg;
      } catch (_) {}
      throw Exception('Failed to add MCP server "$name": $msg');
    }
  }

  // ── Connect ───────────────────────────────────────────────────────────────

  @override
  Future<String?> connectServer(String name) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/opencode/mcp/$name/connect'),
    );
    if (response.statusCode != 200) {
      String msg = 'HTTP ${response.statusCode}';
      try {
        final b = jsonDecode(response.body) as Map<String, dynamic>;
        final err = b['error'] as Map<String, dynamic>?;
        msg = err?['message'] as String? ?? msg;
      } catch (_) {}
      throw Exception('Failed to connect MCP server "$name": $msg');
    }
    // Remote OAuth servers return a consent URL the caller must open; already
    // authenticated servers return null here.
    try {
      final b = jsonDecode(response.body) as Map<String, dynamic>;
      return b['authorizationUrl'] as String?;
    } catch (_) {
      return null;
    }
  }

  // ── OAuth: start ────────────────────────────────────────────────────────

  @override
  Future<String?> startOAuth(String name) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/opencode/mcp/$name/oauth/start'),
    );
    if (response.statusCode != 200) {
      String msg = 'HTTP ${response.statusCode}';
      try {
        final b = jsonDecode(response.body) as Map<String, dynamic>;
        final err = b['error'] as Map<String, dynamic>?;
        msg = err?['message'] as String? ?? msg;
      } catch (_) {}
      throw Exception('Failed to start OAuth for MCP server "$name": $msg');
    }
    try {
      final b = jsonDecode(response.body) as Map<String, dynamic>;
      return b['authorizationUrl'] as String?;
    } catch (_) {
      return null;
    }
  }

  // ── OAuth: status ─────────────────────────────────────────────────────────

  @override
  Future<String> oauthStatus(String name) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/opencode/mcp/$name/oauth/status'),
    );
    if (response.statusCode != 200) {
      String msg = 'HTTP ${response.statusCode}';
      try {
        final b = jsonDecode(response.body) as Map<String, dynamic>;
        final err = b['error'] as Map<String, dynamic>?;
        msg = err?['message'] as String? ?? msg;
      } catch (_) {}
      throw Exception('Failed to read OAuth status for "$name": $msg');
    }
    try {
      final b = jsonDecode(response.body) as Map<String, dynamic>;
      return b['status'] as String? ?? 'unknown';
    } catch (_) {
      return 'unknown';
    }
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  @override
  Future<void> disconnectServer(String name) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/opencode/mcp/$name/disconnect'),
    );
    if (response.statusCode != 200) {
      String msg = 'HTTP ${response.statusCode}';
      try {
        final b = jsonDecode(response.body) as Map<String, dynamic>;
        final err = b['error'] as Map<String, dynamic>?;
        msg = err?['message'] as String? ?? msg;
      } catch (_) {}
      throw Exception('Failed to disconnect MCP server "$name": $msg');
    }
  }

  // ── Remove ────────────────────────────────────────────────────────────────

  @override
  Future<void> removeServer(String name) async {
    final response = await http.delete(
      Uri.parse('$_baseUrl/opencode/mcp/$name'),
    );
    if (response.statusCode != 204) {
      String msg = 'HTTP ${response.statusCode}';
      try {
        final b = jsonDecode(response.body) as Map<String, dynamic>;
        final err = b['error'] as Map<String, dynamic>?;
        msg = err?['message'] as String? ?? msg;
      } catch (_) {}
      throw Exception('Failed to remove MCP server "$name": $msg');
    }
  }
}
