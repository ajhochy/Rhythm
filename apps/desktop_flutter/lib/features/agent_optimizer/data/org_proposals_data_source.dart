import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/org_proposal.dart';

/// Talks to the LOCAL agent server's review-queue API (org-optimizer-10,
/// #826): `GET/POST /agent-org-proposals`. Hard-codes
/// [AppConstants.agentLocalBaseUrl] — never `serverConfigService.url` — per
/// the dual-endpoint architecture: agent traffic must not move if the user
/// changes the production Server URL in Settings.
class OrgProposalsDataSource {
  OrgProposalsDataSource() : _baseUrl = AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  Future<List<OrgProposal>> listProposed({String status = 'proposed'}) async {
    final response = await http.get(
      Uri.parse('$_baseUrl/agent-org-proposals?status=$status'),
    );
    assertOk(response);
    final List<dynamic> data = jsonDecode(response.body) as List<dynamic>;
    return data
        .map((e) => OrgProposal.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<OrgProposal> approve(
    String id, {
    int? decidedByUserId,
    bool conditionalToolSafetyConfirmation = false,
  }) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-org-proposals/$id/approve'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        if (decidedByUserId != null) 'decidedByUserId': decidedByUserId,
        if (conditionalToolSafetyConfirmation)
          'toolSafetyConfirmation': 'approve-conditional-tool-install',
      }),
    );
    assertOk(response);
    return OrgProposal.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  /// #857 — undo an already-applied proposal, restoring its before-snapshot.
  /// The server refuses anything that is not `status == 'active'`, and refuses
  /// legacy whole-field scope snapshots, with a 409; both surface here as an
  /// [AppError] carrying the server's own message.
  Future<OrgProposal> revert(String id) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-org-proposals/$id/revert'),
      headers: {'Content-Type': 'application/json'},
    );
    assertOk(response);
    return OrgProposal.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }

  Future<OrgProposal> reject(String id, {int? decidedByUserId}) async {
    final response = await http.post(
      Uri.parse('$_baseUrl/agent-org-proposals/$id/reject'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        if (decidedByUserId != null) 'decidedByUserId': decidedByUserId,
      }),
    );
    assertOk(response);
    return OrgProposal.fromJson(
      jsonDecode(response.body) as Map<String, dynamic>,
    );
  }
}
