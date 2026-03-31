import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../controllers/messages_controller.dart';
import '../models/message.dart';
import '../models/message_thread.dart';

// ---------------------------------------------------------------------------
// Theme tokens (Rhythm 2.0 Light)
// ---------------------------------------------------------------------------
const _kSidebarBg = Color(0xFFF8F9FA);
const _kSidebarBorder = Color(0xFFE5E7EB);
const _kPrimary = Color(0xFF4F6AF5);
const _kTextPrimary = Color(0xFF111827);
const _kTextSecondary = Color(0xFF6B7280);
const _kTextMuted = Color(0xFF9CA3AF);
const _kDivider = Color(0xFFE5E7EB);

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
      context.read<MessagesController>().loadThreads();
    });
    _searchController.addListener(() {
      setState(() => _searchQuery = _searchController.text.toLowerCase());
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: Row(
        children: [
          _ThreadListPanel(
            searchController: _searchController,
            searchQuery: _searchQuery,
          ),
          const VerticalDivider(width: 1, color: _kSidebarBorder),
          const Expanded(child: _MessagePanel()),
        ],
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
      width: 280,
      color: _kSidebarBg,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _PanelHeader(
            onNewThread: () => _showNewThreadDialog(context),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            child: _SearchField(controller: searchController),
          ),
          const Divider(height: 1, color: _kDivider),
          Expanded(
            child: controller.status == MessagesStatus.loading &&
                    controller.threads.isEmpty
                ? const Center(
                    child: CircularProgressIndicator(color: _kPrimary))
                : filtered.isEmpty
                    ? const Center(
                        child: Text(
                          'No conversations',
                          style: TextStyle(color: _kTextMuted, fontSize: 13),
                        ),
                      )
                    : ListView.builder(
                        itemCount: filtered.length,
                        itemBuilder: (context, i) => _ThreadRow(
                          thread: filtered[i],
                          isSelected:
                              controller.selectedThreadId == filtered[i].id,
                          onTap: () =>
                              context.read<MessagesController>().selectThread(
                                    filtered[i].id,
                                  ),
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
        onCreated: (title) =>
            context.read<MessagesController>().createThread(title),
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
      padding: const EdgeInsets.fromLTRB(16, 16, 12, 4),
      child: Row(
        children: [
          const Expanded(
            child: Text(
              'Messages',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: _kTextPrimary,
              ),
            ),
          ),
          TextButton(
            onPressed: onNewThread,
            style: TextButton.styleFrom(
              foregroundColor: _kPrimary,
              minimumSize: const Size(40, 32),
              padding: const EdgeInsets.symmetric(horizontal: 10),
            ),
            child: const Text('New', style: TextStyle(fontSize: 13)),
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
        fillColor: Colors.white,
        contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: _kDivider),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
          borderSide: const BorderSide(color: _kDivider),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(8),
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
  });

  final MessageThread thread;
  final bool isSelected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected ? const Color(0x144F6AF5) : Colors.transparent,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          thread.title,
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: thread.hasRecentActivity
                                ? FontWeight.w600
                                : FontWeight.w400,
                            color: _kTextPrimary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        _formatTimestamp(thread.updatedAt),
                        style: const TextStyle(
                          fontSize: 11,
                          color: _kTextMuted,
                        ),
                      ),
                    ],
                  ),
                  if (thread.lastMessage != null) ...[
                    const SizedBox(height: 2),
                    Text(
                      thread.lastMessage!,
                      style: const TextStyle(
                        fontSize: 12,
                        color: _kTextSecondary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            if (thread.hasRecentActivity) ...[
              const SizedBox(width: 8),
              Container(
                width: 8,
                height: 8,
                margin: const EdgeInsets.only(top: 3),
                decoration: const BoxDecoration(
                  color: _kPrimary,
                  shape: BoxShape.circle,
                ),
              ),
            ],
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

// ---------------------------------------------------------------------------
// Right panel — message thread content
// ---------------------------------------------------------------------------

class _MessagePanel extends StatefulWidget {
  const _MessagePanel();

  @override
  State<_MessagePanel> createState() => _MessagePanelState();
}

class _MessagePanelState extends State<_MessagePanel> {
  final _senderController = TextEditingController();
  final _messageController = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void dispose() {
    _senderController.dispose();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _sendMessage(BuildContext context) {
    final threadId = context.read<MessagesController>().selectedThreadId;
    if (threadId == null) return;

    final sender = _senderController.text.trim();
    final content = _messageController.text.trim();
    if (sender.isEmpty || content.isEmpty) return;

    context
        .read<MessagesController>()
        .sendMessage(threadId, sender, content)
        .then((_) {
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

    if (controller.selectedThreadId == null) {
      return const Center(
        child: Text(
          'Select a conversation',
          style: TextStyle(color: _kTextMuted, fontSize: 14),
        ),
      );
    }

    final thread = controller.selectedThread;

    return Column(
      children: [
        // Header
        Container(
          height: 56,
          padding: const EdgeInsets.symmetric(horizontal: 20),
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: _kDivider)),
          ),
          child: Align(
            alignment: Alignment.centerLeft,
            child: Text(
              thread?.title ?? '',
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w600,
                color: _kTextPrimary,
              ),
            ),
          ),
        ),
        // Message list
        Expanded(
          child: controller.messages.isEmpty
              ? const Center(
                  child: Text(
                    'No messages yet. Say something!',
                    style: TextStyle(color: _kTextMuted, fontSize: 13),
                  ),
                )
              : ListView.builder(
                  controller: _scrollController,
                  padding: const EdgeInsets.all(16),
                  itemCount: controller.messages.length,
                  itemBuilder: (context, i) =>
                      _MessageBubble(message: controller.messages[i]),
                ),
        ),
        // Reply area
        _ReplyArea(
          senderController: _senderController,
          messageController: _messageController,
          onSend: () => _sendMessage(context),
        ),
      ],
    );
  }
}

class _MessageBubble extends StatelessWidget {
  const _MessageBubble({required this.message});

  final Message message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                message.senderName,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: _kTextPrimary,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                _formatTime(message.createdAt),
                style: const TextStyle(
                  fontSize: 11,
                  color: _kTextMuted,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
            decoration: BoxDecoration(
              color: const Color(0xFFF3F4F6),
              borderRadius: BorderRadius.circular(8),
            ),
            child: Text(
              message.content,
              style: const TextStyle(
                fontSize: 13,
                color: _kTextPrimary,
              ),
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
  const _ReplyArea({
    required this.senderController,
    required this.messageController,
    required this.onSend,
  });

  final TextEditingController senderController;
  final TextEditingController messageController;
  final VoidCallback onSend;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: _kDivider)),
        color: Colors.white,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: senderController,
            style: const TextStyle(fontSize: 13, color: _kTextPrimary),
            decoration: InputDecoration(
              hintText: 'Your name',
              hintStyle: const TextStyle(color: _kTextMuted, fontSize: 13),
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(6),
                borderSide: const BorderSide(color: _kDivider),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(6),
                borderSide: const BorderSide(color: _kDivider),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(6),
                borderSide: const BorderSide(color: _kPrimary),
              ),
            ),
          ),
          const SizedBox(height: 8),
          KeyboardListener(
            focusNode: FocusNode(),
            onKeyEvent: (event) {
              if (event is KeyDownEvent &&
                  event.logicalKey == LogicalKeyboardKey.enter &&
                  HardwareKeyboard.instance.isMetaPressed) {
                onSend();
              }
            },
            child: TextField(
              controller: messageController,
              style: const TextStyle(fontSize: 13, color: _kTextPrimary),
              maxLines: 3,
              minLines: 2,
              decoration: InputDecoration(
                hintText: 'Write a message\u2026',
                hintStyle: const TextStyle(color: _kTextMuted, fontSize: 13),
                isDense: true,
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(6),
                  borderSide: const BorderSide(color: _kDivider),
                ),
                enabledBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(6),
                  borderSide: const BorderSide(color: _kDivider),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(6),
                  borderSide: const BorderSide(color: _kPrimary),
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: onSend,
              style: FilledButton.styleFrom(
                backgroundColor: _kPrimary,
                padding:
                    const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                minimumSize: const Size(80, 36),
              ),
              child: const Text(
                'Send',
                style: TextStyle(fontSize: 13, color: Colors.white),
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

  final ValueChanged<String> onCreated;

  @override
  State<_NewThreadDialog> createState() => _NewThreadDialogState();
}

class _NewThreadDialogState extends State<_NewThreadDialog> {
  final _titleController = TextEditingController();

  @override
  void dispose() {
    _titleController.dispose();
    super.dispose();
  }

  void _submit() {
    final title = _titleController.text.trim();
    if (title.isEmpty) return;
    widget.onCreated(title);
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text(
        'New Conversation',
        style: TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
      ),
      content: SizedBox(
        width: 360,
        child: TextField(
          controller: _titleController,
          autofocus: true,
          style: const TextStyle(fontSize: 14),
          decoration: InputDecoration(
            labelText: 'Thread title',
            hintText: 'e.g. Sunday setup crew',
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: _kPrimary),
            ),
          ),
          onSubmitted: (_) => _submit(),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel', style: TextStyle(color: _kTextSecondary)),
        ),
        FilledButton(
          onPressed: _submit,
          style: FilledButton.styleFrom(backgroundColor: _kPrimary),
          child: const Text('Create', style: TextStyle(color: Colors.white)),
        ),
      ],
    );
  }
}
