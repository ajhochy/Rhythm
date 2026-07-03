/// Issue #863 — one-tap, jargon-free agent quick actions.
///
/// Renders a small row of buttons ("Help me finish this", "Draft next
/// steps", "Summarize", "Create follow-up tasks") that each run a preset
/// agent invocation with the source item's content pre-loaded. No model
/// picker, no token talk, no MCP terminology is ever shown here — the
/// widget reuses the existing session-creation path
/// ([AgentsController.createSession]) the same way the email assistant and
/// graphic designer launchers already do (see agent_email_view.dart,
/// agent_gallery_view.dart), then sends the preset prompt immediately via
/// [AgentsController.sendInput] so the user never has to type anything.
library;

import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agent_configs/controllers/agent_configs_controller.dart';
import '../../tasks/controllers/tasks_controller.dart';
import '../controllers/agents_controller.dart';
import '../models/quick_action_context.dart';

/// Callback invoked once a quick action has successfully started (or, for
/// "Create follow-up tasks", once the linked task was created) so the host
/// screen can navigate the user to view the result — satisfies "action
/// output is viewable" from issue #863's acceptance criteria.
typedef QuickActionSessionOpener = void Function(String sessionId);

enum _QuickActionKind { help, draftNextSteps, summarize, followUpTasks }

class _QuickActionSpec {
  const _QuickActionSpec({
    required this.kind,
    required this.key,
    required this.label,
    required this.icon,
  });

  final _QuickActionKind kind;
  final String key;
  final String label;
  final IconData icon;
}

const _quickActionSpecs = <_QuickActionSpec>[
  _QuickActionSpec(
    kind: _QuickActionKind.help,
    key: 'quick-action-help-finish',
    label: 'Help me finish this',
    icon: Icons.rocket_launch_outlined,
  ),
  _QuickActionSpec(
    kind: _QuickActionKind.draftNextSteps,
    key: 'quick-action-draft-next-steps',
    label: 'Draft next steps',
    icon: Icons.checklist_outlined,
  ),
  _QuickActionSpec(
    kind: _QuickActionKind.summarize,
    key: 'quick-action-summarize',
    label: 'Summarize',
    icon: Icons.summarize_outlined,
  ),
  _QuickActionSpec(
    kind: _QuickActionKind.followUpTasks,
    key: 'quick-action-follow-up-tasks',
    label: 'Create follow-up tasks',
    icon: Icons.playlist_add_check_outlined,
  ),
];

/// Shared quick-actions widget. Attach to any task/plan/thread detail
/// surface by passing a [QuickActionContext] built from that item.
class QuickActionsBar extends StatefulWidget {
  const QuickActionsBar({
    super.key,
    required this.context_,
    this.onSessionReady,
  });

  /// The task/plan/thread this bar is attached to.
  final QuickActionContext context_;

  /// Called with the new session id once a chat-style action (help/draft
  /// next steps/summarize) or the follow-up-tasks agent run has started
  /// successfully, so the host can navigate to view the result.
  final QuickActionSessionOpener? onSessionReady;

  @override
  State<QuickActionsBar> createState() => _QuickActionsBarState();
}

