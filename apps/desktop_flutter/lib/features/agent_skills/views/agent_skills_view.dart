import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../../app/core/ui/tokens/rhythm_theme.dart';
import '../../agents/data/opencode_skills_data_source.dart';
import '../../agents/views/_managed_skill_editor_sheet.dart';
import '../controllers/agent_skills_controller.dart';

/// Standalone Skills menu (Agents → Tools → Skills).
///
/// #813 (skills-table): redesigns the unified list from #796 into a SORTABLE,
/// SEARCHABLE table.
///   - Columns: Name (+ MANAGED/EXTERNAL badge, lock icon for external),
///     Description, and a compact trailing Status cell holding a lifecycle pill
///     plus per-row actions.
///   - Status: every row shows a lifecycle pill — `active` (the default when a
///     skill has no sidecar row) as a muted neutral pill so the column is never
///     empty, `measuring` amber, `reverted` red.
///   - Sort: clicking the Name, Description, or Status header toggles asc/desc
///     (default Name asc). A visual sort arrow marks the active column. Status
///     sorts by lifecycle group (measuring → reverted → active) with a Name
///     tiebreak.
///   - Search: a live filter field matches Name + Description
///     (case-insensitive substring). Body is NOT searched — it is lazy.
///   - Body (lazy): each row expands; on first expand it fetches the SKILL.md
///     body via [OpencodeSkillsDataSource.getContent] and caches it per-row, so
///     re-expanding does not refetch. A spinner shows while fetching and a soft
///     error renders on failure.
///
/// #845 (skill-effectiveness dashboard): adds sortable Score (judge
/// `postScore`) and Usage (`uses`) columns between Description and Status,
/// following the same `skills-sort-*` header pattern. A skill with no
/// measurement/usage data sorts as lowest (never crashes) and renders a muted
/// `—` placeholder. The lazy expansion area gains a measurement-history
/// section showing the baseline→post score narrative for a kept measurement,
/// or a distinct "Reverted" marker for a revert event — sourced from the
/// existing sidecar ledger (`baselineScore`/`postScore`/`measureReason`), no
/// new history table.
///
/// Everything from #796 is preserved: the "New skill" create button, managed
/// edit/delete, external read-only rows, and the lifecycle/provenance metadata.
/// All traffic stays on the local agent server (`:4001`) via the data source —
/// never the production Server URL.
class AgentSkillsView extends StatefulWidget {
  const AgentSkillsView({super.key});

  @override
  State<AgentSkillsView> createState() => _AgentSkillsViewState();
}

/// Which column the table is sorted by.
enum _SortColumn { name, description, status, score, usage }

/// The lifecycle status of a skill, defaulting to `active` when no sidecar row
/// is present (the server's documented default). Lower-cased for stable
/// comparison and badge keying.
String _statusOf(OpencodeSkillEntry skill) =>
    (skill.metadata?.status ?? 'active').toLowerCase();

/// Sort rank for lifecycle status when sorting the Status column. Groups the
/// states that need attention first — measuring → reverted → active — so the
/// default ascending Status sort surfaces in-flight skills at the top. Unknown
/// statuses sort last; within a rank rows fall back to a Name tiebreak.
int _statusRank(String status) {
  switch (status) {
    case 'measuring':
      return 0;
    case 'reverted':
      return 1;
    case 'active':
      return 2;
    default:
      return 3;
  }
}

/// Fixed width of the trailing status/actions cell. Sized to hold a lifecycle
/// pill plus the edit + delete icon buttons without overflowing the row.
const double _kTrailingCellWidth = 132;

/// Fixed width of the Score and Usage columns (#845) — narrow numeric cells,
/// each sized to hold a short value/placeholder plus its sort header.
const double _kScoreCellWidth = 64;
const double _kUsageCellWidth = 64;

/// #845 — the judge `postScore` used for sorting/rendering the Score column,
/// or `null` when the skill has never been measured.
double? _postScoreOf(OpencodeSkillEntry skill) => skill.metadata?.postScore;

