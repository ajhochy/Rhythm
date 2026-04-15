import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/theme/rhythm_tokens.dart';
import '../controllers/messages_controller.dart';
import '../models/message.dart';
import '../models/message_thread.dart';

const _kCanvas = RhythmTokens.background;
const _kPrimary = RhythmTokens.accent;
const _kTextPrimary = RhythmTokens.textPrimary;
const _kTextSecondary = RhythmTokens.textSecondary;
const _kTextMuted = RhythmTokens.textMuted;
const _kDivider = RhythmTokens.borderSoft;
const _kSurface = RhythmTokens.surfaceStrong;
const _kSurfaceMuted = RhythmTokens.surfaceMuted;
const _kBorder = RhythmTokens.border;
const _kAccentSoft = RhythmTokens.accentSoft;

class MessagesView extends StatefulWidget {
  const MessagesView({super.key});

  @override
  State<MessagesView> createState() => _MessagesViewState();
}

class _MessagesViewState extends State<MessagesView> {
  final _searchController = TextEditingController();
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final controller = context.read<MessagesController>();
      controller.loadThreads();
      controller.startPolling();
    });
    _searchController.addListener(() {
      setState(() => _searchQuery = _searchController.text.toLowerCase());
    });
  }

  @override
  void dispose() {
    context.read<MessagesController>().stopPolling();
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: _kCanvas,
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [_kCanvas, Color(0xFFF7F4EF), _kCanvas],
            stops: [0.0, 0.45, 1.0],
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              _ThreadListPanel(
                searchController: _searchController,
                searchQuery: _searchQuery,
              ),
              const SizedBox(width: 12),
              const Expanded(child: _MessagePanel()),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Left panel — thread list
// ---------------------------------------------------------------------------

class _ThreadListPanel extends StatelessWidget {
  const _ThreadListPanel({
    required this.searchController,
    required this.searchQuery,
  });

  final TextEditingController searchController;
  final String searchQuery;

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<MessagesController>();
    final filtered = controller.threads
        .where((t) => t.title.toLowerCase().contains(searchQuery))
        .toList();

    return Container(
      width: 330,
      decoration: BoxDecoration(
        color: _kSurface,
        borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
        border: Border.all(color: _kBorder),
        boxShadow: RhythmTokens.shadow,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _PanelHeader(onNewThread: () => _showNewThreadDialog(context)),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: _SearchField(controller: searchController),
          ),
          const Divider(height: 1, color: _kDivider),
          Expanded(
            child:
                controller.status == MessagesStatus.loading &&
                    controller.threads.isEmpty
                ? const Center(
                    child: CircularProgressIndicator(color: _kPrimary),
                  )
                : filtered.isEmpty
                ? const _EmptyThreadsState()
                : ListView.separated(
                    padding: const EdgeInsets.fromLTRB(12, 12, 12, 14),
                    itemCount: filtered.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 8),
                    itemBuilder: (context, i) => _ThreadRow(
                      thread: filtered[i],
                      isSelected: controller.selectedThreadId == filtered[i].id,
                      onTap: () => context
                          .read<MessagesController>()
                          .selectThread(filtered[i].id),
                      onToggleUnread: () {
                        final messages = context.read<MessagesController>();
                        if (filtered[i].isUnread) {
                          messages.markThreadRead(filtered[i].id);
                        } else {
                          messages.markThreadUnread(filtered[i].id);
                        }
                      },
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  void _showNewThreadDialog(BuildContext context) {
    showDialog<void>(
      context: context,
      builder: (_) => _NewThreadDialog(
        onCreated: (participantIds, title, threadType) => context
            .read<MessagesController>()
            .createThread(participantIds, title: title, threadType: threadType),
      ),
    );
  }
}

class _PanelHeader extends StatelessWidget {
  const _PanelHeader({required this.onNewThread});

  final VoidCallback onNewThread;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
      child: Row(
        children: [
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Messages',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: _kTextPrimary,
                  ),
                ),
                SizedBox(height: 3),
                Text(
                  'Unread threads and direct conversations',
                  style: TextStyle(fontSize: 12, color: _kTextMuted),
                ),
              ],
            ),
          ),
          FilledButton.tonal(
            onPressed: onNewThread,
            style: FilledButton.styleFrom(
              backgroundColor: _kAccentSoft,
              foregroundColor: _kPrimary,
              elevation: 0,
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
              ),
            ),
            child: const Text(
              'New',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
            ),
          ),
        ],
      ),
    );
  }
}

