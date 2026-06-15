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
  });

  final String name;

  /// 'connected' | 'disconnected' | 'failed' | 'disabled' | 'needs_auth' | …
  final String status;

  /// Present when [status] == 'failed'.
  final String? error;

  factory McpServerEntry.fromJson(Map<String, dynamic> json) {
    return McpServerEntry(
      name: json['name'] as String,
      status: json['status'] as String? ?? 'unknown',
      error: json['error'] as String?,
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
  });

  Future<void> connectServer(String name);

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
  }) async {
    final body = <String, String>{'name': name};
    if (command != null && command.isNotEmpty) body['command'] = command;
    if (url != null && url.isNotEmpty) body['url'] = url;

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
  Future<void> connectServer(String name) async {
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
