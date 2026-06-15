import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../constants/app_constants.dart';

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
