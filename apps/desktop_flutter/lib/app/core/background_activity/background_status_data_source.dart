import 'dart:convert';

import 'package:http/http.dart' as http;

import '../constants/app_constants.dart';
import 'background_status_model.dart';

/// Fetches the aggregated background-loop status from the local agent server.
///
/// Always polls [AppConstants.agentLocalBaseUrl] — this is internal to the
/// local agent server and must never follow the user-configurable
/// [ServerConfigService.url] (per the dual-endpoint architecture rule).
class BackgroundStatusDataSource {
  BackgroundStatusDataSource({String? baseUrl})
    : _baseUrl = baseUrl ?? AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  Future<BackgroundStatus> fetch() async {
    final uri = Uri.parse('$_baseUrl/agent-sessions/background-status');
    final response = await http.get(uri);
    if (response.statusCode != 200) {
      throw Exception(
        'BackgroundStatusDataSource: unexpected ${response.statusCode}',
      );
    }
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return BackgroundStatus.fromJson(json);
  }
}
