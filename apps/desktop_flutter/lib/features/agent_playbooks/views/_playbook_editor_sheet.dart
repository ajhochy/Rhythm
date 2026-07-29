import 'package:flutter/material.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agent_configs/models/agent_config.dart';
import '../../agents/data/agent_models_data_source.dart';
import '../../agents/models/catalog_model_entry.dart';
import '../data/agent_playbooks_data_source.dart';

/// Editor for authoring / editing a Rhythm-managed playbook (custom slash
/// command): name, description, template body ($ARGUMENTS/$1..$n), an
/// optional agent + model override, and a subtask toggle. Mirrors
/// ManagedSkillEditorSheet (_managed_skill_editor_sheet.dart).
///
/// Opens as a modal bottom sheet. On a successful save the sheet pops `true`;
/// dismissing pops null.
Future<bool?> showPlaybookEditorSheet(
  BuildContext context, {
  required AgentPlaybooksDataSource dataSource,
  required Set<String> existingNames,
  required List<AgentConfig> availableAgents,
  PlaybookEntry? playbook,
}) {
  return showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    backgroundColor: context.rhythm.surface,
    shape: RoundedRectangleBorder(
      borderRadius: const BorderRadius.vertical(
        top: Radius.circular(RhythmRadius.xl),
      ),
      side: BorderSide(color: context.rhythm.border),
    ),
    builder: (_) => PlaybookEditorSheet(
      dataSource: dataSource,
      existingNames: existingNames,
      availableAgents: availableAgents,
      playbook: playbook,
    ),
  );
}

class PlaybookEditorSheet extends StatefulWidget {
  const PlaybookEditorSheet({
    super.key,
    required this.dataSource,
    required this.existingNames,
    required this.availableAgents,
    this.playbook,
  });

  final AgentPlaybooksDataSource dataSource;

  /// Live playbook names (used to block a create that collides). Compared
  /// case-insensitively.
  final Set<String> existingNames;

  /// Session-selectable agent profiles (ocAgent set) — the agent picker's
  /// options.
  final List<AgentConfig> availableAgents;

  /// Non-null = edit mode (name is locked); null = create mode.
  final PlaybookEntry? playbook;

  @override
  State<PlaybookEditorSheet> createState() => _PlaybookEditorSheetState();
}

class _PlaybookEditorSheetState extends State<PlaybookEditorSheet> {
  late final TextEditingController _nameController;
  late final TextEditingController _descriptionController;
  late final TextEditingController _templateController;

  String? _selectedOcAgent;
  CatalogModelEntry? _selectedModel;
  bool _subtask = false;
  List<CatalogModelEntry> _catalogModels = [];

  bool _saving = false;
  String? _error;

  /// True while an existing playbook's frontmatter/body is being fetched in
  /// edit mode. The template field is disabled and shows a loading hint until
  /// content arrives; name/description stay editable.
  bool _loadingContent = false;

