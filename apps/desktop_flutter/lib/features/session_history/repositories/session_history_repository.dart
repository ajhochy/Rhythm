import '../data/session_history_data_source.dart';
import '../models/session_transcript_message.dart';

class SessionHistoryRepository {
  SessionHistoryRepository(this._dataSource);

  final SessionHistoryDataSource _dataSource;

  Future<List<SessionTranscriptMessage>> getTranscript(String sessionId) =>
      _dataSource.getTranscript(sessionId);
}
