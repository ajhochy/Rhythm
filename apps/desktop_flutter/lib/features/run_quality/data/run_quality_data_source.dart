import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_run_quality.dart';

/// Talks to the LOCAL agent server's run-quality rollup API (#865):
/// `GET /agents/run-quality`. Hard-codes [AppConstants.agentLocalBaseUrl] —
/// never `serverConfigService.url` — per the dual-endpoint architecture:
/// agent traffic must not move if the user changes the production Server URL
/// in Settings.
class RunQualityDataSource {
  RunQualityDataSource() : _baseUrl = AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  Future<RunQualityRollup> getRollup({int? windowDays}) async {
    final uri = Uri.parse('$_baseUrl/agents/run-quality').replace(
      queryParameters:
          windowDays != null ? {'windowDays': windowDays.toString()} : null,
    );
    final response = await http.get(uri);
    assertOk(response);
    return RunQualityRollup.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }
}
