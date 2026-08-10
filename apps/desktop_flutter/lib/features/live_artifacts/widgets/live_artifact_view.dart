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
  });

  final LiveArtifact artifact;
  final LiveArtifactsDataSource source;
  final bool enableNativeRuntime;

  /// Assert-only native integration hook; unavailable from release builds.
  final void Function(WebViewController controller, bool inspectableDisabled)?
      debugOnNativeReady;
  final void Function(String raw)? debugOnBridgeMessage;
  final VoidCallback? onRemove;

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
        _ViewerToolbar(artifact: _artifact, onReload: _reload),
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
  const _ViewerToolbar({required this.artifact, required this.onReload});

  final LiveArtifact artifact;
  final VoidCallback onReload;

  String _metadata() {
    final name = artifact.updatedByDisplayName?.trim();
    return [
      'Updated ${DateFormat.yMMMd().format(artifact.updatedAt.toLocal())}${name?.isNotEmpty == true ? ' by $name' : ''}',
      'Bundle ${artifact.currentBundleRevision}',
      'State ${artifact.currentStateRevision}',
    ].join(' · ');
  }

  @override
  Widget build(BuildContext context) => Material(
        child: ListTile(
          title: Text(artifact.title),
          subtitle: Text(_metadata()),
          trailing: IconButton(
            tooltip: 'Reload artifact',
            onPressed: onReload,
            icon: const Icon(Icons.refresh),
          ),
        ),
      );
}
