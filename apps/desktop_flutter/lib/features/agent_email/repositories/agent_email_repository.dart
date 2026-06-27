import '../data/agent_email_data_source.dart';
import '../models/gmail_signal.dart';

class AgentEmailRepository {
  AgentEmailRepository(this._dataSource);

  final AgentEmailDataSource _dataSource;

  Future<List<AgentEmailGmailSignal>> listSignals() =>
      _dataSource.listSignals();
}