class _SearchField extends StatelessWidget {
  const _SearchField({required this.controller});

  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      style: const TextStyle(fontSize: 13, color: _kTextPrimary),
      decoration: InputDecoration(
        hintText: 'Search conversations\u2026',
        hintStyle: const TextStyle(color: _kTextMuted, fontSize: 13),
        prefixIcon: const Icon(Icons.search, size: 16, color: _kTextMuted),
        isDense: true,
        filled: true,
        fillColor: _kSurfaceMuted,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 10,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
          borderSide: const BorderSide(color: _kDivider),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
          borderSide: const BorderSide(color: _kDivider),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
          borderSide: const BorderSide(color: _kPrimary),
        ),
      ),
    );
  }
}

class _ThreadRow extends StatelessWidget {
  const _ThreadRow({
    required this.thread,
    required this.isSelected,
    required this.onTap,
    required this.onToggleUnread,
  });

  final MessageThread thread;
  final bool isSelected;
  final VoidCallback onTap;
  final VoidCallback onToggleUnread;

  @override
  Widget build(BuildContext context) {
    final initial = thread.title.trim().isNotEmpty
        ? thread.title.trim()[0].toUpperCase()
        : '?';

    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 160),
        curve: Curves.easeOut,
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: isSelected ? _kAccentSoft : _kSurfaceMuted,
          borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
          border: Border.all(
            color: isSelected ? _kPrimary.withValues(alpha: 0.28) : _kBorder,
          ),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: _kPrimary.withValues(alpha: 0.08),
                    blurRadius: 18,
                    offset: const Offset(0, 6),
                  ),
                ]
              : const [],
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 32,
              height: 32,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: isSelected ? _kPrimary : const Color(0xFFE9EEF9),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Text(
                initial,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: isSelected ? Colors.white : _kPrimary,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Text(
                          thread.title,
                          style: TextStyle(
                            fontSize: 13.5,
                            fontWeight: thread.isUnread
                                ? FontWeight.w700
                                : FontWeight.w600,
                            color: _kTextPrimary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        _formatTimestamp(thread.updatedAt),
                        style: const TextStyle(
                          fontSize: 11,
                          color: _kTextMuted,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    thread.lastMessage ?? 'No messages yet',
                    style: const TextStyle(
                      fontSize: 12,
                      color: _kTextSecondary,
                      height: 1.3,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                PopupMenuButton<String>(
                  tooltip: 'Thread actions',
                  icon: const Icon(
                    Icons.more_horiz,
                    size: 18,
                    color: _kTextMuted,
                  ),
                  color: _kSurface,
                  surfaceTintColor: _kSurface,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                    side: const BorderSide(color: _kDivider),
                  ),
                  itemBuilder: (context) => [
                    PopupMenuItem<String>(
                      value: thread.isUnread ? 'read' : 'unread',
                      child: Text(
                        thread.isUnread ? 'Mark as read' : 'Mark as unread',
                      ),
                    ),
                  ],
                  onSelected: (_) => onToggleUnread(),
                ),
                if (thread.isUnread)
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 3,
                    ),
                    decoration: BoxDecoration(
                      color: _kPrimary,
                      borderRadius: BorderRadius.circular(999),
                    ),
                    child: Text(
                      '${thread.unreadCount}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  String _formatTimestamp(DateTime dt) {
    final now = DateTime.now();
    final diff = now.difference(dt);
    if (diff.inMinutes < 60) {
      return '${diff.inMinutes}m ago';
    }
    if (diff.inHours < 24) {
      return '${diff.inHours}h ago';
    }
    if (diff.inDays == 1) {
      return 'Yesterday';
    }
    if (diff.inDays < 7) {
      return '${diff.inDays}d ago';
    }
    return '${dt.month}/${dt.day}/${dt.year}';
  }
}

class _EmptyThreadsState extends StatelessWidget {
  const _EmptyThreadsState();

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.forum_outlined, size: 34, color: _kTextMuted),
            SizedBox(height: 10),
            Text(
              'No conversations',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: _kTextPrimary,
              ),
            ),
            SizedBox(height: 4),
            Text(
              'Start a direct thread to begin the conversation.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: _kTextMuted, height: 1.35),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Right panel — message thread content
// ---------------------------------------------------------------------------

class _MessagePanel extends StatefulWidget {
  const _MessagePanel();

  @override
  State<_MessagePanel> createState() => _MessagePanelState();
}

class _MessagePanelState extends State<_MessagePanel> {
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _sendMessage(BuildContext context) {
    final threadId = context.read<MessagesController>().selectedThreadId;
    if (threadId == null) return;

    final content = _messageController.text.trim();
    if (content.isEmpty) return;

    context.read<MessagesController>().sendMessage(threadId, content).then((_) {
      _messageController.clear();
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (_scrollController.hasClients) {
          _scrollController.animateTo(
            _scrollController.position.maxScrollExtent,
            duration: const Duration(milliseconds: 200),
            curve: Curves.easeOut,
          );
        }
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<MessagesController>();
    if (controller.selectedThreadId != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!_scrollController.hasClients) return;
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 200),
          curve: Curves.easeOut,
        );
      });
    }

    return Column(
      children: [
        if (controller.incomingNotice != null)
          _IncomingMessageBanner(notice: controller.incomingNotice!),
        Expanded(
          child: Container(
            decoration: BoxDecoration(
              color: _kSurface,
              borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
              border: Border.all(color: _kBorder),
              boxShadow: RhythmTokens.shadow,
            ),
            child: controller.selectedThreadId == null
                ? const _EmptyConversationState()
                : Column(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 20,
                          vertical: 16,
                        ),
                        decoration: const BoxDecoration(
                          border: Border(bottom: BorderSide(color: _kDivider)),
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    controller.selectedThread?.title ?? '',
                                    style: const TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w700,
                                      color: _kTextPrimary,
                                    ),
                                  ),
                                  const SizedBox(height: 4),
                                  Text(
                                    '${controller.messages.length} message${controller.messages.length == 1 ? '' : 's'}',
                                    style: const TextStyle(
                                      fontSize: 12,
                                      color: _kTextMuted,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 6,
                              ),
                              decoration: BoxDecoration(
                                color: _kAccentSoft,
                                borderRadius: BorderRadius.circular(
                                  RhythmTokens.radiusS,
                                ),
                              ),
                              child: Text(
                                controller.selectedThread?.isGroup == true
                                    ? 'Group'
                                    : 'Direct',
                                style: TextStyle(
                                  fontSize: 11,
                                  fontWeight: FontWeight.w700,
                                  color: _kPrimary.withValues(alpha: 0.9),
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                      Expanded(
                        child: Container(
                          color: _kCanvas.withValues(alpha: 0.45),
                          child: controller.messages.isEmpty
                              ? const Center(
                                  child: Text(
                                    'No messages yet. Say something!',
                                    style: TextStyle(
                                      color: _kTextMuted,
                                      fontSize: 13,
                                    ),
                                  ),
                                )
                              : ListView.separated(
                                  controller: _scrollController,
                                  padding: const EdgeInsets.fromLTRB(
                                    20,
                                    20,
                                    20,
                                    16,
                                  ),
                                  itemCount: controller.messages.length,
                                  separatorBuilder: (_, __) =>
                                      const SizedBox(height: 12),
                                  itemBuilder: (context, i) => _MessageBubble(
                                    message: controller.messages[i],
                                  ),
                                ),
                        ),
                      ),
                      _ReplyArea(
                        messageController: _messageController,
                        onSend: () => _sendMessage(context),
                      ),
                    ],
                  ),
          ),
        ),
      ],
    );
  }
}

