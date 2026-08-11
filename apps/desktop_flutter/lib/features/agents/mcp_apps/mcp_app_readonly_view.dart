import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../data/agents_data_source.dart';
import 'mcp_app_readonly_host.dart';

/// Generic descriptor-driven read-only MCP App surface.
///
/// The fallback is deliberately rendered outside the WebView and remains
/// usable while the resource loads, after it loads, and after every failure.
class McpAppReadOnlyView extends StatefulWidget {
  const McpAppReadOnlyView({
    super.key,
    required this.descriptor,
    required this.mode,
    required this.fallbackText,
    this.structuredFallback,
    this.toolInput,
    this.toolResult,
    this.fetchResource,
    this.enableNativeRuntime = true,
  });

  final McpAppResourceDescriptor descriptor;
  final String mode;
  final String fallbackText;
  final String? structuredFallback;
  final Object? toolInput;
  final Object? toolResult;
  final McpAppResourceFetcher? fetchResource;
  final bool enableNativeRuntime;

  @override
  State<McpAppReadOnlyView> createState() => _McpAppReadOnlyViewState();
}

class _McpAppReadOnlyViewState extends State<McpAppReadOnlyView> {
  AgentsDataSource? _ownedSource;
  WebViewController? _webView;
  late McpAppReadOnlyHost _host;
  int _generation = 0;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void didUpdateWidget(covariant McpAppReadOnlyView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.descriptor.sessionId != widget.descriptor.sessionId ||
        oldWidget.descriptor.callId != widget.descriptor.callId ||
        oldWidget.mode != widget.mode) {
      _host.teardown();
      _start();
    }
  }

  void _start() {
    final fetcher = widget.fetchResource ?? _fetchFromLocalApi;
    _host = McpAppReadOnlyHost(
      mode: widget.mode,
      sessionId: widget.descriptor.sessionId,
      callId: widget.descriptor.callId,
      fallbackText: widget.fallbackText,
      structuredFallback: widget.structuredFallback,
      fetchResource: fetcher,
      sendToApp: _sendToApp,
    );
    _load(++_generation);
  }

  Future<McpAppHtmlResource> _fetchFromLocalApi({
    required String sessionId,
    required String callId,
  }) async {
    final source = _ownedSource ??= AgentsDataSource();
    final json = await source.fetchMcpAppResource(
      sessionId: sessionId,
      toolCallId: callId,
    );
    return McpAppHtmlResource.fromJson(json);
  }

  Future<void> _load(int generation) async {
    await _host.load();
    if (!mounted || generation != _generation) return;
    final resource = _host.snapshot.resource;
    if (resource != null && widget.enableNativeRuntime && Platform.isMacOS) {
      final theme =
          Theme.of(context).brightness == Brightness.dark ? 'dark' : 'light';
      try {
        final controller = await _createWebView(generation);
        if (!mounted || generation != _generation) return;
        _webView = controller;
        await controller.loadHtmlString(
          _trustedShell(resource.text, _host.bootNonce),
        );
        await _host.initialize(theme: theme);
        await _host.deliverInput(widget.toolInput);
        await _host.deliverResult(widget.toolResult);
        await _host.updateSize(width: 800, height: 360);
        await _host.ping();
      } on Object {
        _host.teardown();
      }
    }
    if (mounted && generation == _generation) setState(() {});
  }

  Future<WebViewController> _createWebView(int generation) async {
    var permitsInitialBlankNavigation = true;
    final params = WebKitWebViewControllerCreationParams(
      javaScriptCanOpenWindowsAutomatically: false,
      mediaTypesRequiringUserAction: const {
        PlaybackMediaTypes.audio,
        PlaybackMediaTypes.video,
      },
      allowsInlineMediaPlayback: false,
    );
    final controller = WebViewController.fromPlatformCreationParams(
      params,
      onPermissionRequest: (request) => request.deny(),
    );
    await controller.setJavaScriptMode(JavaScriptMode.unrestricted);
    await controller.setNavigationDelegate(NavigationDelegate(
      onNavigationRequest: (request) {
        final initialBlank = permitsInitialBlankNavigation &&
            (request.url.isEmpty || request.url == 'about:blank');
        permitsInitialBlankNavigation = false;
        return initialBlank
            ? NavigationDecision.navigate
            : NavigationDecision.prevent;
      },
    ));
    final platform = controller.platform;
    if (platform is WebKitWebViewController) {
      await platform.setAllowsBackForwardNavigationGestures(false);
      try {
        await platform.setInspectable(false);
      } on Object {
        // Older supported macOS versions do not expose this property.
      }
    }
    await WebViewCookieManager().clearCookies();
    await controller.clearCache();
    await controller.clearLocalStorage();
    await controller.addJavaScriptChannel(
      'RhythmMcpAppHost',
      onMessageReceived: (message) async {
        if (!mounted || generation != _generation) return;
        await _host.handleAppMessage(message.message);
      },
    );
    return controller;
  }

  Future<void> _sendToApp(String encodedMessage) async {
    final controller = _webView;
    if (controller == null) return;
    final encoded = jsonEncode(encodedMessage);
    await controller.runJavaScript(
      "document.getElementById('app')?.contentWindow?.postMessage(JSON.parse($encoded), '*');",
    );
  }

  @override
  void dispose() {
    _generation++;
    _host.teardown();
    _ownedSource?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final snapshot = _host.snapshot;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (widget.fallbackText.isNotEmpty) SelectableText(widget.fallbackText),
        if (widget.structuredFallback case final structured?) ...[
          const SizedBox(height: 6),
          SelectableText(
            structured,
            style: const TextStyle(fontFamily: 'JetBrainsMono', fontSize: 11),
          ),
        ],
        if (snapshot.errorCode != null) ...[
          const SizedBox(height: 6),
          const Text('Interactive view unavailable. The result remains above.'),
        ],
        if (snapshot.htmlVisible && _webView != null) ...[
          const SizedBox(height: 8),
          SizedBox(height: 360, child: WebViewWidget(controller: _webView!)),
        ],
      ],
    );
  }

  static String _trustedShell(String appHtml, String bootNonce) {
    final app = base64Encode(utf8.encode(appHtml));
    final nonce = base64Encode(utf8.encode(bootNonce));
    return '''
<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-rhythm-mcp-app-shell'; frame-src blob:; connect-src 'none'; form-action 'none'; base-uri 'none'">
</head><body><iframe id="app" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
<script nonce="rhythm-mcp-app-shell">(() => {
  'use strict';
  const frame = document.getElementById('app');
  const decode = value => new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)));
  const nonce = decode('$nonce');
  const app = decode('$app');
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'";
  const bootstrap = `<script>Object.defineProperty(window,'rhythmMcpApp',{value:Object.freeze({bootNonce:'\${nonce}'})});<\\/script>`;
  const url = URL.createObjectURL(new Blob([`<!doctype html><meta http-equiv="Content-Security-Policy" content="\${policy}">\${bootstrap}\${app}`], {type:'text/html'}));
  frame.addEventListener('load', () => URL.revokeObjectURL(url), {once:true});
  frame.src = url;
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== 'null') return;
    const payload = event.data && typeof event.data === 'object'
      ? event.data
      : {id:'invalid', method:'invalid'};
    RhythmMcpAppHost.postMessage(JSON.stringify(payload));
  });
})();</script></body></html>''';
  }
}
