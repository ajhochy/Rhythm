import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:file_picker/file_picker.dart';
import 'package:provider/provider.dart';
import 'package:window_manager/window_manager.dart';

import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/ui/rhythm_badge.dart';
import '../controllers/live_artifacts_controller.dart';
import '../data/live_artifacts_data_source.dart';
import '../models/live_artifact.dart';
import '../services/html_import_analyzer.dart';
import '../services/html_import_decomposer.dart';
import 'live_artifact_view.dart';
import '../../settings/data/user_preferences_data_source.dart';

class DashboardArtifactWorkspace extends StatefulWidget {
  const DashboardArtifactWorkspace({
    super.key,
    required this.dashboard,
    required this.workspaceId,
    this.controller,
    this.baseUrl,
    this.manageAuthLifecycle = true,
    this.activeUserId,
    this.enableNativeRuntime = true,
    this.debugOnNativeReady,
    this.debugOnHostRequest,
    this.debugOnBridgeMessage,
  });
  final Widget dashboard;
  final int workspaceId;
  final LiveArtifactsController? controller;
  final String? baseUrl;
  final bool manageAuthLifecycle;
  final int? activeUserId;
  final bool enableNativeRuntime;

  /// Assert-only native integration hook; it is invoked only by the viewer's
  /// debug assertion and therefore has no release behavior.
  final void Function(dynamic controller, bool inspectableDisabled)?
      debugOnNativeReady;
  final void Function(String operation)? debugOnHostRequest;
  final void Function(String raw)? debugOnBridgeMessage;
  @override
  State<DashboardArtifactWorkspace> createState() =>
      _DashboardArtifactWorkspaceState();
}

class _DashboardArtifactWorkspaceState
    extends State<DashboardArtifactWorkspace> {
  int? _activeUserId;
  bool _identityInitialized = false;
  LiveArtifactsController? _ownedController;

  LiveArtifactsController get _controller =>
      widget.controller ??
      (_ownedController ??= LiveArtifactsController(
        LiveArtifactsDataSource(baseUrl: widget.baseUrl),
        UserPreferencesDataSource(baseUrl: widget.baseUrl),
      ));

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // #1381: In non-managed mode the parent (app_shell) owns this controller
    // and drives its reset/restore lifecycle. The Dashboard is rebuilt from
    // scratch on every navigation — app_shell renders views[index], not an
    // IndexedStack — so this State is recreated on each return. Previously we
    // reset() the SHARED controller here on that remount, wiping the tabs the
    // parent had already restored, and (with no watched user in this mode)
    // never restored them: imported artifacts vanished on navigate-away.
    // Leave the parent-owned controller untouched; app_shell restores it.
    if (!widget.manageAuthLifecycle) return;
    final user = context.watch<AuthSessionService>().currentUser;
    final userId = user?.id;
    if (!_identityInitialized || _activeUserId != userId) {
      _identityInitialized = true;
      _activeUserId = userId;
      _controller.reset();
      if (userId == null || user == null) return;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          _controller.restore(user.id, user.artifactTabIds);
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = _controller;
    return ListenableBuilder(
      listenable: controller,
      builder: (_, __) => Column(children: [
        DashboardArtifactTabs(
            controller: controller,
            onImport: (title, bundle) async {
              final artifact =
                  await LiveArtifactsDataSource(baseUrl: widget.baseUrl).create(
                      workspaceId: widget.workspaceId,
                      title: title,
                      html: bundle.html,
                      css: bundle.css,
                      js: bundle.js);
              await controller.open(artifact);
            }),
        Expanded(
            child: controller.dashboardSelected
                ? widget.dashboard
                : _ArtifactContent(
                    tab: controller.tabs
                        .firstWhere((tab) => tab.id == controller.selectedId),
                    source: LiveArtifactsDataSource(
                        baseUrl: widget.baseUrl,
                        debugOnRequest: widget.debugOnHostRequest),
                    enableNativeRuntime: widget.enableNativeRuntime,
                    debugOnNativeReady: widget.debugOnNativeReady,
                    debugOnBridgeMessage: widget.debugOnBridgeMessage,
                    currentUserId: _activeUserId,
                    onRetry: () => controller.retryTab(controller.selectedId!),
                    onRemove: () => controller.close(controller.selectedId!))),
      ]),
    );
  }
}

