/// OCU-21 (#1062) — Inspector Files tab: browse + preview.
///
/// A single-pane Finder-style browser rooted at the session's directory
/// (worktree dir when isolated — the server resolves that, this widget only
/// ever deals in session-relative paths). Tapping a directory navigates into
/// it; tapping a file swaps the pane to a read-only preview (text/image/binary
/// stub) with a "back" affordance. Git-aware status dots come from the
/// file/status proxy. Manual refresh only — no watcher-driven live refresh
/// (explicitly out of scope for this issue).
library;

import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agents_controller.dart';
import '../models/agent_session.dart';

class FilesTab extends StatefulWidget {
  const FilesTab({super.key, required this.session});

  final AgentSession session;

  @override
  State<FilesTab> createState() => _FilesTabState();
}

class _FilesTabState extends State<FilesTab> {
  String _path = '.';
  List<Map<String, dynamic>> _entries = const [];
  bool _loading = false;
  String? _error;
  Map<String, String> _statusByPath = const {};

  String? _previewPath;
  Map<String, dynamic>? _previewContent;
  bool _previewLoading = false;
  String? _previewError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(FilesTab old) {
    super.didUpdateWidget(old);
    if (old.session.id != widget.session.id) {
      _path = '.';
      _previewPath = null;
      _previewContent = null;
      _previewError = null;
      _load();
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    final controller = context.read<AgentsController>();
    try {
      final results = await Future.wait([
        controller.listSessionFiles(widget.session.id, path: _path),
        controller.filesGitStatus(widget.session.id),
      ]);
      if (!mounted) return;
      final entries = List<Map<String, dynamic>>.of(results[0])
        ..sort((a, b) {
          final aDir = a['type'] == 'directory';
          final bDir = b['type'] == 'directory';
          if (aDir != bDir) return aDir ? -1 : 1;
          return ((a['name'] as String?) ?? '').compareTo(
            (b['name'] as String?) ?? '',
          );
        });
      final status = <String, String>{
        for (final e in results[1])
          if (e['path'] is String && e['status'] is String)
            e['path'] as String: e['status'] as String,
      };
      setState(() {
        _entries = entries;
        _statusByPath = status;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  void _openDir(String relPath) {
    setState(() => _path = relPath.isEmpty ? '.' : relPath);
    _load();
  }

  void _up() {
    if (_path == '.') return;
    final parts = _path.split('/')..removeLast();
    _openDir(parts.isEmpty ? '.' : parts.join('/'));
  }

  Future<void> _preview(String relPath) async {
    setState(() {
      _previewPath = relPath;
      _previewLoading = true;
      _previewError = null;
      _previewContent = null;
    });
    final controller = context.read<AgentsController>();
    try {
      final content = await controller.fetchFileContent(
        widget.session.id,
        relPath,
      );
      if (!mounted) return;
      setState(() {
        _previewContent = content;
        _previewLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _previewLoading = false;
        _previewError = e.toString();
      });
    }
  }

  void _closePreview() {
    setState(() {
      _previewPath = null;
      _previewContent = null;
      _previewError = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    return _previewPath != null ? _buildPreview(context) : _buildList(context);
  }

  Widget _buildList(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: context.rhythm.borderSubtle),
            ),
          ),
          child: Row(
            children: [
              IconButton(
                key: const ValueKey('files-tab-up-button'),
                onPressed: _path == '.' ? null : _up,
                icon: const Icon(Icons.arrow_upward, size: 16),
                visualDensity: VisualDensity.compact,
                tooltip: 'Up',
              ),
              Expanded(
                child: Text(
                  _path,
                  key: const ValueKey('files-tab-breadcrumb'),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 11,
                    fontFamily: 'JetBrainsMono',
                    color: context.rhythm.textMuted,
                  ),
                ),
              ),
              IconButton(
                key: const ValueKey('files-tab-refresh-button'),
                onPressed: _load,
                icon: const Icon(Icons.refresh, size: 16),
                visualDensity: VisualDensity.compact,
                tooltip: 'Refresh',
              ),
            ],
          ),
        ),
        Expanded(child: _buildListBody(context)),
      ],
    );
  }

