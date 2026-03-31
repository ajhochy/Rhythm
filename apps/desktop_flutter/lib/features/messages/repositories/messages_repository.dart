import '../data/messages_data_source.dart';
import '../models/message.dart';
import '../models/message_thread.dart';

class MessagesRepository {
  MessagesRepository(this._dataSource);

  final MessagesDataSource _dataSource;

  Future<List<MessageThread>> getThreads() => _dataSource.getThreads();

  Future<MessageThread> createThread(String title) =>
      _dataSource.createThread(title);

  Future<List<Message>> getMessages(int threadId) =>
      _dataSource.getMessages(threadId);

  Future<Message> sendMessage(
    int threadId,
    String senderName,
    String content,
  ) =>
      _dataSource.sendMessage(threadId, senderName, content);
}