class DashboardArtifactTabs extends StatefulWidget {
  const DashboardArtifactTabs(
      {super.key, required this.controller, this.onImport});
  final LiveArtifactsController controller;
  final Future<void> Function(String title, HtmlImportDecomposition bundle)?
      onImport;
  @override
  State<DashboardArtifactTabs> createState() => _DashboardArtifactTabsState();
}

class _DashboardArtifactTabsState extends State<DashboardArtifactTabs> {
  final _dashboardFocus = FocusNode(debugLabel: 'artifact-dashboard-tab');
  final _plusFocus = FocusNode(debugLabel: 'artifact-tab-picker');
  final _plusLink = LayerLink();
  final Map<String, FocusNode> _tabFocus = {};
  OverlayEntry? _picker;
  LiveArtifactsController get controller => widget.controller;

  @override
  void dispose() {
    _closePicker();
    _dashboardFocus.dispose();
    _plusFocus.dispose();
    for (final node in _tabFocus.values) {
      node.dispose();
    }
    super.dispose();
  }

  FocusNode _focusFor(String id) => _tabFocus.putIfAbsent(
      id, () => FocusNode(debugLabel: 'artifact-tab-$id'));

  void _moveFocus(String? id, int direction) {
    final ids = [null, ...controller.tabs.map((tab) => tab.id)];
    final next = ids[(ids.indexOf(id) + direction + ids.length) % ids.length];
    (next == null ? _dashboardFocus : _focusFor(next)).requestFocus();
  }

  Future<void> _close(String id) async {
    final index = controller.tabs.indexWhere((tab) => tab.id == id);
    controller.close(id);
    if (!mounted) return;
    final neighbor = index > 0 && index - 1 < controller.tabs.length
        ? controller.tabs[index - 1].id
        : null;
    (neighbor == null ? _dashboardFocus : _focusFor(neighbor)).requestFocus();
  }

  void _showPicker() {
    if (_picker != null) return;
    _picker = OverlayEntry(
        builder: (context) => Stack(children: [
              Positioned.fill(
                  child: GestureDetector(
                      behavior: HitTestBehavior.translucent,
                      onTap: _closePicker)),
              CompositedTransformFollower(
                link: _plusLink,
                targetAnchor: Alignment.bottomRight,
                followerAnchor: Alignment.topRight,
                offset: const Offset(0, 6),
                child: _ArtifactPicker(
                    controller: controller,
                    onImport: widget.onImport,
                    onClose: _closePicker,
                    onSelected: (id) => _closePicker(selectedId: id)),
              ),
            ]));
    Overlay.of(context).insert(_picker!);
  }

