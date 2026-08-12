import Foundation
import WebKit

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
  guard condition() else {
    FileHandle.standardError.write(Data(("CONTRACT FAILURE: \(message)\n").utf8))
    exit(1)
  }
}

@main
enum McpAppIsolationProbeContractDriver {
  static func main() {
    guard CommandLine.arguments.count == 2 else {
      FileHandle.standardError.write(Data("expected one contract case\n".utf8))
      exit(2)
    }

    switch CommandLine.arguments[1] {
    case "bridge-isolation":
      // Regression caught: adding allow-same-origin (or exposing the Dart
      // channel in the iframe) lets hostile app HTML reach the outer bridge.
      let shell = McpAppIsolationProbePolicy.trustedShell(
        iframeHTML: "<script>window.parent.webkit.messageHandlers.rhythm.postMessage('owned')</script>",
        bootNonce: "boot-contract-nonce"
      )
      require(shell.contains("sandbox=\"allow-scripts\""), "iframe must be script-only sandboxed")
      require(!shell.contains("allow-same-origin"), "iframe must retain an opaque origin")
      require(!shell.contains("allow-top-navigation"), "iframe cannot navigate its parent")
      require(!McpAppIsolationProbePolicy.iframeOwnsDartChannel, "only the outer shell may own the Dart channel")

    case "nonce-origin":
      // Regression caught: accepting a stale nonce, null/foreign origin, or
      // malformed payload turns postMessage into an ambient authority.
      let valid = McpAppIsolationProbePolicy.validateBridgeMessage(
        ["id": "request-1", "method": "probe.ping", "nonce": "boot-contract-nonce"],
        expectedNonce: "boot-contract-nonce",
        sourceOrigin: McpAppIsolationProbePolicy.opaqueIframeOrigin
      )
      require(valid == .allow, "well-formed message from the bound iframe must pass")
      require(
        McpAppIsolationProbePolicy.validateBridgeMessage(
          ["id": "request-2", "method": "probe.ping", "nonce": "stale"],
          expectedNonce: "boot-contract-nonce",
          sourceOrigin: McpAppIsolationProbePolicy.opaqueIframeOrigin
        ) == .deny("invalid_nonce"),
        "stale nonce must be rejected deterministically"
      )
      require(
        McpAppIsolationProbePolicy.validateBridgeMessage(
          ["id": "request-3", "method": "probe.ping", "nonce": "boot-contract-nonce"],
          expectedNonce: "boot-contract-nonce",
          sourceOrigin: "https://attacker.invalid"
        ) == .deny("invalid_origin"),
        "foreign origin must be rejected deterministically"
      )
      require(
        McpAppIsolationProbePolicy.validateBridgeMessage(
          ["method": "probe.ping", "nonce": "boot-contract-nonce"],
          expectedNonce: "boot-contract-nonce",
          sourceOrigin: McpAppIsolationProbePolicy.opaqueIframeOrigin
        ) == .deny("malformed_message"),
        "malformed payload must be rejected deterministically"
      )

    case "ephemeral-storage":
      // Regression caught: WKWebsiteDataStore.default() silently restores
      // cookies/localStorage across probe views and application restarts.
      let first = McpAppIsolationProbePolicy.makeWebViewConfiguration()
      let second = McpAppIsolationProbePolicy.makeWebViewConfiguration()
      require(!first.websiteDataStore.isPersistent, "probe must use a non-persistent data store")
      require(!second.websiteDataStore.isPersistent, "every view must use a non-persistent data store")
      require(first !== second, "each probe view needs a distinct WKWebViewConfiguration")

    case "csp-network-navigation":
      // Regression caught: a permissive CSP or navigation delegate lets app
      // HTML fetch localhost/private data, open downloads, or leave the shell.
      let csp = McpAppIsolationProbePolicy.contentSecurityPolicy
      require(csp.contains("default-src 'none'"), "CSP must deny by default")
      require(csp.contains("connect-src 'none'"), "CSP must deny all network connections")
      require(csp.contains("form-action 'none'"), "CSP must deny form navigation")
      require(csp.contains("object-src 'none'"), "CSP must deny plugins/objects")
      let denied = [
        "https://example.com/app.js",
        "http://127.0.0.1:4001/private",
        "http://10.0.0.2/internal",
        "file:///etc/passwd",
      ]
      for rawURL in denied {
        let url = URL(string: rawURL)!
        require(!McpAppIsolationProbePolicy.allowsNetworkRequest(to: url), "network request escaped deny policy: \(rawURL)")
        require(!McpAppIsolationProbePolicy.allowsNavigation(to: url), "navigation escaped deny policy: \(rawURL)")
      }
      require(!McpAppIsolationProbePolicy.allowsDownloads, "downloads must be denied")

    case "bounds-lifecycle":
      // Regression caught: unbounded content, messages, view counts, geometry,
      // or lifetime survives long enough to exhaust the desktop process.
      let limits = McpAppIsolationProbePolicy.limits
      require(limits.maxContentBytes > 0 && limits.maxContentBytes <= 1_048_576, "content bound must be finite and at most 1 MiB")
      require(limits.maxMessageBytes > 0 && limits.maxMessageBytes <= 65_536, "message bound must be finite and at most 64 KiB")
      require(limits.maxViews > 0 && limits.maxViews <= 4, "view count must be finite and small")
      require(limits.maxWidth > 0 && limits.maxWidth <= 4_096, "width must be bounded")
      require(limits.maxHeight > 0 && limits.maxHeight <= 4_096, "height must be bounded")
      require(limits.maxLifetimeSeconds > 0 && limits.maxLifetimeSeconds <= 900, "lifetime must be bounded")
      require(
        McpAppIsolationProbePolicy.limitViolation(
          contentBytes: limits.maxContentBytes + 1,
          messageBytes: 1,
          activeViews: 1,
          width: 100,
          height: 100,
          ageSeconds: 1
        ) == .contentTooLarge,
        "oversized content must request teardown"
      )
      require(
        McpAppIsolationProbePolicy.limitViolation(
          contentBytes: 1,
          messageBytes: limits.maxMessageBytes + 1,
          activeViews: 1,
          width: 100,
          height: 100,
          ageSeconds: 1
        ) == .messageTooLarge,
        "oversized bridge messages must request teardown"
      )
      require(
        McpAppIsolationProbePolicy.limitViolation(
          contentBytes: 1,
          messageBytes: 1,
          activeViews: limits.maxViews + 1,
          width: 100,
          height: 100,
          ageSeconds: 1
        ) == .tooManyViews,
        "excess views must request teardown"
      )
      require(
        McpAppIsolationProbePolicy.limitViolation(
          contentBytes: 1,
          messageBytes: 1,
          activeViews: 1,
          width: limits.maxWidth + 1,
          height: 100,
          ageSeconds: 1
        ) == .invalidDimensions,
        "oversized geometry must request teardown"
      )
      require(
        McpAppIsolationProbePolicy.limitViolation(
          contentBytes: 1,
          messageBytes: 1,
          activeViews: 1,
          width: 100,
          height: 100,
          ageSeconds: limits.maxLifetimeSeconds + 1
        ) == .expired,
        "expired views must request teardown"
      )

    default:
      FileHandle.standardError.write(Data("unknown contract case\n".utf8))
      exit(2)
    }
  }
}
