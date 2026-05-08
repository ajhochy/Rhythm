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
/// - Command (full-width monospace)
/// - AI Agent checkbox (toggles resume block)
/// - Resume block (visible when isAgent is true):
///   - "Supports session resume" checkbox
///   - Advanced ExpansionTile with resumeCommand + sessionIdPattern fields
///
/// Save-on-blur with 500ms debounce for text edits.
/// Toggle/checkbox changes save immediately.
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
  late final TextEditingController _commandCtrl;
  late final TextEditingController _resumeCommandCtrl;
  late final TextEditingController _sessionIdPatternCtrl;

  // Focus nodes
  late final FocusNode _labelFocus;
  late final FocusNode _commandFocus;
  late final FocusNode _resumeCommandFocus;
  late final FocusNode _sessionIdPatternFocus;

  // Local state mirrors for immediate UI update
  late bool _isAgent;
  late bool _canResume;

  // Validation errors
  String? _commandError;
  String? _resumeCommandError;
  String? _sessionIdPatternError;

  // Debounce timer
  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    final c = widget.config;
    _isAgent = c.isAgent;
    _canResume = c.canResume;

    _labelCtrl = TextEditingController(text: c.label);
    _commandCtrl = TextEditingController(text: c.command);
    _resumeCommandCtrl = TextEditingController(text: c.resumeCommand ?? '');
    _sessionIdPatternCtrl =
        TextEditingController(text: c.sessionIdPattern ?? '');

    _labelFocus = FocusNode()..addListener(() => _onFocusChange(_labelFocus));
    _commandFocus = FocusNode()
      ..addListener(() => _onFocusChange(_commandFocus));
    _resumeCommandFocus = FocusNode()
      ..addListener(() => _onFocusChange(_resumeCommandFocus));
    _sessionIdPatternFocus = FocusNode()
      ..addListener(() => _onFocusChange(_sessionIdPatternFocus));
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _labelCtrl.dispose();
    _commandCtrl.dispose();
    _resumeCommandCtrl.dispose();
    _sessionIdPatternCtrl.dispose();
    _labelFocus.dispose();
    _commandFocus.dispose();
    _resumeCommandFocus.dispose();
    _sessionIdPatternFocus.dispose();
    super.dispose();
  }

  // --------------------------------------------------------------------------
  // Save logic
  // --------------------------------------------------------------------------

  bool _validate() {
    bool valid = true;
    setState(() {
      // command non-empty
      if (_commandCtrl.text.trim().isEmpty) {
        _commandError = 'Command is required';
        valid = false;
      } else {
        _commandError = null;
      }

      // resumeCommand must contain {{sessionId}} when canResume
      if (_canResume) {
        if (!_resumeCommandCtrl.text.contains('{{sessionId}}')) {
          _resumeCommandError = 'Must contain {{sessionId}}';
          valid = false;
        } else {
          _resumeCommandError = null;
        }
      } else {
        _resumeCommandError = null;
      }

      // sessionIdPattern must be a valid regex
      final pattern = _sessionIdPatternCtrl.text.trim();
      if (pattern.isNotEmpty) {
        try {
          RegExp(pattern);
          _sessionIdPatternError = null;
        } catch (_) {
          _sessionIdPatternError = 'Invalid regular expression';
          valid = false;
        }
      } else {
        _sessionIdPatternError = null;
      }
    });
    return valid;
  }

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
    if (!_validate()) return;
    final patch = <String, dynamic>{
      'command': _commandCtrl.text.trim(),
      'isAgent': _isAgent,
      'canResume': _canResume,
      'resumeCommand': _resumeCommandCtrl.text.trim().isEmpty
          ? null
          : _resumeCommandCtrl.text.trim(),
      'sessionIdPattern': _sessionIdPatternCtrl.text.trim().isEmpty
          ? null
          : _sessionIdPatternCtrl.text.trim(),
    };
    // Only send label for custom cards
    if (!widget.config.isPreset) {
      patch['label'] = _labelCtrl.text.trim();
    }
    if (!mounted) return;
    await context
        .read<AgentConfigsController>()
        .update(widget.config.id, patch);
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

          // ── Command field ──
          TextField(
            controller: _commandCtrl,
            focusNode: _commandFocus,
            style: TextStyle(
              fontSize: 12,
              fontFamily: 'Menlo',
              color: rhythm.textPrimary,
            ),
            decoration: InputDecoration(
              isDense: true,
              contentPadding:
                  const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(color: rhythm.border),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(color: rhythm.border),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(color: rhythm.accent, width: 2),
              ),
              errorBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(color: rhythm.danger),
              ),
              focusedErrorBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(color: rhythm.danger, width: 2),
              ),
              hintText: 'claude --dangerously-skip-permissions',
              hintStyle: TextStyle(
                color: rhythm.textMuted,
                fontFamily: 'Menlo',
                fontSize: 12,
              ),
              errorText: _commandError,
              errorStyle: TextStyle(color: rhythm.danger, fontSize: 11),
              filled: true,
              fillColor: rhythm.surface,
            ),
            onChanged: (_) => _saveDebounced(),
          ),

          const SizedBox(height: 8),

          // ── Status badge ──
          _StatusBadge(isAvailable: widget.isAvailable),

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

          // ── Resume block (visible when isAgent) ──
          if (_isAgent) ...[
            const SizedBox(height: 8),
            _CheckboxRow(
              value: _canResume,
              label: 'Supports session resume',
              onChanged: (val) {
                setState(() => _canResume = val);
                _saveToggle({'canResume': val});
              },
            ),

            // Advanced disclosure (visible when canResume)
            if (_canResume) ...[
              const SizedBox(height: 4),
              Theme(
                data: Theme.of(context).copyWith(
                  dividerColor: Colors.transparent,
                ),
                child: ExpansionTile(
                  tilePadding: EdgeInsets.zero,
                  title: Text(
                    'Advanced',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: rhythm.textSecondary,
                    ),
                  ),
                  iconColor: rhythm.textMuted,
                  collapsedIconColor: rhythm.textMuted,
                  children: [
                    const SizedBox(height: 8),
                    // Resume command field
                    TextField(
                      controller: _resumeCommandCtrl,
                      focusNode: _resumeCommandFocus,
                      style: TextStyle(
                        fontSize: 12,
                        fontFamily: 'Menlo',
                        color: rhythm.textPrimary,
                      ),
                      decoration: InputDecoration(
                        isDense: true,
                        labelText: 'Resume command',
                        labelStyle: TextStyle(
                          fontSize: 12,
                          color: rhythm.textSecondary,
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 8),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(RhythmRadius.sm),
                          borderSide: BorderSide(color: rhythm.border),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(RhythmRadius.sm),
                          borderSide: BorderSide(color: rhythm.border),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(RhythmRadius.sm),
                          borderSide:
                              BorderSide(color: rhythm.accent, width: 2),
                        ),
                        errorBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(RhythmRadius.sm),
                          borderSide: BorderSide(color: rhythm.danger),
                        ),
                        focusedErrorBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(RhythmRadius.sm),
                          borderSide:
                              BorderSide(color: rhythm.danger, width: 2),
                        ),
                        hintText: 'claude --resume {{sessionId}}',
                        hintStyle: TextStyle(
                          color: rhythm.textMuted,
                          fontFamily: 'Menlo',
                          fontSize: 12,
                        ),
                        errorText: _resumeCommandError,
                        errorStyle:
                            TextStyle(color: rhythm.danger, fontSize: 11),
                        filled: true,
                        fillColor: rhythm.surface,
                      ),
                      onChanged: (_) => _saveDebounced(),
                    ),

                    const SizedBox(height: 10),

                    // Session ID pattern field
                    TextField(
                      controller: _sessionIdPatternCtrl,
                      focusNode: _sessionIdPatternFocus,
                      style: TextStyle(
                        fontSize: 12,
                        fontFamily: 'Menlo',
                        color: rhythm.textPrimary,
                      ),
                      decoration: InputDecoration(
                        isDense: true,
                        labelText: 'Session ID pattern',
                        labelStyle: TextStyle(
                          fontSize: 12,
                          color: rhythm.textSecondary,
                        ),
                        helperText: 'Regex with one capture group',
                        helperStyle:
                            TextStyle(fontSize: 11, color: rhythm.textMuted),
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 10, vertical: 8),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(RhythmRadius.sm),
                          borderSide: BorderSide(color: rhythm.border),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(RhythmRadius.sm),
                          borderSide: BorderSide(color: rhythm.border),
                        ),
                        focusedBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(RhythmRadius.sm),
                          borderSide:
                              BorderSide(color: rhythm.accent, width: 2),
                        ),
                        errorBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(RhythmRadius.sm),
                          borderSide: BorderSide(color: rhythm.danger),
                        ),
                        focusedErrorBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(RhythmRadius.sm),
                          borderSide:
                              BorderSide(color: rhythm.danger, width: 2),
                        ),
                        errorText: _sessionIdPatternError,
                        errorStyle:
                            TextStyle(color: rhythm.danger, fontSize: 11),
                        filled: true,
                        fillColor: rhythm.surface,
                      ),
                      onChanged: (_) => _saveDebounced(),
                    ),

                    const SizedBox(height: 8),
                  ],
                ),
              ),
            ],
          ],
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
// Status badge
// ---------------------------------------------------------------------------

class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.isAvailable});

  final bool isAvailable;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    const configuredColor = Color(0xFF10B981);
    final needsSetupColor = rhythm.warning;

    final label = isAvailable ? 'Configured' : 'Needs setup';
    final bgColor = isAvailable
        ? configuredColor.withValues(alpha: 0.12)
        : needsSetupColor.withValues(alpha: 0.12);
    final textColor = isAvailable ? configuredColor : needsSetupColor;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(RhythmRadius.pill),
        border: Border.all(color: textColor.withValues(alpha: 0.25)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: textColor,
        ),
      ),
    );
  }
}
