import Foundation
import WebKit

/// Disposable policy used by the issue #1343 feasibility probe. This is not a
/// production MCP App host and is intentionally not included in the Runner
/// target.
enum McpAppIsolationProbePolicy {
  static let opaqueIframeOrigin = "null"
  static let iframeOwnsDartChannel = false
  static let allowsDownloads = false

  static let contentSecurityPolicy = [
    "default-src 'none'",
    "script-src 'nonce-rhythm-probe-shell'",
    "style-src 'none'",
    "img-src 'none'",
    "connect-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'self'",
    "form-action 'none'",
    "base-uri 'none'",
  ].joined(separator: "; ")

  struct Limits {
    let maxContentBytes = 1_048_576
    let maxMessageBytes = 65_536
    let maxViews = 4
    let maxWidth = 2_560
    let maxHeight = 1_600
    let maxLifetimeSeconds = 300
  }

  enum BridgeDecision: Equatable {
    case allow
    case deny(String)
  }

  enum LimitViolation: String, Equatable {
    case contentTooLarge = "content_too_large"
    case messageTooLarge = "message_too_large"
    case tooManyViews = "too_many_views"
    case invalidDimensions = "invalid_dimensions"
    case expired
  }

  static let limits = Limits()

  static func makeWebViewConfiguration() -> WKWebViewConfiguration {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = WKWebsiteDataStore.nonPersistent()
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    configuration.userContentController = WKUserContentController()
    return configuration
  }

  static func validateBridgeMessage(
    _ message: Any,
    expectedNonce: String,
    sourceOrigin: String
  ) -> BridgeDecision {
    guard sourceOrigin == opaqueIframeOrigin else {
      return .deny("invalid_origin")
    }
    guard
      let body = message as? [String: Any],
      let id = body["id"] as? String,
      !id.isEmpty,
      let method = body["method"] as? String,
      method == "probe.ping",
      let nonce = body["nonce"] as? String
    else {
      return .deny("malformed_message")
    }
    guard nonce == expectedNonce else {
      return .deny("invalid_nonce")
    }
    guard let data = try? JSONSerialization.data(withJSONObject: body),
      data.count <= limits.maxMessageBytes
    else {
      return .deny("message_too_large")
    }
    return .allow
  }

  static func trustedShell(iframeHTML: String, bootNonce: String) -> String {
    let content = Data(iframeHTML.utf8).base64EncodedString()
    let nonce = jsonString(bootNonce)
    return """
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="\(contentSecurityPolicy)">
      </head>
      <body>
        <iframe id="app" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
        <script nonce="rhythm-probe-shell">
          (() => {
            'use strict';
            const frame = document.getElementById('app');
            const expectedNonce = \(nonce);
            const encodedContent = '\(content)';
            frame.srcdoc = atob(encodedContent);
            window.addEventListener('message', (event) => {
              let denial = null;
              if (event.source !== frame.contentWindow) denial = 'invalid_frame';
              else if (event.origin !== 'null') denial = 'invalid_origin';
              else if (!event.data || typeof event.data !== 'object') denial = 'malformed_message';
              else if (event.data.nonce !== expectedNonce) denial = 'invalid_nonce';
              const payload = denial
                ? { kind: 'denied', reason: denial }
                : { kind: 'message', origin: event.origin, payload: event.data };
              window.webkit.messageHandlers.rhythmProbe.postMessage(payload);
            });
          })();
        </script>
      </body>
    </html>
    """
  }

  static func allowsNetworkRequest(to _: URL) -> Bool {
    false
  }

  static func allowsNavigation(to _: URL) -> Bool {
    false
  }

  static func limitViolation(
    contentBytes: Int,
    messageBytes: Int,
    activeViews: Int,
    width: Int,
    height: Int,
    ageSeconds: Int
  ) -> LimitViolation? {
    if contentBytes < 0 || contentBytes > limits.maxContentBytes { return .contentTooLarge }
    if messageBytes < 0 || messageBytes > limits.maxMessageBytes { return .messageTooLarge }
    if activeViews < 1 || activeViews > limits.maxViews { return .tooManyViews }
    if width < 1 || height < 1 || width > limits.maxWidth || height > limits.maxHeight {
      return .invalidDimensions
    }
    if ageSeconds < 0 || ageSeconds > limits.maxLifetimeSeconds { return .expired }
    return nil
  }

  private static func jsonString(_ value: String) -> String {
    guard
      let data = try? JSONSerialization.data(withJSONObject: [value]),
      let encoded = String(data: data, encoding: .utf8)
    else {
      return "\"\""
    }
    return String(encoded.dropFirst().dropLast())
  }
}
