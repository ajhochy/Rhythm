import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/formatters/date_formatters.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agents_controller.dart';
import '../models/agent_session.dart';
import '_changes_tab.dart';
import '_terminal_tab.dart';
import '_todo_panel.dart';

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
      key: const ValueKey('inspector-panel'),
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
          // OPC-M3-5: collapsible todo panel shown below tab content.
          // Collapse state is keyed per session so switching sessions
          // preserves the collapsed/expanded choice for each one.
          _buildTodoPanel(context),
        ],
      ),
    );
  }

  Widget _buildTodoPanel(BuildContext context) {
    final controller = context.watch<AgentsController>();
    final todos = controller.sessionTodosFor(widget.session.id);
    // TodoPanel returns SizedBox.shrink() when todos is empty — no extra
    // space allocated.
    return TodoPanel(
      todos: todos,
      collapseKey: widget.session.id,
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
        // OPC-M1-6 / issue #709 — real Terminal command-runner tab.
        return TerminalTab(sessionId: widget.session.id);
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
          IconButton(
            key: const ValueKey('inspector-collapse-button'),
            icon: const Icon(Icons.chevron_right, size: 18),
            tooltip: 'Collapse',
            onPressed: () =>
                context.read<AgentsController>().setPanelCollapsed(true),
            style: IconButton.styleFrom(
              minimumSize: const Size(28, 28),
              padding: EdgeInsets.zero,
              foregroundColor: context.rhythm.textMuted,
            ),
          ),
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
    final controller = context.watch<AgentsController>();
    final totalTokens = controller.sessionContextTokens(session.id);
    final contextWindow = controller.contextWindowForSession(session);
    final messageCount = controller.chatMessagesFor(session.id).length;
    final hasMessages = messageCount > 0;
    return ListView(
      padding: const EdgeInsets.all(12),
      children: [
        _row(context, 'Agent', session.agentId),
        _row(context, 'Cwd', session.cwd),
        _row(context, 'Status', session.status.wireValue),
        const SizedBox(height: 8),
        _ContextUsageGauge(
            tokensUsed: totalTokens, contextWindow: contextWindow),
        // OPC: enriched Context-tab details (cost, token breakdown, session
        // metadata). Only rendered once the session has at least one message;
        // zero-message sessions keep the gauge's "No messages yet" empty state.
        if (hasMessages) ..._buildDetails(context, controller, messageCount),
      ],
    );
  }

  List<Widget> _buildDetails(
    BuildContext context,
    AgentsController controller,
    int messageCount,
  ) {
    final cost = controller.sessionTotalCost(session.id) ?? 0;
    final b = controller.sessionTokenBreakdown(session.id);
    return [
      const SizedBox(height: 12),
      _rowChild(
        context,
        'Session cost',
        Text(
          '\$${cost.toStringAsFixed(4)}',
          key: const ValueKey('context-cost'),
          style: TextStyle(fontSize: 12, color: context.rhythm.textPrimary),
        ),
      ),
      const SizedBox(height: 8),
      _rowChild(
        context,
        'Input tokens',
        _valueText(context, b.input.toString(),
            key: const ValueKey('context-tokens-input')),
      ),
      _rowChild(
        context,
        'Output tokens',
        _valueText(context, b.output.toString(),
            key: const ValueKey('context-tokens-output')),
      ),
      _rowChild(
          context, 'Cache read', _valueText(context, b.cacheRead.toString())),
      _rowChild(
          context, 'Cache write', _valueText(context, b.cacheWrite.toString())),
      _rowChild(context, 'Reasoning tokens',
          _valueText(context, b.reasoning.toString())),
      const SizedBox(height: 8),
      _rowChild(
        context,
        'Model',
        _valueText(context, controller.modelDisplayName(session),
            key: const ValueKey('context-model')),
      ),
      _row(context, 'Created',
          DateFormatters.fullDateFromDateTime(session.createdAt)),
      _row(context, 'Updated',
          DateFormatters.fullDateFromDateTime(session.updatedAt)),
      _rowChild(
        context,
        'Messages',
        _valueText(context, messageCount.toString(),
            key: const ValueKey('context-message-count')),
      ),
    ];
  }

  Text _valueText(BuildContext context, String v, {Key? key}) {
    return Text(
      v,
      key: key,
      style: TextStyle(fontSize: 12, color: context.rhythm.textPrimary),
    );
  }

  /// Label/value row that reuses the [_row] label style but renders a custom
  /// value widget (so a [ValueKey] can be attached to the value Text).
  Widget _rowChild(BuildContext context, String k, Widget value) {
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
          value,
        ],
      ),
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