  bool get _isEdit => widget.playbook != null;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.playbook?.name ?? '');
    _descriptionController = TextEditingController(
      text: widget.playbook?.description ?? '',
    );
    _templateController = TextEditingController();
    _loadCatalog();
    if (_isEdit) {
      _loadContent();
    }
  }

  Future<void> _loadCatalog() async {
    final entries = await AgentModelsDataSource().fetchCatalog();
    if (!mounted) return;
    setState(() => _catalogModels = entries);
  }

  Future<void> _loadContent() async {
    setState(() => _loadingContent = true);
    try {
      final content = await widget.dataSource.getContent(widget.playbook!.name);
      if (!mounted) return;
      setState(() {
        _templateController.text = content.template;
        _selectedOcAgent = content.agent;
        _subtask = content.subtask;
        _loadingContent = false;
      });
      _preselectModel(content.model);
    } catch (_) {
      // Fetch failure must not block name/description edits.
      if (!mounted) return;
      setState(() => _loadingContent = false);
    }
  }

  /// [modelString] is the frontmatter `provider/modelId` string. Matches it
  /// against the catalog once loaded (handles the catalog arriving after
  /// content, or before — both call this).
  void _preselectModel(String? modelString) {
    if (modelString == null || !modelString.contains('/')) return;
    final parts = modelString.split('/');
    final provider = parts.first;
    final modelId = parts.skip(1).join('/');
    for (final e in _catalogModels) {
      if (e.provider == provider && e.modelId == modelId) {
        if (mounted) setState(() => _selectedModel = e);
        return;
      }
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _descriptionController.dispose();
    _templateController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final name = _nameController.text.trim();
    final template = _templateController.text;

    if (!_isEdit) {
      if (name.isEmpty) {
        setState(() => _error = 'Name is required.');
        return;
      }
      final collides = widget.existingNames
          .map((n) => n.toLowerCase())
          .contains(name.toLowerCase());
      if (collides) {
        setState(() => _error = 'A playbook named "$name" already exists.');
        return;
      }
    }

    if (template.trim().isEmpty) {
      setState(() => _error = 'Template (the command body) is required.');
      return;
    }

    setState(() {
      _saving = true;
      _error = null;
    });

    final description = _descriptionController.text.trim().isEmpty
        ? null
        : _descriptionController.text.trim();
    final model = _selectedModel == null
        ? null
        : '${_selectedModel!.provider}/${_selectedModel!.modelId}';

    try {
      if (_isEdit) {
        await widget.dataSource.update(
          widget.playbook!.name,
          description: description,
          agent: _selectedOcAgent,
          model: model,
          subtask: _subtask,
          template: template,
        );
      } else {
        await widget.dataSource.create(
          name: name,
          description: description,
          agent: _selectedOcAgent,
          model: model,
          subtask: _subtask,
          template: template,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _saving = false;
        _error = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 24,
          right: 24,
          top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _isEdit ? 'Edit playbook' : 'New playbook',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: rhythm.textPrimary,
                    ),
                  ),
                ),
                IconButton(
                  icon: Icon(Icons.close, size: 20, color: rhythm.textMuted),
                  onPressed: () => Navigator.of(context).pop(),
                ),
              ],
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('playbook-name-field'),
              controller: _nameController,
              enabled: !_isEdit,
              autofocus: !_isEdit,
              style: TextStyle(
                color: _isEdit ? rhythm.textMuted : rhythm.textPrimary,
              ),
              decoration: _decoration(context, 'Name (e.g. weekly-bulletin)'),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('playbook-description-field'),
              controller: _descriptionController,
              style: TextStyle(color: rhythm.textPrimary),
              decoration: _decoration(context, 'Description (optional)'),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('playbook-template-field'),
              controller: _templateController,
              enabled: !_loadingContent,
              minLines: 5,
              maxLines: 12,
              style: TextStyle(color: rhythm.textPrimary, fontSize: 13),
              decoration: _decoration(
                context,
                _loadingContent
                    ? 'Loading playbook content…'
                    : 'Prompt template… use \$ARGUMENTS or \$1, \$2… for arguments',
                alignLabelWithHint: true,
              ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: DropdownButtonFormField<String?>(
                    key: const ValueKey('playbook-agent-picker'),
                    // Controlled (not initialValue-only) so re-selecting after
                    // async edit-mode prefill (_loadContent) is reflected.
                    value: _selectedOcAgent,
                    isExpanded: true,
                    decoration: _decoration(context, 'Agent (optional)'),
                    dropdownColor: rhythm.surfaceRaised,
                    style: TextStyle(color: rhythm.textPrimary, fontSize: 13),
                    items: [
                      const DropdownMenuItem<String?>(
                        value: null,
                        child: Text('Default'),
                      ),
                      ...widget.availableAgents.map(
                        (a) => DropdownMenuItem<String?>(
                          value: a.ocAgent,
                          child: Text(a.label, overflow: TextOverflow.ellipsis),
                        ),
                      ),
                    ],
                    onChanged: (v) => setState(() => _selectedOcAgent = v),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: DropdownButtonFormField<CatalogModelEntry?>(
                    key: const ValueKey('playbook-model-picker'),
                    value: _selectedModel,
                    isExpanded: true,
                    decoration: _decoration(context, 'Model (optional)'),
                    dropdownColor: rhythm.surfaceRaised,
                    style: TextStyle(color: rhythm.textPrimary, fontSize: 13),
                    items: [
                      const DropdownMenuItem<CatalogModelEntry?>(
                        value: null,
                        child: Text('Default'),
                      ),
                      ..._catalogModels.map(
                        (m) => DropdownMenuItem<CatalogModelEntry?>(
                          value: m,
                          child: Text(
                            '${m.provider}/${m.displayName}',
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ),
                    ],
                    onChanged: (v) => setState(() => _selectedModel = v),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            SwitchListTile(
              key: const ValueKey('playbook-subtask-toggle'),
              contentPadding: EdgeInsets.zero,
              value: _subtask,
              activeThumbColor: rhythm.accent,
              title: Text(
                'Run as subtask',
                style: TextStyle(color: rhythm.textPrimary, fontSize: 13),
              ),
              subtitle: Text(
                'Spawns a child session instead of running inline.',
                style: TextStyle(color: rhythm.textMuted, fontSize: 11),
              ),
              onChanged: (v) => setState(() => _subtask = v),
            ),
            if (_error != null) ...[
              const SizedBox(height: 8),
              Text(
                _error!,
                style: TextStyle(color: rhythm.danger, fontSize: 13),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              style: FilledButton.styleFrom(
                backgroundColor: rhythm.accent,
                minimumSize: const Size.fromHeight(48),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(RhythmRadius.sm),
                ),
              ),
              onPressed: _saving ? null : _save,
              child: _saving
                  ? SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: Colors.white.withValues(alpha: 0.8),
                      ),
                    )
                  : Text(_isEdit ? 'Save playbook' : 'Create playbook'),
            ),
          ],
        ),
      ),
    );
  }

  InputDecoration _decoration(
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
      disabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        borderSide: BorderSide(color: context.rhythm.borderSubtle),
      ),
      filled: true,
      fillColor: context.rhythm.surfaceMuted,
    );
  }
}
