import Foundation
import WebKit

/// Fail-closed native policy shared by every production MCP App view.
enum McpAppHostPolicy {
  static let dartChannelName = "rhythmMcpAppHost"
  static let opaqueIframeOrigin = "null"
  static let allowsDownloads = false

  static let maxContentBytes = 1_048_576
  static let maxMessageBytes = 65_536
  static let maxViews = 4
  static let maxWidth = 2_560
  static let maxHeight = 1_600
  static let maxLifetimeSeconds = 300

  static let contentSecurityPolicy = [
    "default-src 'none'",
    "script-src 'nonce-rhythm-mcp-app-shell'",
    "style-src 'none'",
    "img-src 'none'",
    "connect-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src blob:",
    "form-action 'none'",
    "base-uri 'none'",
  ].joined(separator: "; ")

  private static let appContentSecurityPolicy = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "connect-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].joined(separator: "; ")

  enum Mode: String {
    case off
    case readonly
    case interactive

    static func parse(_ raw: String?) -> Mode {
      guard let raw, let value = Mode(rawValue: raw) else { return .off }
      return value
    }
  }

  enum Decision: Equatable {
    case allow
    case deny(String)
  }

  static func makeConfiguration() -> WKWebViewConfiguration {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = WKWebsiteDataStore.nonPersistent()
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    configuration.userContentController = WKUserContentController()
    return configuration
  }

  static func validate(
    message: Any,
    expectedNonce: String,
    sourceOrigin: String
  ) -> Decision {
    guard sourceOrigin == opaqueIframeOrigin else {
      return .deny("invalid_origin")
    }
    guard
      let body = message as? [String: Any],
      JSONSerialization.isValidJSONObject(body),
      let data = try? JSONSerialization.data(withJSONObject: body),
      data.count <= maxMessageBytes
    else {
      return .deny("message_too_large")
    }
    guard
      let id = body["id"] as? String,
      !id.isEmpty,
      id.lengthOfBytes(using: .utf8) <= 256,
      let method = body["method"] as? String,
      !method.isEmpty,
      let nonce = body["nonce"] as? String
    else {
      return .deny("malformed_message")
    }
    guard nonce == expectedNonce else {
      return .deny("invalid_nonce")
    }
    guard method == "host.ping" else {
      return .deny("unsupported_method")
    }
    return .allow
  }

  static func trustedShell(appHTML: String, bootNonce: String) -> String {
    let appHTMLBase64 = Data(appHTML.utf8).base64EncodedString()
    let nonceBase64 = Data(bootNonce.utf8).base64EncodedString()
    let appCSPBase64 = Data(appContentSecurityPolicy.utf8).base64EncodedString()
    return """
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="\(contentSecurityPolicy)">
      </head>
      <body>
        <iframe id="app" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
        <script nonce="rhythm-mcp-app-shell">
          (() => {
            'use strict';
            const frame = document.getElementById('app');
            const decode = (value) => new TextDecoder().decode(
              Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
            );
            const bootNonce = decode('\(nonceBase64)');
            const appCSP = decode('\(appCSPBase64)');
            const appHTML = decode('\(appHTMLBase64)');
            const nonceForApp = btoa(unescape(encodeURIComponent(bootNonce)));
            const bootstrap = `<script>Object.defineProperty(window, 'rhythmMcpApp', { value: Object.freeze({ bootNonce: decodeURIComponent(escape(atob('${nonceForApp}'))) }), writable: false, configurable: false });<\\/script>`;
            const appDocument = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${appCSP}">${bootstrap}${appHTML}`;
            const appURL = URL.createObjectURL(new Blob([appDocument], { type: 'text/html' }));
            frame.addEventListener('load', () => URL.revokeObjectURL(appURL), { once: true });
            frame.src = appURL;
            window.addEventListener('message', (event) => {
              let denial = null;
              if (event.source !== frame.contentWindow) denial = 'invalid_frame';
              else if (event.origin !== 'null') denial = 'invalid_origin';
              else if (!event.data || typeof event.data !== 'object') denial = 'malformed_message';
              else if (event.data.nonce !== bootNonce) denial = 'invalid_nonce';
              let encoded = '';
              try { encoded = JSON.stringify(event.data); }
              catch (_) { denial = 'malformed_message'; }
              if (new TextEncoder().encode(encoded).byteLength > \(maxMessageBytes)) {
                denial = 'message_too_large';
              }
              const envelope = denial
                ? { kind: 'denied', reason: denial }
                : { kind: 'message', origin: event.origin, payload: event.data };
              window.webkit.messageHandlers.\(dartChannelName).postMessage(envelope);
            });
          })();
        </script>
      </body>
    </html>
    """
  }

  static func allowsNetworkRequest(to _: URL) -> Bool { false }

  static func allowsNavigation(to _: URL) -> Bool { false }
}