/// Issue #718 — Context-usage gauge for the Context tab.
///
/// Displays the cumulative input tokens used vs the model's context-window
/// capacity, formatted as "X tokens / Yk" with a coloured
/// [LinearProgressIndicator].
///
/// When [contextWindow] is supplied (from the catalog's per-model limit), it
/// is used as the denominator. When null, falls back to [_kDefaultContextWindow]
/// (200k), which is a safe default for claude-sonnet-class models.
///
/// Colour thresholds:
///   - green  below 60 %
///   - yellow 60–80 %
///   - red    above 80 %
///
/// Shows "No messages yet" when [tokensUsed] is 0.
class _ContextUsageGauge extends StatelessWidget {
  const _ContextUsageGauge({required this.tokensUsed, this.contextWindow});

  final int tokensUsed;

  /// Real context window for this session's model, from the catalog.
  /// Null when unknown — the gauge falls back to [_kDefaultContextWindow].
  final int? contextWindow;

  /// Fallback context window (tokens) when the catalog has no per-model limit.
  /// 200k is the largest safe default for claude-sonnet-class models.
  static const int _kDefaultContextWindow = 200000;

  /// Format a token count as a human-readable string.
  ///
  /// Values ≥ 1000 are shown with a "k" suffix (e.g. "128k"); smaller values
  /// are shown as raw numbers.
  static String _fmtTokens(int n) {
    if (n >= 1000) {
      final k = n / 1000;
      // Drop the decimal when it's a whole number (e.g. 200k not 200.0k).
      return k == k.truncateToDouble()
          ? '${k.truncate()}k'
          : '${k.toStringAsFixed(1)}k';
    }
    return n.toString();
  }

  @override
  Widget build(BuildContext context) {
    // Section label.
    final label = Text(
      'CONTEXT USAGE',
      style: TextStyle(
        fontSize: 10,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.6,
        color: context.rhythm.textMuted,
      ),
    );

    if (tokensUsed == 0) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          label,
          const SizedBox(height: 4),
          Text(
            'No messages yet',
            style: TextStyle(
              fontSize: 12,
              color: context.rhythm.textMuted,
            ),
          ),
        ],
      );
    }

    final effectiveWindow = contextWindow ?? _kDefaultContextWindow;
    final fraction = (tokensUsed / effectiveWindow).clamp(0.0, 1.0);
    final pct = fraction * 100;

    // Colour thresholds.
    final Color barColor;
    if (pct < 60) {
      barColor = Colors.green;
    } else if (pct < 80) {
      barColor = Colors.orange;
    } else {
      barColor = Colors.red;
    }

    final usedLabel = _fmtTokens(tokensUsed);
    final capacityLabel = _fmtTokens(effectiveWindow);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        label,
        const SizedBox(height: 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              '$usedLabel / $capacityLabel tokens',
              style: TextStyle(
                fontSize: 12,
                color: context.rhythm.textPrimary,
              ),
            ),
            Text(
              '${pct.round()}%',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: barColor,
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        ClipRRect(
          borderRadius: BorderRadius.circular(2),
          child: LinearProgressIndicator(
            value: fraction,
            minHeight: 5,
            backgroundColor: context.rhythm.border,
            valueColor: AlwaysStoppedAnimation<Color>(barColor),
          ),
        ),
      ],
    );
  }
}
