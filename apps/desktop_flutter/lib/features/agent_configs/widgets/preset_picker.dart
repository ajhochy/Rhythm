import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../controllers/agent_configs_controller.dart';
import 'agent_icon.dart';

// ---------------------------------------------------------------------------
// AgentPreset — lightweight data class for built-in presets
// ---------------------------------------------------------------------------

/// Describes a built-in agent preset.
///
/// These values are used both by the picker (to render menu items) and,
/// when the user selects a preset that is absent from the configs list, to
/// populate the payload sent to [AgentConfigsController.create].
class AgentPreset {
  const AgentPreset({
    required this.id,
    required this.label,
    required this.icon,
    required this.isAgent,
  });

  final String id;
  final String label;

  /// Asset path or `'terminal'` sentinel (same convention as [AgentConfig.icon]).
  final String icon;

  final bool isAgent;
}

// ---------------------------------------------------------------------------
// Built-in preset definitions (single source of truth)
// ---------------------------------------------------------------------------

/// The canonical list of built-in agent presets.
///
/// These match the seeds applied by the migration in `#481`.  Keep this list
/// as the single source of truth — do not duplicate these definitions
/// anywhere else in the codebase.
const List<AgentPreset> kBuiltInPresets = [
  AgentPreset(
    id: 'claude-code',
    label: 'Claude Code',
    icon: 'assets/agents/claude-code.png',
    isAgent: true,
  ),
  AgentPreset(
    id: 'codex',
    label: 'Codex',
    icon: 'assets/agents/codex.png',
    isAgent: true,
  ),
  AgentPreset(
    id: 'gemini-cli',
    label: 'Gemini CLI',
    icon: 'assets/agents/gemini-cli.png',
    isAgent: true,
  ),
  AgentPreset(
    id: 'opencode',
    label: 'OpenCode',
    icon: 'assets/agents/opencode.png',
    isAgent: true,
  ),
];

// ---------------------------------------------------------------------------
// PresetPicker widget
// ---------------------------------------------------------------------------

/// A [MenuAnchor]-based preset picker attached to any trigger widget.
///
/// Usage:
/// ```dart
/// PresetPicker(
///   builder: (context, controller, child) => TextButton(
///     onPressed: () => controller.isOpen
///         ? controller.close()
///         : controller.open(),
///     child: const Text('+ Add agent'),
///   ),
/// )
/// ```
///
/// The picker shows built-in presets that are **not** already present in
/// [AgentConfigsController.configs] (matched by [AgentConfig.presetId]),
/// followed by a divider and a "+ Custom" option.
///
/// Selecting a preset calls [AgentConfigsController.create] with the preset
/// fields; selecting Custom creates a blank disabled card for the user to
/// configure.
class PresetPicker extends StatelessWidget {
  const PresetPicker({
    super.key,
    required this.builder,
  });

  /// Passed directly to [MenuAnchor.builder].
  final MenuAnchorChildBuilder builder;

  @override
  Widget build(BuildContext context) {
    // Read once — we need the present presetIds to filter the menu.
    final controller = context.read<AgentConfigsController>();
    final existingPresetIds =
        controller.configs.map((c) => c.presetId).whereType<String>().toSet();

    final missingPresets = kBuiltInPresets
        .where((p) => !existingPresetIds.contains(p.id))
        .toList();

    final menuItems = <Widget>[
      // ── Missing built-in presets ──
      for (final preset in missingPresets)
        MenuItemButton(
          leadingIcon: Padding(
            padding: const EdgeInsets.only(right: 4),
            child:
                AgentIcon(preset.icon, size: 18, fallbackLabel: preset.label),
          ),
          onPressed: () => _addPreset(context, preset),
          child: Text(preset.label),
        ),

      // ── Divider + Custom ──
      if (missingPresets.isNotEmpty) const Divider(height: 1),
      MenuItemButton(
        leadingIcon: const Padding(
          padding: EdgeInsets.only(right: 4),
          child: Icon(Icons.terminal, size: 18),
        ),
        onPressed: () => _addCustom(context),
        child: const Text('+ Custom'),
      ),
    ];

    return MenuAnchor(
      menuChildren: menuItems,
      builder: builder,
    );
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  Future<void> _addPreset(BuildContext context, AgentPreset preset) async {
    await context.read<AgentConfigsController>().create({
      'label': preset.label,
      'icon': preset.icon,
      'isAgent': preset.isAgent,
      'enabled': true,
      'presetId': preset.id,
    });
  }

  Future<void> _addCustom(BuildContext context) async {
    await context.read<AgentConfigsController>().create({
      'label': 'Custom Agent',
      'icon': 'terminal',
      'isAgent': false,
      'enabled': false,
    });
  }
}
