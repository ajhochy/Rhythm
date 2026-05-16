// HOW TO INVOKE FROM agents_view.dart
// ─────────────────────────────────────────────────────────────────────────────
// 1. Import this file:
//      import '_agent_settings_sheet.dart';
//
// 2. Add a gear IconButton to _SessionListHeader's Row, next to the "New"
//    FilledButton.tonal (around line 418–448 of agents_view.dart).
//    Place it before the FilledButton.tonal so it sits to its left, or after
//    if you prefer the trailing position.  Example placement after the Expanded:
//
//      IconButton(
//        icon: const Icon(Icons.settings_outlined, size: 18),
//        tooltip: 'Agent settings',
//        onPressed: () => showAgentSettingsSheet(context),
//        style: IconButton.styleFrom(
//          minimumSize: const Size(34, 34),
//          padding: EdgeInsets.zero,
//        ),
//      ),
//      const SizedBox(width: 6),
//      // … existing FilledButton.tonal('New') …
//
// Sheet design choice: AlertDialog (constrained width, vertically centred) is
// chosen over showModalBottomSheet because macOS desktop is landscape-oriented;
// a bottom sheet would span the full width and look awkward.  The dialog is
// scrollable to handle tall content at small window heights.
// ─────────────────────────────────────────────────────────────────────────────

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../settings/services/destructive_modal_service.dart';
import '../../settings/services/keybinds_service.dart';
import '../../settings/services/opencode_server_service.dart';
import '../../settings/widgets/ai_account_section.dart';

/// Opens the "Agent settings" dialog.  Call from the gear IconButton's
/// onPressed in _SessionListHeader.
void showAgentSettingsSheet(BuildContext context) {
  showDialog<void>(
    context: context,
    builder: (dialogContext) => MultiProvider(
      providers: [
        ChangeNotifierProvider.value(
          value: context.read<DestructiveModalService>(),
        ),
        ChangeNotifierProvider.value(value: context.read<KeybindsService>()),
        ChangeNotifierProvider.value(
          value: context.read<OpencodeServerService>(),
        ),
      ],
      child: const _AgentSettingsDialog(),
    ),
  );
}

