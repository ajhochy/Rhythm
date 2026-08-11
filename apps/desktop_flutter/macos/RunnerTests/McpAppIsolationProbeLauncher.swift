#if DEBUG
import Cocoa
import Foundation
import WebKit

private let probeEnvironmentKey = "RHYTHM_MCP_APPS_ISOLATION_PROBE"

private final class ProbeController: NSObject, WKNavigationDelegate, WKUIDelegate,
  WKScriptMessageHandler
{
  private let bootNonce = UUID().uuidString
  private let startedAt = Date()
  private var webView: WKWebView?
  private var lifetimeTimer: Timer?

  func launch() -> NSWindow {
    let limits = McpAppIsolationProbePolicy.limits
    let configuration = McpAppIsolationProbePolicy.makeWebViewConfiguration()
    configuration.userContentController.add(self, name: "rhythmProbe")

    let frame = NSRect(x: 0, y: 0, width: min(960, limits.maxWidth), height: min(720, limits.maxHeight))
    let view = WKWebView(frame: frame, configuration: configuration)
    view.navigationDelegate = self
    view.uiDelegate = self
    webView = view

    let window = NSWindow(
      contentRect: frame,
      styleMask: [.titled, .closable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Rhythm MCP App Isolation Probe — NOT PRODUCTION"
    window.contentView = view
    window.delegate = self
    window.contentMinSize = NSSize(width: 320, height: 240)
    window.contentMaxSize = NSSize(width: limits.maxWidth, height: limits.maxHeight)

    let fixture = """
    <!doctype html><meta charset="utf-8"><script nonce="rhythm-probe-shell">
      const report = (id, value) => parent.postMessage({
        id, method: 'probe.ping', nonce: '\(bootNonce)', value
      }, '*');
      report('ready', {
        parentReadable: (() => { try { return !!parent.document; } catch (_) { return false; } })(),
        topReadable: (() => { try { return !!top.document; } catch (_) { return false; } })(),
        directHandler: !!(window.webkit && window.webkit.messageHandlers)
      });
    </script>
    """
    let contentBytes = fixture.lengthOfBytes(using: .utf8)
    guard McpAppIsolationProbePolicy.limitViolation(
      contentBytes: contentBytes,
      messageBytes: 1,
      activeViews: 1,
      width: Int(frame.width),
      height: Int(frame.height),
      ageSeconds: 0
    ) == nil else {
      fatalError("probe fixture exceeds policy limits")
    }
    view.loadHTMLString(
      McpAppIsolationProbePolicy.trustedShell(iframeHTML: fixture, bootNonce: bootNonce),
      baseURL: nil
    )
    lifetimeTimer = Timer.scheduledTimer(withTimeInterval: TimeInterval(limits.maxLifetimeSeconds), repeats: false) {
      [weak self] _ in self?.teardown(reason: "lifetime_expired")
    }
    log(
      "created persistentStore=\(configuration.websiteDataStore.isPersistent) "
        + "maxSize=\(limits.maxWidth)x\(limits.maxHeight) nonce=<redacted>"
    )
    return window
  }

  func userContentController(_: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.name == "rhythmProbe" else {
      log("denied reason=unknown_handler")
      return
    }
    guard message.frameInfo.isMainFrame else {
      log("denied reason=invalid_frame")
      return
    }
    guard Date().timeIntervalSince(startedAt) <= Double(McpAppIsolationProbePolicy.limits.maxLifetimeSeconds) else {
      teardown(reason: "lifetime_expired")
      return
    }
    guard let body = message.body as? [String: Any] else {
      log("denied reason=malformed_native_message")
      return
    }
    if let reason = body["reason"] as? String {
      log("denied reason=\(reason)")
      return
    }
    guard body["kind"] as? String == "message", let payload = body["payload"] else {
      log("denied reason=malformed_native_message")
      return
    }
    let origin = body["origin"] as? String ?? ""
    switch McpAppIsolationProbePolicy.validateBridgeMessage(
      payload,
      expectedNonce: bootNonce,
      sourceOrigin: origin
    ) {
    case .allow:
      log("accepted method=probe.ping")
    case let .deny(reason):
      log("denied reason=\(reason)")
    }
  }

  func webView(
    _: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if navigationAction.targetFrame?.isMainFrame == true,
      navigationAction.navigationType == .other,
      navigationAction.request.url?.scheme == "about"
    {
      decisionHandler(.allow)
      return
    }
    log("denied reason=navigation")
    decisionHandler(.cancel)
  }

  func webView(
    _: WKWebView,
    createWebViewWith _: WKWebViewConfiguration,
    for _: WKNavigationAction,
    windowFeatures _: WKWindowFeatures
  ) -> WKWebView? {
    log("denied reason=popup")
    return nil
  }

  @available(macOS 11.3, *)
  func webView(
    _: WKWebView,
    navigationAction _: WKNavigationAction,
    didBecome _: WKDownload
  ) {
    log("denied reason=download")
  }

  func teardown(reason: String) {
    guard let view = webView else { return }
    lifetimeTimer?.invalidate()
    lifetimeTimer = nil
    view.stopLoading()
    view.navigationDelegate = nil
    view.uiDelegate = nil
    view.configuration.userContentController.removeScriptMessageHandler(forName: "rhythmProbe")
    view.removeFromSuperview()
    webView = nil
    log("teardown reason=\(reason) observable=true")
  }

  private func log(_ event: String) {
    FileHandle.standardError.write(Data("MCP_APP_PROBE \(event)\n".utf8))
  }
}

extension ProbeController: NSWindowDelegate {
  func windowWillClose(_: Notification) {
    teardown(reason: "window_closed")
    NSApp.terminate(nil)
  }
}

@main
private enum McpAppIsolationProbeLauncher {
  static func main() {
    guard ProcessInfo.processInfo.environment[probeEnvironmentKey] == "1" else {
      FileHandle.standardError.write(Data("Probe disabled; set \(probeEnvironmentKey)=1 explicitly.\n".utf8))
      exit(64)
    }
    let app = NSApplication.shared
    app.setActivationPolicy(.regular)
    let controller = ProbeController()
    let window = controller.launch()
    window.makeKeyAndOrderFront(nil)
    app.activate(ignoringOtherApps: true)
    withExtendedLifetime(controller) { app.run() }
  }
}
#else
@main
private enum McpAppIsolationProbeLauncher {
  static func main() {
    fatalError("The MCP App isolation probe is DEBUG-only")
  }
}
#endif
