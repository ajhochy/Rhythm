import 'dart:convert';

import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/utils/http_utils.dart';
import '../models/agent_design.dart';

class AgentGalleryDataSource {
  AgentGalleryDataSource() : _baseUrl = AppConstants.agentLocalBaseUrl;

  final String _baseUrl;

  Future<List<AgentDesign>> list() async {
    final response = await http.get(Uri.parse('$_baseUrl/agent-designs'));
    assertOk(response);
    final List<dynamic> data = jsonDecode(response.body) as List<dynamic>;
    return data
        .map((e) => AgentDesign.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}
