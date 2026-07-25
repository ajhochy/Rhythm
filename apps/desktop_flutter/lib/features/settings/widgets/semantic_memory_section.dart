import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/semantic_memory_controller.dart';
import '../data/semantic_memory_data_source.dart';

const _engraphInstallGuide = 'https://github.com/devwhodevs/engraph';

typedef SemanticMemoryBinaryPicker = Future<String?> Function();
typedef SemanticMemoryInstallGuideLauncher = Future<bool> Function(Uri uri);

Future<String?> _defaultBinaryPicker() async {
  final selection = await FilePicker.pickFiles(
    allowMultiple: false,
    dialogTitle: 'Choose Engraph',
    type: FileType.any,
  );
  return selection?.files.single.path;
}

Future<bool> _defaultInstallGuideLauncher(Uri uri) {
  return launchUrl(uri, mode: LaunchMode.externalApplication);
}

class SemanticMemorySection extends StatefulWidget {
  const SemanticMemorySection({
    super.key,
    this.controller,
    this.binaryPicker = _defaultBinaryPicker,
    this.installGuideLauncher = _defaultInstallGuideLauncher,
  });

  final SemanticMemoryController? controller;
  final SemanticMemoryBinaryPicker binaryPicker;
  final SemanticMemoryInstallGuideLauncher installGuideLauncher;

  @override
  State<SemanticMemorySection> createState() => _SemanticMemorySectionState();
}

class _SemanticMemorySectionState extends State<SemanticMemorySection> {
  late final SemanticMemoryController _controller;
  late final bool _ownsController;

