import 'dart:io';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../../../app/core/errors/app_error.dart';
import '../data/live_artifacts_data_source.dart';
import '../models/live_artifact.dart';
import '../services/live_artifact_bridge.dart';

class LiveArtifactView extends StatefulWidget {
  const LiveArtifactView({
    super.key,
    required this.artifact,
    required this.source,
    this.enableNativeRuntime = true,
    this.debugOnNativeReady,
    this.debugOnBridgeMessage,
    this.onRemove,
    this.currentUserId,
  });

  final LiveArtifact artifact;
  final LiveArtifactsDataSource source;
  final bool enableNativeRuntime;

  /// Assert-only native integration hook; unavailable from release builds.
  final void Function(WebViewController controller, bool inspectableDisabled)?
      debugOnNativeReady;
  final void Function(String raw)? debugOnBridgeMessage;
  final VoidCallback? onRemove;
  final int? currentUserId;

  @override
  State<LiveArtifactView> createState() => _LiveArtifactViewState();
}

class _LiveArtifactViewState extends State<LiveArtifactView> {
  WebViewController? _webView;
  late LiveArtifact _artifact;
  int _generation = 0;
  bool _loading = true;
  _ViewerFailure? _failure;
  DateTime? _lastBlockedAt;

  @override
  void initState() {
    super.initState();
    _artifact = widget.artifact;
    _reload();
  }

  @override
  void didUpdateWidget(covariant LiveArtifactView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.artifact.id != widget.artifact.id) {
      _artifact = widget.artifact;
      _reload();
    }
  }

  Future<WebViewController> _createWebView(int generation) async {
    var permitsInitialBlankNavigation = true;
    late final WebViewController controller;
    final bridge = LiveArtifactBridge(
      artifactId: _artifact.id,
      userId: 0,
      generation: generation,
      source: widget.source,
      artifact: _artifact,
      isCurrent: (value) => mounted && value == _generation,
      onBlocked: _showBlocked,
      debugOnMessage: widget.debugOnBridgeMessage,
    );
    final params = WebKitWebViewControllerCreationParams(
      javaScriptCanOpenWindowsAutomatically: false,
      mediaTypesRequiringUserAction: const {
        PlaybackMediaTypes.audio,
        PlaybackMediaTypes.video,
      },
      allowsInlineMediaPlayback: false,
    );
    controller = WebViewController.fromPlatformCreationParams(
      params,
      onPermissionRequest: (request) {
        _showBlocked('media');
        request.deny();
      },
    );
    await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    await controller.setNavigationDelegate(NavigationDelegate(
      onNavigationRequest: (request) {
        final isInitialBlank = permitsInitialBlankNavigation &&
            (request.url.isEmpty || request.url == 'about:blank');
        permitsInitialBlankNavigation = false;
        if (!isInitialBlank) _showBlocked('navigation');
        return isInitialBlank
            ? NavigationDecision.navigate
            : NavigationDecision.prevent;
      },
    ));
    final platform = controller.platform;
    var inspectableDisabled = false;
    if (platform is WebKitWebViewController) {
      await platform.setAllowsBackForwardNavigationGestures(false);
      try {
        await platform.setInspectable(false);
        inspectableDisabled = true;
      } catch (_) {
        // macOS before 13.3 has no inspectable WKWebView property.
      }
    }
    await WebViewCookieManager().clearCookies();
    await controller.clearCache();
    await controller.clearLocalStorage();
    await controller.addJavaScriptChannel('RhythmBridge',
        onMessageReceived: (message) async {
      final response = await bridge.handle(message.message);
      if (response.isNotEmpty && mounted && generation == _generation) {
        await controller.runJavaScript(response);
      }
    });
    assert(() {
      widget.debugOnNativeReady?.call(controller, inspectableDisabled);
      return true;
    }());
    return controller;
  }

  void _showBlocked(String _) {
    final now = DateTime.now();
    if (_lastBlockedAt != null &&
        now.difference(_lastBlockedAt!) < const Duration(seconds: 2)) return;
    _lastBlockedAt = now;
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
      content: Text(
          'Links, downloads, and file access are unavailable in live artifacts.'),
      behavior: SnackBarBehavior.floating,
    ));
  }

  Future<void> _reload() async {
    final generation = ++_generation;
    setState(() {
      _loading = true;
      _failure = null;
    });
    try {
      final latest = await widget.source.get(_artifact.id);
      final html = await widget.source.render(_artifact.id);
      if (!mounted || generation != _generation) return;
      _artifact = latest;
      if (widget.enableNativeRuntime && Platform.isMacOS) {
        final controller = await _createWebView(generation);
        if (!mounted || generation != _generation) return;
        _webView = controller;
        await controller.loadHtmlString(html);
      }
      if (mounted && generation == _generation) {
        setState(() => _loading = false);
      }
    } catch (error) {
      if (mounted && generation == _generation) {
        setState(() {
          _loading = false;
          _failure = _ViewerFailure.from(error);
        });
      }
    }
  }

  @override
  void dispose() {
    _generation++;
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Column(children: [
        _ViewerToolbar(
            artifact: _artifact,
            source: widget.source,
            currentUserId: widget.currentUserId,
            onChanged: (artifact) => setState(() => _artifact = artifact),
            onReload: _reload),
        Expanded(
          child: _failure != null
              ? Center(
                  child: _FailureContent(
                      failure: _failure!,
                      onRetry: _reload,
                      onRemove: widget.onRemove))
              : _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _webView == null
                      ? const Center(
                          child: Text(
                              'Secure native viewer is available on macOS.'))
                      : WebViewWidget(controller: _webView!),
        ),
      ]);
}

