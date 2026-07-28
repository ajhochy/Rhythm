import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/auth/auth_session_store.dart';
import '../../../app/core/constants/app_constants.dart';
import '../models/agent_approval.dart';
import 'human_approval_signer.dart';

/// #895 — talks to the LOCAL agent server (:4001), same as every other
/// agent-execution-state endpoint (never serverConfigService.url).
abstract class AgentApprovalsDataSource {
  factory AgentApprovalsDataSource({
    String? baseUrl,
    HumanApprovalSigner? humanApprovalSigner,
  }) = _AgentApprovalsDataSourceImpl;

  Future<List<AgentApproval>> listPending();
  Future<void> decide(AgentApproval approval, {required bool approve});
}

class _AgentApprovalsDataSourceImpl implements AgentApprovalsDataSource {
  _AgentApprovalsDataSourceImpl({
    String? baseUrl,
    HumanApprovalSigner? humanApprovalSigner,
  })  : _baseUrl = baseUrl ?? AppConstants.agentLocalBaseUrl,
        _humanApprovalSigner = humanApprovalSigner ?? HumanApprovalSigner();

  final String _baseUrl;
  final HumanApprovalSigner _humanApprovalSigner;

  @override
  Future<List<AgentApproval>> listPending() async {
    final headers = AuthSessionStore.headers();
    final humanApprovalCapability =
        await _humanApprovalSigner.humanApprovalCapability();
    headers['X-Rhythm-Human-Approval'] = humanApprovalCapability;
    final response = await http.get(
      Uri.parse('$_baseUrl/agent-approvals?status=pending'),
      headers: headers,
    );
    if (response.statusCode != 200) {
      throw Exception('Failed to load agent approvals: ${response.statusCode}');
    }
    final list = jsonDecode(response.body) as List<dynamic>;
    return list
        .map((e) => AgentApproval.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  @override
  Future<void> decide(
    AgentApproval approval, {
    required bool approve,
  }) async {
    final decisionStatus = approve ? 'approved' : 'rejected';
    final signature = await _humanApprovalSigner.signDecision(
      approvalId: approval.id,
      decisionNonce: approval.decisionNonce,
      payloadDigest: approval.payloadDigest,
      decisionStatus: decisionStatus,
    );
    final headers = AuthSessionStore.headers(json: true);
    final humanApprovalCapability =
        await _humanApprovalSigner.humanApprovalCapability();
    headers['X-Rhythm-Human-Approval'] = humanApprovalCapability;
    final response = await http.patch(
      Uri.parse('$_baseUrl/agent-approvals/${approval.id}'),
      headers: headers,
      body: jsonEncode({
        'status': decisionStatus,
        'signature': signature,
      }),
    );
    if (response.statusCode != 200) {
      throw Exception(
          'Failed to decide agent approval: ${response.statusCode}');
    }
  }
}
