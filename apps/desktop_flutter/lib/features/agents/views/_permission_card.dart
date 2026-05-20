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
    this.timeout = const Duration(seconds: 60),
  });

  final String sessionId;
  final String permissionId;
  final String title;
  final String? toolName;
  final String? description;
  final Duration timeout;

  @override
  State<PermissionCard> createState() => _PermissionCardState();
}

class _PermissionCardState extends State<PermissionCard> {
  static const _destructiveTools = {'bash', 'write', 'edit', 'patch'};

  late DateTime _deadline;
  Timer? _tick;
  bool _responded = false;
  bool _autoDenied = false;
  String? _error;
  Duration _remaining = Duration.zero;
  bool _modalShown = false;

  @override
  void initState() {
    super.initState();
    _deadline = DateTime.now().add(widget.timeout);
    _remaining = widget.timeout;
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      final left = _deadline.difference(DateTime.now());
      if (left.isNegative && !_responded) {
        _autoDenied = true;
        _respond('deny', auto: true);
      } else {
        setState(() => _remaining = left);
      }
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
  }

  bool get _isDestructive =>
      widget.toolName != null &&
      _destructiveTools.contains(widget.toolName!.toLowerCase());

  Future<void> _respond(String decision, {bool auto = false}) async {
    if (_responded) return;
    _responded = true;
    _tick?.cancel();
    if (!mounted) return;
    final controller = context.read<AgentsController>();
    try {
      if (decision == 'accept') {
        await controller.acceptPermission(
            widget.sessionId, widget.permissionId);
      } else {
        await controller.denyPermission(widget.sessionId, widget.permissionId);
      }
      if (!mounted) return;
      setState(() {});
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _responded = false;
        _autoDenied = false;
      });
    }
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Elevate to modal when destructive-modal toggle is on and tool is destructive.
    if (_modalShown || _responded) return;
    final destructiveModal = context.watch<DestructiveModalService>();
    if (destructiveModal.enabled && _isDestructive) {
      _modalShown = true;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || _responded) return;
        showDialog<String>(
          context: context,
          barrierDismissible: false,
          builder: (_) => _PermissionModalDialog(
            title: widget.title,
            description: widget.description,
            remaining: _remaining,
          ),
        ).then((decision) {
          if (decision != null && mounted) {
            _respond(decision);
          }
        });
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_autoDenied) {
      return _Stub(
        text: 'Denied (timeout)',
        color: context.rhythm.textMuted,
      );
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
                style: TextStyle(
                  fontSize: 11,
                  color: context.rhythm.textMuted,
                ),
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
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              TextButton(
                onPressed: () => _respond('deny'),
                child: const Text('Deny'),
              ),
              const SizedBox(width: 6),
              FilledButton(
                onPressed: () => _respond('accept'),
                child: const Text('Accept'),
              ),
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

  @override
  void initState() {
    super.initState();
    _remaining = widget.remaining;
    _tick = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      final newRemaining = _remaining - const Duration(seconds: 1);
      if (newRemaining.isNegative) {
        _tick?.cancel();
        Navigator.of(context).pop('deny');
      } else {
        setState(() => _remaining = newRemaining);
      }
    });
  }

  @override
  void dispose() {
    _tick?.cancel();
    super.dispose();
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
      content: widget.description != null
          ? Text(
              widget.description!,
              style: TextStyle(
                fontSize: 13,
                color: context.rhythm.textSecondary,
                height: 1.45,
              ),
            )
          : null,
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop('deny'),
          style: TextButton.styleFrom(
            foregroundColor: context.rhythm.textSecondary,
          ),
          child: const Text('Deny'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop('accept'),
          style: FilledButton.styleFrom(
            backgroundColor: context.rhythm.accent,
          ),
          child: const Text('Accept'),
        ),
      ],
    );
  }
}
