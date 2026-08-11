import 'dart:async';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../../app/core/errors/app_error.dart';
import '../../live_artifacts/data/live_artifacts_data_source.dart';
import '../../live_artifacts/controllers/live_artifacts_controller.dart';
import '../../live_artifacts/models/live_artifact.dart';
import '../../live_artifacts/widgets/live_artifact_view.dart';
import '../models/agent_session_message.dart';
import '../models/transcript_artifact_extractor.dart';

typedef ArtifactTranscriptPage = ({
  List<AgentSessionMessage> messages,
  String? nextCursor,
  bool hasMore,
});

typedef ArtifactTranscriptPageLoader = Future<ArtifactTranscriptPage> Function({
  required String sessionId,
  String? before,
});

typedef ArtifactPreviewBuilder = Widget Function(
  BuildContext context,
  LiveArtifact artifact,
  Key previewKey,
);

class ArtifactsTab extends StatefulWidget {
  const ArtifactsTab({
    super.key,
    required this.sessionId,
    this.userId,
    required this.initialMessages,
    required this.dataSource,
    this.initialCursor,
    this.initialHasMore = false,
    this.loadPage,
    this.previewBuilder,
    this.enableNativeRuntime = true,
    this.onOpenInDashboard,
    this.dashboardController,
    this.onNavigateToDashboard,
    this.debugOnNativeReady,
    this.debugOnViewerDisposed,
  });

  final String sessionId;
  final int? userId;
  final List<AgentSessionMessage> initialMessages;
  final LiveArtifactsDataSource dataSource;
  final String? initialCursor;
  final bool initialHasMore;
  final ArtifactTranscriptPageLoader? loadPage;
  final ArtifactPreviewBuilder? previewBuilder;
  final bool enableNativeRuntime;
  final ValueChanged<LiveArtifact>? onOpenInDashboard;
  final LiveArtifactsController? dashboardController;
  final FutureOr<void> Function()? onNavigateToDashboard;
  final void Function(WebViewController controller, bool inspectableDisabled)?
      debugOnNativeReady;
  final VoidCallback? debugOnViewerDisposed;

  @override
  State<ArtifactsTab> createState() => _ArtifactsTabState();
}

class _ArtifactsTabState extends State<ArtifactsTab> {
  late final List<AgentSessionMessage> _messages;
  List<_ArtifactRow> _rows = const [];
  String? _selectedId;
  String? _cursor;
  late bool _hasMore;
  bool _loading = true;
  bool _loadingHistory = false;
  bool _historyFailed = false;
  int _generation = 0;
  int _identityGeneration = 0;
  int _previewRevision = 0;

  @override
  void initState() {
    super.initState();
    _messages = List.of(widget.initialMessages);
    _cursor = widget.initialCursor;
    _hasMore = widget.initialHasMore;
    unawaited(_initialize());
  }

  @override
  void didUpdateWidget(covariant ArtifactsTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.sessionId != widget.sessionId ||
        oldWidget.userId != widget.userId) {
      _generation++;
      _identityGeneration++;
      _messages
        ..clear()
        ..addAll(widget.initialMessages);
      _rows = const [];
      _selectedId = null;
      _cursor = widget.initialCursor;
      _hasMore = widget.initialHasMore;
      _loading = true;
      _loadingHistory = false;
      _historyFailed = false;
      _previewRevision = 0;
      unawaited(_initialize());
      return;
    }

