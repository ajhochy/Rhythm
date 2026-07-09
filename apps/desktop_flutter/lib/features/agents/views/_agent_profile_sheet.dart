import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/services/default_agent_profile_service.dart';
import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agent_configs/controllers/agent_configs_controller.dart';
import '../../agent_configs/models/agent_config.dart';
import '../../settings/data/anthropic_accounts_data_source.dart';
import '../data/agent_models_data_source.dart';
import '../data/opencode_mcp_data_source.dart';
import '../data/opencode_skills_data_source.dart';
import '../models/catalog_model_entry.dart';
import '_managed_skill_editor_sheet.dart';

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
  AgentModelsDataSource? modelsDataSource,
  OpencodeSkillsDataSource? skillsDataSource,
  OpencodeMcpDataSource? mcpDataSource,
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
      child: AgentProfileSheet(
        config: config,
        modelsDataSource: modelsDataSource,
        skillsDataSource: skillsDataSource,
        mcpDataSource: mcpDataSource,
      ),
    ),
  );
}

/// Shows the [AgentProfilesManagerSheet] — the list of existing Agent Profiles
/// with a "New Profile" action. Tapping a profile opens it in edit mode.
Future<void> showAgentProfilesManagerSheet(
  BuildContext context, {
  AgentModelsDataSource? modelsDataSource,
}) {
  return showModalBottomSheet<void>(
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
      child: AgentProfilesManagerSheet(modelsDataSource: modelsDataSource),
    ),
  );
}

// ---------------------------------------------------------------------------
// Profiles manager (list) sheet
// ---------------------------------------------------------------------------

/// Lists all Agent Profiles. Tap a row to edit; the header button creates a new
/// one. Refreshes the controller on open so the list reflects the latest state
/// (including profiles seeded from opencode agents).
class AgentProfilesManagerSheet extends StatefulWidget {
  const AgentProfilesManagerSheet({
    super.key,
    AgentModelsDataSource? modelsDataSource,
  }) : _modelsDataSource = modelsDataSource;

  final AgentModelsDataSource? _modelsDataSource;

  @override
  State<AgentProfilesManagerSheet> createState() =>
      _AgentProfilesManagerSheetState();
}

/// #909 — sort keys for the Agent Profiles manager list.
enum _ProfileSortField { name, modelProvider }

class _AgentProfilesManagerSheetState extends State<AgentProfilesManagerSheet> {
  final _searchController = TextEditingController();
  String _searchQuery = '';
  _ProfileSortField _sortField = _ProfileSortField.name;

