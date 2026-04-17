import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../../app/core/notifications/local_notification_service.dart';
import '../../../app/core/auth/auth_user.dart';
import '../models/message.dart';
import '../models/message_thread.dart';
import '../repositories/messages_repository.dart';

enum MessagesStatus { idle, loading, error }

class IncomingMessageNotice {
  const IncomingMessageNotice({
    required this.threadId,
    required this.senderName,
    required this.preview,
  });

  final int threadId;
  final String senderName;
  final String preview;
}

class MessagesController extends ChangeNotifier {
  MessagesController(
    this._repository, {
    required LocalNotificationService notifications,
    Duration pollInterval = const Duration(seconds: 30),
  })  : _notifications = notifications,
        _pollInterval = pollInterval;

  final MessagesRepository _repository;
  final LocalNotificationService _notifications;
  final Duration _pollInterval;

  List<MessageThread> _threads = [];
  List<AuthUser> _users = [];
  int? _selectedThreadId;
  List<Message> _messages = [];
  MessagesStatus _status = MessagesStatus.idle;
  String? _errorMessage;
  Timer? _pollTimer;
  bool _screenActive = false;
  bool _pollingEnabled = false;
  IncomingMessageNotice? _incomingNotice;

  List<MessageThread> get threads => _threads;
  List<AuthUser> get users => _users;
  int? get selectedThreadId => _selectedThreadId;
  List<Message> get messages => _messages;
  MessagesStatus get status => _status;
  String? get errorMessage => _errorMessage;
  int get unreadThreadCount => _threads.where((t) => t.isUnread).length;
  int get totalUnreadCount =>
      _threads.fold(0, (sum, thread) => sum + thread.unreadCount);
  IncomingMessageNotice? get incomingNotice => _incomingNotice;

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
      final previousThreads = List<MessageThread>.from(_threads);
      _threads = await _repository.getThreads();
      _maybeNotifyForUnreadThreadActivity(previousThreads, _threads);
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
    _markThreadReadLocally(id);
    _selectedThreadId = id;
    _messages = [];
    notifyListeners();

    try {
      await _repository.markRead(id);
      _messages = await _repository.getMessages(id);
      await loadThreads(silent: true);
      _status = MessagesStatus.idle;
    } catch (e) {
      _errorMessage = e.toString();
      _status = MessagesStatus.error;
    }
    notifyListeners();
  }

  Future<void> createThread(
    List<int> participantIds, {
    String? title,
    String threadType = 'direct',
  }) async {
    try {
      final thread = await _repository.createThread(
        participantIds,
        title: title,
        threadType: threadType,
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
      _touchThread(threadId, content);
      _status = MessagesStatus.idle;
      notifyListeners();
      await loadThreads(silent: true);
    } catch (e) {
      _errorMessage = e.toString();
      _status = MessagesStatus.error;
      notifyListeners();
    }
  }

  void setScreenActive(bool active) {
    if (_screenActive == active) return;
    _screenActive = active;
    if (active) {
      unawaited(loadThreads(silent: true));
    }
  }

  void setPollingEnabled(bool enabled) {
    if (_pollingEnabled == enabled) return;
    _pollingEnabled = enabled;
    if (enabled) {
      unawaited(loadThreads(silent: true));
      startPolling();
    } else {
      stopPolling();
    }
  }

  void clearIncomingNotice() {
    if (_incomingNotice == null) return;
    _incomingNotice = null;
    notifyListeners();
  }

  Future<void> markThreadRead(int threadId) async {
    _markThreadReadLocally(threadId);
    notifyListeners();
    try {
      await _repository.markRead(threadId);
      await loadThreads(silent: true);
    } catch (e) {
      _errorMessage = e.toString();
      _status = MessagesStatus.error;
      notifyListeners();
    }
  }

  Future<void> markThreadUnread(int threadId) async {
    try {
      await _repository.markUnread(threadId);
      await loadThreads(silent: true);
    } catch (e) {
      _errorMessage = e.toString();
      _status = MessagesStatus.error;
      notifyListeners();
    }
  }

  void startPolling() {
    _pollTimer ??= Timer.periodic(_pollInterval, (_) => unawaited(_poll()));
  }

  void stopPolling() {
    _pollTimer?.cancel();
    _pollTimer = null;
  }

  void _markThreadReadLocally(int threadId) {
    _threads = _threads
        .map(
          (thread) => thread.id == threadId
              ? MessageThread(
                  id: thread.id,
                  title: thread.title,
                  lastMessage: thread.lastMessage,
                  updatedAt: thread.updatedAt,
                  unreadCount: 0,
                  participants: thread.participants,
                  threadType: thread.threadType,
                )
              : thread,
        )
        .toList();
  }

  void _touchThread(int threadId, String latestMessage) {
    final matching = _threads.where((thread) => thread.id == threadId);
    if (matching.isEmpty) return;
    final thread = matching.first;
    final updated = MessageThread(
      id: thread.id,
      title: thread.title,
      lastMessage: latestMessage,
      updatedAt: DateTime.now(),
      unreadCount: 0,
      participants: thread.participants,
      threadType: thread.threadType,
    );
    _threads = [updated, ..._threads.where((thread) => thread.id != threadId)];
  }

  Future<void> _poll() async {
    final previousMessages = List<Message>.from(_messages);
    if (_screenActive && _selectedThreadId != null) {
      try {
        final threadId = _selectedThreadId!;
        final nextMessages = await _repository.getMessages(threadId);
        _maybeNotifyForIncomingMessages(
          previousMessages,
          nextMessages,
          threadId,
        );
        _messages = nextMessages;
        await _repository.markRead(threadId);
      } catch (_) {
        // Fall back to thread-list refresh below.
      }
    }
    await loadThreads(silent: true);
  }

  void _maybeNotifyForIncomingMessages(
    List<Message> previousMessages,
    List<Message> nextMessages,
    int threadId,
  ) {
    final previousIds = previousMessages.map((message) => message.id).toSet();
    final incoming = nextMessages
        .where((message) => !previousIds.contains(message.id))
        .toList();
    if (incoming.isEmpty) return;

    final latest = incoming.last;
    _incomingNotice = IncomingMessageNotice(
      threadId: threadId,
      senderName: latest.senderName,
      preview: latest.content,
    );
    _showSystemNotification(
      id: latest.id,
      title: latest.senderName,
      body: latest.content,
    );
  }

  void _maybeNotifyForUnreadThreadActivity(
    List<MessageThread> previousThreads,
    List<MessageThread> nextThreads,
  ) {
    final previousById = {
      for (final thread in previousThreads) thread.id: thread,
    };

    for (final thread in nextThreads) {
      if (thread.id == _selectedThreadId) continue;
      final previous = previousById[thread.id];
      final unreadIncreased = previous == null
          ? thread.unreadCount > 0
          : thread.unreadCount > previous.unreadCount;
      if (!unreadIncreased) continue;

      _incomingNotice = IncomingMessageNotice(
        threadId: thread.id,
        senderName: thread.title,
        preview: thread.lastMessage ?? 'New message',
      );
      _showSystemNotification(
        id: (thread.id * 1000) + thread.unreadCount,
        title: thread.title,
        body: thread.lastMessage ?? 'New unread message',
      );
      return;
    }
  }

  void _showSystemNotification({
    required int id,
    required String title,
    required String body,
  }) {
    unawaited(
      _notifications.showMessageNotification(id: id, title: title, body: body),
    );
  }

  @override
  void dispose() {
    stopPolling();
    super.dispose();
  }
}
