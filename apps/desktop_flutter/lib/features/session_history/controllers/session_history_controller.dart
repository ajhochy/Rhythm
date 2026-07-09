import 'package:flutter/foundation.dart';

import '../models/session_history_agent_session.dart';
import '../models/session_transcript_message.dart';
import '../repositories/session_history_repository.dart';

enum SessionHistoryControllerStatus { idle, loading, error }

class SessionHistoryController extends ChangeNotifier {
  SessionHistoryController(this._repository);

  final SessionHistoryRepository _repository;

  SessionHistoryControllerStatus _status = SessionHistoryControllerStatus.idle;
  String? _error;
  List<SessionHistoryAgentSession> _sessions = const [];
  final Map<String, List<SessionTranscriptMessage>> _transcripts = {};

  SessionHistoryControllerStatus get status => _status;
  String? get error => _error;
  List<SessionHistoryAgentSession> get sessions => _sessions;

  List<SessionTranscriptMessage> transcriptFor(String sessionId) =>
      _transcripts[sessionId] ?? const [];

  Future<void> refresh() async {
    _status = SessionHistoryControllerStatus.loading;
    _error = null;
    notifyListeners();

    try {
      _sessions = await _repository.listSessions();
      _status = SessionHistoryControllerStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = SessionHistoryControllerStatus.error;
    }
    notifyListeners();
  }

  Future<void> loadTranscript(String sessionId) async {
    _status = SessionHistoryControllerStatus.loading;
    _error = null;
    notifyListeners();

    try {
      _transcripts[sessionId] = await _repository.getTranscript(sessionId);
      _status = SessionHistoryControllerStatus.idle;
    } catch (e) {
      _error = e.toString();
      _status = SessionHistoryControllerStatus.error;
    }
    notifyListeners();
  }
}