class _ViewerFailure {
  const _ViewerFailure(this.message, {this.action = _ViewerFailureAction.none});
  final String message;
  final _ViewerFailureAction action;

  factory _ViewerFailure.from(Object error) {
    final status = error is AppError ? error.statusCode : null;
    if (status == 410)
      return const _ViewerFailure('This artifact was deleted.',
          action: _ViewerFailureAction.remove);
    if (status == 409)
      return const _ViewerFailure(
          'This artifact changed elsewhere. Refresh and try again.',
          action: _ViewerFailureAction.refresh);
    if (status == 403 || status == 404)
      return const _ViewerFailure('This artifact is unavailable.');
    return const _ViewerFailure('Could not load this artifact.',
        action: _ViewerFailureAction.retry);
  }
}

enum _ViewerFailureAction { none, retry, refresh, remove }

class _FailureContent extends StatelessWidget {
  const _FailureContent(
      {required this.failure, required this.onRetry, this.onRemove});
  final _ViewerFailure failure;
  final VoidCallback onRetry;
  final VoidCallback? onRemove;

  @override
  Widget build(BuildContext context) =>
      Column(mainAxisSize: MainAxisSize.min, children: [
        Text(failure.message, textAlign: TextAlign.center),
        if (failure.action == _ViewerFailureAction.retry ||
            failure.action == _ViewerFailureAction.refresh)
          TextButton(
              onPressed: onRetry,
              child: Text(failure.action == _ViewerFailureAction.retry
                  ? 'Retry artifact'
                  : 'Refresh artifact')),
        if (failure.action == _ViewerFailureAction.remove && onRemove != null)
          TextButton(onPressed: onRemove, child: const Text('Remove tab')),
      ]);
}

class _ViewerToolbar extends StatelessWidget {
  const _ViewerToolbar({
    required this.artifact,
    required this.source,
    required this.currentUserId,
    required this.onChanged,
    required this.onReload,
  });

  final LiveArtifact artifact;
  final LiveArtifactsDataSource source;
  final int? currentUserId;
  final ValueChanged<LiveArtifact> onChanged;
  final VoidCallback onReload;

  bool get _isOwner => artifact.ownerUserId == currentUserId;

  String _metadata() {
    final name = artifact.updatedByDisplayName?.trim();
    return [
      'Updated ${DateFormat.yMMMd().format(artifact.updatedAt.toLocal())}${name?.isNotEmpty == true ? ' by $name' : ''}',
      'Bundle ${artifact.currentBundleRevision}',
      'State ${artifact.currentStateRevision} · ${artifact.visibility.label}',
    ].join(' · ');
  }

