import 'package:flutter/foundation.dart';

import '../models/session_transcript_message.dart';
import '../repositories/session_history_repository.dart';

enum SessionHistoryControllerStatus { idle, loading, error }

/// #1027 (USO A4) — the list-merge state (`refresh`/`sessions`) was retired
/// with the standalone Session History page. This controller now only loads
/// per-session transcripts for the reused detail view.
class SessionHistoryController extends ChangeNotifier {
  SessionHistoryController(this._repository);

  final SessionHistoryRepository _repository;

  SessionHistoryControllerStatus _status = SessionHistoryControllerStatus.idle;
  String? _error;
  final Map<String, List<SessionTranscriptMessage>> _transcripts = {};

  SessionHistoryControllerStatus get status => _status;
  String? get error => _error;

  List<SessionTranscriptMessage> transcriptFor(String sessionId) =>
      _transcripts[sessionId] ?? const [];

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
