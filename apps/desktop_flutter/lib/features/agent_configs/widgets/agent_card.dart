import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../controllers/agent_configs_controller.dart';
import '../models/agent_config.dart';
import 'agent_icon.dart';

/// Per-card inline edit form for an [AgentConfig].
///
/// Fields:
/// - Label (editable; preset cards: read-only)
/// - Enabled switch
/// - AI Agent checkbox
/// - Provider-based availability badge ("Available" / "Unavailable")
///
/// The legacy CLI fields (command, resume command, session-id pattern,
/// "Supports session resume" checkbox) were removed in #575 when the Opencode
/// SDK replaced the PTY/CLI execution path. Availability is now driven by the
/// Opencode capabilities map surfaced by `AgentServerController`.
class AgentCard extends StatefulWidget {
  const AgentCard({
    super.key,
    required this.config,
    required this.isAvailable,
  });

  final AgentConfig config;
  final bool isAvailable;

  @override
  State<AgentCard> createState() => _AgentCardState();
}

class _AgentCardState extends State<AgentCard> {
  // Text controllers
  late final TextEditingController _labelCtrl;

  // Focus nodes
  late final FocusNode _labelFocus;

  // Local state mirror for immediate UI update
  late bool _isAgent;

  // Debounce timer
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    final c = widget.config;
    _isAgent = c.isAgent;

    _labelCtrl = TextEditingController(text: c.label);
    _labelFocus = FocusNode()..addListener(() => _onFocusChange(_labelFocus));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _labelCtrl.dispose();
    _labelFocus.dispose();
    super.dispose();
  }

  // --------------------------------------------------------------------------
  // Save logic
  // --------------------------------------------------------------------------

  void _saveDebounced() {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), _save);
  }

  void _onFocusChange(FocusNode node) {
    if (!node.hasFocus) {
      _debounce?.cancel();
      _save();
    }
  }

  Future<void> _save() async {
    // Only the label is editable from this card (and only for non-preset
    // entries). Toggles save themselves immediately via [_saveToggle].
    if (widget.config.isPreset) return;
    if (!mounted) return;
    await context.read<AgentConfigsController>().update(
      widget.config.id,
      {'label': _labelCtrl.text.trim()},
    );
  }

  Future<void> _saveToggle(Map<String, dynamic> patch) async {
    if (!mounted) return;
    await context
        .read<AgentConfigsController>()
        .update(widget.config.id, patch);
  }

  // --------------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------------

  Future<void> _confirmDelete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text('Delete "${widget.config.label}"?'),
        content: const Text(
          'This agent configuration will be permanently removed.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: FilledButton.styleFrom(
              backgroundColor: context.rhythm.danger,
            ),
            child: const Text(
              'Delete',
              style: TextStyle(color: Colors.white),
            ),
          ),
        ],
      ),
    );
    if (confirmed == true && mounted) {
      await context.read<AgentConfigsController>().delete(widget.config.id);
    }
  }

  // --------------------------------------------------------------------------
  // Build
  // --------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final isPreset = widget.config.isPreset;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.lg),
        border: Border.all(color: rhythm.border),
        boxShadow: RhythmElevation.panel,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Row: icon | label | enabled switch | delete button ──
          Row(
            children: [
              AgentIcon(
                widget.config.icon,
                size: 36,
                fallbackLabel: widget.config.label,
              ),
              const SizedBox(width: 14),
              Expanded(
                child: isPreset
                    ? Text(
                        widget.config.label,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: rhythm.textPrimary,
                        ),
                        overflow: TextOverflow.ellipsis,
                      )
                    : TextField(
                        controller: _labelCtrl,
                        focusNode: _labelFocus,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: rhythm.textPrimary,
                        ),
                        decoration: InputDecoration(
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 6,
                          ),
                          border: OutlineInputBorder(
                            borderRadius:
                                BorderRadius.circular(RhythmRadius.sm),
                            borderSide: BorderSide(color: rhythm.border),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius:
                                BorderRadius.circular(RhythmRadius.sm),
                            borderSide: BorderSide(color: rhythm.border),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius:
                                BorderRadius.circular(RhythmRadius.sm),
                            borderSide:
                                BorderSide(color: rhythm.accent, width: 2),
                          ),
                          hintText: 'Agent name',
                          hintStyle: TextStyle(color: rhythm.textMuted),
                          filled: true,
                          fillColor: rhythm.surface,
                        ),
                        onChanged: (_) => _saveDebounced(),
                      ),
              ),
              const SizedBox(width: 8),
              // Enabled switch
              Switch(
                value: widget.config.enabled,
                onChanged: (val) {
                  _saveToggle({'enabled': val});
                },
                activeThumbColor: rhythm.accent,
                activeTrackColor: rhythm.accentMuted,
              ),
              // Delete button (custom cards only)
              if (!isPreset) ...[
                const SizedBox(width: 4),
                IconButton(
                  icon: Icon(Icons.delete_outline,
                      size: 18, color: rhythm.danger),
                  tooltip: 'Delete agent',
                  onPressed: _confirmDelete,
                  style: IconButton.styleFrom(
                    padding: const EdgeInsets.all(6),
                  ),
                ),
              ],
            ],
          ),

          const SizedBox(height: 12),

          // ── Provider-based availability badge ──
          _AvailabilityBadge(isAvailable: widget.isAvailable),

          const SizedBox(height: 12),

          // ── AI Agent checkbox ──
          _CheckboxRow(
            value: _isAgent,
            label: 'AI Agent',
            onChanged: (val) {
              setState(() => _isAgent = val);
              _saveToggle({'isAgent': val});
            },
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Checkbox row helper
// ---------------------------------------------------------------------------

class _CheckboxRow extends StatelessWidget {
  const _CheckboxRow({
    required this.value,
    required this.label,
    required this.onChanged,
  });

  final bool value;
  final String label;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    return InkWell(
      borderRadius: BorderRadius.circular(RhythmRadius.sm),
      onTap: () => onChanged(!value),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: 20,
            height: 20,
            child: Checkbox(
              value: value,
              onChanged: (v) => onChanged(v ?? value),
              activeColor: rhythm.accent,
              materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
              visualDensity: VisualDensity.compact,
            ),
          ),
          const SizedBox(width: 8),
          Text(
            label,
            style: TextStyle(
              fontSize: 13,
              color: rhythm.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Availability badge — driven by Opencode capabilities map
// ---------------------------------------------------------------------------

class _AvailabilityBadge extends StatelessWidget {
  const _AvailabilityBadge({required this.isAvailable});

  final bool isAvailable;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    const availableColor = Color(0xFF10B981);
    final unavailableColor = rhythm.textMuted;

    final label = isAvailable ? 'Available' : 'Unavailable';
    final fg = isAvailable ? availableColor : unavailableColor;
    final bg = fg.withValues(alpha: 0.12);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(RhythmRadius.pill),
        border: Border.all(color: fg.withValues(alpha: 0.25)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: fg,
        ),
      ),
    );
  }
}
