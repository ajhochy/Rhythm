import 'dart:async';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';

/// M3-6: inline permission card surfaced in the chat thread when opencode
/// emits a `permission.asked` event. Defaults to inline-for-everything;
/// destructive-tools-modal toggle (M5-1) can elevate to a modal later.
///
/// Auto-denies after [timeout] (default 60s) if the user doesn't respond.
class PermissionCard extends StatefulWidget {
  const PermissionCard({
    super.key,
    required this.sessionId,
    required this.permissionId,
    required this.title,
    this.description,
    this.timeout = const Duration(seconds: 60),
  });

  final String sessionId;
  final String permissionId;
  final String title;
  final String? description;
  final Duration timeout;

  @override
  State<PermissionCard> createState() => _PermissionCardState();
}

class _PermissionCardState extends State<PermissionCard> {
  late DateTime _deadline;
  Timer? _tick;
  bool _responded = false;
  bool _autoDenied = false;
  String? _error;
  Duration _remaining = Duration.zero;

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

  Future<void> _respond(String decision, {bool auto = false}) async {
    if (_responded) return;
    _responded = true;
    _tick?.cancel();
    try {
      final res = await http.post(
        Uri.parse(
          '${AppConstants.agentLocalBaseUrl}/agent-sessions/${widget.sessionId}/permission/${widget.permissionId}/$decision',
        ),
      );
      if (res.statusCode >= 400) {
        throw Exception('HTTP ${res.statusCode}');
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
