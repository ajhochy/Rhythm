import Foundation
import WebKit

/// Standalone policy fixture. Compile this file with `McpAppHostPolicy.swift`
/// in both debug and release modes; it is deliberately not linked into Runner.
@main enum McpAppHostFixtureLauncher {
  static func main() {
    let environment = ProcessInfo.processInfo.environment
    guard let fixture = environment["RHYTHM_MCP_APP_HOST_FIXTURE"],
      fixture == "valid" || fixture == "malicious"
    else {
      FileHandle.standardError.write(
        Data("Fixture disabled; set RHYTHM_MCP_APP_HOST_FIXTURE=valid|malicious.\n".utf8)
      )
      exit(64)
    }
    guard McpAppHostPolicy.Mode.parse(environment["RHYTHM_MCP_APPS_MODE"]) != .off else {
      FileHandle.standardError.write(Data("MCP Apps mode is off; fixture denied.\n".utf8))
      exit(65)
    }

    let nonce = "fixture-boot-nonce"
    let message: [String: Any]
    let origin: String
    if fixture == "valid" {
      message = ["id": "fixture", "method": "host.ping", "nonce": nonce]
      origin = "null"
    } else {
      message = ["id": "fixture", "method": "host.unknown", "nonce": "replayed"]
      origin = "https://evil.invalid"
    }
    let decision = McpAppHostPolicy.validate(
      message: message,
      expectedNonce: nonce,
      sourceOrigin: origin
    )
    switch (fixture, decision) {
    case ("valid", .allow):
      print("MCP_APP_HOST_FIXTURE valid accepted nonce=<redacted>")
    case ("malicious", .deny(let reason)):
      print("MCP_APP_HOST_FIXTURE malicious denied reason=\(reason) nonce=<redacted>")
    default:
      FileHandle.standardError.write(Data("Unexpected fixture decision.\n".utf8))
      exit(1)
    }
  }
}