  @override
  void initState() {
    super.initState();
    // Pull the latest profiles when the manager opens.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) context.read<AgentConfigsController>().refresh();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  /// #909 — live substring match on label, then sort.
  List<AgentConfig> _visibleProfiles(List<AgentConfig> profiles) {
    final query = _searchQuery.trim().toLowerCase();
    final filtered = query.isEmpty
        ? profiles
        : profiles.where((c) => c.label.toLowerCase().contains(query)).toList();

    final sorted = [...filtered];
    sorted.sort((a, b) {
      switch (_sortField) {
        case _ProfileSortField.name:
          return a.label.toLowerCase().compareTo(b.label.toLowerCase());
        case _ProfileSortField.modelProvider:
          return (a.modelProvider ?? '').compareTo(b.modelProvider ?? '');
      }
    });
    return sorted;
  }

  /// #909 — rename a profile inline (label only), without opening the full
  /// profile editor sheet.
  Future<void> _rename(AgentConfig config) async {
    final newLabel = await showDialog<String>(
      context: context,
      builder: (ctx) => _RenameProfileDialog(currentLabel: config.label),
    );
    if (newLabel == null || newLabel.isEmpty || newLabel == config.label) {
      return;
    }
    if (!mounted) return;
    await context.read<AgentConfigsController>().update(
      config.id,
      {'label': newLabel},
    );
  }

  String _subtitle(AgentConfig c) {
    final parts = <String>[];
    if ((c.ocAgent ?? '').isNotEmpty) parts.add('opencode: ${c.ocAgent}');
    if ((c.modelProvider ?? '').isNotEmpty && (c.modelId ?? '').isNotEmpty) {
      parts.add('${c.modelProvider}/${c.modelId}');
    }
    if (c.sessionSelectable && (c.ocAgent ?? '').isNotEmpty)
      parts.add('in picker');
    return parts.isEmpty ? c.id : parts.join('  ·  ');
  }

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final controller = context.watch<AgentConfigsController>();
    final profiles = controller.configs;
    final visibleProfiles = _visibleProfiles(profiles);

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.all(RhythmSpacing.md),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            // Header
            Row(
              children: [
                Expanded(
                  child: Text(
                    'Agent Profiles',
                    style: TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w600,
                      color: rhythm.textPrimary,
                    ),
                  ),
                ),
                IconButton(
                  key: const ValueKey('profile-refresh-button'),
                  tooltip: 'Refresh profiles',
                  icon: controller.status == AgentConfigsStatus.loading
                      ? SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: rhythm.textSecondary,
                          ),
                        )
                      : Icon(Icons.refresh_rounded,
                          size: 18, color: rhythm.textSecondary),
                  onPressed: controller.status == AgentConfigsStatus.loading
                      ? null
                      : () => controller.refresh(),
                ),
                TextButton.icon(
                  onPressed: () => showAgentProfileSheet(
                    context,
                    modelsDataSource: widget._modelsDataSource,
                  ),
                  icon: const Icon(Icons.add, size: 18),
                  label: const Text('New Profile'),
                  style: TextButton.styleFrom(foregroundColor: rhythm.accent),
                ),
              ],
            ),
            const SizedBox(height: RhythmSpacing.sm),
            const _DefaultProfilePicker(),
            const SizedBox(height: RhythmSpacing.md),
            if (profiles.isNotEmpty) ...[
              // #909 — search + sort.
              Row(
                children: [
                  Expanded(
                    child: TextField(
                      key: const ValueKey('profile-search-field'),
                      controller: _searchController,
                      style: TextStyle(fontSize: 13, color: rhythm.textPrimary),
                      decoration: InputDecoration(
                        hintText: 'Search profiles…',
                        hintStyle:
                            TextStyle(fontSize: 13, color: rhythm.textMuted),
                        prefixIcon: Icon(Icons.search,
                            size: 16, color: rhythm.textMuted),
                        isDense: true,
                        contentPadding: const EdgeInsets.symmetric(
                          vertical: 8,
                          horizontal: 10,
                        ),
                        filled: true,
                        fillColor: rhythm.surfaceMuted,
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(RhythmRadius.md),
                          borderSide: BorderSide(color: rhythm.border),
                        ),
                      ),
                      onChanged: (v) => setState(() => _searchQuery = v),
                    ),
                  ),
                  const SizedBox(width: RhythmSpacing.sm),
                  PopupMenuButton<_ProfileSortField>(
                    key: const ValueKey('profile-sort-menu'),
                    tooltip: 'Sort profiles',
                    initialValue: _sortField,
                    onSelected: (v) => setState(() => _sortField = v),
                    itemBuilder: (_) => const [
                      PopupMenuItem(
                        value: _ProfileSortField.name,
                        child: Text('Name'),
                      ),
                      PopupMenuItem(
                        value: _ProfileSortField.modelProvider,
                        child: Text('Model provider'),
                      ),
                    ],
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 8),
                      decoration: BoxDecoration(
                        color: rhythm.surfaceMuted,
                        borderRadius: BorderRadius.circular(RhythmRadius.md),
                        border: Border.all(color: rhythm.borderSubtle),
                      ),
                      child: Icon(Icons.sort_rounded,
                          size: 16, color: rhythm.textSecondary),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: RhythmSpacing.sm),
            ],
            if (profiles.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: RhythmSpacing.xl),
                child: Text(
                  'No profiles yet.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: rhythm.textMuted),
                ),
              )
            else if (visibleProfiles.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: RhythmSpacing.xl),
                child: Text(
                  'No profiles match "${_searchQuery.trim()}".',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: rhythm.textMuted),
                ),
              )
            else
              Flexible(
                child: ListView.separated(
                  shrinkWrap: true,
                  itemCount: visibleProfiles.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: RhythmSpacing.xxs),
                  itemBuilder: (_, i) {
                    final c = visibleProfiles[i];
                    return Material(
                      color: rhythm.surfaceMuted,
                      borderRadius: BorderRadius.circular(RhythmRadius.md),
                      child: InkWell(
                        borderRadius: BorderRadius.circular(RhythmRadius.md),
                        onTap: () => showAgentProfileSheet(
                          context,
                          config: c,
                          modelsDataSource: widget._modelsDataSource,
                        ),
                        child: Padding(
                          padding: const EdgeInsets.symmetric(
                            horizontal: RhythmSpacing.sm,
                            vertical: RhythmSpacing.sm,
                          ),
                          child: Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Row(
                                      children: [
                                        Flexible(
                                          child: Text(
                                            c.label,
                                            style: TextStyle(
                                              fontSize: 14,
                                              fontWeight: FontWeight.w500,
                                              color: rhythm.textPrimary,
                                            ),
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                        if (c.isPreset) ...[
                                          const SizedBox(width: 6),
                                          _Tag(text: 'preset', rhythm: rhythm),
                                        ],
                                      ],
                                    ),
                                    const SizedBox(height: 2),
                                    Text(
                                      _subtitle(c),
                                      style: TextStyle(
                                        fontSize: 11,
                                        color: rhythm.textMuted,
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ),
                              ),
                              // #909 — inline rename, without opening the
                              // full profile editor sheet.
                              IconButton(
                                key: ValueKey('rename-profile-${c.id}'),
                                icon: Icon(Icons.edit_outlined,
                                    size: 16, color: rhythm.textMuted),
                                tooltip: 'Rename',
                                visualDensity: VisualDensity.compact,
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints(
                                  minWidth: 28,
                                  minHeight: 28,
                                ),
                                onPressed: () => _rename(c),
                              ),
                              Icon(
                                Icons.chevron_right,
                                size: 18,
                                color: rhythm.textMuted,
                              ),
                            ],
                          ),
                        ),
                      ),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// #890 — App-level "Default profile" picker shown at the top of the Agent
/// Profiles manager sheet. Lists the profiles selectable for a new session
/// (mirrors the session composer's own picker) plus a "Secretary (default)"
/// entry representing "unset" (falls back to the seeded Secretary default,
/// or the first authorized catalog entry if Secretary isn't configured).
///
/// Reads/writes [DefaultAgentProfileService] via Provider — no local state,
/// since the manager sheet already rebuilds via `context.watch` on the
/// surrounding `AgentConfigsController`.
class _DefaultProfilePicker extends StatelessWidget {
  const _DefaultProfilePicker();

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final configsController = context.watch<AgentConfigsController>();
    final defaultService = context.watch<DefaultAgentProfileService>();

    final selectable = configsController.sessionSelectableAgents;
    final currentOcAgent = defaultService.defaultOcAgent;
    // If the persisted override no longer matches a selectable profile
    // (removed/disabled profile), show it as unset rather than a dangling
    // selection the dropdown can't render.
    final currentValue = (currentOcAgent != null &&
            selectable.any((c) => c.ocAgent == currentOcAgent))
        ? currentOcAgent
        : null;

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: RhythmSpacing.sm,
        vertical: RhythmSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: rhythm.borderSubtle),
      ),
      child: Row(
        children: [
          Icon(Icons.star_outline, size: 16, color: rhythm.textMuted),
          const SizedBox(width: RhythmSpacing.xs),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Default profile',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: rhythm.textPrimary,
                  ),
                ),
                Text(
                  'Used for new sessions unless another profile is chosen.',
                  style: TextStyle(fontSize: 11, color: rhythm.textMuted),
                ),
              ],
            ),
          ),
          const SizedBox(width: RhythmSpacing.sm),
          DropdownButton<String?>(
            value: currentValue,
            dropdownColor: rhythm.surface,
            style: TextStyle(color: rhythm.textPrimary, fontSize: 13),
            underline: const SizedBox.shrink(),
            items: [
              DropdownMenuItem<String?>(
                value: null,
                child: Text(
                  'Secretary (default)',
                  style: TextStyle(color: rhythm.textMuted, fontSize: 13),
                ),
              ),
              ...selectable.map(
                (c) => DropdownMenuItem<String?>(
                  value: c.ocAgent,
                  child: Text(
                    c.label,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: rhythm.textPrimary, fontSize: 13),
                  ),
                ),
              ),
            ],
            onChanged: (value) {
              context.read<DefaultAgentProfileService>().setDefault(value);
            },
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// #909 — Rename dialog
// ---------------------------------------------------------------------------