  @override
  Widget build(BuildContext context) => Material(
        child: ListTile(
          title: Text(artifact.title),
          subtitle: Text(_metadata()),
          trailing: Row(mainAxisSize: MainAxisSize.min, children: [
            if (_isOwner)
              Semantics(
                  label: 'Share artifact',
                  button: true,
                  container: true,
                  child: IconButton(
                    tooltip: 'Share artifact',
                    onPressed: () => _share(context),
                    icon: const Icon(Icons.share),
                  )),
            IconButton(
              tooltip: 'Reload artifact',
              onPressed: onReload,
              icon: const Icon(Icons.refresh),
            ),
          ]),
        ),
      );

  void _share(BuildContext context) => showDialog<void>(
      context: context,
      barrierLabel: 'Search workspace users',
      builder: (_) => _ShareArtifactDialog(
          artifact: artifact, source: source, onChanged: onChanged));
}

class _ShareArtifactDialog extends StatefulWidget {
  const _ShareArtifactDialog(
      {required this.artifact, required this.source, required this.onChanged});
  final LiveArtifact artifact;
  final LiveArtifactsDataSource source;
  final ValueChanged<LiveArtifact> onChanged;
  @override
  State<_ShareArtifactDialog> createState() => _ShareArtifactDialogState();
}

class _ShareArtifactDialogState extends State<_ShareArtifactDialog> {
  late LiveArtifact _artifact = widget.artifact;
  List<LiveArtifactUser> _users = const [];
  List<int> _collaboratorIds = const [];
  String _query = '';
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _refresh();
  }

  Future<void> _refresh() async {
    setState(() => _loading = true);
    try {
      final results = await Future.wait<Object>([
        widget.source.get(_artifact.id),
        widget.source.collaborators(_artifact.id),
      ]);
      final users = _users.isEmpty ? await widget.source.users() : _users;
      if (!mounted) return;
      setState(() {
        _artifact = results[0] as LiveArtifact;
        _users = users;
        _collaboratorIds = results[1] as List<int>;
        _loading = false;
      });
      widget.onChanged(_artifact);
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _setVisibility(LiveArtifactVisibility visibility) async {
    await widget.source.updateVisibility(_artifact.id, visibility);
    await _refresh();
  }

  Future<void> _add(int userId) async {
    await widget.source.addCollaborator(_artifact.id, userId);
    await _refresh();
  }

  Future<void> _remove(int userId) async {
    await widget.source.removeCollaborator(_artifact.id, userId);
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final matches = _users.where((user) {
      final query = _query.toLowerCase();
      return user.name.toLowerCase().contains(query) ||
          user.email.toLowerCase().contains(query);
    }).toList();
    final collaborators =
        _users.where((user) => _collaboratorIds.contains(user.id)).toList();
    return AlertDialog(
      title: const Text('Share artifact'),
      content: SizedBox(
        width: 440,
        child: SingleChildScrollView(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
          for (final visibility in LiveArtifactVisibility.values)
            RadioListTile<LiveArtifactVisibility>(
              value: visibility,
              groupValue: _artifact.visibility,
              onChanged: (value) =>
                  value == null ? null : _setVisibility(value),
              title: Text(visibility.label),
            ),
          Semantics(
            label: 'Search workspace users',
            textField: true,
            child: TextField(
              autofocus: true,
              decoration: const InputDecoration(labelText: 'Search users'),
              onChanged: (value) => setState(() => _query = value),
            ),
          ),
          const SizedBox(height: 8),
          if (_loading)
            const CircularProgressIndicator()
          else ...[
            for (final user in collaborators)
              ListTile(
                title: Text(user.displayName),
                subtitle: user.email.isEmpty ? null : Text(user.email),
                trailing: Semantics(
                  label: 'Remove ${user.displayName}',
                  button: true,
                  container: true,
                  child: IconButton(
                    tooltip: 'Remove ${user.displayName}',
                    onPressed: () => _remove(user.id),
                    icon: const Icon(Icons.person_remove),
                  ),
                ),
              ),
            for (final user
                in matches.where((user) => !_collaboratorIds.contains(user.id)))
              ListTile(
                title: Text(user.displayName),
                subtitle: user.email.isEmpty ? null : Text(user.email),
                trailing: TextButton(
                    onPressed: () => _add(user.id), child: const Text('Add')),
              ),
          ],
          const Text(
              'Removing a collaborator revokes access but does not delete the artifact.'),
        ])),
      ),
      actions: [
        TextButton(
            onPressed: () => Navigator.pop(context), child: const Text('Done'))
      ],
    );
  }
}
