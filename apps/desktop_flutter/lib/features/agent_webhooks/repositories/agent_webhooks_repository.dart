import '../data/agent_webhooks_data_source.dart';
import '../models/agent_webhook_endpoint.dart';

class AgentWebhooksRepository {
  AgentWebhooksRepository() : _dataSource = AgentWebhooksDataSource();

  final AgentWebhooksDataSource _dataSource;

  Future<List<AgentWebhookEndpoint>> list() => _dataSource.list();

  Future<AgentWebhookEndpoint> create(Map<String, dynamic> input) =>
      _dataSource.create(input);

  Future<void> delete(String id) => _dataSource.delete(id);
}