/// A StatefulWidget (not a bare inline builder) so its TextEditingController
/// is disposed by State.dispose() at the correct point in the dialog route's
/// lifecycle — disposing manually right after showDialog() returns races the
/// route's exit transition (see the identical fix in _session_list_body.dart
/// #903, "A TextEditingController was used after being disposed").
class _RenameProfileDialog extends StatefulWidget {
  const _RenameProfileDialog({required this.currentLabel});

  final String currentLabel;

  @override
  State<_RenameProfileDialog> createState() => _RenameProfileDialogState();
}

class _RenameProfileDialogState extends State<_RenameProfileDialog> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.currentLabel);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Rename profile'),
      content: TextField(
        key: const ValueKey('rename-profile-field'),
        controller: _controller,
        autofocus: true,
        decoration: const InputDecoration(hintText: 'Profile name'),
        onSubmitted: (v) => Navigator.of(context).pop(v.trim()),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(_controller.text.trim()),
          child: const Text('Save'),
        ),
      ],
    );
  }
}

/// Small pill tag used in the profiles list (e.g. "preset").
class _Tag extends StatelessWidget {
  const _Tag({required this.text, required this.rhythm});

  final String text;
  final RhythmColorRoles rhythm;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: rhythm.surface,
        borderRadius: BorderRadius.circular(RhythmRadius.xs),
        border: Border.all(color: rhythm.border),
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 10, color: rhythm.textMuted),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Widget
// ---------------------------------------------------------------------------

class AgentProfileSheet extends StatefulWidget {
  const AgentProfileSheet({
    super.key,
    this.config,
    AgentModelsDataSource? modelsDataSource,
    OpencodeSkillsDataSource? skillsDataSource,
    OpencodeMcpDataSource? mcpDataSource,
  })  : _modelsDataSource = modelsDataSource,
        _skillsDataSource = skillsDataSource,
        _mcpDataSource = mcpDataSource;

  /// Non-null = edit mode; null = create mode.
  final AgentConfig? config;

  /// Optional override — inject a fake data source in tests so the catalog
  /// load does not require a running agent server.
  final AgentModelsDataSource? _modelsDataSource;

  /// Optional override — inject a fake skills data source in tests so the live
  /// skills load does not require a running agent server.
  final OpencodeSkillsDataSource? _skillsDataSource;

