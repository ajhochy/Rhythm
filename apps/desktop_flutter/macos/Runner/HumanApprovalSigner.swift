import FlutterMacOS
import Foundation
import Security

/// #1175 — app-bound signer for human approval decisions.
///
/// The private P-256 key is generated in the Secure Enclave when available
/// and otherwise remains a Keychain key protected by this signed app's
/// keychain-access-groups entitlement. Only the public point is returned to
/// Dart/the child API; private key bytes are never exported.
final class HumanApprovalSigner: NSObject {
  private static let channelName = "com.vcrc.rhythm/human-approval"
  private static let keyTag =
    "com.vcrc.rhythm.human-approval.signing.v1".data(using: .utf8)!

  static func register(with controller: FlutterViewController) {
    let channel = FlutterMethodChannel(
      name: channelName,
      binaryMessenger: controller.engine.binaryMessenger
    )
    let signer = HumanApprovalSigner()
    channel.setMethodCallHandler { call, result in
      signer.handle(call, result: result)
    }
  }

  private func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    do {
      switch call.method {
      case "getPublicKey":
        result(try publicKeyBase64())
      case "signDecision":
        guard
          let arguments = call.arguments as? [String: Any],
          let message = arguments["message"] as? String
        else {
          throw SignerError.invalidArguments
        }
        result(try signatureBase64(message: message))
      default:
        result(FlutterMethodNotImplemented)
      }
    } catch {
      result(
        FlutterError(
          code: "HUMAN_APPROVAL_SIGNING_FAILED",
          message: String(describing: error),
          details: nil
        )
      )
    }
  }

  private func existingKey() -> SecKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrApplicationTag as String: Self.keyTag,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecReturnRef as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecUseDataProtectionKeychain as String: true,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else { return nil }
    return (item as! SecKey)
  }

  private func createKey(secureEnclave: Bool) throws -> SecKey {
    var accessError: Unmanaged<CFError>?
    guard
      let access = SecAccessControlCreateWithFlags(
        nil,
        kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        [.privateKeyUsage],
        &accessError
      )
    else {
      throw accessError?.takeRetainedValue() ?? SignerError.keyCreationFailed
    }

    let secretAttributes: [String: Any] = [
      kSecAttrIsPermanent as String: true,
      kSecAttrApplicationTag as String: Self.keyTag,
      kSecAttrAccessControl as String: access,
    ]
    var attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: secretAttributes,
      kSecUseDataProtectionKeychain as String: true,
    ]
    if secureEnclave {
      attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
    }

    var error: Unmanaged<CFError>?
    guard
      let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error)
    else {
      throw error?.takeRetainedValue() ?? SignerError.keyCreationFailed
    }
    return key
  }

  private func key() throws -> SecKey {
    if let current = existingKey() { return current }
    do {
      return try createKey(secureEnclave: true)
    } catch {
      // Intel Macs and some development signing environments have no Secure
      // Enclave token. The Data Protection Keychain fallback still restricts
      // key use to the signed app/access group and never returns key material.
      return try createKey(secureEnclave: false)
    }
  }

  private func signatureBase64(message: String) throws -> String {
    let algorithm = SecKeyAlgorithm.ecdsaSignatureMessageX962SHA256
    let key = try key()
    guard SecKeyIsAlgorithmSupported(key, .sign, algorithm) else {
      throw SignerError.algorithmUnavailable
    }
    var error: Unmanaged<CFError>?
    guard
      let value = SecKeyCreateSignature(
        key,
        algorithm,
        Data(message.utf8) as CFData,
        &error
      ) as Data?
    else {
      throw error?.takeRetainedValue() ?? SignerError.signatureFailed
    }
    return value.base64EncodedString()
  }

  private enum SignerError: Error {
    case invalidArguments
    case keyCreationFailed
    case publicKeyUnavailable
    case invalidPublicKey
    case algorithmUnavailable
    case signatureFailed
  }

  private func publicKeyBase64() throws -> String {
    guard let verificationKey = SecKeyCopyPublicKey(try key()) else {
      throw SignerError.publicKeyUnavailable
    }
    var error: Unmanaged<CFError>?
    guard
      let bytes = SecKeyCopyExternalRepresentation(verificationKey, &error)
        as Data?
    else {
      throw error?.takeRetainedValue() ?? SignerError.publicKeyUnavailable
    }
    guard bytes.count == 65, bytes.first == 0x04 else {
      throw SignerError.invalidPublicKey
    }
    return bytes.base64EncodedString()
  }
}