  void _closePicker({String? selectedId}) {
    _picker?.remove();
    _picker = null;
    if (selectedId == null) {
      _plusFocus.requestFocus();
    } else {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _focusFor(selectedId).requestFocus();
      });
    }
  }

  @override
  Widget build(BuildContext context) => ListenableBuilder(
        listenable: controller,
        builder: (_, __) => Material(
          child: SizedBox(
              height: 46,
              child: Row(children: [
                const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 4),
                  child: RhythmBadge(
                    label: 'Planning',
                    icon: Icons.dashboard_outlined,
                    tone: RhythmBadgeTone.accent,
                  ),
                ),
                _tab(context,
                    focusNode: _dashboardFocus,
                    label: 'Dashboard',
                    selected: controller.dashboardSelected,
                    onTap: () => controller.select(null),
                    onKey: (event) {
                      if (event.logicalKey == LogicalKeyboardKey.arrowLeft) {
                        _moveFocus(null, -1);
                        return KeyEventResult.handled;
                      }
                      if (event.logicalKey == LogicalKeyboardKey.arrowRight) {
                        _moveFocus(null, 1);
                        return KeyEventResult.handled;
                      }
                      return KeyEventResult.ignored;
                    }),
                Expanded(
                    child: SingleChildScrollView(
                        scrollDirection: Axis.horizontal,
                        child: Row(children: [
                          for (final tab in controller.tabs)
                            _artifactTab(context, tab)
                        ]))),
                CompositedTransformTarget(
                    link: _plusLink,
                    child: IconButton(
                        focusNode: _plusFocus,
                        tooltip: 'Open live artifact',
                        onPressed: _showPicker,
                        icon: const Icon(Icons.add))),
              ])),
        ),
      );

  Widget _artifactTab(BuildContext context, LiveArtifactTab tab) {
    final label = tab.artifact?.title ?? 'Unavailable artifact';
    return Tooltip(
        message: label,
        child: Row(mainAxisSize: MainAxisSize.min, children: [
          _tab(context,
              focusNode: _focusFor(tab.id),
              label: label,
              selected: controller.selectedId == tab.id,
              onTap: () => controller.select(tab.id),
              onKey: (event) {
                if (event.logicalKey == LogicalKeyboardKey.arrowLeft) {
                  _moveFocus(tab.id, -1);
                  return KeyEventResult.handled;
                }
                if (event.logicalKey == LogicalKeyboardKey.arrowRight) {
                  _moveFocus(tab.id, 1);
                  return KeyEventResult.handled;
                }
                if (event.logicalKey == LogicalKeyboardKey.delete ||
                    event.logicalKey == LogicalKeyboardKey.backspace) {
                  _close(tab.id);
                  return KeyEventResult.handled;
                }
                return KeyEventResult.ignored;
              }),
          Tooltip(
              message: 'Close $label',
              child: GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () => _close(tab.id),
                  child: const SizedBox(
                      width: 44,
                      height: 44,
                      child: Icon(Icons.close, size: 16)))),
        ]));
  }

  Widget _tab(BuildContext context,
          {required FocusNode focusNode,
          required String label,
          required bool selected,
          required VoidCallback onTap,
          KeyEventResult Function(KeyEvent event)? onKey}) =>
      Semantics(
        button: true,
        selected: selected,
        label: label == 'Dashboard' ? 'Dashboard tab' : '$label artifact tab',
        child: Focus(
          canRequestFocus: false,
          onKeyEvent: (_, event) => event is KeyDownEvent && onKey != null
              ? onKey(event)
              : KeyEventResult.ignored,
          child: TextButton(
            focusNode: focusNode,
            onPressed: onTap,
            style: TextButton.styleFrom(
                backgroundColor: selected
                    ? Theme.of(context).colorScheme.secondaryContainer
                    : null,
                minimumSize: const Size(0, 44),
                maximumSize: const Size(180, 44)),
            child: Text(label, overflow: TextOverflow.ellipsis),
          ),
        ),
      );
}

class _ArtifactPicker extends StatefulWidget {
  const _ArtifactPicker(
      {required this.controller,
      required this.onClose,
      required this.onSelected,
      this.onImport});
  final LiveArtifactsController controller;
  final VoidCallback onClose;
  final ValueChanged<String> onSelected;
  final Future<void> Function(String title, HtmlImportDecomposition bundle)?
      onImport;
  @override
  State<_ArtifactPicker> createState() => _ArtifactPickerState();
}

