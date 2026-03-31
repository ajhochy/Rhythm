import 'package:flutter/foundation.dart';

import '../models/message.dart';
import '../models/message_thread.dart';
import '../repositories/messages_repository.dart';

enum MessagesStatus { idle, loading, error }

class MessagesController extends ChangeNotifier {
  MessagesController(this._repository);

  final MessagesRepository _repository;

  List<MessageThread> _threads = [];
  int? _selectedThreadId;
  List<Message> _messages = [];
  MessagesStatus _status = MessagesStatus.idle;
  String? _errorMessage;

  List<MessageThread> get threads => _threads;
  int? get selectedThreadId => _selectedThreadId;
  List<Message> get messages => _messages;
  MessagesStatus get status => _status;
  String? get errorMessage => _errorMessage;

  MessageThread? get selectedThread {
    if (_selectedThreadId == null) return null;
    try {
      return _threads.firstWhere((t) => t.id == _selectedThreadId);
    } catch (_) {
      return null;
    }
  }

  Future<void> loadThreads() async {
    _status = MessagesStatus.loading;
    _errorMessage = null;
    notifyListeners();

    try {
      _threads = await _repository.getThreads();
      _status = MessagesStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = MessagesStatus.error;
    }
    notifyListeners();
  }

  Future<void> selectThread(int id) async {
    _selectedThreadId = id;
    _messages = [];
    notifyListeners();

    try {
      _messages = await _repository.getMessages(id);
    } catch (e) {
      _errorMessage = e.toString();
      _status = MessagesStatus.error;
    }
    notifyListeners();
  }

  Future<void> createThread(String title) async {
    try {
      final thread = await _repository.createThread(title);
      _threads = [..._threads, thread];
      _status = MessagesStatus.idle;
      notifyListeners();
      await selectThread(thread.id);
    } catch (e) {
      _errorMessage = e.toString();
      _status = MessagesStatus.error;
      notifyListeners();
    }
  }

  Future<void> sendMessage(
    int threadId,
    String senderName,
    String content,
  ) async {
    try {
      final message =
          await _repository.sendMessage(threadId, senderName, content);
      _messages = [..._messages, message];
      _status = MessagesStatus.idle;
      notifyListeners();
      // Refresh thread list so last_message / updated_at updates.
      _threads = await _repository.getThreads();
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = MessagesStatus.error;
      notifyListeners();
    }
  }
}
