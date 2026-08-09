import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';

import '../../../app/core/auth/auth_session_service.dart';
import '../../../app/core/ui/rhythm_badge.dart';
import '../controllers/live_artifacts_controller.dart';
import '../data/live_artifacts_data_source.dart';
import '../models/live_artifact.dart';
import '../../settings/data/user_preferences_data_source.dart';

class DashboardArtifactWorkspace extends StatefulWidget {
  const DashboardArtifactWorkspace({
    super.key,
    required this.dashboard,
    this.controller,
    this.baseUrl,
    this.manageAuthLifecycle = true,
  });
  final Widget dashboard;
  final LiveArtifactsController? controller;
  final String? baseUrl;
  final bool manageAuthLifecycle;
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
    if (!widget.manageAuthLifecycle) return;
    final user = context.watch<AuthSessionService>().currentUser;
    if (!_identityInitialized || _activeUserId != user?.id) {
      _identityInitialized = true;
      _activeUserId = user?.id;
      _controller.reset();
      if (user == null) return;
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
        DashboardArtifactTabs(controller: controller),
        Expanded(
            child: controller.dashboardSelected
                ? widget.dashboard
                : _ArtifactPlaceholder(
                    tab: controller.tabs
                        .firstWhere((tab) => tab.id == controller.selectedId),
                    onRetry: () =>
                        controller.retryTab(controller.selectedId!))),
      ]),
    );
  }
}

class DashboardArtifactTabs extends StatefulWidget {
  const DashboardArtifactTabs({super.key, required this.controller});
  final LiveArtifactsController controller;
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
      required this.onSelected});
  final LiveArtifactsController controller;
  final VoidCallback onClose;
  final ValueChanged<String> onSelected;
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
}

class _ClosePickerIntent extends Intent {
  const _ClosePickerIntent();
}

class _ArtifactPlaceholder extends StatelessWidget {
  const _ArtifactPlaceholder({required this.tab, required this.onRetry});
  final LiveArtifactTab tab;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) => Center(
          child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(
              tab.status == LiveArtifactTabStatus.ready
                  ? '${tab.artifact!.title}\nArtifact viewing arrives in the next slice.'
                  : tab.message ?? 'Loading artifact…',
              textAlign: TextAlign.center),
          if (tab.status == LiveArtifactTabStatus.conflict)
            TextButton(
                onPressed: onRetry, child: const Text('Refresh artifact')),
        ]),
      ));
}
