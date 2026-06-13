import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agents_controller.dart';
import '../models/agent_session.dart';
import '_changes_tab.dart';

/// M3-5: right-rail inspector panel for the active session.
///
/// Tabs:
///   - Context: provider, model, cwd, tokens, cost.
///   - Changes: working-tree diff fetched from GET /agent-sessions/:id/diff.
///     Diff state lives on [AgentsController] (single source of truth, shared
///     with the `session.diff` WS-event refetch path) and renders through the
///     [ChangesTab] widget (reuses UnifiedDiffView from M2-3).
///   - Terminal: captured bash output (placeholder; M3 ships an empty state
///     until streaming bash output is plumbed end-to-end).
class SessionSidePanel extends StatefulWidget {
  const SessionSidePanel({super.key, required this.session});

  final AgentSession session;

  @override
  State<SessionSidePanel> createState() => _SessionSidePanelState();
}

enum _Tab { context, changes, terminal }

class _SessionSidePanelState extends State<SessionSidePanel> {
  _Tab _selected = _Tab.context;

  @override
  void didUpdateWidget(SessionSidePanel old) {
    super.didUpdateWidget(old);
    if (old.session.id != widget.session.id && _selected == _Tab.changes) {
      _ensureDiff();
    }
  }

  /// Trigger a diff fetch for the current session (no-op if one is already
  /// in-flight; the controller gates concurrent fetches).
  void _ensureDiff() {
    context.read<AgentsController>().fetchSessionDiff(widget.session.id);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 320,
      decoration: BoxDecoration(
        color: context.rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        border: Border.all(color: context.rhythm.border),
        boxShadow: RhythmElevation.panel,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _Tabs(
            selected: _selected,
            sessionId: widget.session.id,
            onSelect: (t) {
              setState(() => _selected = t);
              if (t == _Tab.changes) _ensureDiff();
            },
          ),
          Divider(height: 1, color: context.rhythm.borderSubtle),
          Expanded(child: _buildBody(context)),
        ],
      ),
    );
  }

  Widget _buildBody(BuildContext context) {
    switch (_selected) {
      case _Tab.context:
        return _ContextTab(session: widget.session);
      case _Tab.changes:
        final controller = context.watch<AgentsController>();
        final id = widget.session.id;
        return ChangesTab(
          sessionId: id,
          diffEntries: controller.sessionDiffFor(id),
          isLoading: controller.sessionDiffLoading(id),
          errorMessage: controller.sessionDiffErrorFor(id),
        );
      case _Tab.terminal:
        return const _PlaceholderTab(
          message: 'Captured bash output will appear here.',
        );
    }
  }
}

class _Tabs extends StatelessWidget {
  const _Tabs({
    required this.selected,
    required this.sessionId,
    required this.onSelect,
  });
  final _Tab selected;
  final String sessionId;
  final ValueChanged<_Tab> onSelect;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
      child: Row(
        children: [
          _tab(context, _Tab.context, 'Context'),
          _tab(
            context,
            _Tab.changes,
            'Changes',
            trailing: ChangesTabBadge(sessionId: sessionId),
          ),
          _tab(context, _Tab.terminal, 'Terminal'),
        ],
      ),
    );
  }

  Widget _tab(
    BuildContext context,
    _Tab t,
    String label, {
    Widget? trailing,
  }) {
    final isSel = t == selected;
    return Expanded(
      child: InkWell(
        onTap: () => onSelect(t),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            border: Border(
              bottom: BorderSide(
                color: isSel ? context.rhythm.accent : Colors.transparent,
                width: 2,
              ),
            ),
          ),
          alignment: Alignment.center,
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Flexible(
                child: Text(
                  label,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: isSel
                        ? context.rhythm.textPrimary
                        : context.rhythm.textMuted,
                  ),
                ),
              ),
              if (trailing != null) ...[
                const SizedBox(width: 4),
                trailing,
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _ContextTab extends StatelessWidget {
  const _ContextTab({required this.session});
  final AgentSession session;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        _row(context, 'Agent', session.agentId),
        _row(context, 'Cwd', session.cwd),
        _row(context, 'Status', session.status.wireValue),
      ],
    );
  }

  Widget _row(BuildContext context, String k, String v) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            k,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.6,
              color: context.rhythm.textMuted,
            ),
          ),
          const SizedBox(height: 2),
          SelectableText(
            v,
            style: TextStyle(
              fontSize: 12,
              color: context.rhythm.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

class _PlaceholderTab extends StatelessWidget {
  const _PlaceholderTab({required this.message});
  final String message;
  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Text(
          message,
          style: TextStyle(color: context.rhythm.textMuted, fontSize: 12),
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}
