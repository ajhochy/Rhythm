import 'package:flutter/foundation.dart';

import '../models/agent_webhook_endpoint.dart';
import '../repositories/agent_webhooks_repository.dart';

enum AgentWebhooksStatus { idle, loading, error }

class AgentWebhooksController extends ChangeNotifier {
  AgentWebhooksController(this._repository);

  final AgentWebhooksRepository _repository;

  List<AgentWebhookEndpoint> _endpoints = [];
  AgentWebhooksStatus _status = AgentWebhooksStatus.idle;
  String? _error;

  List<AgentWebhookEndpoint> get endpoints => List.unmodifiable(_endpoints);
  AgentWebhooksStatus get status => _status;
  String? get error => _error;

  Future<void> refresh() async {
    _status = AgentWebhooksStatus.loading;
    _error = null;
    notifyListeners();

    try {
      _endpoints = await _repository.list();
      _status = AgentWebhooksStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = AgentWebhooksStatus.error;
    }
    notifyListeners();
  }

  Future<AgentWebhookEndpoint?> create(Map<String, dynamic> input) async {
    try {
      final created = await _repository.create(input);
      _endpoints = [..._endpoints, created];
      _error = null;
      notifyListeners();
      return created;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return null;
    }
  }

  Future<bool> delete(String id) async {
    try {
      await _repository.delete(id);
      _endpoints = _endpoints.where((e) => e.id != id).toList();
      _error = null;
      notifyListeners();
      return true;
    } catch (e) {
      _error = e.toString();
      notifyListeners();
      return false;
    }
  }
}