  /// Optional override — inject a fake MCP data source in tests so the live MCP
  /// load does not require a running agent server.
  final OpencodeMcpDataSource? _mcpDataSource;

  @override
  State<AgentProfileSheet> createState() => _AgentProfileSheetState();
}

class _AgentProfileSheetState extends State<AgentProfileSheet> {
  late final TextEditingController _labelController;
  late final TextEditingController _iconController;
  late final TextEditingController _systemPromptController;
  late final TextEditingController _allowedDelegatesController;

  late bool _isManager;

  // null means "all allowed" (no restriction); non-null means restricted set.
  List<String>? _selectedMcps;
  List<String>? _selectedSkills;

  // Model picker state — null means "no preference" (AgentRunner falls back
  // to most-recently-used or hardcoded default).
  List<CatalogModelEntry> _catalogModels = [];
  CatalogModelEntry? _selectedModel;

  // Claude account picker state — null means "App default". The field is
  // hidden until accounts load successfully AND at least one exists.
  List<AnthropicAccount> _anthropicAccounts = [];
  bool _anthropicAccountsLoaded = false;
  String? _selectedAnthropicAccountId;

  // Live skills/MCPs sourced from the engine (the single source of truth —
  // never a hardcoded array; #775). Loaded asynchronously on open.
  late final OpencodeSkillsDataSource _skillsDataSource;
  late final OpencodeMcpDataSource _mcpDataSource;
  List<OpencodeSkillEntry> _availableSkills = [];
  List<String> _availableMcps = [];
  bool _skillsLoaded = false;
  bool _mcpsLoaded = false;

  // #922 — MCP servers the live engine currently reports as needs_auth
  // (e.g. canva/notion/supabase with expired OAuth). Used to flag this
  // profile as degraded when one of its allowed servers is unauthenticated.
  Set<String> _needsAuthMcps = {};

  bool _loading = false;
  String? _error;

  bool get _isEdit => widget.config != null;

  @override
  void initState() {
    super.initState();
    final cfg = widget.config;
    _labelController = TextEditingController(text: cfg?.label ?? '');
    _iconController = TextEditingController(text: cfg?.icon ?? 'terminal');
    _systemPromptController = TextEditingController(
      text: cfg?.systemPrompt ?? '',
    );
    _allowedDelegatesController = TextEditingController(
      text: (cfg?.allowedDelegates ?? []).join('\n'),
    );
    _isManager = cfg?.isManager ?? false;
    _selectedMcps =
        cfg?.allowedMcps != null ? List<String>.from(cfg!.allowedMcps!) : null;
    _selectedSkills = cfg?.allowedSkills != null
        ? List<String>.from(cfg!.allowedSkills!)
        : null;
    _skillsDataSource = widget._skillsDataSource ?? OpencodeSkillsDataSource();
    _mcpDataSource = widget._mcpDataSource ?? OpencodeMcpDataSource();
    _selectedAnthropicAccountId = cfg?.defaultAnthropicAccountId;
    // Load catalog + live skills/MCPs asynchronously — do not block render.
    _loadCatalog();
    _loadSkills();
    _loadMcps();
    _loadAnthropicAccounts();
  }

  Future<void> _loadAnthropicAccounts() async {
    try {
      final result = await AnthropicAccountsDataSource().list();
      if (!mounted) return;
      setState(() {
        _anthropicAccounts = result.accounts;
        _anthropicAccountsLoaded = true;
      });
    } catch (_) {
      // Fetch failure → keep the field hidden (single-account/legacy setups).
    }
  }

  Future<void> _loadCatalog() async {
    final entries = await (widget._modelsDataSource ?? AgentModelsDataSource())
        .fetchCatalog();
    if (!mounted) return;
    final cfg = widget.config;
    // Pre-select the profile's current model if one is set.
    CatalogModelEntry? preSelected;
    if (cfg?.modelProvider != null && cfg?.modelId != null) {
      for (final e in entries) {
        if (e.provider == cfg!.modelProvider && e.modelId == cfg.modelId) {
          preSelected = e;
          break;
        }
      }
    }
    setState(() {
      _catalogModels = entries;
      _selectedModel = preSelected;
    });
  }

  Future<void> _loadSkills() async {
    final skills = await _skillsDataSource.list();
    if (!mounted) return;
    setState(() {
      _availableSkills = skills;
      _skillsLoaded = true;
    });
  }

  Future<void> _loadMcps() async {
    final mcps = await _mcpDataSource.listNames();
    if (!mounted) return;
    setState(() {
      _availableMcps = mcps;
      _mcpsLoaded = true;
    });
    // #922 — fetch separately so a failure here never blocks the picker.
    final needsAuth = await _mcpDataSource.listNeedsAuthNames();
    if (!mounted) return;
    setState(() => _needsAuthMcps = needsAuth);
  }

  List<String> get _availableSkillNames =>
      _availableSkills.map((s) => s.name).toList();

  @override
  void dispose() {
    _labelController.dispose();
    _iconController.dispose();
    _systemPromptController.dispose();
    _allowedDelegatesController.dispose();
    super.dispose();
  }