    final previousReferences = extractTranscriptArtifactReferences(
      sessionId: widget.sessionId,
      messages: _messages,
    );
    final previousSelectedMutation = _mutationIdentity(
      previousReferences,
      _selectedId,
    );
    final byId = {for (final message in _messages) message.id: message};
    for (final message in widget.initialMessages) {
      if (message.sessionId == widget.sessionId) byId[message.id] = message;
    }
    _messages
      ..clear()
      ..addAll(byId.values);
    final nextReferences = extractTranscriptArtifactReferences(
      sessionId: widget.sessionId,
      messages: _messages,
    );
    final nextSelectedMutation = _mutationIdentity(nextReferences, _selectedId);
    if (previousSelectedMutation != null &&
        nextSelectedMutation != previousSelectedMutation) {
      _previewRevision++;
    }
    if (!_sameReferences(previousReferences, nextReferences)) {
      unawaited(_resolveRows());
    }
  }

  Future<void> _initialize() async {
    await _resolveRows();
    if (_hasMore && widget.loadPage != null) await _loadRemainingHistory();
  }

  Future<void> _resolveRows() async {
    final generation = ++_generation;
    final references = extractTranscriptArtifactReferences(
      sessionId: widget.sessionId,
      messages: _messages,
    );
    final previousRows = {for (final row in _rows) row.id: row};
    final rows = await Future.wait(
      references.map((reference) async {
        try {
          final artifact = await widget.dataSource.get(reference.artifactId);
          return _ArtifactRow.ready(artifact);
        } catch (error) {
          return _ArtifactRow.unavailable(
            reference.artifactId,
            _genericStatus(error),
          );
        }
      }),
    );
    if (!mounted || generation != _generation) return;
    setState(() {
      _rows = rows.isEmpty && previousRows.isNotEmpty
          ? previousRows.values.toList(growable: false)
          : rows;
      if (_selectedId == null || !_rows.any((row) => row.id == _selectedId)) {
        _selectedId = _rows.isEmpty ? null : _rows.first.id;
      }
      _loading = false;
    });
  }

  Future<void> _loadRemainingHistory() async {
    final loader = widget.loadPage;
    if (loader == null || _loadingHistory || !_hasMore) return;
    setState(() {
      _loadingHistory = true;
      _historyFailed = false;
    });
    final identityGeneration = _identityGeneration;

    try {
      while (_hasMore) {
        final priorCursor = _cursor;
        final priorMessageIds = _messages.map((message) => message.id).toSet();
        final page = await loader(
          sessionId: widget.sessionId,
          before: priorCursor,
        );
        if (!mounted || identityGeneration != _identityGeneration) return;

        final newMessages = page.messages
            .where(
              (message) =>
                  message.sessionId == widget.sessionId &&
                  !priorMessageIds.contains(message.id),
            )
            .toList(growable: false);
        final cursorAdvanced = page.nextCursor != priorCursor;
        if (newMessages.isEmpty && page.hasMore && !cursorAdvanced) {
          _historyFailed = true;
          break;
        }

        _messages.addAll(newMessages);
        _cursor = page.nextCursor;
        _hasMore = page.hasMore;
      }
    } catch (_) {
      if (mounted && identityGeneration == _identityGeneration) {
        _historyFailed = true;
      }
    } finally {
      if (mounted && identityGeneration == _identityGeneration) {
        await _resolveRows();
        if (mounted) setState(() => _loadingHistory = false);
      }
    }
  }

  @override
  void dispose() {
    _generation++;
    _identityGeneration++;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _rows.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_rows.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'No live artifacts were created or updated in this session.',
                textAlign: TextAlign.center,
              ),
              if (_historyFailed) ...[
                const SizedBox(height: 8),
                TextButton(
                  key: const ValueKey('artifacts-history-retry'),
                  onPressed: _loadRemainingHistory,
                  child: const Text('Retry earlier history'),
                ),
              ],
            ],
          ),
        ),
      );
    }

    _ArtifactRow? selected;
    for (final row in _rows) {
      if (row.id == _selectedId) {
        selected = row;
        break;
      }
    }
    final selectedLabel = selected == null
        ? 'No artifact selected'
        : 'Selected ${selected.title}. Status ${selected.status}';
    return FocusTraversalGroup(
      policy: OrderedTraversalPolicy(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.all(8),
            child: ConstrainedBox(
              key: const ValueKey('artifact-selector-target'),
              constraints: const BoxConstraints(minHeight: 44),
              child: Semantics(
                container: true,
                label: 'Artifact selector. $selectedLabel',
                child: FocusTraversalOrder(
                  order: const NumericFocusOrder(1),
                  child: DropdownButtonFormField<String>(
                    key: const ValueKey('artifact-selector'),
                    initialValue: _selectedId,
                    isExpanded: true,
                    decoration: const InputDecoration(
                      labelText: 'Session artifact',
                    ),
                    items: [
                      for (final row in _rows)
                        DropdownMenuItem(
                          value: row.id,
                          child: Semantics(
                            container: true,
                            label:
                                'Artifact ${row.title}. Status ${row.status}',
                            child: ExcludeSemantics(
                              child: Row(
                                key: ValueKey('artifact-row-${row.id}'),
                                children: [
                                  Expanded(
                                    child: Text(
                                      row.title,
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ),
                                  const SizedBox(width: 8),
                                  Text(row.status),
                                ],
                              ),
                            ),
                          ),
                        ),
                    ],
                    onChanged: (id) => setState(() => _selectedId = id),
                  ),
                ),
              ),
            ),
          ),
          if (_loadingHistory)
            const LinearProgressIndicator(key: ValueKey('artifacts-history')),
          if (_historyFailed)
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Row(
                children: [
                  const Expanded(
                      child: Text('Some earlier history is unavailable.')),
                  TextButton(
                    key: const ValueKey('artifacts-history-retry'),
                    onPressed: _loadRemainingHistory,
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          Expanded(child: _buildPreview(context, selected)),
        ],
      ),
    );
  }

  Widget _buildPreview(BuildContext context, _ArtifactRow? row) {
    if (row?.artifact == null) {
      return Center(
        child: Semantics(
          label: row == null
              ? 'No artifact selected'
              : 'Artifact status: ${row.status}',
          child: Text(row == null ? 'Select an artifact.' : row.status),
        ),
      );
    }
    final artifact = row!.artifact!;
    final previewKey = ValueKey('artifact-preview-${artifact.id}');
    final preview = widget.previewBuilder?.call(
          context,
          artifact,
          previewKey,
        ) ??
        LiveArtifactView(
          key: previewKey,
          artifact: artifact,
          source: widget.dataSource,
          compact: true,
          reloadToken: _previewRevision,
          enableNativeRuntime: widget.enableNativeRuntime,
          debugOnNativeReady: widget.debugOnNativeReady,
          debugOnDisposed: widget.debugOnViewerDisposed,
        );

    if (widget.onOpenInDashboard == null &&
        widget.dashboardController == null) {
      return KeyedSubtree(
        key: ValueKey('artifact-viewer-${widget.sessionId}-${widget.userId}'),
        child: preview,
      );
    }
    return Column(
      children: [
        Align(
          alignment: Alignment.centerRight,
          child: Semantics(
            label: 'Open ${artifact.title} in Dashboard',
            button: true,
            child: ExcludeSemantics(
              child: TextButton.icon(
                key: const ValueKey('artifact-open-dashboard-button'),
                onPressed: () => _openInDashboard(artifact),
                style: TextButton.styleFrom(
                  minimumSize: const Size(44, 44),
                ),
                icon: const Icon(Icons.open_in_new),
                label: const Text('Open in Dashboard'),
              ),
            ),
          ),
        ),
        Expanded(
          child: KeyedSubtree(
            key: ValueKey(
              'artifact-viewer-${widget.sessionId}-${widget.userId}',
            ),
            child: preview,
          ),
        ),
      ],
    );
  }

  Future<void> _openInDashboard(LiveArtifact artifact) async {
    final controller = widget.dashboardController;
    if (controller != null) {
      await controller.open(artifact);
      await widget.onNavigateToDashboard?.call();
      return;
    }
    widget.onOpenInDashboard?.call(artifact);
  }
}

