/// issue #708 — interactive PTY terminal tab.
///
/// Renders inside the Terminal tab of [SessionSidePanel]. Replaces the old
/// one-shot command-runner with a real interactive terminal: an xterm
/// [Terminal] bound to the PTY proxy WebSocket exposed by the local agent
/// server. The PTY is created (in the session's cwd) when the tab mounts and
/// killed on dispose / session-switch. Keystrokes flow out over the socket and
/// process output flows back into the terminal buffer.
///
/// Lifecycle:
///   - initState / sessionId change → [_start]: createPty → open WS → wire I/O.
///   - dispose → cancel subscription, close socket, killPty (fire-and-forget).
///
/// Status states: connecting (spinner), connected (TerminalView), exited
/// ("[process exited]" + New terminal), error (message + Retry).
library;

import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:stream_channel/stream_channel.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:xterm/xterm.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agents_controller.dart';

/// Factory that opens the transport channel for a given ptyId. Injectable so
/// tests can supply a fake channel without a real socket/engine.
typedef PtyChannelFactory = StreamChannel<dynamic> Function(String ptyId);

enum _TerminalStatus { connecting, connected, exited, error }

class TerminalTab extends StatefulWidget {
  const TerminalTab({
    super.key,
    required this.sessionId,
    this.channelFactory,
  });

  final String sessionId;

  /// Test seam: overrides the default [WebSocketChannel.connect] transport.
  @visibleForTesting
  final PtyChannelFactory? channelFactory;

  @override
  State<TerminalTab> createState() => _TerminalTabState();
}

class _TerminalTabState extends State<TerminalTab> {
  final Terminal _terminal = Terminal(maxLines: 10000);

  StreamChannel<dynamic>? _channel;
  StreamSubscription<dynamic>? _sub;
  String? _ptyId;
  _TerminalStatus _status = _TerminalStatus.connecting;

  /// Cached so it is safe to use in [dispose] (Provider.of is unsafe there).
  AgentsController? _controllerRef;

  /// Exposed for tests to read inbound bytes via the terminal buffer.
  @visibleForTesting
  Terminal get debugTerminal => _terminal;

  AgentsController get _controller =>
      _controllerRef ??= Provider.of<AgentsController>(context, listen: false);

  @override
  void initState() {
    super.initState();
    _terminal.onOutput = (data) {
      _channel?.sink.add(data);
    };
    _terminal.onResize = (width, height, pixelWidth, pixelHeight) {
      final id = _ptyId;
      if (id != null) {
        // xterm reports width=cols, height=rows.
        _controller.resizePty(id, width, height);
      }
    };
    _start();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _controllerRef = Provider.of<AgentsController>(context, listen: false);
  }

  @override
  void didUpdateWidget(covariant TerminalTab oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.sessionId != oldWidget.sessionId) {
      _teardown();
      _start();
    }
  }

  Future<void> _start() async {
    _setStatus(_TerminalStatus.connecting);
    try {
      final id = await _controller.createPty(widget.sessionId);
      if (!mounted) {
        // Widget was disposed mid-create; clean up the orphaned PTY.
        unawaited(_controller.killPty(id));
        return;
      }
      _ptyId = id;

      final factory = widget.channelFactory ?? _defaultChannelFactory;
      final channel = factory(id);
      _channel = channel;

      _sub = channel.stream.listen(
        (event) {
          _terminal.write(
            event is String ? event : utf8.decode(event as List<int>),
          );
        },
        onDone: () => _setStatus(_TerminalStatus.exited),
        onError: (_) => _setStatus(_TerminalStatus.error),
      );

      _setStatus(_TerminalStatus.connected);
    } catch (_) {
      _setStatus(_TerminalStatus.error);
    }
  }

  StreamChannel<dynamic> _defaultChannelFactory(String ptyId) =>
      WebSocketChannel.connect(Uri.parse(_controller.ptyWsUrl(ptyId)));

  /// Tear down the current PTY/socket without restarting. Safe to call when
  /// already torn down.
  void _teardown() {
    _sub?.cancel();
    _sub = null;
    _channel?.sink.close();
    _channel = null;
    final id = _ptyId;
    if (id != null) {
      unawaited(_controller.killPty(id));
    }
    _ptyId = null;
  }

  /// Restart after the process exited: open a fresh PTY (nothing to kill).
  void _restart() {
    _ptyId = null;
    _start();
  }

  void _setStatus(_TerminalStatus status) {
    if (!mounted) return;
    if (_status == status) return;
    setState(() => _status = status);
  }

  @override
  void dispose() {
    _sub?.cancel();
    _channel?.sink.close();
    final id = _ptyId;
    if (id != null) {
      unawaited(_controller.killPty(id));
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    switch (_status) {
      case _TerminalStatus.connecting:
        return const Center(
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        );
      case _TerminalStatus.connected:
        return TerminalView(_terminal);
      case _TerminalStatus.exited:
        return _StatusMessage(
          key: const Key('terminal-exited'),
          icon: Icons.check_circle_outline,
          message: '[process exited]',
          actionLabel: 'New terminal',
          onAction: _restart,
        );
      case _TerminalStatus.error:
        return _StatusMessage(
          key: const Key('terminal-error'),
          icon: Icons.error_outline,
          message: 'Terminal connection failed.',
          actionLabel: 'Retry',
          isError: true,
          onAction: _restart,
        );
    }
  }
}

/// Centered status message with an action button (exited / error states).
class _StatusMessage extends StatelessWidget {
  const _StatusMessage({
    super.key,
    required this.icon,
    required this.message,
    required this.actionLabel,
    required this.onAction,
    this.isError = false,
  });

  final IconData icon;
  final String message;
  final String actionLabel;
  final VoidCallback onAction;
  final bool isError;

  @override
  Widget build(BuildContext context) {
    final color =
        isError ? context.rhythm.danger : context.rhythm.textSecondary;
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 20, color: color),
          const SizedBox(height: 8),
          Text(
            message,
            style: TextStyle(
              fontFamily: 'JetBrainsMono',
              fontSize: 12,
              color: color,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 12),
          OutlinedButton(
            onPressed: onAction,
            child: Text(actionLabel),
          ),
        ],
      ),
    );
  }
}
