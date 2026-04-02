import '../data/messages_data_source.dart';
import '../models/message.dart';
import '../models/message_thread.dart';
import '../../../app/core/auth/auth_user.dart';

class MessagesRepository {
  MessagesRepository(this._dataSource);

  final MessagesDataSource _dataSource;

  Future<List<MessageThread>> getThreads() => _dataSource.getThreads();

  Future<List<AuthUser>> getUsers() => _dataSource.getUsers();

  Future<MessageThread> createThread(List<int> participantIds,
          {String? title}) =>
      _dataSource.createThread(participantIds, title: title);

  Future<List<Message>> getMessages(int threadId) =>
      _dataSource.getMessages(threadId);

  Future<Message> sendMessage(int threadId, String content) =>
      _dataSource.sendMessage(threadId, content);

  Future<void> markRead(int threadId) => _dataSource.markRead(threadId);
}