class _ArtifactPickerState extends State<_ArtifactPicker> {
  String query = '';
  @override
  Widget build(BuildContext context) {
    final matches = widget.controller.available
        .where((artifact) =>
            artifact.title.toLowerCase().contains(query.toLowerCase()))
        .toList();
    return Shortcuts(
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.escape): _ClosePickerIntent()
      },
      child: Actions(
        actions: {
          _ClosePickerIntent: CallbackAction<_ClosePickerIntent>(onInvoke: (_) {
            widget.onClose();
            return null;
          })
        },
        child: Focus(
          autofocus: true,
          child: Material(
            elevation: 8,
            borderRadius: BorderRadius.circular(12),
            child: SizedBox(
                width: 460,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    const Align(
                        alignment: Alignment.centerLeft,
                        child: Text('Open live artifact')),
                    const SizedBox(height: 12),
                    Row(children: [
                      TextButton(
                          onPressed: () => _showImport(context),
                          child: const Text('Import HTML')),
                      const SizedBox(width: 8),
                      Semantics(
                          label: 'Import HTML file',
                          button: true,
                          container: true,
                          child: TextButton(
                              onPressed: () => _showImport(context),
                              child: const Text('Preview import'))),
                    ]),
                    Shortcuts(
                      shortcuts: const {
                        SingleActivator(LogicalKeyboardKey.escape):
                            _ClosePickerIntent()
                      },
                      child: Actions(
                        actions: {
                          _ClosePickerIntent:
                              CallbackAction<_ClosePickerIntent>(onInvoke: (_) {
                            widget.onClose();
                            return null;
                          })
                        },
                        child: TextField(
                          autofocus: true,
                          decoration: const InputDecoration(
                              labelText: 'Search artifacts'),
                          onChanged: (value) => setState(() => query = value),
                        ),
                      ),
                    ),
                    const SizedBox(height: 12),
                    if (widget.controller.pickerError != null) ...[
                      Text(widget.controller.pickerError!),
                      TextButton(
                          onPressed: widget.controller.retryPicker,
                          child: const Text('Retry')),
                    ] else if (widget.controller.available.isEmpty)
                      const Padding(
                          padding: EdgeInsets.all(20),
                          child: Text('No HTML live artifacts are available.'))
                    else if (matches.isEmpty)
                      Padding(
                          padding: const EdgeInsets.all(20),
                          child: Column(children: [
                            const Text('No live artifacts match your search.'),
                            TextButton(
                                onPressed: () => setState(() => query = ''),
                                child: const Text('Clear search')),
                          ]))
                    else
                      Flexible(
                          child: ListView(children: [
                        for (final artifact in matches)
                          ListTile(
                            title: Text(artifact.title),
                            subtitle: Text(
                                'Updated ${MaterialLocalizations.of(context).formatMediumDate(artifact.updatedAt.toLocal())}'),
                            onTap: () {
                              widget.controller.open(artifact);
                              widget.onSelected(artifact.id);
                            },
                          )
                      ])),
                  ]),
                )),
          ),
        ),
      ),
    );
  }

  Future<void> _showImport(BuildContext context) async {
    final result = await showDialog<_HtmlImport>(
        context: context, builder: (_) => const HtmlImportDialog());
    if (result == null || widget.onImport == null) return;
    await widget.onImport!(result.title, result.bundle);
    if (mounted) widget.onClose();
  }
}

class _HtmlImport {
  const _HtmlImport(this.title, this.bundle);
  final String title;
  final HtmlImportDecomposition bundle;
}

/// Leaves JSON-envelope headroom beneath the server's 1 MiB request ceiling.
const maxHtmlImportBytes = 900 * 1024;

class HtmlImportPreview {
  const HtmlImportPreview._(
      {required this.title, required this.bundle, required this.warnings});
  final String title;
  final HtmlImportDecomposition bundle;
  String get html => bundle.html;
  final List<String> warnings;

  static HtmlImportPreview parse(
      {required String filename, required List<int> bytes}) {
    if (!RegExp(r'\.html?$', caseSensitive: false).hasMatch(filename)) {
      throw const FormatException('Choose an HTML (.html or .htm) file.');
    }
    if (bytes.length > maxHtmlImportBytes) {
      throw const FormatException('This HTML file is too large to import.');
    }
    final html = utf8.decode(bytes, allowMalformed: false);
    final fallback =
        filename.replaceFirst(RegExp(r'\.html?$', caseSensitive: false), '');
    final match = RegExp(r'<title\b[^>]*>(.*?)</title>',
            caseSensitive: false, dotAll: true)
        .firstMatch(html);
    final title = match?.group(1)?.replaceAll(RegExp(r'<[^>]*>'), '').trim();
    final warnings = HtmlImportAnalyzer.analyze(html).warnings;
    final bundle = HtmlImportDecomposer.decompose(html);
    return HtmlImportPreview._(
        title: title?.isNotEmpty == true ? title! : fallback,
        bundle: bundle,
        warnings: warnings);
  }
}

class HtmlImportFile {
  const HtmlImportFile({required this.name, required this.bytes});
  final String name;
  final List<int> bytes;
}

class HtmlImportDialog extends StatefulWidget {
  const HtmlImportDialog({super.key, this.pickFile});
  final Future<HtmlImportFile?> Function()? pickFile;
  @override
  State<HtmlImportDialog> createState() => _HtmlImportDialogState();
}

class _HtmlImportDialogState extends State<HtmlImportDialog> {
  HtmlImportDecomposition? _bundle;
  String? _error;
  List<String> _warnings = const [];
  final _title = TextEditingController();
  bool _opening = false;

