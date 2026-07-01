// #788 — MCP source-of-truth note.
//
// This auto-installer is the *materialize-on-install trigger* for the rhythm
// MCP template: on launch it POSTs to the server-side ensure endpoint
// (`/opencode/mcp/rhythm/ensure`), which materializes the rhythm server INTO
// the opencode engine. It does NOT constitute a second MCP source.
//
// The SINGLE source of truth for which MCP servers exist is the live engine
// list (`GET /opencode/mcp`) — that is what the pickers display and what #765
// scoping enforces (see
// docs/ai/decisions/2026-06-28-unify-mcp-source-of-truth.md). Decision: KEEP
// this client-side trigger (do not fold into a server-side ensure-on-ready) —
// behavior unchanged.

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../constants/app_constants.dart';

/// All three conditions must hold before auto-installing: the engine is ready,
/// a user is authenticated, and the configured server is the cloud API (a
/// localhost-only token cannot be reached by the MCP server process).
bool shouldAutoInstallRhythmMcp({
  required bool engineReady,
  required bool authenticated,
  required bool isCloudServer,
}) =>
    engineReady && authenticated && isCloudServer;

/// Auto-installs (and refreshes) the rhythm MCP server inside the embedded
/// opencode engine via the local agent server. Failures are non-fatal: a
/// `false` return means "not installed this time", never an exception that
/// blocks launch or agent sessions.
class RhythmMcpAutoInstaller {
  RhythmMcpAutoInstaller({http.Client? httpClient})
      : _http = httpClient ?? http.Client();

  final http.Client _http;

  Future<bool> ensure({
    required String apiToken,
    required String apiUrl,
  }) async {
    try {
      final res = await _http.post(
        Uri.parse(
          '${AppConstants.agentLocalBaseUrl}/opencode/mcp/rhythm/ensure',
        ),
        headers: const {'Content-Type': 'application/json'},
        body: jsonEncode({'apiToken': apiToken, 'apiUrl': apiUrl}),
      );
      if (res.statusCode >= 200 && res.statusCode < 300) return true;
      debugPrint(
        'RhythmMcpAutoInstaller: ensure failed ${res.statusCode}: ${res.body}',
      );
      return false;
    } catch (err) {
      debugPrint('RhythmMcpAutoInstaller: ensure error $err');
      return false;
    }
  }
}