class _AgentSettingsDialog extends StatelessWidget {
  const _AgentSettingsDialog();

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: context.rhythm.surfaceRaised,
      surfaceTintColor: context.rhythm.surfaceRaised,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.xl),
        side: BorderSide(color: context.rhythm.border),
      ),
      titlePadding: const EdgeInsets.fromLTRB(24, 24, 24, 0),
      contentPadding: const EdgeInsets.fromLTRB(24, 16, 24, 8),
      actionsPadding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
      title: Row(
        children: [
          Expanded(
            child: Text(
              'Agent settings',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: context.rhythm.textPrimary,
              ),
            ),
          ),
          IconButton(
            icon: Icon(Icons.close, size: 18, color: context.rhythm.textMuted),
            onPressed: () => Navigator.of(context).pop(),
            style: IconButton.styleFrom(
              minimumSize: const Size(30, 30),
              padding: EdgeInsets.zero,
            ),
          ),
        ],
      ),
      content: SizedBox(
        width: 520,
        height: 640,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: const [
              _AccountsSection(),
              SizedBox(height: 20),
              _Divider(),
              SizedBox(height: 20),
              _BehaviorSection(),
              SizedBox(height: 20),
              _Divider(),
              SizedBox(height: 20),
              _KeybindsSection(),
              SizedBox(height: 20),
              _Divider(),
              SizedBox(height: 20),
              _OpencodeServerSection(),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: Text(
            'Done',
            style: TextStyle(
              fontWeight: FontWeight.w600,
              color: context.rhythm.accent,
            ),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Section 1 — Behavior
// ---------------------------------------------------------------------------

/// Wraps the existing AiAccountSection (provider/API-key auth flows) so it
/// renders inside the Agent settings sheet instead of the main app Settings.
class _AccountsSection extends StatelessWidget {
  const _AccountsSection();

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: const [
        _SectionHeader('Accounts'),
        SizedBox(height: 12),
        AiAccountSection(),
      ],
    );
  }
}

class _BehaviorSection extends StatelessWidget {
  const _BehaviorSection();

  @override
  Widget build(BuildContext context) {
    final service = context.watch<DestructiveModalService>();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _SectionHeader('Behavior'),
        const SizedBox(height: 8),
        Container(
          decoration: BoxDecoration(
            color: context.rhythm.surfaceMuted,
            borderRadius: BorderRadius.circular(RhythmRadius.md),
            border: Border.all(color: context.rhythm.borderSubtle),
          ),
          child: SwitchListTile(
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 14,
              vertical: 2,
            ),
            title: Text(
              'Require modal for destructive tools',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: context.rhythm.textPrimary,
              ),
            ),
            subtitle: Text(
              'Bash, write, and edit tool calls show a full confirmation dialog instead of an inline prompt.',
              style: TextStyle(fontSize: 11.5, color: context.rhythm.textMuted),
            ),
            value: service.enabled,
            activeThumbColor: context.rhythm.accent,
            onChanged: (v) =>
                context.read<DestructiveModalService>().setEnabled(v),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Section 2 — Keybindings
// ---------------------------------------------------------------------------

class _KeybindsSection extends StatefulWidget {
  const _KeybindsSection();

  @override
  State<_KeybindsSection> createState() => _KeybindsSectionState();
}

class _KeybindsSectionState extends State<_KeybindsSection> {
  late final Map<String, TextEditingController> _controllers;

  @override
  void initState() {
    super.initState();
    final svc = context.read<KeybindsService>();
    _controllers = {
      'send': TextEditingController(text: svc.send),
      'newSession': TextEditingController(text: svc.newSession),
      'cancelTurn': TextEditingController(text: svc.cancelTurn),
      'switchSession': TextEditingController(text: svc.switchSession),
    };
  }

  @override
  void dispose() {
    for (final c in _controllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _resetToDefaults() {
    context.read<KeybindsService>().resetToDefaults();
    _controllers['send']!.text = KeybindDefaults.send;
    _controllers['newSession']!.text = KeybindDefaults.newSession;
    _controllers['cancelTurn']!.text = KeybindDefaults.cancelTurn;
    _controllers['switchSession']!.text = KeybindDefaults.switchSession;
  }

  @override
  Widget build(BuildContext context) {
    final svc = context.watch<KeybindsService>();

    // Keep controllers in sync if the service resets externally.
    if (_controllers['send']!.text != svc.send) {
      _controllers['send']!.text = svc.send;
    }
    if (_controllers['newSession']!.text != svc.newSession) {
      _controllers['newSession']!.text = svc.newSession;
    }
    if (_controllers['cancelTurn']!.text != svc.cancelTurn) {
      _controllers['cancelTurn']!.text = svc.cancelTurn;
    }
    if (_controllers['switchSession']!.text != svc.switchSession) {
      _controllers['switchSession']!.text = svc.switchSession;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: _SectionHeader('Keybindings')),
            GestureDetector(
              onTap: _resetToDefaults,
              child: Text(
                'Reset to defaults',
                style: TextStyle(
                  fontSize: 12,
                  color: context.rhythm.accent,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        // Keystroke values are stored as plain strings — no keystroke capture
        // or validation is implemented.  Users type strings like "Cmd+N" or
        // "Esc" directly.  A proper keystroke listener can be added later.
        _KeybindRow(
          label: 'Send message',
          controller: _controllers['send']!,
          onSubmitted: (v) => context.read<KeybindsService>().setSend(v),
        ),
        const SizedBox(height: 8),
        _KeybindRow(
          label: 'New session',
          controller: _controllers['newSession']!,
          onSubmitted: (v) => context.read<KeybindsService>().setNewSession(v),
        ),
        const SizedBox(height: 8),
        _KeybindRow(
          label: 'Cancel turn',
          controller: _controllers['cancelTurn']!,
          onSubmitted: (v) => context.read<KeybindsService>().setCancelTurn(v),
        ),
        const SizedBox(height: 8),
        _KeybindRow(
          label: 'Switch session',
          controller: _controllers['switchSession']!,
          onSubmitted: (v) =>
              context.read<KeybindsService>().setSwitchSession(v),
        ),
      ],
    );
  }
}

class _KeybindRow extends StatelessWidget {
  const _KeybindRow({
    required this.label,
    required this.controller,
    required this.onSubmitted,
  });

  final String label;
  final TextEditingController controller;
  final ValueChanged<String> onSubmitted;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              fontSize: 13,
              color: context.rhythm.textPrimary,
            ),
          ),
        ),
        SizedBox(
          width: 130,
          child: TextField(
            controller: controller,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12,
              fontFamily: 'Menlo',
              color: context.rhythm.textPrimary,
            ),
            decoration: InputDecoration(
              isDense: true,
              filled: true,
              fillColor: context.rhythm.canvas,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 10,
                vertical: 8,
              ),
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(color: context.rhythm.border),
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(color: context.rhythm.border),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(color: context.rhythm.accent),
              ),
            ),
            // Save on every keystroke so closing the sheet without pressing
            // Enter still persists. onSubmitted/onEditingComplete only fire
            // on explicit submit / focus blur.
            onChanged: onSubmitted,
            onSubmitted: onSubmitted,
            onEditingComplete: () => onSubmitted(controller.text),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Section 3 — Opencode server
// ---------------------------------------------------------------------------

class _OpencodeServerSection extends StatefulWidget {
  const _OpencodeServerSection();

  @override
  State<_OpencodeServerSection> createState() => _OpencodeServerSectionState();
}

class _OpencodeServerSectionState extends State<_OpencodeServerSection> {
  late final TextEditingController _urlController;

  @override
  void initState() {
    super.initState();
    _urlController = TextEditingController(
      text: context.read<OpencodeServerService>().url ?? '',
    );
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  void _save() {
    context.read<OpencodeServerService>().setUrl(_urlController.text);
  }

  void _reset() {
    context.read<OpencodeServerService>().resetToEmbedded();
    _urlController.clear();
  }

  @override
  Widget build(BuildContext context) {
    final svc = context.watch<OpencodeServerService>();

    // Sync if another caller cleared the URL externally.
    final expected = svc.url ?? '';
    if (_urlController.text != expected) {
      _urlController.text = expected;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: _SectionHeader('Opencode server')),
            GestureDetector(
              onTap: _reset,
              child: Text(
                'Reset to embedded',
                style: TextStyle(
                  fontSize: 12,
                  color: context.rhythm.accent,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _urlController,
          style: TextStyle(
            fontSize: 13,
            fontFamily: 'Menlo',
            color: context.rhythm.textPrimary,
          ),
          decoration: InputDecoration(
            hintText: 'http://localhost:4001  (embedded)',
            hintStyle: TextStyle(
              color: context.rhythm.textMuted,
              fontSize: 12,
            ),
            isDense: true,
            filled: true,
            fillColor: context.rhythm.surfaceMuted,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: 12,
              vertical: 10,
            ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(RhythmRadius.md),
              borderSide: BorderSide(color: context.rhythm.borderSubtle),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(RhythmRadius.md),
              borderSide: BorderSide(color: context.rhythm.borderSubtle),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(RhythmRadius.md),
              borderSide: BorderSide(color: context.rhythm.accent),
            ),
          ),
          // Persist on every keystroke; closing the sheet without pressing
          // Enter still saves.
          onChanged: (_) => _save(),
          onSubmitted: (_) => _save(),
          onEditingComplete: _save,
        ),
        const SizedBox(height: 6),
        Text(
          'Leave blank to use the embedded local agent server. '
          'Set a URL to route opencode traffic to a remote instance.',
          style: TextStyle(
            fontSize: 11,
            color: context.rhythm.textMuted,
            height: 1.4,
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

class _SectionHeader extends StatelessWidget {
  const _SectionHeader(this.title);

  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title.toUpperCase(),
      style: TextStyle(
        fontSize: 10.5,
        fontWeight: FontWeight.w700,
        color: context.rhythm.textMuted,
        letterSpacing: 0.8,
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  const _Divider();

  @override
  Widget build(BuildContext context) {
    return Divider(height: 1, color: context.rhythm.borderSubtle);
  }
}