  @override
  void dispose() {
    _title.dispose();
    super.dispose();
  }

  Future<void> _pick() async {
    // The native panel can take a beat to appear on first open; without a
    // busy state the button looks dead and invites a second click.
    if (_opening) return;
    setState(() => _opening = true);
    try {
      final supplied = await widget.pickFile?.call();
      if (widget.pickFile != null) {
        if (supplied == null) return;
        return await _preview(supplied);
      }
      // ponytail: script/debug launches can leave the app without real macOS
      // activation, so the native open panel ignores clicks; focus first.
      await windowManager.focus();
      final picked = await FilePicker.pickFiles(
          type: FileType.custom,
          allowedExtensions: const ['html', 'htm'],
          withData: true);
      final file = picked?.files.singleOrNull;
      final bytes = file?.bytes;
      if (bytes == null || file == null) return;
      await _preview(HtmlImportFile(name: file.name, bytes: bytes));
    } finally {
      if (mounted) setState(() => _opening = false);
    }
  }

  Future<void> _preview(HtmlImportFile file) async {
    try {
      final preview =
          HtmlImportPreview.parse(filename: file.name, bytes: file.bytes);
      setState(() {
        _bundle = preview.bundle;
        _title.text = preview.title;
        _warnings = preview.warnings;
        _error = null;
      });
    } on FormatException catch (error) {
      setState(() {
        _bundle = null;
        _warnings = const [];
        _error = error.message.toString();
      });
    }
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('Import HTML'),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Semantics(
              label: 'Import HTML file',
              button: true,
              child: TextButton(
                  onPressed: _opening ? null : _pick,
                  child: Text(_opening ? 'Opening…' : 'Choose HTML file'))),
          const SizedBox(height: 8),
          if (_error != null) Text(_error!),
          if (_bundle == null && _error == null)
            const Text('Preview import after choosing an HTML file.'),
          if (_bundle != null) ...[
            const SizedBox(height: 8),
            TextField(
              controller: _title,
              decoration: const InputDecoration(labelText: 'Artifact title'),
            ),
            const SizedBox(height: 8),
            Text('HTML ready (${_bundle!.html.length} characters).'),
            if (_warnings.isNotEmpty)
              Text(
                'Some features may be limited: ${_warnings.join(', ')}.',
              ),
          ],
        ]),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: _bundle == null
                  ? null
                  : () => Navigator.pop(
                      context, _HtmlImport(_title.text.trim(), _bundle!)),
              child: const Text('Import')),
        ],
      );
}

class _ClosePickerIntent extends Intent {
  const _ClosePickerIntent();
}

class _ArtifactContent extends StatelessWidget {
  const _ArtifactContent(
      {required this.tab,
      required this.source,
      required this.enableNativeRuntime,
      this.currentUserId,
      this.debugOnNativeReady,
      this.debugOnBridgeMessage,
      required this.onRetry,
      required this.onRemove});
  final LiveArtifactTab tab;
  final LiveArtifactsDataSource source;
  final bool enableNativeRuntime;
  final int? currentUserId;
  final void Function(dynamic controller, bool inspectableDisabled)?
      debugOnNativeReady;
  final void Function(String raw)? debugOnBridgeMessage;
  final VoidCallback onRetry;
  final VoidCallback onRemove;
  @override
  Widget build(BuildContext context) {
    if (tab.status == LiveArtifactTabStatus.ready) {
      return LiveArtifactView(
          artifact: tab.artifact!,
          source: source,
          enableNativeRuntime: enableNativeRuntime,
          debugOnNativeReady: debugOnNativeReady,
          debugOnBridgeMessage: debugOnBridgeMessage,
          currentUserId: currentUserId,
          onRemove: onRemove);
    }
    return Center(
        child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(tab.message ?? 'Loading artifact…', textAlign: TextAlign.center),
        if (tab.status == LiveArtifactTabStatus.conflict ||
            tab.status == LiveArtifactTabStatus.error)
          TextButton(onPressed: onRetry, child: const Text('Refresh artifact')),
        if (tab.status == LiveArtifactTabStatus.deleted)
          TextButton(onPressed: onRemove, child: const Text('Remove tab')),
      ]),
    ));
  }
}
