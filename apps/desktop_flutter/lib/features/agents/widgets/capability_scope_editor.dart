import 'package:flutter/material.dart';

import '../../agents/data/opencode_mcp_data_source.dart';
import '../../agents/data/opencode_skills_data_source.dart';

class CapabilityScopeResult {
  const CapabilityScopeResult({this.skills, this.mcps});

  final List<String>? skills;
  final Map<String, List<String>?>? mcps;
}

class CapabilityScopeEditor extends StatefulWidget {
  const CapabilityScopeEditor({
    super.key,
    required this.skills,
    required this.mcps,
    required this.selectedSkills,
    required this.selectedMcps,
  });

  final List<OpencodeSkillEntry> skills;
  final List<OpencodeMcpCapability> mcps;
  final List<String>? selectedSkills;
  final Map<String, List<String>?>? selectedMcps;

  @override
  State<CapabilityScopeEditor> createState() => _CapabilityScopeEditorState();
}

class _CapabilityScopeEditorState extends State<CapabilityScopeEditor>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  late List<String>? _skills;
  late Map<String, List<String>?>? _mcps;
  String _query = '';

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 2, vsync: this);
    _skills = widget.selectedSkills == null
        ? null
        : List<String>.from(widget.selectedSkills!);
    _mcps = widget.selectedMcps == null
        ? null
        : widget.selectedMcps!.map(
            (name, tools) =>
                MapEntry(name, tools == null ? null : List<String>.from(tools)),
          );
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  bool? _categoryValue(int selected, int total, bool unrestricted) {
    if (unrestricted || (total > 0 && selected == total)) return true;
    if (selected == 0) return false;
    return null;
  }

  // TabBarView needs a bounded height to lay out its pages; give it one
  // fixed value here instead of an Expanded inside a height-constrained
  // AlertDialog. A flat outer SizedBox height forced the Expanded to absorb
  // whatever the dialog's title/actions/padding didn't leave over, which on
  // a modest window (including the default widget-test surface) squeezed
  // the list to a sliver and silently dropped rows below the fold from the
  // render tree entirely. `scrollable: true` lets the whole dialog body
  // scroll instead, so the list always gets its full requested height.
  static const double _tabViewHeight = 340;

  @override
  Widget build(BuildContext context) {
    final q = _query.toLowerCase();
    return AlertDialog(
      scrollable: true,
      title: const Text('Capabilities'),
      content: SizedBox(
        width: 680,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
              'Choose exactly which skills and MCP tools this profile can use.',
            ),
            const SizedBox(height: 12),
            TextField(
              key: const ValueKey('capability-search'),
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search),
                hintText: 'Search capabilities',
                border: OutlineInputBorder(),
              ),
              onChanged: (value) => setState(() => _query = value.trim()),
            ),
            const SizedBox(height: 12),
            TabBar(
              controller: _tabs,
              tabs: const [
                Tab(text: 'Skills'),
                Tab(text: 'MCP'),
              ],
            ),
            const SizedBox(height: 8),
            SizedBox(
              height: _tabViewHeight,
              child: TabBarView(
                controller: _tabs,
                children: [_skillsTab(q), _mcpTab(q)],
              ),
            ),
            const Divider(),
            Text(
              'Effective scope',
              style: Theme.of(context).textTheme.titleSmall,
            ),
            const SizedBox(height: 4),
            Text(_summary()),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(
            context,
            CapabilityScopeResult(skills: _skills, mcps: _mcps),
          ),
          child: const Text('Save capabilities'),
        ),
      ],
    );
  }

  Widget _skillsTab(String query) {
    final visible = widget.skills
        .where(
          (skill) =>
              query.isEmpty ||
              skill.name.toLowerCase().contains(query) ||
              (skill.description ?? '').toLowerCase().contains(query),
        )
        .toList();
    final selected =
        _skills ?? widget.skills.map((skill) => skill.name).toList();
    return ListView(
      children: [
        CheckboxListTile(
          key: const ValueKey('skills-category-checkbox'),
          tristate: true,
          value: _categoryValue(
            selected.length,
            widget.skills.length,
            _skills == null,
          ),
          title: const Text('All skills'),
          subtitle: Text(
            '${selected.length} of ${widget.skills.length} selected',
          ),
          onChanged: (value) => setState(() {
            _skills = value == true
                ? null
                : value == false
                ? <String>[]
                : widget.skills.map((skill) => skill.name).toList();
          }),
        ),
        ...visible.map(
          (skill) => CheckboxListTile(
            key: ValueKey('skill-${skill.name}'),
            value: _skills == null || _skills!.contains(skill.name),
            title: Text(skill.name),
            subtitle: skill.description == null
                ? null
                : Text(skill.description!),
            onChanged: (_) => setState(() {
              _skills ??= widget.skills.map((entry) => entry.name).toList();
              _skills!.contains(skill.name)
                  ? _skills!.remove(skill.name)
                  : _skills!.add(skill.name);
            }),
          ),
        ),
      ],
    );
  }

  Widget _mcpTab(String query) {
    final selectedNames =
        _mcps?.keys.toList() ??
        widget.mcps.map((server) => server.name).toList();
    final visible = widget.mcps.where((server) {
      return query.isEmpty ||
          server.name.toLowerCase().contains(query) ||
          server.tools.any((tool) => tool.toLowerCase().contains(query));
    });
    return ListView(
      children: [
        CheckboxListTile(
          key: const ValueKey('mcp-category-checkbox'),
          tristate: true,
          value: _categoryValue(
            selectedNames.length,
            widget.mcps.length,
            _mcps == null,
          ),
          title: const Text('All MCP servers and tools'),
          subtitle: Text(
            '${selectedNames.length} of ${widget.mcps.length} selected',
          ),
          onChanged: (value) => setState(() {
            _mcps = value == true
                ? null
                : value == false
                ? <String, List<String>?>{}
                : {for (final server in widget.mcps) server.name: null};
          }),
        ),
        ...visible.map(_serverTile),
      ],
    );
  }

  Widget _serverTile(OpencodeMcpCapability server) {
    final enabled = _mcps == null || _mcps!.containsKey(server.name);
    final selectedTools = _mcps?[server.name];
    return ExpansionTile(
      key: ValueKey('mcp-server-${server.name}'),
      leading: Checkbox(
        tristate: true,
        value: !enabled
            ? false
            : selectedTools == null
            ? true
            : selectedTools.length == server.tools.length
            ? true
            : null,
        onChanged: (value) => setState(() {
          _mcps ??= {for (final entry in widget.mcps) entry.name: null};
          if (value == false) {
            _mcps!.remove(server.name);
          } else {
            _mcps![server.name] = null;
          }
        }),
      ),
      title: Text(server.name),
      subtitle: Text(
        !enabled
            ? 'No tools'
            : selectedTools == null
            ? 'All ${server.tools.length} tools'
            : '${selectedTools.length} of ${server.tools.length} tools',
      ),
      children: server.tools
          .map(
            (tool) => CheckboxListTile(
              dense: true,
              title: Text(tool),
              value:
                  enabled &&
                  (selectedTools == null || selectedTools.contains(tool)),
              onChanged: (_) => setState(() {
                _mcps ??= {for (final entry in widget.mcps) entry.name: null};
                final tools = List<String>.from(
                  _mcps![server.name] ?? server.tools,
                );
                tools.contains(tool) ? tools.remove(tool) : tools.add(tool);
                if (tools.isEmpty) {
                  _mcps!.remove(server.name);
                } else {
                  _mcps![server.name] = tools;
                }
              }),
            ),
          )
          .toList(),
    );
  }

  String _summary() {
    final skillCount = _skills?.length ?? widget.skills.length;
    final serverCount = _mcps?.length ?? widget.mcps.length;
    final restrictedTools =
        _mcps?.values.whereType<List<String>>().fold<int>(
          0,
          (sum, tools) => sum + tools.length,
        ) ??
        0;
    final toolDetail = restrictedTools == 0
        ? 'all tools on selected servers'
        : '$restrictedTools selected tools';
    return '$skillCount of ${widget.skills.length} skills • '
        '$serverCount of ${widget.mcps.length} MCP servers • $toolDetail';
  }
}
