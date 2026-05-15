import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../../../app/core/constants/app_constants.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../models/agent_session.dart';

/// M3-5: right-rail inspector panel for the active session.
///
/// Tabs:
///   - Context: provider, model, cwd, tokens, cost.
///   - Changes: working-tree diff fetched from GET /agent-sessions/:id/diff.
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
  List<_DiffEntry>? _diff;
  bool _diffLoading = false;
  String? _diffError;

  @override
  void didUpdateWidget(SessionSidePanel old) {
    super.didUpdateWidget(old);
    if (old.session.id != widget.session.id) {
      setState(() => _diff = null);
      if (_selected == _Tab.changes) _loadDiff();
    }
  }

  Future<void> _loadDiff() async {
    setState(() {
      _diffLoading = true;
      _diffError = null;
    });
    try {
      final res = await http.get(
        Uri.parse(
          '${AppConstants.agentLocalBaseUrl}/agent-sessions/${widget.session.id}/diff',
        ),
      );
      if (res.statusCode != 200) {
        throw Exception('HTTP ${res.statusCode}');
      }
      final list = (jsonDecode(res.body) as List<dynamic>)
          .map((e) => _DiffEntry.fromJson(e as Map<String, dynamic>))
          .toList();
      if (!mounted) return;
      setState(() {
        _diff = list;
        _diffLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _diffError = e.toString();
        _diffLoading = false;
      });
    }
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
            onSelect: (t) {
              setState(() => _selected = t);
              if (t == _Tab.changes && _diff == null && !_diffLoading) {
                _loadDiff();
              }
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
        return _ChangesTab(
          loading: _diffLoading,
          error: _diffError,
          entries: _diff,
          onRefresh: _loadDiff,
        );
      case _Tab.terminal:
        return const _PlaceholderTab(
          message: 'Captured bash output will appear here.',
        );
    }
  }
}

class _Tabs extends StatelessWidget {
  const _Tabs({required this.selected, required this.onSelect});
  final _Tab selected;
  final ValueChanged<_Tab> onSelect;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
      child: Row(
        children: [
          _tab(context, _Tab.context, 'Context'),
          _tab(context, _Tab.changes, 'Changes'),
          _tab(context, _Tab.terminal, 'Terminal'),
        ],
      ),
    );
  }

  Widget _tab(BuildContext context, _Tab t, String label) {
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
          child: Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color:
                  isSel ? context.rhythm.textPrimary : context.rhythm.textMuted,
            ),
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

class _ChangesTab extends StatelessWidget {
  const _ChangesTab({
    required this.loading,
    required this.error,
    required this.entries,
    required this.onRefresh,
  });
  final bool loading;
  final String? error;
  final List<_DiffEntry>? entries;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    if (loading) {
      return Center(
        child: CircularProgressIndicator(color: context.rhythm.accent),
      );
    }
    if (error != null) {
      return Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(error!, style: const TextStyle(color: Color(0xFFEF4444))),
            const SizedBox(height: 8),
            TextButton(onPressed: onRefresh, child: const Text('Retry')),
          ],
        ),
      );
    }
    final list = entries ?? const [];
    if (list.isEmpty) {
      return const _PlaceholderTab(message: 'No file changes yet.');
    }
    return ListView.separated(
      padding: const EdgeInsets.all(12),
      itemCount: list.length,
      separatorBuilder: (_, __) => const SizedBox(height: 8),
      itemBuilder: (_, i) => SelectableText(
        list[i].path,
        style: const TextStyle(fontSize: 12),
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

class _DiffEntry {
  _DiffEntry({required this.path});
  final String path;
  factory _DiffEntry.fromJson(Map<String, dynamic> json) =>
      _DiffEntry(path: json['path'] as String? ?? '');
}