  List<String> _parseDelimitedList(String value) {
    return value
        .split(RegExp(r'[,\n]'))
        .map((v) => v.trim())
        .where((v) => v.isNotEmpty)
        .toSet()
        .toList()
      ..sort();
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
        'allowedDelegatesJson': _isManager
            ? jsonEncode(_parseDelimitedList(_allowedDelegatesController.text))
            : null,
        'modelProvider': _selectedModel?.provider,
        'modelId': _selectedModel?.modelId,
        'defaultAnthropicAccountId': _selectedAnthropicAccountId,
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
        'allowedDelegatesJson': _isManager
            ? jsonEncode(_parseDelimitedList(_allowedDelegatesController.text))
            : null,
        'modelProvider': _selectedModel?.provider,
        'modelId': _selectedModel?.modelId,
        'defaultAnthropicAccountId': _selectedAnthropicAccountId,
      };
      result = await controller.create(input);
    }

    if (!mounted) return;
    setState(() => _loading = false);

    if (result == null) {
      setState(() => _error = controller.error ?? 'Failed to save profile.');
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
                if (_isManager) ...[
                  const SizedBox(height: 16),
                  _buildAllowedDelegatesSection(),
                ],
                const SizedBox(height: 24),
                _buildModelSection(),
                if (_anthropicAccountsLoaded &&
                    _anthropicAccounts.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  _buildClaudeAccountSection(),
                ],
                const SizedBox(height: 24),
                _buildMcpsSection(),
                const SizedBox(height: 24),
                _buildSkillsSection(),
                if (_error != null) ...[
                  const SizedBox(height: 16),
                  Text(
                    _error!,
                    style: TextStyle(
                      color: context.rhythm.danger,
                      fontSize: 13,
                    ),
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
      // CheckboxListTile (a ListTile) paints ink/selection on its nearest
      // Material ancestor; inside this colored Container with none, Flutter
      // asserts ("background or ink splashes may be invisible"). A transparent
      // Material satisfies it while keeping the Container's background/border.
      child: Material(
        type: MaterialType.transparency,
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
      ),
    );
  }

  Widget _buildAllowedDelegatesSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionLabel('Allowed Delegates'),
        const SizedBox(height: 10),
        TextField(
          controller: _allowedDelegatesController,
          enabled: _isManager,
          minLines: 2,
          maxLines: 5,
          style: TextStyle(
            color: _isManager
                ? context.rhythm.textPrimary
                : context.rhythm.textMuted,
            fontSize: 13,
          ),
          decoration: _inputDecoration(
            context,
            'coding-agent, verification-gate',
            alignLabelWithHint: true,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          'Profile ids this manager can invoke as delegated specialist runs.',
          style: TextStyle(color: context.rhythm.textMuted, fontSize: 11),
        ),
      ],
    );
  }

  Widget _buildModelSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionLabel('Model'),
        const SizedBox(height: 10),
        if (_catalogModels.isEmpty)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
            decoration: BoxDecoration(
              color: context.rhythm.surfaceMuted,
              borderRadius: BorderRadius.circular(RhythmRadius.sm),
              border: Border.all(color: context.rhythm.borderSubtle),
            ),
            child: Row(
              children: [
                Icon(Icons.sync, size: 16, color: context.rhythm.textMuted),
                const SizedBox(width: 8),
                Text(
                  'Loading models…',
                  style: TextStyle(
                    color: context.rhythm.textSecondary,
                    fontSize: 13,
                  ),
                ),
              ],
            ),
          )
        else
          DropdownButtonFormField<CatalogModelEntry>(
            value: _selectedModel,
            dropdownColor: context.rhythm.surface,
            style: TextStyle(color: context.rhythm.textPrimary, fontSize: 13),
            decoration: InputDecoration(
              hintText: 'No preference (use default)',
              hintStyle: TextStyle(
                color: context.rhythm.textMuted,
                fontSize: 13,
              ),
              contentPadding: const EdgeInsets.symmetric(
                horizontal: 12,
                vertical: 12,
              ),
              enabledBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(color: context.rhythm.border),
              ),
              focusedBorder: OutlineInputBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.sm),
                borderSide: BorderSide(
                  color: context.rhythm.accent,
                  width: 1.5,
                ),
              ),
              filled: true,
              fillColor: context.rhythm.surfaceMuted,
            ),
            items: [
              DropdownMenuItem<CatalogModelEntry>(
                value: null,
                child: Text(
                  'No preference',
                  style: TextStyle(
                    color: context.rhythm.textMuted,
                    fontSize: 13,
                  ),
                ),
              ),
              ..._catalogModels.map(
                (e) => DropdownMenuItem<CatalogModelEntry>(
                  value: e,
                  child: Text(
                    '${e.provider} / ${e.modelId}',
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      color: e.authorized
                          ? context.rhythm.textPrimary
                          : context.rhythm.textMuted,
                      fontSize: 13,
                    ),
                  ),
                ),
              ),
            ],
            onChanged: (v) => setState(() => _selectedModel = v),
          ),
        const SizedBox(height: 4),
        Text(
          'Used by the autonomous agent runner for scheduled and cookbook runs.',
          style: TextStyle(color: context.rhythm.textMuted, fontSize: 11),
        ),
      ],
    );
  }

  Widget _buildClaudeAccountSection() {
    // Guard against a stale persisted id (account since removed) — the
    // dropdown asserts when `value` has no matching item.
    final value =
        _anthropicAccounts.any((a) => a.id == _selectedAnthropicAccountId)
            ? _selectedAnthropicAccountId
            : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionLabel('Claude Account'),
        const SizedBox(height: 10),
        DropdownButtonFormField<String?>(
          initialValue: value,
          dropdownColor: context.rhythm.surface,
          style: TextStyle(color: context.rhythm.textPrimary, fontSize: 13),
          decoration: _inputDecoration(context, 'App default'),
          items: [
            DropdownMenuItem<String?>(
              value: null,
              child: Text(
                'App default',
                style: TextStyle(
                  color: context.rhythm.textMuted,
                  fontSize: 13,
                ),
              ),
            ),
            ..._anthropicAccounts.map(
              (a) => DropdownMenuItem<String?>(
                value: a.id,
                child: Text(
                  a.label,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    color: context.rhythm.textPrimary,
                    fontSize: 13,
                  ),
                ),
              ),
            ),
          ],
          onChanged: (v) => setState(() => _selectedAnthropicAccountId = v),
        ),
        const SizedBox(height: 4),
        Text(
          'Default Anthropic account for sessions started with this profile.',
          style: TextStyle(color: context.rhythm.textMuted, fontSize: 11),
        ),
      ],
    );
  }

  /// #906 — Gemini's GenerateContentRequest proto rejects requests with more
  /// than 512 function declarations. gemini_tool_cap.ts (#884) already trims
  /// the allowlist at DISPATCH time so a run never actually fails — this is
  /// the complementary CONFIG-time warning so the user sees the risk while
  /// picking MCPs instead of only discovering the silent trim in logs later.
  /// Mirrors gemini_tool_cap.ts's budget/per-server-estimate constants
  /// (duplicated deliberately, same rationale as that file's own
  /// PER_SERVER_INHERIT_ALL_ESTIMATE comment: independent, pure client-side
  /// estimate vs. a network round-trip for a rough heads-up).
  static const _kGeminiMcpToolBudget = 500; // 512 cap - 12 builtin reserve
  static const _kGeminiPerServerEstimate = 25;

  Widget? _buildGeminiCapWarning() {
    if (_selectedModel?.provider != 'google') return null;
    final serverCount = (_selectedMcps ?? _availableMcps).length;
    final estimated = serverCount * _kGeminiPerServerEstimate;
    if (estimated <= _kGeminiMcpToolBudget) return null;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: context.rhythm.warning.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border:
            Border.all(color: context.rhythm.warning.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.warning_amber_rounded,
              size: 16, color: context.rhythm.warning),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'This many MCP servers may exceed Gemini\'s tool-declaration limit '
              '(~$estimated est. vs. $_kGeminiMcpToolBudget budget). Rhythm will '
              'automatically trim the least-recently-added servers at runtime '
              'rather than fail the session, but restricting to fewer servers '
              'here avoids relying on that.',
              style:
                  TextStyle(color: context.rhythm.textSecondary, fontSize: 12),
            ),
          ),
        ],
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
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                ),
                onPressed: () =>
                    setState(() => _selectedMcps = List.from(_availableMcps)),
                child: const Text('Restrict', style: TextStyle(fontSize: 13)),
              )
            else
              TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.textSecondary,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                ),
                onPressed: () => setState(() => _selectedMcps = null),
                child: const Text('Allow all', style: TextStyle(fontSize: 13)),
              ),
          ],
        ),
        const SizedBox(height: 8),
        if (_buildGeminiCapWarning() case final warning?) warning,
        if (_buildDegradedMcpWarning() case final warning?) warning,
        if (_selectedMcps == null)
          _allAllowedBanner('All MCPs allowed')
        else if (_availableMcps.isEmpty)
          _emptyBanner(_mcpsLoaded ? 'No MCP servers' : 'Loading MCP servers…')
        else
          _filterChipWrap(
            // The restricted set may include names no longer live (e.g. a
            // server removed since the profile was saved, or a saved id that
            // never matched the live engine id like `nfl-mcp` vs `nfl_mcp`);
            // union them so the user still sees and can unselect a stale
            // selection. Persisted names pass through verbatim — we surface
            // staleness, we never rewrite the saved scope (#781 / #789).
            items: {..._availableMcps, ..._selectedMcps!}.toList(),
            selected: _selectedMcps!,
            // A persisted selection with no live match is unenforceable; flag
            // it visibly so it can't be mistaken for a valid live chip. Only
            // judge staleness once the live set has actually loaded.
            liveItems: _availableMcps.toSet(),
            flagStale: _mcpsLoaded,
            // #922 — separately flag servers that ARE live but currently
            // report needs_auth (expired/missing OAuth), so a profile scoped
            // to e.g. canva shows it's degraded rather than silently dead.
            needsAuthItems: _needsAuthMcps,
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

  /// #922 — surfaces "profile is degraded" when this profile's allowed MCP
  /// scope includes a server the live engine currently reports as
  /// needs_auth. Covers BOTH the unrestricted ("all allowed") case and a
  /// restricted allowlist, since either can bind a scheduled run to a dead
  /// server. Read-only: never disables the profile or blocks saving (#892's
  /// preflight already fails a run fast; this is visibility only).
  Widget? _buildDegradedMcpWarning() {
    if (_needsAuthMcps.isEmpty) return null;
    final relevant = _selectedMcps == null
        ? _needsAuthMcps
        : _needsAuthMcps.intersection(_selectedMcps!.toSet());
    if (relevant.isEmpty) return null;

    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: context.rhythm.warning.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border:
            Border.all(color: context.rhythm.warning.withValues(alpha: 0.4)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.warning_amber_rounded,
              size: 16, color: context.rhythm.warning),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'Degraded — ${relevant.join(', ')} need${relevant.length == 1 ? 's' : ''} '
              're-authentication. Runs that depend on ${relevant.length == 1 ? 'it' : 'them'} '
              'will fail fast until reconnected in Integrations.',
              style:
                  TextStyle(color: context.rhythm.textSecondary, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSkillsSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: _sectionLabel('Allowed Skills')),
            TextButton.icon(
              style: TextButton.styleFrom(
                foregroundColor: context.rhythm.accent,
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              ),
              icon: const Icon(Icons.add, size: 16),
              label: const Text('New skill', style: TextStyle(fontSize: 13)),
              onPressed: _onCreateSkill,
            ),
            if (_selectedSkills == null)
              TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.accent,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                ),
                onPressed: () => setState(
                  () => _selectedSkills = List.from(_availableSkillNames),
                ),
                child: const Text('Restrict', style: TextStyle(fontSize: 13)),
              )
            else
              TextButton(
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.textSecondary,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 4,
                  ),
                ),
                onPressed: () => setState(() => _selectedSkills = null),
                child: const Text('Allow all', style: TextStyle(fontSize: 13)),
              ),
          ],
        ),
        const SizedBox(height: 8),
        if (_selectedSkills == null)
          _allAllowedBanner('All Skills allowed')
        else if (_availableSkills.isEmpty)
          _emptyBanner(_skillsLoaded ? 'No skills' : 'Loading skills…')
        else
          _buildSkillChipWrap(),
      ],
    );
  }

  /// Skill chips with per-skill edit/delete affordances for **managed** skills
  /// only. External skills are scope-only (selectable, but not editable —
  /// they show neither an edit nor a delete button). A persisted selection
  /// whose skill is no longer live is shown as a plain selected chip so the
  /// user can unselect it (names pass through verbatim, #775).
  Widget _buildSkillChipWrap() {
    final byName = {for (final s in _availableSkills) s.name: s};
    final names = <String>{
      ..._availableSkillNames,
      ..._selectedSkills!,
    }.toList();

    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: names.map((name) {
        final entry = byName[name];
        final isSelected = _selectedSkills!.contains(name);
        final managed = entry?.managed ?? false;

        final chip = FilterChip(
          // Bound + ellipsize the label so a long skill name (e.g.
          // `patristic-bible-study:study-passage`) can never make the chip —
          // or the managed-skill Row it sits in — overflow the Wrap (#780).
          // Full name stays legible via the tooltip.
          label: Tooltip(
            message: name,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 240),
              child: Text(
                name,
                maxLines: 1,
                softWrap: false,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ),
          selected: isSelected,
          onSelected: (_) => setState(() {
            if (_selectedSkills!.contains(name)) {
              _selectedSkills!.remove(name);
            } else {
              _selectedSkills!.add(name);
            }
          }),
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

        // External skills: scope-only — no edit/delete affordances.
        if (!managed) return chip;

        // Managed skills: chip + compact edit/delete buttons.
        return Container(
          decoration: BoxDecoration(
            border: Border.all(
              color: context.rhythm.accent.withValues(alpha: 0.25),
            ),
            borderRadius: BorderRadius.circular(RhythmRadius.pill),
          ),
          padding: const EdgeInsets.only(right: 2),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              chip,
              _miniIconButton(
                icon: Icons.edit_outlined,
                tooltip: 'Edit skill',
                semanticKey: 'edit-skill-$name',
                onPressed: () => _onEditSkill(entry!),
              ),
              _miniIconButton(
                icon: Icons.delete_outline,
                tooltip: 'Delete skill',
                semanticKey: 'delete-skill-$name',
                onPressed: () => _onDeleteSkill(entry!),
              ),
            ],
          ),
        );
      }).toList(),
    );
  }

  Widget _miniIconButton({
    required IconData icon,
    required String tooltip,
    required String semanticKey,
    required VoidCallback onPressed,
  }) {
    return IconButton(
      key: ValueKey(semanticKey),
      icon: Icon(icon, size: 16),
      color: context.rhythm.textMuted,
      tooltip: tooltip,
      visualDensity: VisualDensity.compact,
      constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
      padding: EdgeInsets.zero,
      onPressed: onPressed,
    );
  }

  // --------------------------------------------------------------------------
  // Managed-skill authoring
  // --------------------------------------------------------------------------

  Future<void> _onCreateSkill() async {
    final created = await showManagedSkillEditorSheet(
      context,
      dataSource: _skillsDataSource,
      existingNames: _availableSkillNames.toSet(),
    );
    if (created == null || !mounted) return;
    // Reload the live list so the new skill appears (round-trip), and select it.
    await _loadSkills();
    if (!mounted) return;
    setState(() {
      _selectedSkills?.add(created.name);
    });
  }

  Future<void> _onEditSkill(OpencodeSkillEntry skill) async {
    final updated = await showManagedSkillEditorSheet(
      context,
      dataSource: _skillsDataSource,
      existingNames: _availableSkillNames.toSet(),
      skill: skill,
    );
    if (updated == null || !mounted) return;
    await _loadSkills();
  }

  Future<void> _onDeleteSkill(OpencodeSkillEntry skill) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogCtx) => AlertDialog(
        backgroundColor: dialogCtx.rhythm.surface,
        title: Text(
          'Delete "${skill.name}"?',
          style: TextStyle(color: dialogCtx.rhythm.textPrimary),
        ),
        content: Text(
          'This removes the Rhythm-managed skill from the engine.',
          style: TextStyle(color: dialogCtx.rhythm.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogCtx).pop(false),
            child: const Text('Cancel'),
          ),
          TextButton(
            style: TextButton.styleFrom(
              foregroundColor: dialogCtx.rhythm.danger,
            ),
            onPressed: () => Navigator.of(dialogCtx).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    try {
      await _skillsDataSource.delete(skill.name);
    } catch (e) {
      if (!mounted) return;
      setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
      return;
    }
    if (!mounted) return;
    setState(() => _selectedSkills?.remove(skill.name));
    await _loadSkills();
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
          Icon(Icons.all_inclusive, size: 16, color: context.rhythm.textMuted),
          const SizedBox(width: 8),
          Text(
            label,
            style: TextStyle(color: context.rhythm.textSecondary, fontSize: 13),
          ),
        ],
      ),
    );
  }

  /// Banner shown when a restricted picker has no live items to choose from
  /// (e.g. the engine reports no MCP servers / no skills). Avoids crashing or
  /// falling back to a stale hardcoded list.
  Widget _emptyBanner(String label) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: context.rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border: Border.all(color: context.rhythm.borderSubtle),
      ),
      child: Row(
        children: [
          Icon(Icons.inbox_outlined, size: 16, color: context.rhythm.textMuted),
          const SizedBox(width: 8),
          Text(
            label,
            style: TextStyle(color: context.rhythm.textSecondary, fontSize: 13),
          ),
        ],
      ),
    );
  }

  Widget _filterChipWrap({
    required List<String> items,
    required List<String> selected,
    required ValueChanged<String> onToggle,
    // When [flagStale] is true, any *selected* item absent from [liveItems] is
    // treated as a stale persisted selection: it can no longer be enforced
    // against the live engine, so it is rendered with a distinct, muted +
    // warning style. The chip stays toggleable so the user can unselect it.
    // We surface the mismatch; we never rewrite the saved value (#781 / #789).
    Set<String> liveItems = const {},
    bool flagStale = false,
    // #922 — servers the live engine reports as needs_auth. Rendered with the
    // same muted/warning chip style as a stale selection (distinct tooltip),
    // since both mean "this scope entry won't actually work right now".
    Set<String> needsAuthItems = const {},
  }) {
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      children: items.map((item) {
        final isSelected = selected.contains(item);
        final isStale = flagStale && isSelected && !liveItems.contains(item);
        final needsAuth = !isStale && needsAuthItems.contains(item);

        if (isStale || needsAuth) {
          return Tooltip(
            message: isStale
                ? 'Not a live MCP server — this saved selection won\'t be '
                    'enforced. Unselect it, or pick the live server.'
                : '$item needs re-authentication — connect it in Integrations '
                    'or runs that depend on it will fail fast.',
            child: FilterChip(
              key: ValueKey(
                  isStale ? 'stale-chip-$item' : 'needs-auth-chip-$item'),
              avatar: Icon(
                Icons.warning_amber_rounded,
                size: 16,
                color: context.rhythm.warning,
              ),
              label: Text(item),
              selected: isSelected,
              onSelected: (_) => onToggle(item),
              // Muted/greyed fill so it reads as inert rather than a valid
              // accent-coloured selection.
              selectedColor: context.rhythm.surfaceMuted,
              backgroundColor: context.rhythm.surfaceMuted,
              showCheckmark: false,
              labelStyle: TextStyle(
                color: context.rhythm.textMuted,
                fontSize: 12,
                fontWeight: FontWeight.w400,
                fontStyle: FontStyle.italic,
              ),
              side: BorderSide(
                color: context.rhythm.warning.withValues(alpha: 0.6),
              ),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(RhythmRadius.pill),
              ),
              padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
            ),
          );
        }

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
