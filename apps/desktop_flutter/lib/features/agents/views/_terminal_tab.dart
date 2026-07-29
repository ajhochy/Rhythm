/// issue #708 — interactive PTY terminal tab.
///
/// Renders inside the Terminal tab of [SessionSidePanel]. A real interactive
/// terminal: an xterm [Terminal] bound to the PTY proxy WebSocket exposed by
/// the local agent server. Keystrokes flow out over the socket and process
/// output flows back into the terminal buffer.
///
/// Smoke-fix: this widget is now a THIN VIEW. All terminal state (the xterm
/// [Terminal], the PTY id, the channel, the subscription, status, the
/// start/teardown/restart logic) lives in a session-keyed
/// [PtyTerminalSession] owned by the long-lived [AgentsController]. The PTY's
/// lifetime is tied to the SESSION, not to this widget — so collapsing the
/// side panel or switching the panel's Context/Changes/Terminal tabs (both of
/// which dispose this widget) NO LONGER kills the shell. Remounting reuses the
/// same [PtyTerminalSession] (same buffer, same shell). The PTY is torn down
/// only when the session is closed/deleted, or when the controller is disposed.
///
/// Status states: connecting (spinner), connected (TerminalView), exited
/// ("[process exited]" + New terminal), error (message + Retry).
library;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:xterm/xterm.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agents_controller.dart';
import '../controllers/pty_terminal_session.dart';

class TerminalTab extends StatelessWidget {
  const TerminalTab({super.key, required this.sessionId});

  final String sessionId;

  @override
  Widget build(BuildContext context) {
    // Get-or-create the session-scoped terminal. On first open this lazily
    // creates the PTY exactly once; on remount (panel collapse / tab switch)
    // it returns the SAME instance, preserving the live shell + buffer.
    final term = context.read<AgentsController>().terminalSessionFor(sessionId);
    // Rebuild this view on status changes without rebuilding on every unrelated
    // AgentsController notification.
    return ListenableBuilder(
      listenable: term,
      builder: (context, _) => _TerminalBody(term: term),
    );
  }
}

class _TerminalBody extends StatelessWidget {
  const _TerminalBody({required this.term});

  final PtyTerminalSession term;

  @override
  Widget build(BuildContext context) {
    switch (term.status) {
      case PtyTerminalStatus.connecting:
        return const Center(
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        );
      case PtyTerminalStatus.connected:
        return TerminalView(term.terminal);
      case PtyTerminalStatus.exited:
        return _StatusMessage(
          key: const Key('terminal-exited'),
          icon: Icons.check_circle_outline,
          message: '[process exited]',
          actionLabel: 'New terminal',
          onAction: term.restart,
        );
      case PtyTerminalStatus.error:
        return _StatusMessage(
          key: const Key('terminal-error'),
          icon: Icons.error_outline,
          message: 'Terminal connection failed.',
          actionLabel: 'Retry',
          isError: true,
          onAction: term.restart,
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
    final color = isError
        ? context.rhythm.danger
        : context.rhythm.textSecondary;
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
          OutlinedButton(onPressed: onAction, child: Text(actionLabel)),
        ],
      ),
    );
  }
}
