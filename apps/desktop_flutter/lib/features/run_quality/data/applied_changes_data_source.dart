import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';

/// READ-ONLY reader for org-optimizer proposals that have actually been
/// deployed, used only to summarise them on the Agent Report Card.
///
/// GETs only. This never approves, reverts, or measures anything — those
/// routes exist on the same endpoint and are deliberately not called here.
///
/// Hard-codes [AppConstants.agentLocalBaseUrl] — never
/// `serverConfigService.url` — per the dual-endpoint architecture.
///
/// `GET /agent-org-proposals` takes exactly one `status`, so one request per
/// deployment status. ponytail: 4 small local GETs beats a new endpoint.
class AppliedChangesDataSource {
  AppliedChangesDataSource() : _baseUrl = AppConstants.agentLocalBaseUrl;

  static const deployedStatuses = [
    'applied',
    'measuring',
    'active',
    'reverted'
  ];

  final String _baseUrl;

  /// Raw proposal rows, left as decoded JSON on purpose: the report card only
  /// counts `targetRef`/`status`/`outcomeStatus`, so a parallel proposal model
  /// would be three fields of signal and twenty of noise.
  Future<List<Map<String, dynamic>>> listAppliedChanges() async {
    final responses = await Future.wait(
      deployedStatuses.map(
        (status) => http.get(
          Uri.parse('$_baseUrl/agent-org-proposals?status=$status'),
        ),
      ),
    );

    final rows = <Map<String, dynamic>>[];
    for (final response in responses) {
      assertOk(response);
      final decoded = jsonDecode(response.body);
      if (decoded is List) {
        rows.addAll(decoded.whereType<Map<String, dynamic>>());
      }
    }
    return rows;
  }
}
