import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../settings/services/destructive_modal_service.dart';
import '../controllers/agents_controller.dart';

/// M3-6 / #608: inline permission card surfaced in the chat thread when opencode
/// emits a `permission.asked` event.
///
/// When [DestructiveModalService.enabled] is true and the tool is in the
/// destructive set (bash, write, edit), this card is shown as a modal dialog
/// overlay rather than inline. Otherwise it renders inline above the composer.
///
/// Auto-denies after [timeout] (default 60s) if the user doesn't respond.
class PermissionCard extends StatefulWidget {
  const PermissionCard({
    super.key,
    required this.sessionId,
    required this.permissionId,
    required this.title,
    this.toolName,
    this.description,
    this.initialError,
    this.timeout = const Duration(seconds: 60),
  });

  final String sessionId;
  final String permissionId;
  final String title;
  final String? toolName;
  final String? description;
  final String? initialError;
  final Duration timeout;

  @override
  State<PermissionCard> createState() => _PermissionCardState();
}

class _PermissionCardState extends State<PermissionCard> {
  static const _destructiveTools = {'bash', 'write', 'edit', 'patch'};

  late DateTime _deadline;
  Timer? _tick;
  bool _responded = false;
  bool _submitting = false;
  bool _autoDenied = false;
  String? _error;
  Duration _remaining = Duration.zero;
  bool _modalShown = false;
  bool _showDenyReason = false;
  final _denyReasonController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _deadline = DateTime.now().add(widget.timeout);
    _remaining = widget.timeout;
    _error = widget.initialError;
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      final left = _deadline.difference(DateTime.now());
      if (left.isNegative && !_responded && !_submitting) {
        _respond('deny', auto: true);
      } else {
        setState(() => _remaining = left);
      }
    });
  }

  @override
  void didUpdateWidget(PermissionCard oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialError != oldWidget.initialError &&
        widget.initialError != null) {
      _error = widget.initialError;
    }
  }

  @override
  void dispose() {
    _tick?.cancel();
    _denyReasonController.dispose();
    super.dispose();
  }

  bool get _isDestructive =>
      widget.toolName != null &&
      _destructiveTools.contains(widget.toolName!.toLowerCase());

  /// Reveals the deny-reason field instead of denying immediately. The user
  /// can still submit with an empty reason (skippable).
  void _revealDenyReason() {
    if (_responded || _submitting) return;
    setState(() => _showDenyReason = true);
  }

  Future<void> _respond(
    String decision, {
    bool auto = false,
    String? reason,
  }) async {
    if (_responded || _submitting) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    _tick?.cancel();
    if (!mounted) return;
    final controller = context.read<AgentsController>();
    try {
      if (decision == 'accept') {
        await controller.acceptPermission(
          widget.sessionId,
          widget.permissionId,
        );
      } else if (decision == 'always') {
        await controller.alwaysAllowPermission(
          widget.sessionId,
          widget.permissionId,
        );
      } else {
        await controller.denyPermission(
          widget.sessionId,
          widget.permissionId,
          reason: (reason != null && reason.trim().isNotEmpty)
              ? reason.trim()
              : null,
        );
      }
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _responded = true;
        _autoDenied = auto;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _submitting = false;
        _autoDenied = false;
        _modalShown = false;
        _deadline = DateTime.now().add(widget.timeout);
        _remaining = widget.timeout;
      });
      _tick = Timer.periodic(const Duration(seconds: 1), (_) {
        if (!mounted) return;
        final left = _deadline.difference(DateTime.now());
        if (left.isNegative && !_responded && !_submitting) {
          _respond('deny', auto: true);
        } else {
          setState(() => _remaining = left);
        }
      });
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Elevate to modal when destructive-modal toggle is on and tool is destructive.
    if (_modalShown || _responded || _submitting) return;
    final destructiveModal = context.watch<DestructiveModalService>();
    if (destructiveModal.enabled && _isDestructive) {
      _modalShown = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || _responded) return;
        showDialog<Map<String, String?>>(
          context: context,
          barrierDismissible: false,
          builder: (_) => _PermissionModalDialog(
            title: widget.title,
            description: widget.description,
            remaining: _remaining,
          ),
        ).then((result) {
          if (result != null && mounted) {
            _respond(result['decision']!, reason: result['reason']);
          }
        });
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_autoDenied) {
      return _Stub(text: 'Denied (timeout)', color: context.rhythm.textMuted);
    }
    if (_responded && _error == null) {
      return const SizedBox.shrink();
    }
    // When the modal path is used, don't render the inline card.
    if (_modalShown) {
      return const SizedBox.shrink();
    }
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: context.rhythm.canvas,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: context.rhythm.accent),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.security, size: 16, color: context.rhythm.accent),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  widget.title,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: context.rhythm.textPrimary,
                  ),
                ),
              ),
              Text(
                '${_remaining.inSeconds}s',
                style: TextStyle(fontSize: 11, color: context.rhythm.textMuted),
              ),
            ],
          ),
          if (widget.description != null) ...[
            const SizedBox(height: 6),
            Text(
              widget.description!,
              style: TextStyle(
                fontSize: 11,
                color: context.rhythm.textSecondary,
              ),
            ),
          ],
          if (_error != null) ...[
            const SizedBox(height: 6),
            Text(_error!, style: const TextStyle(color: Color(0xFFEF4444))),
          ],
          if (_showDenyReason) ...[
            const SizedBox(height: 8),
            TextField(
              controller: _denyReasonController,
              autofocus: true,
              decoration: const InputDecoration(
                isDense: true,
                hintText: 'Reason (optional)',
              ),
              style: const TextStyle(fontSize: 12),
              onSubmitted: (value) => _respond('deny', reason: value),
            ),
          ],
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              if (_showDenyReason)
                FilledButton(
                  onPressed: _submitting
                      ? null
                      : () => _respond(
                            'deny',
                            reason: _denyReasonController.text,
                          ),
                  child: _submitting
                      ? const SizedBox.square(
                          dimension: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Submit'),
                )
              else ...[
                TextButton(
                  onPressed: _submitting ? null : _revealDenyReason,
                  child: const Text('Deny'),
                ),
                const SizedBox(width: 6),
                TextButton(
                  key: const Key('permission_always_allow'),
                  onPressed: _submitting ? null : () => _respond('always'),
                  child: const Text('Always allow'),
                ),
                const SizedBox(width: 6),
                FilledButton(
                  onPressed: _submitting ? null : () => _respond('accept'),
                  child: _submitting
                      ? const SizedBox.square(
                          dimension: 14,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Accept'),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

class _Stub extends StatelessWidget {
  const _Stub({required this.text, required this.color});
  final String text;
  final Color color;
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(Icons.block, size: 12, color: color),
          const SizedBox(width: 4),
          Text(text, style: TextStyle(fontSize: 11, color: color)),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Modal dialog for destructive tool permissions
// ---------------------------------------------------------------------------

class _PermissionModalDialog extends StatefulWidget {
  const _PermissionModalDialog({
    required this.title,
    this.description,
    required this.remaining,
  });

  final String title;
  final String? description;
  final Duration remaining;

  @override
  State<_PermissionModalDialog> createState() => _PermissionModalDialogState();
}

class _PermissionModalDialogState extends State<_PermissionModalDialog> {
  late Duration _remaining;
  Timer? _tick;
  bool _showDenyReason = false;
  final _denyReasonController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _remaining = widget.remaining;
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      final newRemaining = _remaining - const Duration(seconds: 1);
      if (newRemaining.isNegative) {
        _tick?.cancel();
        Navigator.of(context).pop({'decision': 'deny', 'reason': null});
      } else {
        setState(() => _remaining = newRemaining);
      }
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    _denyReasonController.dispose();
    super.dispose();
  }

  void _pop(String decision, {String? reason}) {
    Navigator.of(context).pop({
      'decision': decision,
      'reason':
          (reason != null && reason.trim().isNotEmpty) ? reason.trim() : null,
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: context.rhythm.surfaceRaised,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
      ),
      title: Row(
        children: [
          Icon(Icons.security, size: 20, color: context.rhythm.accent),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              widget.title,
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: context.rhythm.textPrimary,
              ),
            ),
          ),
          Text(
            '${_remaining.inSeconds}s',
            style: TextStyle(fontSize: 13, color: context.rhythm.textMuted),
          ),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (widget.description != null)
            Text(
              widget.description!,
              style: TextStyle(
                fontSize: 13,
                color: context.rhythm.textSecondary,
                height: 1.45,
              ),
            ),
          if (_showDenyReason) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _denyReasonController,
              autofocus: true,
              decoration: const InputDecoration(
                isDense: true,
                hintText: 'Reason (optional)',
              ),
              onSubmitted: (value) => _pop('deny', reason: value),
            ),
          ],
        ],
      ),
      actions: _showDenyReason
          ? [
              FilledButton(
                onPressed: () =>
                    _pop('deny', reason: _denyReasonController.text),
                style: FilledButton.styleFrom(
                  backgroundColor: context.rhythm.accent,
                ),
                child: const Text('Submit'),
              ),
            ]
          : [
              TextButton(
                onPressed: () => setState(() => _showDenyReason = true),
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.textSecondary,
                ),
                child: const Text('Deny'),
              ),
              TextButton(
                key: const Key('permission_modal_always_allow'),
                onPressed: () => _pop('always'),
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.textSecondary,
                ),
                child: const Text('Always allow'),
              ),
              FilledButton(
                onPressed: () => _pop('accept'),
                style: FilledButton.styleFrom(
                  backgroundColor: context.rhythm.accent,
                ),
                child: const Text('Accept'),
              ),
            ],
    );
  }
}
