import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agent_memory_controller.dart';
import '../models/agent_memory_entry.dart';

class AgentMemoryView extends StatefulWidget {
  const AgentMemoryView({super.key});

  @override
  State<AgentMemoryView> createState() => _AgentMemoryViewState();
}

class _AgentMemoryViewState extends State<AgentMemoryView> {
  final _searchController = TextEditingController();
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AgentMemoryController>().refresh();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    _debounce?.cancel();
    super.dispose();
  }

  void _onSearchChanged(String q) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 300), () {
      context.read<AgentMemoryController>().search(q);
    });
  }

  Future<void> _confirmClearAll(BuildContext context) async {
    final controller = context.read<AgentMemoryController>();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: ctx.rhythm.surface,
        title: Text(
          'Clear all memories?',
          style: TextStyle(color: ctx.rhythm.textPrimary),
        ),
        content: Text(
          'This will permanently delete all stored agent memory entries.',
          style: TextStyle(color: ctx.rhythm.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(
              'Cancel',
              style: TextStyle(color: ctx.rhythm.textMuted),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(
              'Clear all',
              style: TextStyle(color: ctx.rhythm.danger),
            ),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await controller.clearAll();
    }
  }

  Future<void> _confirmDelete(
      BuildContext context, AgentMemoryEntry entry) async {
    final controller = context.read<AgentMemoryController>();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: ctx.rhythm.surface,
        title: Text(
          'Delete memory?',
          style: TextStyle(color: ctx.rhythm.textPrimary),
        ),
        content: Text(
          entry.content.length > 120
              ? '${entry.content.substring(0, 120)}…'
              : entry.content,
          style: TextStyle(color: ctx.rhythm.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: Text(
              'Cancel',
              style: TextStyle(color: ctx.rhythm.textMuted),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: Text(
              'Delete',
              style: TextStyle(color: ctx.rhythm.danger),
            ),
          ),
        ],
      ),
    );
    if (confirmed == true && context.mounted) {
      await controller.delete(entry.id);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AgentMemoryController>(
      builder: (context, controller, _) {
        return Scaffold(
          backgroundColor: context.rhythm.canvas,
          appBar: AppBar(
            backgroundColor: context.rhythm.surface,
            title: Text(
              'Agent Memory',
              style: TextStyle(color: context.rhythm.textPrimary),
            ),
            actions: [
              IconButton(
                icon: Icon(Icons.delete_sweep_outlined,
                    color: context.rhythm.textSecondary),
                tooltip: 'Clear all memories',
                onPressed: controller.entries.isEmpty
                    ? null
                    : () => _confirmClearAll(context),
              ),
            ],
          ),
          body: Column(
            children: [
              // Search bar
              Container(
                color: context.rhythm.surface,
                padding: const EdgeInsets.fromLTRB(
                  RhythmSpacing.md,
                  RhythmSpacing.xs,
                  RhythmSpacing.md,
                  RhythmSpacing.md,
                ),
                child: TextField(
                  controller: _searchController,
                  onChanged: _onSearchChanged,
                  style: TextStyle(color: context.rhythm.textPrimary),
                  decoration: InputDecoration(
                    hintText: 'Search memories…',
                    hintStyle:
                        TextStyle(color: context.rhythm.textMuted),
                    prefixIcon: Icon(Icons.search,
                        color: context.rhythm.textMuted),
                    suffixIcon: _searchController.text.isNotEmpty
                        ? IconButton(
                            icon: Icon(Icons.clear,
                                color: context.rhythm.textMuted),
                            onPressed: () {
                              _searchController.clear();
                              controller.clearSearch();
                            },
                          )
                        : null,
                    filled: true,
                    fillColor:
                        context.rhythm.canvas.withValues(alpha: 0.6),
                    border: OutlineInputBorder(
                      borderRadius:
                          BorderRadius.circular(RhythmRadius.pill),
                      borderSide: BorderSide.none,
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: RhythmSpacing.md,
                      vertical: RhythmSpacing.sm,
                    ),
                  ),
                ),
              ),
              // Body
              Expanded(child: _buildBody(context, controller)),
            ],
          ),
        );
      },
    );
  }

  Widget _buildBody(
      BuildContext context, AgentMemoryController controller) {
    final isLoading = controller.status == AgentMemoryStatus.loading ||
        controller.status == AgentMemoryStatus.searching;

    if (isLoading) {
      return Center(
        child: CircularProgressIndicator(
          color: context.rhythm.accent,
        ),
      );
    }

    if (controller.entries.isEmpty) {
      if (controller.isSearching) {
        return Center(
          child: Text(
            'No results for \'${controller.searchQuery}\'',
            style: TextStyle(color: context.rhythm.textMuted),
          ),
        );
      }
      return Center(
        child: Text(
          'No memories yet',
          style: TextStyle(color: context.rhythm.textMuted),
        ),
      );
    }

    return ListView.builder(
      padding: const EdgeInsets.all(RhythmSpacing.md),
      itemCount: controller.entries.length,
      itemBuilder: (context, index) {
        final entry = controller.entries[index];
        return _MemoryTile(
          entry: entry,
          onDelete: () => _confirmDelete(context, entry),
        );
      },
    );
  }
}

class _MemoryTile extends StatefulWidget {
  const _MemoryTile({
    required this.entry,
    required this.onDelete,
  });

  final AgentMemoryEntry entry;
  final VoidCallback onDelete;

  @override
  State<_MemoryTile> createState() => _MemoryTileState();
}

class _MemoryTileState extends State<_MemoryTile> {
  bool _expanded = false;

  String _formatDate(String iso) {
    if (iso.isEmpty) return '';
    try {
      final dt = DateTime.parse(iso).toLocal();
      return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
    } catch (_) {
      return iso;
    }
  }

  @override
  Widget build(BuildContext context) {
    final entry = widget.entry;
    return GestureDetector(
      onTap: () => setState(() => _expanded = !_expanded),
      onLongPress: widget.onDelete,
      child: Container(
        margin: const EdgeInsets.only(bottom: RhythmSpacing.sm),
        decoration: BoxDecoration(
          color:
              context.rhythm.surfaceRaised.withValues(alpha: 0.92),
          borderRadius: BorderRadius.circular(RhythmRadius.md),
          border: Border.all(color: context.rhythm.borderSubtle),
          boxShadow: RhythmElevation.panel,
        ),
        child: Padding(
          padding: const EdgeInsets.all(RhythmSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Kind badge
              Row(
                children: [
                  _KindBadge(kind: entry.kind),
                  const Spacer(),
                  Icon(
                    _expanded
                        ? Icons.expand_less
                        : Icons.expand_more,
                    size: 18,
                    color: context.rhythm.textMuted,
                  ),
                ],
              ),
              const SizedBox(height: RhythmSpacing.xs),
              // Content
              Text(
                entry.content,
                maxLines: _expanded ? null : 2,
                overflow:
                    _expanded ? TextOverflow.visible : TextOverflow.ellipsis,
                style: TextStyle(
                  color: context.rhythm.textPrimary,
                  fontSize: 14,
                  height: 1.5,
                ),
              ),
              if (entry.tags.isNotEmpty) ...[
                const SizedBox(height: RhythmSpacing.xs),
                Wrap(
                  spacing: RhythmSpacing.xs,
                  runSpacing: RhythmSpacing.xxs,
                  children: entry.tags
                      .map((tag) => _TagChip(tag: tag))
                      .toList(),
                ),
              ],
              const SizedBox(height: RhythmSpacing.xs),
              // Source + date
              Row(
                children: [
                  if (entry.source != null) ...[
                    Icon(Icons.link, size: 12, color: context.rhythm.textMuted),
                    const SizedBox(width: 4),
                    Text(
                      entry.source!,
                      style: TextStyle(
                        color: context.rhythm.textMuted,
                        fontSize: 11,
                      ),
                    ),
                    const SizedBox(width: RhythmSpacing.sm),
                  ],
                  Icon(Icons.schedule,
                      size: 12, color: context.rhythm.textMuted),
                  const SizedBox(width: 4),
                  Text(
                    _formatDate(entry.createdAt),
                    style: TextStyle(
                      color: context.rhythm.textMuted,
                      fontSize: 11,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _KindBadge extends StatelessWidget {
  const _KindBadge({required this.kind});

  final String kind;

  @override
  Widget build(BuildContext context) {
    Color bg;
    Color fg;
    switch (kind) {
      case 'preference':
        bg = context.rhythm.accentMuted;
        fg = context.rhythm.accent;
        break;
      case 'context':
        bg = context.rhythm.info.withValues(alpha: 0.15);
        fg = context.rhythm.info;
        break;
      default: // fact
        bg = context.rhythm.success.withValues(alpha: 0.15);
        fg = context.rhythm.success;
    }
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: RhythmSpacing.xs,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(RhythmRadius.xs),
      ),
      child: Text(
        kind,
        style: TextStyle(
          color: fg,
          fontSize: 11,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

class _TagChip extends StatelessWidget {
  const _TagChip({required this.tag});

  final String tag;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: RhythmSpacing.xs,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.pill),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Text(
        tag,
        style: TextStyle(
          color: context.rhythm.textSecondary,
          fontSize: 11,
        ),
      ),
    );
  }
}