  Widget _buildListBody(BuildContext context) {
    if (_loading && _entries.isEmpty) {
      return Center(
        child: CircularProgressIndicator(
          strokeWidth: 2,
          color: context.rhythm.accent,
        ),
      );
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _error!,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: context.rhythm.danger),
          ),
        ),
      );
    }
    if (_entries.isEmpty) {
      return Center(
        child: Text(
          'Empty directory',
          style: TextStyle(fontSize: 13, color: context.rhythm.textMuted),
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.symmetric(vertical: 4),
      itemCount: _entries.length,
      itemBuilder: (context, index) {
        final entry = _entries[index];
        final isDir = entry['type'] == 'directory';
        final name = (entry['name'] as String?) ?? '';
        final relPath = (entry['path'] as String?) ?? name;
        final status = _statusByPath[relPath];
        return InkWell(
          key: ValueKey('files-tab-entry-$relPath'),
          onTap: () => isDir ? _openDir(relPath) : _preview(relPath),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
            child: Row(
              children: [
                Icon(
                  isDir ? Icons.folder_outlined : Icons.description_outlined,
                  size: 15,
                  color: context.rhythm.textSecondary,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    name,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12,
                      color: context.rhythm.textPrimary,
                    ),
                  ),
                ),
                if (status != null) ...[
                  const SizedBox(width: 6),
                  _StatusDot(status: status),
                ],
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildPreview(BuildContext context) {
    final path = _previewPath!;
    final name = path.contains('/') ? path.split('/').last : path;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(color: context.rhythm.borderSubtle),
            ),
          ),
          child: Row(
            children: [
              IconButton(
                key: const ValueKey('files-tab-preview-back-button'),
                onPressed: _closePreview,
                icon: const Icon(Icons.arrow_back, size: 16),
                visualDensity: VisualDensity.compact,
                tooltip: 'Back',
              ),
              Expanded(
                child: Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    fontFamily: 'JetBrainsMono',
                    color: context.rhythm.textPrimary,
                  ),
                ),
              ),
            ],
          ),
        ),
        Expanded(child: _buildPreviewBody(context)),
      ],
    );
  }

  Widget _buildPreviewBody(BuildContext context) {
    if (_previewLoading) {
      return Center(
        child: CircularProgressIndicator(
          strokeWidth: 2,
          color: context.rhythm.accent,
        ),
      );
    }
    // Server refuses >2MB with a 413 AppError — surfaced here as the error
    // message (c.f. acceptance: "Refuses >2MB gracefully with a message").
    if (_previewError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _previewError!,
            key: const ValueKey('files-tab-preview-error'),
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 13, color: context.rhythm.danger),
          ),
        ),
      );
    }
    final content = _previewContent;
    if (content == null) return const SizedBox.shrink();

    if (content['type'] == 'text') {
      return SingleChildScrollView(
        padding: const EdgeInsets.all(12),
        child: SelectableText(
          key: const ValueKey('files-tab-preview-text'),
          (content['content'] as String?) ?? '',
          style: TextStyle(
            fontFamily: 'JetBrainsMono',
            fontSize: 12,
            color: context.rhythm.textPrimary,
          ),
        ),
      );
    }

    final mime = (content['mimeType'] as String?) ?? '';
    if (mime.startsWith('image/')) {
      try {
        final bytes = base64Decode((content['content'] as String?) ?? '');
        return Center(
          child: Image.memory(
            bytes,
            key: const ValueKey('files-tab-preview-image'),
            fit: BoxFit.contain,
          ),
        );
      } catch (_) {
        // Fall through to the binary stub on a decode failure.
      }
    }

    return Center(
      child: Text(
        'Binary file',
        key: const ValueKey('files-tab-preview-binary'),
        style: TextStyle(fontSize: 13, color: context.rhythm.textMuted),
      ),
    );
  }
}

class _StatusDot extends StatelessWidget {
  const _StatusDot({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final r = context.rhythm;
    final color = switch (status) {
      'added' => r.success,
      'deleted' => r.danger,
      'modified' => r.warning,
      _ => r.textMuted,
    };
    return Tooltip(
      message: status,
      child: Container(
        width: 7,
        height: 7,
        decoration: BoxDecoration(color: color, shape: BoxShape.circle),
      ),
    );
  }
}