String? _mutationIdentity(
  List<TranscriptArtifactReference> references,
  String? artifactId,
) {
  if (artifactId == null) return null;
  for (final reference in references) {
    if (reference.artifactId == artifactId) {
      return '${reference.messageId}:${reference.partIndex}:${reference.toolName}';
    }
  }
  return null;
}

bool _sameReferences(
  List<TranscriptArtifactReference> left,
  List<TranscriptArtifactReference> right,
) {
  if (left.length != right.length) return false;
  for (var index = 0; index < left.length; index++) {
    if (left[index].artifactId != right[index].artifactId ||
        _mutationIdentity(left, left[index].artifactId) !=
            _mutationIdentity(right, right[index].artifactId)) {
      return false;
    }
  }
  return true;
}

String _genericStatus(Object error) {
  final statusCode = error is AppError ? error.statusCode : null;
  return switch (statusCode) {
    410 => 'Deleted',
    409 => 'Changed',
    _ => 'Unavailable',
  };
}

class _ArtifactRow {
  const _ArtifactRow({
    required this.id,
    required this.title,
    required this.status,
    this.artifact,
  });

  factory _ArtifactRow.ready(LiveArtifact artifact) => _ArtifactRow(
        id: artifact.id,
        title: artifact.title,
        status: 'Available',
        artifact: artifact,
      );

  factory _ArtifactRow.unavailable(String id, String status) => _ArtifactRow(
        id: id,
        title: 'Artifact $id',
        status: status,
      );

  final String id;
  final String title;
  final String status;
  final LiveArtifact? artifact;
}