  @override
  void initState() {
    super.initState();
    _ownsController = widget.controller == null;
    _controller = widget.controller ??
        SemanticMemoryController(SemanticMemoryDataSource());
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _controller.initialize();
    });
  }

  @override
  void dispose() {
    if (_ownsController) _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final status = _controller.status;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'SEMANTIC MEMORY',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textSecondary,
                letterSpacing: 0.8,
              ),
            ),
            const SizedBox(height: 12),
            Container(
              key: const Key('semantic-memory-section'),
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: context.rhythm.surfaceRaised,
                borderRadius: BorderRadius.circular(RhythmRadius.xl),
                border: Border.all(color: context.rhythm.borderSubtle),
                boxShadow: RhythmElevation.panel,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Semantic Memory',
                              style: TextStyle(
                                fontWeight: FontWeight.w600,
                                color: context.rhythm.textPrimary,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Optional, private search that helps Rhythm find related memories on this Mac. '
                              'It is fail-safe: standard memory search remains active.',
                              style: TextStyle(
                                fontSize: 13,
                                height: 1.4,
                                color: context.rhythm.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: 16),
                      _StateBadge(
                        label: _controller.stateLabel,
                        state: _controller.displayState,
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  Semantics(
                    liveRegion: true,
                    label:
                        'Semantic Memory status: ${_controller.stateLabel}. ${_controller.stateDescription}',
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (_controller.isBusy || (status?.isWorking ?? false))
                          const Padding(
                            padding: EdgeInsets.only(top: 2),
                            child: SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            ),
                          )
                        else
                          Icon(
                            _statusIcon(_controller.displayState),
                            size: 18,
                            color: _statusColor(
                              context,
                              _controller.displayState,
                            ),
                          ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            _controller.stateDescription,
                            key: const Key('semantic-memory-status-copy'),
                            style: TextStyle(
                              fontSize: 13,
                              height: 1.4,
                              color: _controller.displayState == 'error'
                                  ? context.rhythm.danger
                                  : context.rhythm.textSecondary,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                  if (status?.version != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      'Engraph ${status!.version}',
                      style: TextStyle(
                        fontSize: 12,
                        color: context.rhythm.textMuted,
                      ),
                    ),
                  ],
                  const SizedBox(height: 18),
                  Wrap(
                    spacing: 10,
                    runSpacing: 10,
                    children: _buildActions(context),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  List<Widget> _buildActions(BuildContext context) {
    final status = _controller.status;
    final enabled = status?.enabled ?? false;
    final ready = _controller.displayState == 'ready';
    final failed = _controller.displayState == 'error';
    final busy = _controller.isBusy;

    return [
      if (!enabled)
        FilledButton.icon(
          key: const Key('semantic-memory-enable'),
          onPressed: busy ? null : _controller.enable,
          icon: const Icon(Icons.auto_awesome, size: 16),
          label: Text(
            _controller.hasDetectedCandidate && !_controller.hasExecutable
                ? 'Use detected Engraph'
                : 'Enable',
          ),
        ),
      if (enabled)
        OutlinedButton.icon(
          key: const Key('semantic-memory-disable'),
          onPressed: busy ? null : _controller.disable,
          icon: const Icon(Icons.pause_circle_outline, size: 16),
          label: const Text('Disable'),
        ),
      if (ready)
        OutlinedButton.icon(
          key: const Key('semantic-memory-health'),
          onPressed: busy ? null : _controller.checkHealth,
          icon: const Icon(Icons.health_and_safety_outlined, size: 16),
          label: const Text('Check health'),
        ),
      if (failed)
        OutlinedButton.icon(
          key: const Key('semantic-memory-retry'),
          onPressed: busy ? null : _controller.retry,
          icon: const Icon(Icons.refresh, size: 16),
          label: const Text('Retry'),
        ),
      OutlinedButton.icon(
        key: const Key('semantic-memory-choose'),
        onPressed: busy ? null : _chooseBinary,
        icon: const Icon(Icons.folder_open_outlined, size: 16),
        label: const Text('Choose Engraph'),
      ),
      TextButton.icon(
        key: const Key('semantic-memory-install-guide'),
        onPressed: _openInstallGuide,
        icon: const Icon(Icons.open_in_new, size: 16),
        label: const Text('Install guide'),
      ),
      if (ready)
        TextButton.icon(
          key: const Key('semantic-memory-rebuild'),
          onPressed: busy ? null : () => _confirmRebuild(context),
          icon: const Icon(Icons.replay_outlined, size: 16),
          label: const Text('Rebuild index'),
        ),
    ];
  }

  Future<void> _chooseBinary() async {
    final path = await widget.binaryPicker();
    if (path == null || path.trim().isEmpty) return;
    await _controller.chooseBinary(path);
  }

  Future<void> _openInstallGuide() async {
    await widget.installGuideLauncher(Uri.parse(_engraphInstallGuide));
  }

  Future<void> _confirmRebuild(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Rebuild Semantic Memory?'),
        content: const Text(
          "This replaces only Rhythm's private Application Support index. "
          'Your memory notes and any other Engraph setup are not changed.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            key: const Key('semantic-memory-confirm-rebuild'),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Rebuild'),
          ),
        ],
      ),
    );
    if (confirmed == true) await _controller.rebuild();
  }

  IconData _statusIcon(String? state) {
    switch (state) {
      case 'ready':
        return Icons.check_circle_outline;
      case 'error':
        return Icons.error_outline;
      case 'disabled':
      default:
        return Icons.shield_outlined;
    }
  }

  Color _statusColor(BuildContext context, String? state) {
    switch (state) {
      case 'ready':
        return context.rhythm.success;
      case 'error':
        return context.rhythm.danger;
      default:
        return context.rhythm.textMuted;
    }
  }
}

class _StateBadge extends StatelessWidget {
  const _StateBadge({
    required this.label,
    required this.state,
  });

  final String label;
  final String state;

  @override
  Widget build(BuildContext context) {
    final color = switch (state) {
      'ready' => context.rhythm.success,
      'error' => context.rhythm.danger,
      'indexing' || 'starting' || 'discovering' => context.rhythm.accent,
      _ => context.rhythm.textMuted,
    };
    return Semantics(
      label: 'Status: $label',
      child: Container(
        key: Key('semantic-memory-state-$state'),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: 0.35)),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: color,
          ),
        ),
      ),
    );
  }
}
