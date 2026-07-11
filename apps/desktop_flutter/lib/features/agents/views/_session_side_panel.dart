import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/agents/agent_server_controller.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../../app/core/utils/time_format.dart';
import '../../agent_configs/controllers/agent_configs_controller.dart';
import '../controllers/agents_controller.dart';
import '../data/usage_budget_data_source.dart';
import '../models/agent_session.dart';
import '../models/usage_budget.dart';
import 'agent_badge_identity.dart';
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
    final width = context.watch<AgentsController>().panelWidth;
    return Container(
      key: const ValueKey('inspector-panel'),
      width: width,
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
          // (#862 smoke feedback: memory provenance moved INTO the Context
          // tab — it is session context, not a bolted-on footer panel.)
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
    return TodoPanel(todos: todos, collapseKey: widget.session.id);
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

  Widget _tab(BuildContext context, _Tab t, String label, {Widget? trailing}) {
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
              if (trailing != null) ...[const SizedBox(width: 4), trailing],
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
        _row(context, 'Agent', _agentLabel(context)),
        _row(context, 'Cwd', session.cwd),
        _row(context, 'Status', session.status.wireValue),
        const SizedBox(height: 8),
        _ContextUsageGauge(
          tokensUsed: totalTokens,
          contextWindow: contextWindow,
        ),
        const SizedBox(height: 12),
        // Real per-provider usage so you can see when to switch models.
        const _UsageBudgetSection(),
        // OPC: enriched Context-tab details (cost, token breakdown, session
        // metadata). Only rendered once the session has at least one message;
        // zero-message sessions keep the gauge's "No messages yet" empty state.
        if (hasMessages) ..._buildDetails(context, controller, messageCount),
      ],
    );
  }

  /// Model-family-aware agent label, mirroring the session-row badge: an
  /// OpenRouter (aggregator) session reflects the actual model family
  /// (e.g. "OpenRouter" for a Llama model) rather than the stale creation
  /// agentId, which defaults to claude-code.
  String _agentLabel(BuildContext context) {
    // The resolver needs the server + configs controllers (always provided
    // app-wide). When the panel is pumped in isolation without them (some
    // widget tests), degrade gracefully to the raw agentId rather than throw.
    try {
      final providerToAgentKind =
          context.watch<AgentServerController>().providerToAgentKind;
      final configsCtrl = context.watch<AgentConfigsController>();
      final identity = resolveAgentBadgeIdentity(
        agentId: session.agentId,
        providerId: session.providerId,
        modelId: session.modelId,
        providerToAgentKind: providerToAgentKind,
        configById: configsCtrl.byId,
      );
      return identity.label;
    } on ProviderNotFoundException {
      return session.agentId;
    }
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
        _valueText(
          context,
          b.input.toString(),
          key: const ValueKey('context-tokens-input'),
        ),
      ),
      _rowChild(
        context,
        'Output tokens',
        _valueText(
          context,
          b.output.toString(),
          key: const ValueKey('context-tokens-output'),
        ),
      ),
      _rowChild(
        context,
        'Cache read',
        _valueText(context, b.cacheRead.toString()),
      ),
      _rowChild(
        context,
        'Cache write',
        _valueText(context, b.cacheWrite.toString()),
      ),
      _rowChild(
        context,
        'Reasoning tokens',
        _valueText(context, b.reasoning.toString()),
      ),
      const SizedBox(height: 8),
      _rowChild(
        context,
        'Model',
        _valueText(
          context,
          controller.modelDisplayName(session),
          key: const ValueKey('context-model'),
        ),
      ),
      _row(context, 'Created', formatLocalTimestamp(session.createdAt)),
      _row(context, 'Updated', formatLocalTimestamp(session.updatedAt)),
      _rowChild(
        context,
        'Messages',
        _valueText(
          context,
          messageCount.toString(),
          key: const ValueKey('context-message-count'),
        ),
      ),
      ..._memoriesUsedSection(context, controller),
    ];
  }

  /// #862 (smoke feedback): memory provenance rendered as a Context-page
  /// section in the same label/value idiom as the rows above — not a
  /// separate bolted-on collapsible below the tabs. States:
  ///   - provenance not fetched / never recorded → no section at all;
  ///   - recorded with zero memories → count row + an explicit "none" line
  ///     (the absence is stated, not silently hidden);
  ///   - recorded with memories → count row + one readable title per memory
  ///     (full vault path available on hover via tooltip).
  List<Widget> _memoriesUsedSection(
    BuildContext context,
    AgentsController controller,
  ) {
    final provenance = controller.memoryProvenanceFor(session.id);
    if (provenance == null || provenance['recorded'] != true) {
      return const [];
    }
    final memoryIds =
        (provenance['memoryIds'] as List<dynamic>?)?.cast<String>() ??
            const <String>[];
    final notePaths =
        (provenance['notePaths'] as List<dynamic>?)?.cast<String?>() ??
            const <String?>[];
    return [
      const SizedBox(height: 8),
      _rowChild(
        context,
        'Memories used',
        _valueText(
          context,
          memoryIds.length.toString(),
          key: const ValueKey('context-memories-count'),
        ),
      ),
      if (memoryIds.isEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 2, bottom: 4),
          child: Text(
            'No memories were used in this reply.',
            key: const ValueKey('context-memories-none'),
            style: TextStyle(
              fontSize: 12,
              fontStyle: FontStyle.italic,
              color: context.rhythm.textMuted,
            ),
          ),
        )
      else
        for (var i = 0; i < memoryIds.length; i++)
          _memoryUsedRow(context, i < notePaths.length ? notePaths[i] : null),
    ];
  }

  Widget _memoryUsedRow(BuildContext context, String? notePath) {
    final kind = _memoryKind(notePath);
    return Padding(
      padding: const EdgeInsets.only(top: 2, bottom: 2),
      child: Tooltip(
        message: notePath ?? 'No traceable source note',
        waitDuration: const Duration(milliseconds: 400),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Icon(
              Icons.psychology_alt_outlined,
              size: 13,
              color: context.rhythm.textMuted,
            ),
            const SizedBox(width: 6),
            if (kind != null) ...[
              Text(
                kind,
                style: TextStyle(fontSize: 11, color: context.rhythm.textMuted),
              ),
              const SizedBox(width: 6),
            ],
            Expanded(
              child: Text(
                _memoryTitle(notePath),
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 12,
                  color: context.rhythm.textSecondary,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Human-readable title from a vault note path: basename without `.md`,
  /// hyphens to spaces, sentence case. The raw path stays available via the
  /// row tooltip — nobody should have to read a slug.
  static String _memoryTitle(String? notePath) {
    if (notePath == null || notePath.isEmpty) return 'Untracked memory';
    final base = notePath
        .split('/')
        .last
        .replaceAll(RegExp(r'\.md$'), '')
        .replaceAll('-', ' ')
        .trim();
    if (base.isEmpty) return notePath;
    return base[0].toUpperCase() + base.substring(1);
  }

  /// The memory kind (its containing dir, e.g. `preference`), or null when
  /// the path has no directory component.
  static String? _memoryKind(String? notePath) {
    if (notePath == null) return null;
    final parts = notePath.split('/');
    return parts.length >= 2 ? parts[parts.length - 2] : null;
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
            style: TextStyle(fontSize: 12, color: context.rhythm.textPrimary),
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
            style: TextStyle(fontSize: 12, color: context.rhythm.textMuted),
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
              style: TextStyle(fontSize: 12, color: context.rhythm.textPrimary),
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

/// USAGE BUDGET — real per-provider usage (Anthropic windows, OpenRouter
/// credits, Gemini per-model quota; OpenAI shown as unavailable). Fetches on
/// mount and polls every 60s while the Context tab is visible (the data source
/// is server-cached so the poll is cheap). Self-contained: owns its data
/// source, state, and timer.
class _UsageBudgetSection extends StatefulWidget {
  const _UsageBudgetSection();

  @override
  State<_UsageBudgetSection> createState() => _UsageBudgetSectionState();
}

class _UsageBudgetSectionState extends State<_UsageBudgetSection> {
  static const _pollInterval = Duration(seconds: 60);

  final UsageBudgetDataSource _dataSource = UsageBudgetDataSource();
  Timer? _timer;
  UsageBudgetSnapshot? _snapshot;
  bool _loading = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    // Skip live network + the periodic timer under widget tests so mounting the
    // Context tab stays hermetic (no real :4001 call, no pending Timer).
    if (!Platform.environment.containsKey('FLUTTER_TEST')) {
      _refresh();
      _timer = Timer.periodic(_pollInterval, (_) => _refresh());
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<void> _refresh() async {
    if (_loading) return;
    _loading = true;
    if (mounted && _snapshot == null) setState(() {});
    try {
      final snap = await _dataSource.fetch();
      if (!mounted) return;
      setState(() {
        _snapshot = snap;
        _failed = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _failed = true); // keep any prior snapshot visible
    } finally {
      _loading = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    final r = context.rhythm;
    final header = Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          'USAGE BUDGET',
          style: TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.6,
            color: r.textMuted,
          ),
        ),
        InkWell(
          onTap: _loading ? null : _refresh,
          borderRadius: BorderRadius.circular(4),
          child: Padding(
            padding: const EdgeInsets.all(2),
            child: Icon(Icons.refresh, size: 12, color: r.textMuted),
          ),
        ),
      ],
    );

    final snap = _snapshot;
    if (snap == null) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          header,
          const SizedBox(height: 4),
          Text(
            _failed ? 'Unavailable' : 'Loading…',
            style: TextStyle(fontSize: 12, color: r.textMuted),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        header,
        const SizedBox(height: 6),
        for (final p in snap.providers) ...[
          _UsageBudgetProviderBlock(provider: p),
          const SizedBox(height: 8),
        ],
      ],
    );
  }
}

class _UsageBudgetProviderBlock extends StatelessWidget {
  const _UsageBudgetProviderBlock({required this.provider});

  final UsageBudgetProvider provider;

  /// Remaining-fraction → colour (inverse of the context gauge: full = green).
  static Color _barColor(BuildContext context, double remaining) {
    final r = context.rhythm;
    if (remaining > 0.4) return r.success;
    if (remaining > 0.15) return r.warning;
    return r.danger;
  }

  static String? _resetLabel(DateTime? resetAt) {
    if (resetAt == null) return null;
    final now = DateTime.now();
    final d = resetAt.toLocal().difference(now);
    if (d.isNegative) return 'resets now';
    if (d.inHours >= 24) return 'resets ${d.inDays}d';
    if (d.inHours >= 1) return 'resets ${d.inHours}h';
    return 'resets ${d.inMinutes}m';
  }

  @override
  Widget build(BuildContext context) {
    final r = context.rhythm;
    final providerLabel = Text(
      provider.label,
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w600,
        color: r.textSecondary,
      ),
    );

    if (provider.isUnavailable || provider.items.isEmpty) {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          providerLabel,
          const SizedBox(height: 2),
          Text(
            provider.reason ?? 'No usage data',
            style: TextStyle(fontSize: 10, color: r.textMuted),
          ),
        ],
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        providerLabel,
        const SizedBox(height: 3),
        for (final item in provider.items) ...[
          _UsageBudgetBar(item: item, color: _barColorFor(context, item)),
          const SizedBox(height: 3),
        ],
      ],
    );
  }

  static Color _barColorFor(BuildContext context, UsageBudgetItem item) {
    final frac = item.remainingFraction;
    if (frac == null) return context.rhythm.textMuted;
    return _barColor(context, frac);
  }
}

class _UsageBudgetBar extends StatelessWidget {
  const _UsageBudgetBar({required this.item, required this.color});

  final UsageBudgetItem item;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final r = context.rhythm;
    final frac = item.remainingFraction;
    final pctLabel = frac != null ? '${(frac * 100).round()}%' : '—';
    final reset = _UsageBudgetProviderBlock._resetLabel(item.resetAt);
    final rightBits = <String>[
      if (item.detail != null && item.detail!.isNotEmpty) item.detail!,
      if (reset != null) reset,
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Text(
                item.label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(fontSize: 11, color: r.textPrimary),
              ),
            ),
            const SizedBox(width: 6),
            Text(
              pctLabel,
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: frac != null ? color : r.textMuted,
              ),
            ),
          ],
        ),
        // Only draw a bar when a ceiling is known; a null fraction (pay-as-you-go
        // with no cap) would otherwise render an infinite spinner.
        if (frac != null) ...[
          const SizedBox(height: 2),
          ClipRRect(
            borderRadius: BorderRadius.circular(2),
            child: LinearProgressIndicator(
              value: frac,
              minHeight: 4,
              backgroundColor: r.border,
              valueColor: AlwaysStoppedAnimation<Color>(color),
            ),
          ),
        ],
        if (rightBits.isNotEmpty) ...[
          const SizedBox(height: 2),
          Text(
            rightBits.join(' · '),
            style: TextStyle(fontSize: 9, color: r.textMuted),
          ),
        ],
      ],
    );
  }
}