class _QuickActionsBarState extends State<QuickActionsBar> {
  /// The action currently running, so its button can show a spinner and all
  /// buttons can be disabled while it is in flight (prevents double-tap).
  _QuickActionKind? _running;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: RhythmSpacing.xs,
      runSpacing: RhythmSpacing.xs,
      children: [
        for (final spec in _quickActionSpecs)
          _QuickActionButton(
            spec: spec,
            busy: _running == spec.kind,
            disabled: _running != null && _running != spec.kind,
            onPressed: () => _run(spec.kind),
          ),
      ],
    );
  }

  Future<void> _run(_QuickActionKind kind) async {
    if (_running != null) return;
    setState(() => _running = kind);
    try {
      if (kind == _QuickActionKind.followUpTasks) {
        await _runCreateFollowUpTasks();
      } else {
        await _runChatAction(kind);
      }
    } finally {
      if (mounted) setState(() => _running = null);
    }
  }

  String _presetPrompt(_QuickActionKind kind) {
    final title = widget.context_.title;
    final description = widget.context_.description?.trim();
    final hasDescription = description != null && description.isNotEmpty;
    final contextBlock =
        hasDescription ? '"$title"\n\n$description' : '"$title"';

    return switch (kind) {
      _QuickActionKind.help =>
        'Help me finish this. Here is the full context:\n\n$contextBlock',
      _QuickActionKind.draftNextSteps =>
        'Draft the next steps needed to move this forward. Here is the full '
            'context:\n\n$contextBlock',
      _QuickActionKind.summarize =>
        'Summarize this for me in a few short sentences. Here is the full '
            'context:\n\n$contextBlock',
      _QuickActionKind.followUpTasks =>
        'Review this and create any additional follow-up tasks it needs, '
            'beyond the one already created for it. Here is the full '
            'context:\n\n$contextBlock',
    };
  }

  String _sessionName(_QuickActionKind kind) {
    final title = widget.context_.title;
    return switch (kind) {
      _QuickActionKind.help => 'Help me finish: $title',
      _QuickActionKind.draftNextSteps => 'Next steps: $title',
      _QuickActionKind.summarize => 'Summary: $title',
      _QuickActionKind.followUpTasks => 'Follow-up tasks: $title',
    };
  }

  Future<void> _runChatAction(_QuickActionKind kind) async {
    final agentsController = context.read<AgentsController>();
    final agentConfigsController = context.read<AgentConfigsController>();
    final session = await agentsController.createSession(
      // A staff-facing helper session isn't tied to a code checkout, but the
      // engine requires a non-empty working dir — default to HOME, matching
      // the normal chat launchers (agents_view.dart). '' → 400 "cwd is
      // required" (the #863 smoke bug).
      cwd: Platform.environment['HOME'] ?? '/',
      name: _sessionName(kind),
      // #888: mcpRole alone only scopes the MCP tool allowlist — the server
      // resolves which engine agent actually RUNS the session solely from
      // agentId. Without this, the server fell back to the first authorized
      // catalog entry ("Coding Workflow") instead of Secretary, so no
      // delegation (#883) ever happened. Resolve the manager (Secretary)
      // profile's engine agent dynamically rather than hardcoding it.
      agentId: agentConfigsController.managerAgent?.ocAgent ?? 'secretary',
      mcpRole: 'secretary',
      taskId: widget.context_.kind == 'task' ? widget.context_.sourceId : null,
    );
    if (!mounted) return;
    if (session == null) {
      _showFailure(
        agentsController.error ?? 'Could not start the agent. Try again.',
      );
      return;
    }
    if (agentsController.connectivity.isWsDisconnected) {
      _showFailure(
        'The agent session was created, but the connection is offline, so '
        'it could not be started. Try again once reconnected.',
      );
      widget.onSessionReady?.call(session.id);
      return;
    }
    await agentsController.selectSession(session.id);
    if (!mounted) return;
    agentsController.sendInput(session.id, _presetPrompt(kind));
    _showInfo('Rhythm is on it — opening the agent session…');
    widget.onSessionReady?.call(session.id);
  }

  Future<void> _runCreateFollowUpTasks() async {
    final tasksController = context.read<TasksController>();
    final agentsController = context.read<AgentsController>();
    final sourceLabel = switch (widget.context_.kind) {
      'project' => 'project',
      'thread' => 'message thread',
      _ => 'task',
    };

    // TasksController.createTask never throws — failures are captured into
    // errorMessage below — so no try/catch is needed here.
    await tasksController.createTask(
      'Follow-up: ${widget.context_.title}',
      notes: 'Follow-up from $sourceLabel "${widget.context_.title}".',
    );
    if (!mounted) return;
    if (tasksController.errorMessage != null) {
      _showFailure(
        'Could not create the follow-up task: ${tasksController.errorMessage}',
      );
      return;
    }

    // Also launch an agent to propose any additional follow-up tasks this
    // item needs, reusing the same preset-invocation path as the chat
    // actions above.
    final agentConfigsController = context.read<AgentConfigsController>();
    final session = await agentsController.createSession(
      // A staff-facing helper session isn't tied to a code checkout, but the
      // engine requires a non-empty working dir — default to HOME, matching
      // the normal chat launchers (agents_view.dart). '' → 400 "cwd is
      // required" (the #863 smoke bug).
      cwd: Platform.environment['HOME'] ?? '/',
      name: _sessionName(_QuickActionKind.followUpTasks),
      // #888: see _runChatAction — agentId must be passed explicitly or the
      // server defaults to "Coding Workflow" instead of Secretary.
      agentId: agentConfigsController.managerAgent?.ocAgent ?? 'secretary',
      mcpRole: 'secretary',
      taskId: widget.context_.kind == 'task' ? widget.context_.sourceId : null,
    );
    if (!mounted) return;
    if (session == null) {
      // The real follow-up task was already created successfully above, so
      // this is a partial (not total) failure — surface it but don't block.
      _showFailure(
        'Created the follow-up task, but could not start the agent to '
        'suggest more: ${agentsController.error ?? 'unknown error'}',
      );
      return;
    }
    if (!agentsController.connectivity.isWsDisconnected) {
      await agentsController.selectSession(session.id);
      if (!mounted) return;
      agentsController.sendInput(
        session.id,
        _presetPrompt(_QuickActionKind.followUpTasks),
      );
    }
    _showInfo('Created a follow-up task and asked Rhythm to suggest more — '
        'opening the agent session…');
    widget.onSessionReady?.call(session.id);
  }

  void _showFailure(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  /// Confirmation feedback so the user knows what the tap did (the agent
  /// launch can take several seconds; without this it looked like "spun then
  /// did nothing"). onSessionReady then navigates to the opened session.
  void _showInfo(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), duration: const Duration(seconds: 2)),
    );
  }
}

class _QuickActionButton extends StatelessWidget {
  const _QuickActionButton({
    required this.spec,
    required this.busy,
    required this.disabled,
    required this.onPressed,
  });

  final _QuickActionSpec spec;
  final bool busy;
  final bool disabled;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    final colors = context.rhythm;
    return OutlinedButton.icon(
      key: ValueKey(spec.key),
      onPressed: disabled ? null : onPressed,
      icon: busy
          ? SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                valueColor: AlwaysStoppedAnimation<Color>(colors.accent),
              ),
            )
          : Icon(spec.icon, size: 16),
      label: Text(spec.label),
      style: OutlinedButton.styleFrom(
        foregroundColor: colors.textPrimary,
        disabledForegroundColor: colors.textMuted,
        side: BorderSide(color: colors.border),
        padding: const EdgeInsets.symmetric(
          horizontal: RhythmSpacing.sm,
          vertical: RhythmSpacing.xs,
        ),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(RhythmRadius.md),
        ),
      ),
    );
  }
}