class _EmptyConversationState extends StatelessWidget {
  const _EmptyConversationState();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 340,
        padding: const EdgeInsets.all(28),
        decoration: BoxDecoration(
          color: _kSurface,
          borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
          border: Border.all(color: _kBorder),
          boxShadow: RhythmTokens.shadow,
        ),
        child: const Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.chat_bubble_outline, size: 36, color: _kTextMuted),
            SizedBox(height: 12),
            Text(
              'Select a conversation',
              style: TextStyle(
                color: _kTextPrimary,
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
            ),
            SizedBox(height: 6),
            Text(
              'Messages, thread previews, and reply activity appear here.',
              textAlign: TextAlign.center,
              style: TextStyle(color: _kTextMuted, fontSize: 12, height: 1.35),
            ),
          ],
        ),
      ),
    );
  }
}

class _IncomingMessageBanner extends StatelessWidget {
  const _IncomingMessageBanner({required this.notice});

  final IncomingMessageNotice notice;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Material(
        color: Colors.transparent,
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: _kAccentSoft,
            borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
            border: Border.all(color: _kPrimary.withValues(alpha: 0.18)),
          ),
          child: Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: _kPrimary.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(999),
                ),
                child: const Icon(
                  Icons.notifications_active_outlined,
                  size: 16,
                  color: _kPrimary,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      notice.senderName,
                      style: const TextStyle(
                        fontSize: 12.5,
                        fontWeight: FontWeight.w700,
                        color: _kTextPrimary,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      notice.preview,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12,
                        color: _kTextSecondary,
                        height: 1.35,
                      ),
                    ),
                  ],
                ),
              ),
              TextButton(
                onPressed: () =>
                    context.read<MessagesController>().clearIncomingNotice(),
                style: TextButton.styleFrom(
                  foregroundColor: _kPrimary,
                  minimumSize: const Size(0, 34),
                  padding: const EdgeInsets.symmetric(horizontal: 10),
                ),
                child: const Text('Dismiss'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final Message message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 26,
            height: 26,
            decoration: BoxDecoration(
              color: const Color(0xFFE9EEF9),
              borderRadius: BorderRadius.circular(9),
            ),
            alignment: Alignment.center,
            child: Text(
              message.senderName.trim().isNotEmpty
                  ? message.senderName.trim()[0].toUpperCase()
                  : '?',
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: _kPrimary,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        message.senderName,
                        style: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w700,
                          color: _kTextPrimary,
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Text(
                      _formatTime(message.createdAt),
                      style: const TextStyle(fontSize: 11, color: _kTextMuted),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: _kSurface,
                    borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
                    border: Border.all(color: _kBorder),
                    boxShadow: const [
                      BoxShadow(
                        color: Color(0x081F2937),
                        blurRadius: 14,
                        offset: Offset(0, 5),
                      ),
                    ],
                  ),
                  child: Text(
                    message.content,
                    style: const TextStyle(
                      fontSize: 13,
                      color: _kTextPrimary,
                      height: 1.35,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  String _formatTime(DateTime dt) {
    final hour = dt.hour > 12
        ? dt.hour - 12
        : dt.hour == 0
        ? 12
        : dt.hour;
    final minute = dt.minute.toString().padLeft(2, '0');
    final period = dt.hour >= 12 ? 'PM' : 'AM';
    return '$hour:$minute $period';
  }
}

class _ReplyArea extends StatelessWidget {
  const _ReplyArea({required this.messageController, required this.onSend});

  final TextEditingController messageController;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(18, 14, 18, 18),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: _kDivider)),
        color: _kSurface,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Row(
            children: [
              Text(
                'Reply',
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: _kTextPrimary,
                ),
              ),
              Spacer(),
              Text(
                'Cmd + Enter to send',
                style: TextStyle(fontSize: 11, color: _kTextMuted),
              ),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: messageController,
            style: const TextStyle(fontSize: 13, color: _kTextPrimary),
            maxLines: 4,
            minLines: 2,
            decoration: InputDecoration(
              hintText: 'Write a message\u2026',
              hintStyle: const TextStyle(color: _kTextMuted, fontSize: 13),
              isDense: true,
              filled: true,
              fillColor: _kCanvas.withValues(alpha: 0.6),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 12,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
                borderSide: const BorderSide(color: _kBorder),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
                borderSide: const BorderSide(color: _kBorder),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmTokens.radiusM),
                borderSide: const BorderSide(color: _kPrimary),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: onSend,
              style: FilledButton.styleFrom(
                backgroundColor: _kPrimary,
                padding: const EdgeInsets.symmetric(
                  horizontal: 22,
                  vertical: 12,
                ),
                minimumSize: const Size(88, 40),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
              child: const Text(
                'Send',
                style: TextStyle(
                  fontSize: 13,
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// New thread dialog
// ---------------------------------------------------------------------------

class _NewThreadDialog extends StatefulWidget {
  const _NewThreadDialog({required this.onCreated});

  final Future<void> Function(
    List<int> participantIds,
    String? title,
    String threadType,
  )
  onCreated;

  @override
  State<_NewThreadDialog> createState() => _NewThreadDialogState();
}

class _NewThreadDialogState extends State<_NewThreadDialog> {
  final _titleController = TextEditingController();
  final Set<int> _selectedUserIds = <int>{};
  String _threadType = 'direct';

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<MessagesController>().loadUsers();
    });
  }

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
  }

  bool get _isGroup => _threadType == 'group';

  bool get _canSubmit {
    if (_selectedUserIds.isEmpty) return false;
    if (_isGroup && _titleController.text.trim().isEmpty) return false;
    if (!_isGroup && _selectedUserIds.length != 1) return false;
    return true;
  }

  Future<void> _submit() async {
    if (!_canSubmit) return;
    final title = _titleController.text.trim();
    await widget.onCreated(
      _selectedUserIds.toList()..sort(),
      title.isEmpty ? null : title,
      _threadType,
    );
    if (!mounted) return;
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final controller = context.watch<MessagesController>();
    final users = controller.users;
    return AlertDialog(
      backgroundColor: _kSurface,
      surfaceTintColor: _kSurface,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(RhythmTokens.radiusL),
        side: const BorderSide(color: _kBorder),
      ),
      title: Text(
        _isGroup ? 'New Group Thread' : 'New Direct Message',
        style: const TextStyle(
          fontSize: 17,
          fontWeight: FontWeight.w700,
          color: _kTextPrimary,
        ),
      ),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Thread type toggle
            Container(
              decoration: BoxDecoration(
                color: _kSurfaceMuted,
                borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                border: Border.all(color: _kDivider),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: _TypeToggleButton(
                      label: 'Direct',
                      selected: !_isGroup,
                      onTap: () => setState(() {
                        _threadType = 'direct';
                        // keep only first selection if switching to direct
                        if (_selectedUserIds.length > 1) {
                          final first = _selectedUserIds.first;
                          _selectedUserIds
                            ..clear()
                            ..add(first);
                        }
                      }),
                    ),
                  ),
                  Expanded(
                    child: _TypeToggleButton(
                      label: 'Group',
                      selected: _isGroup,
                      onTap: () => setState(() => _threadType = 'group'),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _titleController,
              autofocus: !_isGroup,
              style: const TextStyle(fontSize: 14, color: _kTextPrimary),
              decoration: InputDecoration(
                labelText: _isGroup
                    ? 'Group name (required)'
                    : 'Optional title',
                hintText: _isGroup
                    ? 'e.g. Worship Team'
                    : 'Defaults to participant name',
                filled: true,
                fillColor: _kSurfaceMuted,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                  borderSide: const BorderSide(color: _kDivider),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
                  borderSide: const BorderSide(color: _kPrimary),
                ),
              ),
              onChanged: (_) => setState(() {}),
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 12),
            if (!_isGroup)
              Text(
                'Select one person',
                style: TextStyle(fontSize: 11, color: _kTextMuted),
              )
            else
              Text(
                'Select participants (2 or more)',
                style: TextStyle(fontSize: 11, color: _kTextMuted),
              ),
            const SizedBox(height: 6),
            if (users.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 16),
                child: Text(
                  'No users available.',
                  style: TextStyle(color: _kTextMuted),
                ),
              )
            else
              SizedBox(
                height: 200,
                child: ListView.builder(
                  itemCount: users.length,
                  itemBuilder: (context, index) {
                    final user = users[index];
                    final isSelected = _selectedUserIds.contains(user.id);
                    return CheckboxListTile(
                      value: isSelected,
                      activeColor: _kPrimary,
                      title: Text(
                        user.name,
                        style: const TextStyle(
                          fontWeight: FontWeight.w600,
                          color: _kTextPrimary,
                        ),
                      ),
                      subtitle: Text(
                        user.email,
                        style: const TextStyle(color: _kTextMuted),
                      ),
                      controlAffinity: ListTileControlAffinity.leading,
                      onChanged: (value) {
                        setState(() {
                          if (value == true) {
                            if (!_isGroup) _selectedUserIds.clear();
                            _selectedUserIds.add(user.id);
                          } else {
                            _selectedUserIds.remove(user.id);
                          }
                        });
                      },
                    );
                  },
                ),
              ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel', style: TextStyle(color: _kTextSecondary)),
        ),
        FilledButton(
          onPressed: _canSubmit ? _submit : null,
          style: FilledButton.styleFrom(backgroundColor: _kPrimary),
          child: const Text('Create', style: TextStyle(color: Colors.white)),
        ),
      ],
    );
  }
}

class _TypeToggleButton extends StatelessWidget {
  const _TypeToggleButton({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 140),
        padding: const EdgeInsets.symmetric(vertical: 8),
        decoration: BoxDecoration(
          color: selected ? _kPrimary : Colors.transparent,
          borderRadius: BorderRadius.circular(RhythmTokens.radiusS),
        ),
        alignment: Alignment.center,
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: selected ? Colors.white : _kTextSecondary,
          ),
        ),
      ),
    );
  }
}
