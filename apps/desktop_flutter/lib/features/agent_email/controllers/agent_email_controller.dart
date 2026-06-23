import 'package:flutter/foundation.dart';

import '../models/gmail_signal.dart';
import '../repositories/agent_email_repository.dart';

enum AgentEmailStatus { idle, loading, error }

class AgentEmailController extends ChangeNotifier {
  AgentEmailController(this._repository);

  final AgentEmailRepository _repository;

  List<AgentEmailGmailSignal> _signals = [];
  AgentEmailStatus _status = AgentEmailStatus.idle;
  String? _error;

  List<AgentEmailGmailSignal> get signals => _signals;
  AgentEmailStatus get status => _status;
  String? get error => _error;

  Future<void> loadSignals() async {
    _status = AgentEmailStatus.loading;
    _error = null;
    notifyListeners();

    try {
      _signals = await _repository.listSignals();
      _status = AgentEmailStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = AgentEmailStatus.error;
      // Empty signals → friendly empty state (not an error for 404/empty)
      _signals = [];
    }
    notifyListeners();
  }
}
