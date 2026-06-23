import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agent_configs/controllers/agent_configs_controller.dart';
import '../../agent_configs/models/agent_config.dart';

// ---------------------------------------------------------------------------
// Available MCPs & Skills
// ---------------------------------------------------------------------------

const _kAvailableMcps = [
  'pco-services',
  'rhythm',
  'obsidian',
  'gmail-personal',
  'gmail-work',
  'canva',
  'spotify',
  'ableton',
  'nfl-mcp',
  'calendar',
  'pdf-tools',
  'minutes',
  'control-chrome',
  'claude-in-chrome',
];

const _kAvailableSkills = [
  'docx',
  'pptx',
  'xlsx',
  'pdf',
  'daily-morning-briefing',
  'ffb-roster',
  'ffb-trades',
  'ffb-dynasty',
  'fantasy-manager',
  'dev-planner',
  'issue-pipeline',
  'skill-creator',
  'patristic-bible-study',
  'engineering:code-review',
];

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/// Shows the [AgentProfileSheet] as a modal bottom sheet.
///
/// Pass [config] to open in edit mode; omit (or pass null) for create mode.
/// Returns the created / updated [AgentConfig], or null if dismissed.
Future<AgentConfig?> showAgentProfileSheet(
  BuildContext context, {
  AgentConfig? config,
}) {
  return showModalBottomSheet<AgentConfig>(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.rhythm.surface,
    shape: RoundedRectangleBorder(
      borderRadius: const BorderRadius.vertical(
        top: Radius.circular(RhythmRadius.xl),
      ),
      side: BorderSide(color: context.rhythm.border),
    ),
    builder: (sheetCtx) => ChangeNotifierProvider.value(
      value: context.read<AgentConfigsController>(),
      child: AgentProfileSheet(config: config),
    ),
  );
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

class AgentProfileSheet extends StatefulWidget {
  const AgentProfileSheet({super.key, this.config});

  /// Non-null = edit mode; null = create mode.
  final AgentConfig? config;

  @override
  State<AgentProfileSheet> createState() => _AgentProfileSheetState();
}

class _AgentProfileSheetState extends State<AgentProfileSheet> {
  late final TextEditingController _labelController;
  late final TextEditingController _iconController;
  late final TextEditingController _systemPromptController;

  late bool _isManager;

  // null means "all allowed" (no restriction); non-null means restricted set.
  List<String>? _selectedMcps;
  List<String>? _selectedSkills;

  bool _loading = false;
  String? _error;

  bool get _isEdit => widget.config != null;

  @override
  void initState() {
    super.initState();
    final cfg = widget.config;
    _labelController = TextEditingController(text: cfg?.label ?? '');
    _iconController = TextEditingController(text: cfg?.icon ?? 'terminal');
    _systemPromptController =
        TextEditingController(text: cfg?.systemPrompt ?? '');
    _isManager = cfg?.isManager ?? false;
    _selectedMcps =
        cfg?.allowedMcps != null ? List<String>.from(cfg!.allowedMcps!) : null;
    _selectedSkills = cfg?.allowedSkills != null
        ? List<String>.from(cfg!.allowedSkills!)
        : null;
  }

  @override
  void dispose() {
    _labelController.dispose();
    _iconController.dispose();
    _systemPromptController.dispose();
    super.dispose();
  }

  // --------------------------------------------------------------------------
  // Save
  // --------------------------------------------------------------------------

  Future<void> _save() async {
    final label = _labelController.text.trim();
    if (label.isEmpty) {
      setState(() => _error = 'Label is required.');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    final controller = context.read<AgentConfigsController>();

    AgentConfig? result;

    if (_isEdit) {
      final patch = <String, dynamic>{
        'label': label,
        'icon': _iconController.text.trim().isNotEmpty
            ? _iconController.text.trim()
            : 'terminal',
        'isManager': _isManager,
        'systemPrompt': _systemPromptController.text.trim().isEmpty
            ? null
            : _systemPromptController.text.trim(),
        'allowedMcpsJson':
            _selectedMcps != null ? jsonEncode(_selectedMcps) : null,
        'allowedSkillsJson':
            _selectedSkills != null ? jsonEncode(_selectedSkills) : null,
      };
      final ok = await controller.update(widget.config!.id, patch);
      if (ok) {
        result = controller.byId(widget.config!.id);
      }
    } else {
      final input = <String, dynamic>{
        'label': label,
        'icon': _iconController.text.trim().isNotEmpty
            ? _iconController.text.trim()
            : 'terminal',
        'isAgent': true,
        'enabled': true,
        'isManager': _isManager,
        'systemPrompt': _systemPromptController.text.trim().isEmpty
            ? null
            : _systemPromptController.text.trim(),
        'allowedMcpsJson':
            _selectedMcps != null ? jsonEncode(_selectedMcps) : null,
        'allowedSkillsJson':
            _selectedSkills != null ? jsonEncode(_selectedSkills) : null,
      };
      result = await controller.create(input);
    }

    if (!mounted) return;
    setState(() => _loading = false);

    if (result == null) {
      setState(
        () => _error = controller.error ?? 'Failed to save profile.',
      );
      return;
    }

    Navigator.of(context).pop(result);
  }

  // --------------------------------------------------------------------------
  // Build
  // --------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      minChildSize: 0.5,
      maxChildSize: 0.95,
      expand: false,
      builder: (_, scrollController) => Column(
        children: [
          _buildHandle(),
          Expanded(
            child: ListView(
              controller: scrollController,
              padding: EdgeInsets.only(
                left: 24,
                right: 24,
                top: 8,
                bottom: MediaQuery.of(context).viewInsets.bottom + 32,
              ),
              children: [
                _buildHeader(),
                const SizedBox(height: 24),
                _buildIdentitySection(),
                const SizedBox(height: 24),
                _buildSystemPromptSection(),
                const SizedBox(height: 16),
                _buildManagerToggle(),
                const SizedBox(height: 24),
                _buildMcpsSection(),
                const SizedBox(height: 24),
                _buildSkillsSection(),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _error!,
                    style:
                        TextStyle(color: context.rhythm.danger, fontSize: 13),
                  ),
                ],
                const SizedBox(height: 24),
                _buildSaveButton(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // --------------------------------------------------------------------------
  // Section builders
  // --------------------------------------------------------------------------

  Widget _buildHandle() {
    return Padding(
      padding: const EdgeInsets.only(top: 12, bottom: 4),
      child: Center(
        child: Container(
          width: 36,
          height: 4,
          decoration: BoxDecoration(
            color: context.rhythm.border,
            borderRadius: BorderRadius.circular(RhythmRadius.pill),
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Row(
      children: [
        Expanded(
          child: Text(
            _isEdit ? 'Edit Profile' : 'New Profile',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w700,
              color: context.rhythm.textPrimary,
            ),
          ),
        ),
        IconButton(
          icon: Icon(Icons.close, size: 20, color: context.rhythm.textMuted),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ],
    );
  }

  Widget _buildIdentitySection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionLabel('Identity'),
        const SizedBox(height: 10),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Icon field
            SizedBox(
              width: 90,
              child: TextField(
                controller: _iconController,
                style: TextStyle(color: context.rhythm.textPrimary),
                decoration: _inputDecoration(context, 'Icon'),
              ),
            ),
            const SizedBox(width: 12),
            // Label field
            Expanded(
              child: TextField(
                controller: _labelController,
                autofocus: !_isEdit,
                style: TextStyle(color: context.rhythm.textPrimary),
                decoration: _inputDecoration(context, 'Label'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildSystemPromptSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionLabel('System Prompt'),
        const SizedBox(height: 10),
        TextField(
          controller: _systemPromptController,
          minLines: 4,
          maxLines: 10,
          style: TextStyle(color: context.rhythm.textPrimary, fontSize: 13),
          decoration: _inputDecoration(
            context,
            'Custom system instructions…',
            alignLabelWithHint: true,
          ),
        ),
      ],
    );
  }

  Widget _buildManagerToggle() {
    return Container(
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border: Border.all(color: context.rhythm.border),
      ),
      child: CheckboxListTile(
        value: _isManager,
        onChanged: (v) => setState(() => _isManager = v ?? false),
        activeColor: context.rhythm.accent,
        title: Text(
          'Manager agent',
          style: TextStyle(
            color: context.rhythm.textPrimary,
            fontWeight: FontWeight.w600,
          ),
        ),
        subtitle: Text(
          'This agent orchestrates specialist agents',
          style: TextStyle(color: context.rhythm.textMuted, fontSize: 12),
        ),
        controlAffinity: ListTileControlAffinity.leading,
      ),
    );
  }

  Widget _buildMcpsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: _sectionLabel('Allowed MCPs')),
            if (_selectedMcps == null)
              TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.accent,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                ),
                onPressed: () =>
                    setState(() => _selectedMcps = List.from(_kAvailableMcps)),
                child: const Text('Restrict', style: TextStyle(fontSize: 13)),
              )
            else
              TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.textSecondary,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                ),
                onPressed: () => setState(() => _selectedMcps = null),
                child: const Text('Allow all', style: TextStyle(fontSize: 13)),
              ),
          ],
        ),
        const SizedBox(height: 8),
        if (_selectedMcps == null)
          _allAllowedBanner('All MCPs allowed')
        else
          _filterChipWrap(
            items: _kAvailableMcps,
            selected: _selectedMcps!,
            onToggle: (mcp) => setState(() {
              if (_selectedMcps!.contains(mcp)) {
                _selectedMcps!.remove(mcp);
              } else {
                _selectedMcps!.add(mcp);
              }
            }),
          ),
      ],
    );
  }

  Widget _buildSkillsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: _sectionLabel('Allowed Skills')),
            if (_selectedSkills == null)
              TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.accent,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                ),
                onPressed: () => setState(
                  () => _selectedSkills = List.from(_kAvailableSkills),
                ),
                child: const Text('Restrict', style: TextStyle(fontSize: 13)),
              )
            else
              TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.textSecondary,
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                ),
                onPressed: () => setState(() => _selectedSkills = null),
                child: const Text('Allow all', style: TextStyle(fontSize: 13)),
              ),
          ],
        ),
        const SizedBox(height: 8),
        if (_selectedSkills == null)
          _allAllowedBanner('All Skills allowed')
        else
          _filterChipWrap(
            items: _kAvailableSkills,
            selected: _selectedSkills!,
            onToggle: (skill) => setState(() {
              if (_selectedSkills!.contains(skill)) {
                _selectedSkills!.remove(skill);
              } else {
                _selectedSkills!.add(skill);
              }
            }),
          ),
      ],
    );
  }

  Widget _buildSaveButton() {
    return FilledButton(
      style: FilledButton.styleFrom(
        backgroundColor: context.rhythm.accent,
        minimumSize: const Size.fromHeight(48),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(RhythmRadius.sm),
        ),
      ),
      onPressed: _loading ? null : _save,
      child: _loading
          ? SizedBox(
              height: 20,
              width: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: Colors.white.withValues(alpha: 0.8),
              ),
            )
          : Text(_isEdit ? 'Save changes' : 'Create profile'),
    );
  }

  // --------------------------------------------------------------------------
  // Small helpers
  // --------------------------------------------------------------------------

  Widget _sectionLabel(String text) {
    return Text(
      text.toUpperCase(),
      style: TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.8,
        color: context.rhythm.textMuted,
      ),
    );
  }

  Widget _allAllowedBanner(String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Row(
        children: [
          Icon(
            Icons.all_inclusive,
            size: 16,
            color: context.rhythm.textMuted,
          ),
          const SizedBox(width: 8),
          Text(
            label,
            style: TextStyle(
              color: context.rhythm.textSecondary,
              fontSize: 13,
            ),
          ),
        ],
      ),
    );
  }

  Widget _filterChipWrap({
    required List<String> items,
    required List<String> selected,
    required ValueChanged<String> onToggle,
  }) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: items.map((item) {
        final isSelected = selected.contains(item);
        return FilterChip(
          label: Text(item),
          selected: isSelected,
          onSelected: (_) => onToggle(item),
          selectedColor: context.rhythm.accentMuted,
          checkmarkColor: context.rhythm.accent,
          labelStyle: TextStyle(
            color: isSelected
                ? context.rhythm.accent
                : context.rhythm.textSecondary,
            fontSize: 12,
            fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
          ),
          backgroundColor: context.rhythm.surfaceMuted,
          side: BorderSide(
            color: isSelected
                ? context.rhythm.accent.withValues(alpha: 0.4)
                : context.rhythm.border,
          ),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(RhythmRadius.pill),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
        );
      }).toList(),
    );
  }

  InputDecoration _inputDecoration(
    BuildContext context,
    String hint, {
    bool alignLabelWithHint = false,
  }) {
    return InputDecoration(
      hintText: hint,
      alignLabelWithHint: alignLabelWithHint,
      hintStyle: TextStyle(color: context.rhythm.textMuted, fontSize: 13),
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        borderSide: BorderSide(color: context.rhythm.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        borderSide: BorderSide(color: context.rhythm.accent, width: 1.5),
      ),
      filled: true,
      fillColor: context.rhythm.surfaceMuted,
    );
  }
}