/// #845 — the usage count used for sorting/rendering the Usage column, or
/// `null` when the skill has no sidecar row / has never been used.
int? _usesOf(OpencodeSkillEntry skill) => skill.metadata?.uses;

class _AgentSkillsViewState extends State<AgentSkillsView> {
  final TextEditingController _searchController = TextEditingController();

  String _query = '';
  _SortColumn _sortColumn = _SortColumn.name;
  bool _ascending = true;

  /// Names of the rows currently expanded (showing their lazy body).
  final Set<String> _expanded = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      context.read<AgentSkillsController>().loadSkills();
    });
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    setState(() => _query = value.trim().toLowerCase());
  }

  void _onSort(_SortColumn column) {
    setState(() {
      if (_sortColumn == column) {
        _ascending = !_ascending;
      } else {
        _sortColumn = column;
        _ascending = true;
      }
    });
  }

  /// Applies the live search filter (Name + Description) then the active sort.
  List<OpencodeSkillEntry> _visibleSkills(List<OpencodeSkillEntry> skills) {
    final filtered = _query.isEmpty
        ? List<OpencodeSkillEntry>.of(skills)
        : skills.where((s) {
            final name = s.name.toLowerCase();
            final desc = (s.description ?? '').toLowerCase();
            return name.contains(_query) || desc.contains(_query);
          }).toList();

    int cmp(OpencodeSkillEntry a, OpencodeSkillEntry b) {
      final int result;
      switch (_sortColumn) {
        case _SortColumn.name:
          result = a.name.toLowerCase().compareTo(b.name.toLowerCase());
        case _SortColumn.description:
          result = (a.description ?? '').toLowerCase().compareTo(
                (b.description ?? '').toLowerCase(),
              );
        case _SortColumn.status:
          final byRank = _statusRank(
            _statusOf(a),
          ).compareTo(_statusRank(_statusOf(b)));
          // Tiebreak by name so same-status rows have a stable order.
          result = byRank != 0
              ? byRank
              : a.name.toLowerCase().compareTo(b.name.toLowerCase());
        case _SortColumn.score:
          // Null (never measured) sorts as lowest so ascending surfaces
          // measured skills first without crashing on a missing score.
          final byScore = (_postScoreOf(a) ?? double.negativeInfinity)
              .compareTo(_postScoreOf(b) ?? double.negativeInfinity);
          result = byScore != 0
              ? byScore
              : a.name.toLowerCase().compareTo(b.name.toLowerCase());
        case _SortColumn.usage:
          // Null (no sidecar row) sorts as lowest, same rationale as score.
          final byUsage = (_usesOf(a) ?? -1).compareTo(_usesOf(b) ?? -1);
          result = byUsage != 0
              ? byUsage
              : a.name.toLowerCase().compareTo(b.name.toLowerCase());
      }
      return _ascending ? result : -result;
    }

    filtered.sort(cmp);
    return filtered;
  }

  Future<void> _onCreateSkill(
    BuildContext context,
    AgentSkillsController controller,
  ) async {
    final created = await showManagedSkillEditorSheet(
      context,
      dataSource: controller.dataSource,
      existingNames: controller.skillNames,
    );
    if (created == null || !context.mounted) return;
    await controller.loadSkills();
  }

  Future<void> _onEditSkill(
    BuildContext context,
    AgentSkillsController controller,
    OpencodeSkillEntry skill,
  ) async {
    final updated = await showManagedSkillEditorSheet(
      context,
      dataSource: controller.dataSource,
      existingNames: controller.skillNames,
      skill: skill,
    );
    if (updated == null || !context.mounted) return;
    // The body may have changed — drop any cached copy so re-expanding refetches.
    setState(() {});
    await controller.loadSkills();
  }

  Future<void> _confirmDelete(
    BuildContext context,
    AgentSkillsController controller,
    OpencodeSkillEntry skill,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: ctx.rhythm.surface,
        title: Text(
          'Delete Skill',
          style: TextStyle(color: ctx.rhythm.textPrimary),
        ),
        content: Text(
          'Delete "${skill.name}"? This removes the Rhythm-managed skill from '
          'the engine and cannot be undone.',
          style: TextStyle(color: ctx.rhythm.textSecondary),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(
              'Cancel',
              style: TextStyle(color: ctx.rhythm.textMuted),
            ),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text('Delete', style: TextStyle(color: ctx.rhythm.danger)),
          ),
        ],
      ),
    );
    if (confirmed != true || !context.mounted) return;
    final ok = await controller.deleteSkill(skill.name);
    if (!context.mounted || ok) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Error: ${controller.error ?? 'Unknown error'}'),
        backgroundColor: context.rhythm.danger,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<AgentSkillsController>(
      builder: (context, controller, _) {
        return Scaffold(
          backgroundColor: context.rhythm.canvas,
          appBar: AppBar(
            backgroundColor: context.rhythm.surface,
            elevation: 0,
            title: Text(
              'Skills',
              style: TextStyle(
                color: context.rhythm.textPrimary,
                fontWeight: FontWeight.w600,
                fontSize: 18,
              ),
            ),
            actions: [
              TextButton.icon(
                key: const ValueKey('new-skill-button'),
                style: TextButton.styleFrom(
                  foregroundColor: context.rhythm.accent,
                ),
                icon: const Icon(Icons.add, size: 18),
                label: const Text('New skill'),
                onPressed: () => _onCreateSkill(context, controller),
              ),
              if (controller.status == AgentSkillsStatus.idle)
                IconButton(
                  icon: Icon(
                    Icons.refresh_rounded,
                    color: context.rhythm.textSecondary,
                  ),
                  tooltip: 'Refresh',
                  onPressed: () => controller.loadSkills(),
                ),
            ],
          ),
          body: _buildBody(context, controller),
        );
      },
    );
  }

  Widget _buildBody(BuildContext context, AgentSkillsController controller) {
    if (controller.status == AgentSkillsStatus.loading &&
        controller.skills.isEmpty) {
      return Center(
        child: CircularProgressIndicator(color: context.rhythm.accent),
      );
    }

    if (controller.status == AgentSkillsStatus.error &&
        controller.skills.isEmpty) {
      return Center(
        key: const ValueKey('skills-error-state'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.error_outline_rounded,
              color: context.rhythm.danger,
              size: 48,
            ),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              controller.error ?? 'An error occurred',
              style: TextStyle(color: context.rhythm.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: RhythmSpacing.md),
            FilledButton(
              onPressed: () => controller.loadSkills(),
              style: FilledButton.styleFrom(
                backgroundColor: context.rhythm.accent,
              ),
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (controller.skills.isEmpty) {
      return Center(
        key: const ValueKey('skills-empty-state'),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              Icons.auto_awesome_outlined,
              color: context.rhythm.textMuted,
              size: 56,
            ),
            const SizedBox(height: RhythmSpacing.md),
            Text(
              'No skills yet',
              style: TextStyle(
                color: context.rhythm.textSecondary,
                fontSize: 16,
                fontWeight: FontWeight.w500,
              ),
            ),
            const SizedBox(height: RhythmSpacing.xs),
            Text(
              'Engine skills appear here. Add a managed skill with "New skill".',
              style: TextStyle(color: context.rhythm.textMuted, fontSize: 13),
            ),
          ],
        ),
      );
    }

    final visible = _visibleSkills(controller.skills);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _SearchField(
          controller: _searchController,
          onChanged: _onSearchChanged,
        ),
        _TableHeader(
          sortColumn: _sortColumn,
          ascending: _ascending,
          onSort: _onSort,
        ),
        Expanded(
          child: visible.isEmpty
              ? Center(
                  key: const ValueKey('skills-no-matches'),
                  child: Text(
                    'No skills match "${_searchController.text.trim()}"',
                    style: TextStyle(
                      color: context.rhythm.textMuted,
                      fontSize: 13,
                    ),
                  ),
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(
                    RhythmSpacing.md,
                    RhythmSpacing.xs,
                    RhythmSpacing.md,
                    RhythmSpacing.md,
                  ),
                  itemCount: visible.length,
                  separatorBuilder: (_, __) =>
                      const SizedBox(height: RhythmSpacing.xs),
                  itemBuilder: (context, index) {
                    final skill = visible[index];
                    return _SkillRow(
                      skill: skill,
                      dataSource: controller.dataSource,
                      expanded: _expanded.contains(skill.name),
                      onToggleExpanded: () {
                        setState(() {
                          if (!_expanded.remove(skill.name)) {
                            _expanded.add(skill.name);
                          }
                        });
                      },
                      onEdit: skill.managed
                          ? () => _onEditSkill(context, controller, skill)
                          : null,
                      onDelete: skill.managed
                          ? () => _confirmDelete(context, controller, skill)
                          : null,
                    );
                  },
                ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Search field
// ---------------------------------------------------------------------------

class _SearchField extends StatelessWidget {
  const _SearchField({required this.controller, required this.onChanged});

  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        RhythmSpacing.md,
        RhythmSpacing.md,
        RhythmSpacing.md,
        RhythmSpacing.xs,
      ),
      child: TextField(
        key: const ValueKey('skills-search-field'),
        controller: controller,
        onChanged: onChanged,
        style: TextStyle(color: rhythm.textPrimary, fontSize: 14),
        decoration: InputDecoration(
          isDense: true,
          hintText: 'Search skills by name or description…',
          hintStyle: TextStyle(color: rhythm.textMuted, fontSize: 13),
          prefixIcon: Icon(
            Icons.search_rounded,
            color: rhythm.textMuted,
            size: 20,
          ),
          contentPadding: const EdgeInsets.symmetric(
            horizontal: 12,
            vertical: 10,
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(RhythmRadius.sm),
            borderSide: BorderSide(color: rhythm.border),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(RhythmRadius.sm),
            borderSide: BorderSide(color: rhythm.accent, width: 1.5),
          ),
          filled: true,
          fillColor: rhythm.surfaceMuted,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sortable header row
// ---------------------------------------------------------------------------

class _TableHeader extends StatelessWidget {
  const _TableHeader({
    required this.sortColumn,
    required this.ascending,
    required this.onSort,
  });

  final _SortColumn sortColumn;
  final bool ascending;
  final ValueChanged<_SortColumn> onSort;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    return Container(
      padding: const EdgeInsets.fromLTRB(
        RhythmSpacing.md + RhythmSpacing.lg, // align past the chevron
        RhythmSpacing.xs,
        RhythmSpacing.md,
        RhythmSpacing.xs,
      ),
      decoration: BoxDecoration(
        border: Border(bottom: BorderSide(color: rhythm.borderSubtle)),
      ),
      child: Row(
        children: [
          Expanded(
            flex: 3,
            child: _HeaderCell(
              keyValue: 'skills-sort-name',
              label: 'Name',
              active: sortColumn == _SortColumn.name,
              ascending: ascending,
              onTap: () => onSort(_SortColumn.name),
            ),
          ),
          const SizedBox(width: RhythmSpacing.sm),
          Expanded(
            flex: 5,
            child: _HeaderCell(
              keyValue: 'skills-sort-description',
              label: 'Description',
              active: sortColumn == _SortColumn.description,
              ascending: ascending,
              onTap: () => onSort(_SortColumn.description),
            ),
          ),
          const SizedBox(width: RhythmSpacing.sm),
          // #845 — sortable Score (judge postScore) + Usage (uses) columns.
          SizedBox(
            width: _kScoreCellWidth,
            child: _HeaderCell(
              keyValue: 'skills-sort-score',
              label: 'Score',
              active: sortColumn == _SortColumn.score,
              ascending: ascending,
              onTap: () => onSort(_SortColumn.score),
            ),
          ),
          const SizedBox(width: RhythmSpacing.xs),
          SizedBox(
            width: _kUsageCellWidth,
            child: _HeaderCell(
              keyValue: 'skills-sort-usage',
              label: 'Usage',
              active: sortColumn == _SortColumn.usage,
              ascending: ascending,
              onTap: () => onSort(_SortColumn.usage),
            ),
          ),
          const SizedBox(width: RhythmSpacing.sm),
          // Trailing status (sortable) + per-row actions area.
          SizedBox(
            width: _kTrailingCellWidth,
            child: _HeaderCell(
              keyValue: 'skills-sort-status',
              label: 'Status',
              active: sortColumn == _SortColumn.status,
              ascending: ascending,
              onTap: () => onSort(_SortColumn.status),
            ),
          ),
        ],
      ),
    );
  }
}

class _HeaderCell extends StatelessWidget {
  const _HeaderCell({
    required this.keyValue,
    required this.label,
    required this.active,
    required this.ascending,
    required this.onTap,
  });

  final String keyValue;
  final String label;
  final bool active;
  final bool ascending;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    return InkWell(
      key: ValueKey(keyValue),
      onTap: onTap,
      borderRadius: BorderRadius.circular(RhythmRadius.xs),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 2),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Flexible(
              child: Text(
                label,
                style: TextStyle(
                  color: active ? rhythm.textPrimary : rhythm.textMuted,
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.5,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const SizedBox(width: 4),
            Icon(
              active
                  ? (ascending
                      ? Icons.arrow_upward_rounded
                      : Icons.arrow_downward_rounded)
                  : Icons.unfold_more_rounded,
              key: active
                  ? ValueKey('$keyValue-${ascending ? 'asc' : 'desc'}')
                  : null,
              size: 14,
              color: active ? rhythm.accent : rhythm.textMuted,
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Skill row (expandable, lazy body)
// ---------------------------------------------------------------------------

class _SkillRow extends StatefulWidget {
  const _SkillRow({
    required this.skill,
    required this.dataSource,
    required this.expanded,
    required this.onToggleExpanded,
    this.onEdit,
    this.onDelete,
  });

  final OpencodeSkillEntry skill;
  final OpencodeSkillsDataSource dataSource;
  final bool expanded;
  final VoidCallback onToggleExpanded;

  /// Non-null only for managed skills (external/handwritten are read-only).
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;

  @override
  State<_SkillRow> createState() => _SkillRowState();
}

class _SkillRowState extends State<_SkillRow> {
  /// Cached SKILL.md body, set on the first successful expand so re-expanding
  /// the row does not refetch.
  String? _body;
  bool _loadingBody = false;
  String? _bodyError;

  @override
  void didUpdateWidget(covariant _SkillRow oldWidget) {
    super.didUpdateWidget(oldWidget);
    // Fetch lazily the first time the row is expanded and not yet cached.
    if (widget.expanded && !oldWidget.expanded) {
      _maybeFetchBody();
    }
  }

  Future<void> _maybeFetchBody() async {
    if (_body != null || _loadingBody) return;
    setState(() {
      _loadingBody = true;
      _bodyError = null;
    });
    try {
      final content = await widget.dataSource.getContent(widget.skill.name);
      if (!mounted) return;
      setState(() {
        _body = content;
        _loadingBody = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadingBody = false;
        _bodyError = e.toString().replaceFirst('Exception: ', '');
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final skill = widget.skill;
    final meta = skill.metadata;
    final snippet = skill.description;

    return Container(
      key: ValueKey('skill-tile-${skill.name}'),
      decoration: BoxDecoration(
        color: rhythm.surfaceRaised,
        borderRadius: BorderRadius.circular(RhythmRadius.md),
        border: Border.all(color: rhythm.borderSubtle),
        boxShadow: RhythmElevation.panel,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // ---- Row body (tap to expand) ----
          InkWell(
            key: ValueKey('skill-row-${skill.name}'),
            onTap: widget.onToggleExpanded,
            borderRadius: BorderRadius.circular(RhythmRadius.md),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: RhythmSpacing.sm,
                vertical: RhythmSpacing.sm,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.center,
                children: [
                  // Chevron.
                  Icon(
                    widget.expanded
                        ? Icons.keyboard_arrow_down_rounded
                        : Icons.keyboard_arrow_right_rounded,
                    color: rhythm.textMuted,
                    size: 22,
                  ),
                  const SizedBox(width: RhythmSpacing.xs),
                  // Name column (+ badges).
                  Expanded(
                    flex: 3,
                    child: Row(
                      children: [
                        Flexible(
                          child: Text(
                            skill.name,
                            style: TextStyle(
                              color: rhythm.textPrimary,
                              fontWeight: FontWeight.w600,
                              fontSize: 14,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 6),
                        _ProvenanceBadge(skill: skill),
                        if (!skill.managed) ...[
                          const SizedBox(width: 6),
                          Icon(
                            Icons.lock_outline_rounded,
                            key: ValueKey('readonly-skill-${skill.name}'),
                            color: rhythm.textMuted,
                            size: 14,
                          ),
                        ],
                      ],
                    ),
                  ),
                  const SizedBox(width: RhythmSpacing.sm),
                  // Description column.
                  Expanded(
                    flex: 5,
                    child: Text(
                      (snippet != null && snippet.isNotEmpty) ? snippet : '—',
                      style: TextStyle(
                        color: (snippet != null && snippet.isNotEmpty)
                            ? rhythm.textSecondary
                            : rhythm.textMuted,
                        fontSize: 12,
                      ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(width: RhythmSpacing.sm),
                  // #845 — Score (judge postScore) + Usage (uses) value cells.
                  SizedBox(
                    width: _kScoreCellWidth,
                    child: _NumericCell(value: _postScoreOf(skill)),
                  ),
                  const SizedBox(width: RhythmSpacing.xs),
                  SizedBox(
                    width: _kUsageCellWidth,
                    child: _NumericCell(value: _usesOf(skill)?.toDouble()),
                  ),
                  const SizedBox(width: RhythmSpacing.sm),
                  // Trailing status/metadata cell + actions.
                  SizedBox(
                    width: _kTrailingCellWidth,
                    child: _TrailingCell(
                      skill: skill,
                      onEdit: widget.onEdit,
                      onDelete: widget.onDelete,
                    ),
                  ),
                ],
              ),
            ),
          ),
          // ---- Expanded metadata + lazy body ----
          if (widget.expanded) ...[
            Divider(height: 1, color: rhythm.borderSubtle),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                RhythmSpacing.md,
                RhythmSpacing.sm,
                RhythmSpacing.md,
                RhythmSpacing.md,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (meta != null) ...[
                    _MetaLine(meta: meta),
                    if (meta.hasScores) ...[
                      const SizedBox(height: RhythmSpacing.xxs),
                      _ScoreLine(meta: meta),
                    ],
                    if (meta.isExternalFork) ...[
                      const SizedBox(height: RhythmSpacing.xxs),
                      Text(
                        '⭐ auto-improved (forked from an external skill)',
                        style: TextStyle(
                          color: rhythm.warning,
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                    if (meta.hasMeasurementHistory) ...[
                      const SizedBox(height: RhythmSpacing.xs),
                      _MeasurementHistory(skillName: skill.name, meta: meta),
                    ],
                    const SizedBox(height: RhythmSpacing.sm),
                  ],
                  _BodyView(
                    skillName: skill.name,
                    loading: _loadingBody,
                    body: _body,
                    error: _bodyError,
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// Lazy SKILL.md body area: spinner while fetching, soft error on failure,
/// scrollable monospace text once loaded.
class _BodyView extends StatelessWidget {
  const _BodyView({
    required this.skillName,
    required this.loading,
    required this.body,
    required this.error,
  });

  final String skillName;
  final bool loading;
  final String? body;
  final String? error;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;

    if (loading) {
      return Padding(
        key: ValueKey('skill-body-loading-$skillName'),
        padding: const EdgeInsets.symmetric(vertical: RhythmSpacing.sm),
        child: Row(
          children: [
            SizedBox(
              height: 16,
              width: 16,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: rhythm.accent,
              ),
            ),
            const SizedBox(width: RhythmSpacing.sm),
            Text(
              'Loading skill content…',
              style: TextStyle(color: rhythm.textMuted, fontSize: 12),
            ),
          ],
        ),
      );
    }

    if (error != null) {
      return Text(
        'Could not load skill content: $error',
        key: ValueKey('skill-body-error-$skillName'),
        style: TextStyle(color: rhythm.danger, fontSize: 12),
      );
    }

    final content = body ?? '';
    return Container(
      key: ValueKey('skill-body-$skillName'),
      constraints: const BoxConstraints(maxHeight: 280),
      width: double.infinity,
      padding: const EdgeInsets.all(RhythmSpacing.sm),
      decoration: BoxDecoration(
        color: rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border: Border.all(color: rhythm.borderSubtle),
      ),
      child: SingleChildScrollView(
        child: SelectableText(
          content.isEmpty ? '(empty)' : content,
          style: TextStyle(
            color: rhythm.textSecondary,
            fontSize: 12,
            height: 1.4,
            fontFamily: 'monospace',
            fontFamilyFallback: const ['Menlo', 'Courier New', 'monospace'],
          ),
        ),
      ),
    );
  }
}

/// Compact trailing cell: lifecycle status pill (when not active) + per-row
/// actions (edit/delete for managed; nothing for external — its read-only lock
/// lives next to the name).
class _TrailingCell extends StatelessWidget {
  const _TrailingCell({required this.skill, this.onEdit, this.onDelete});

  final OpencodeSkillEntry skill;
  final VoidCallback? onEdit;
  final VoidCallback? onDelete;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.end,
      mainAxisSize: MainAxisSize.min,
      children: [
        // Lifecycle status pill for EVERY skill — `active` (the default when no
        // sidecar row exists) renders as a muted pill so the column is never
        // empty; `measuring`/`reverted` keep their distinct amber/red styling.
        Flexible(child: _StatusBadge(status: _statusOf(skill))),
        if (onEdit != null)
          IconButton(
            key: ValueKey('edit-skill-${skill.name}'),
            icon: Icon(
              Icons.edit_outlined,
              color: context.rhythm.textSecondary,
              size: 18,
            ),
            tooltip: 'Edit',
            onPressed: onEdit,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          ),
        if (onDelete != null)
          IconButton(
            key: ValueKey('delete-skill-${skill.name}'),
            icon: Icon(
              Icons.delete_outline_rounded,
              color: context.rhythm.textMuted,
              size: 18,
            ),
            tooltip: 'Delete',
            onPressed: onDelete,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
          ),
      ],
    );
  }
}

/// #845 — a compact numeric value cell for the Score/Usage columns. Renders a
/// muted `—` placeholder when [value] is null (no sidecar row / never
/// measured/used) instead of fabricating a 0. Both the Score (judge
/// `postScore`) and Usage (`uses`) columns render as whole numbers.
class _NumericCell extends StatelessWidget {
  const _NumericCell({required this.value});

  final double? value;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final text = value == null ? '—' : value!.toStringAsFixed(0);
    return Text(
      text,
      textAlign: TextAlign.end,
      style: TextStyle(
        color: value == null ? rhythm.textMuted : rhythm.textSecondary,
        fontSize: 12,
        fontWeight: FontWeight.w500,
      ),
      overflow: TextOverflow.ellipsis,
    );
  }
}

/// `MANAGED` (accent) or `EXTERNAL` (muted) pill rendered next to a skill name.
class _ProvenanceBadge extends StatelessWidget {
  const _ProvenanceBadge({required this.skill});

  final OpencodeSkillEntry skill;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final managed = skill.managed;
    final color = managed ? rhythm.accent : rhythm.textMuted;
    return Container(
      key: ValueKey(
        managed
            ? 'badge-managed-${skill.name}'
            : 'badge-external-${skill.name}',
      ),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(RhythmRadius.xs),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Text(
        managed ? 'MANAGED' : 'EXTERNAL',
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.6,
          color: color,
        ),
      ),
    );
  }
}

/// Lifecycle status pill rendered for EVERY skill so the Status column is never
/// empty: `measuring` amber, `reverted` red, `active` (and anything unknown) a
/// muted neutral pill that is visible but not loud.
class _StatusBadge extends StatelessWidget {
  const _StatusBadge({required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final color = switch (status) {
      'reverted' => rhythm.danger,
      'measuring' => rhythm.warning,
      _ => rhythm.textMuted,
    };
    return Container(
      key: ValueKey('status-badge-$status'),
      margin: const EdgeInsets.only(right: 4),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(RhythmRadius.xs),
        border: Border.all(color: color.withValues(alpha: 0.5)),
      ),
      child: Text(
        status.toUpperCase(),
        style: TextStyle(
          fontSize: 9,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.4,
          color: color,
        ),
      ),
    );
  }
}

/// Source + confidence + version meta line (only when metadata is present).
class _MetaLine extends StatelessWidget {
  const _MetaLine({required this.meta});

  final OpencodeSkillMetadata meta;

  @override
  Widget build(BuildContext context) {
    final parts = <String>[
      meta.source ?? 'engine',
      if (meta.confidence != null)
        'confidence ${meta.confidence!.toStringAsFixed(2)}',
      'v${meta.version}',
      if (meta.uses != null) '${meta.uses} uses',
    ];
    return Text(
      parts.join(' · '),
      style: TextStyle(color: context.rhythm.textMuted, fontSize: 11),
    );
  }
}

/// Baseline → post score line, shown once a measured change has both scores.
class _ScoreLine extends StatelessWidget {
  const _ScoreLine({required this.meta});

  final OpencodeSkillMetadata meta;

  @override
  Widget build(BuildContext context) {
    return Text(
      'score ${meta.baselineScore!.toStringAsFixed(2)} → '
      '${meta.postScore!.toStringAsFixed(2)}',
      style: TextStyle(color: context.rhythm.textMuted, fontSize: 11),
    );
  }
}

/// #845 — measurement history for the expansion area: the LLM-judge's
/// baseline→post score narrative for a kept measurement, or a distinct
/// "Reverted" marker for a revert event. Renders only when the sidecar row
/// carries a `measureReason` (i.e. the skill has been measured at least
/// once) — a skill with no measurement ledger renders nothing here.
class _MeasurementHistory extends StatelessWidget {
  const _MeasurementHistory({required this.skillName, required this.meta});

  final String skillName;
  final OpencodeSkillMetadata meta;

  @override
  Widget build(BuildContext context) {
    final rhythm = context.rhythm;
    final reason = meta.measureReason!;
    final isRevert = meta.isRevertEvent;

    return Container(
      key: ValueKey('measurement-history-$skillName'),
      width: double.infinity,
      padding: const EdgeInsets.all(RhythmSpacing.xs),
      margin: const EdgeInsets.only(bottom: RhythmSpacing.sm),
      decoration: BoxDecoration(
        color: rhythm.surfaceMuted,
        borderRadius: BorderRadius.circular(RhythmRadius.sm),
        border: Border.all(color: rhythm.borderSubtle),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Row(
            children: [
              Text(
                'Measurement history',
                style: TextStyle(
                  color: rhythm.textMuted,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.4,
                ),
              ),
              if (isRevert) ...[
                const SizedBox(width: RhythmSpacing.xxs),
                Text(
                  '· Reverted',
                  style: TextStyle(
                    color: rhythm.danger,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: RhythmSpacing.xxs),
          if (meta.hasScores)
            Text(
              'baseline ${meta.baselineScore!.toStringAsFixed(0)} → '
              'post ${meta.postScore!.toStringAsFixed(0)}',
              style: TextStyle(
                color: rhythm.textSecondary,
                fontSize: 11,
                fontWeight: FontWeight.w600,
              ),
            ),
          if (!isRevert) ...[
            const SizedBox(height: RhythmSpacing.xxs),
            Text(
              reason,
              style: TextStyle(color: rhythm.textMuted, fontSize: 11),
            ),
          ],
        ],
      ),
    );
  }
}
