import Foundation
import WebKit

private func require(_ condition: @autoclosure () -> Bool, _ message: String) {
  guard condition() else { FileHandle.standardError.write(Data((message + "\n").utf8)); exit(1) }
}

@main enum McpAppHostContractDriver {
  static func main() {
    let test = CommandLine.arguments.dropFirst().first ?? ""
    switch test {
    case "bridge-ownership":
      let shell = McpAppHostPolicy.trustedShell(appHTML: "<script>0</script>", bootNonce: "boot")
      require(McpAppHostPolicy.dartChannelName == "rhythmMcpAppHost", "trusted shell channel missing")
      require(shell.contains("window.webkit.messageHandlers.rhythmMcpAppHost.postMessage"), "outer shell must own channel")
      require(!shell.contains("allow-same-origin"), "iframe must not share origin")
      require(!shell.contains("window.parent.webkit"), "app HTML reached native bridge")
    case "nonce-origin-sandbox":
      require(McpAppHostPolicy.Mode.parse(nil) == .off, "missing mode must be off")
      require(McpAppHostPolicy.Mode.parse("READONLY") == .off, "invalid mode must be off")
      require(McpAppHostPolicy.Mode.parse("readonly") == .readonly, "readonly mode rejected")
      require(McpAppHostPolicy.validate(message: ["id":"1","method":"host.ping","nonce":"boot"], expectedNonce:"boot", sourceOrigin:"null") == .allow, "valid message denied")
      require(McpAppHostPolicy.validate(message: ["id":"1","method":"host.ping","nonce":"stale"], expectedNonce:"boot", sourceOrigin:"null") == .deny("invalid_nonce"), "stale nonce allowed")
      require(McpAppHostPolicy.validate(message: ["id":"1","method":"host.ping","nonce":"boot"], expectedNonce:"boot", sourceOrigin:"https://evil.invalid") == .deny("invalid_origin"), "foreign origin allowed")
      require(McpAppHostPolicy.trustedShell(appHTML:"", bootNonce:"boot").contains("sandbox=\"allow-scripts\""), "sandbox missing")
    case "ephemeral-storage":
      let a = McpAppHostPolicy.makeConfiguration(); let b = McpAppHostPolicy.makeConfiguration()
      require(!a.websiteDataStore.isPersistent && !b.websiteDataStore.isPersistent, "persistent store")
      require(a !== b, "configuration reused")
    case "csp-network-navigation":
      require(McpAppHostPolicy.contentSecurityPolicy.contains("default-src 'none'"), "default CSP")
      require(McpAppHostPolicy.contentSecurityPolicy.contains("connect-src 'none'"), "network CSP")
      for raw in ["http://127.0.0.1:4001/private", "http://10.0.0.1/", "file:///etc/passwd", "https://evil.invalid/"] {
        let url = URL(string: raw)!
        require(!McpAppHostPolicy.allowsNetworkRequest(to:url), "network allowed")
        require(!McpAppHostPolicy.allowsNavigation(to:url), "navigation allowed")
      }
      require(!McpAppHostPolicy.allowsDownloads, "downloads allowed")
    default: exit(2)
    }
  }
}
