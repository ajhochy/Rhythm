import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../app/core/auth/auth_user.dart';
import '../models/message.dart';
import '../models/message_thread.dart';
import '../repositories/messages_repository.dart';

enum MessagesStatus { idle, loading, error }

class MessagesController extends ChangeNotifier {
  MessagesController(this._repository);

  final MessagesRepository _repository;

  List<MessageThread> _threads = [];
  List<AuthUser> _users = [];
  int? _selectedThreadId;
  List<Message> _messages = [];
  MessagesStatus _status = MessagesStatus.idle;
  String? _errorMessage;
  Timer? _pollTimer;

  List<MessageThread> get threads => _threads;
  List<AuthUser> get users => _users;
  int? get selectedThreadId => _selectedThreadId;
  List<Message> get messages => _messages;
  MessagesStatus get status => _status;
  String? get errorMessage => _errorMessage;
  int get unreadThreadCount => _threads.where((t) => t.isUnread).length;

  MessageThread? get selectedThread {
    if (_selectedThreadId == null) return null;
    try {
      return _threads.firstWhere((t) => t.id == _selectedThreadId);
    } catch (_) {
      return null;
    }
  }

  Future<void> loadThreads({bool silent = false}) async {
    if (!silent) {
      _status = MessagesStatus.loading;
      _errorMessage = null;
      notifyListeners();
    }

    try {
      _threads = await _repository.getThreads();
      _status = MessagesStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = MessagesStatus.error;
    }
    notifyListeners();
  }

  Future<void> loadUsers() async {
    try {
      _users = await _repository.getUsers();
      notifyListeners();
    } catch (e) {
      _errorMessage = e.toString();
      _status = MessagesStatus.error;
      notifyListeners();
    }
  }

  Future<void> selectThread(int id) async {
    _selectedThreadId = id;
    _messages = [];
    notifyListeners();

    try {
      _messages = await _repository.getMessages(id);
      await _repository.markRead(id);
      await loadThreads(silent: true);
      _status = MessagesStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = MessagesStatus.error;
    }
    notifyListeners();
  }

  Future<void> createThread(List<int> participantIds, {String? title}) async {
    try {
      final thread = await _repository.createThread(
        participantIds,
        title: title,
      );
      await loadThreads(silent: true);
      _status = MessagesStatus.idle;
      notifyListeners();
      await selectThread(thread.id);
    } catch (e) {
      _errorMessage = e.toString();
      _status = MessagesStatus.error;
      notifyListeners();
    }
  }

  Future<void> sendMessage(int threadId, String content) async {
    try {
      final message = await _repository.sendMessage(threadId, content);
      _messages = [..._messages, message];
      _status = MessagesStatus.idle;
      notifyListeners();
      await loadThreads(silent: true);
    } catch (e) {
      _errorMessage = e.toString();
      _status = MessagesStatus.error;
      notifyListeners();
    }
  }

  void startPolling() {
    _pollTimer ??= Timer.periodic(
      const Duration(seconds: 30),
      (_) => loadThreads(silent: true),
    );
  }

  void stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  @override
  void dispose() {
    stopPolling();
    super.dispose();
  }
}
