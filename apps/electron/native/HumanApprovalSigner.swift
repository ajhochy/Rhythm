import Foundation
import Security
import CryptoKit
import Darwin

// Versioned separately from the legacy generic-password key; never import/delete that entry.
let applicationTag = Data("com.rhythm.desktop.human-approval.secure-enclave.v2".utf8)
enum Failure: Error, Equatable { case invalidRequest, unavailable, keychain }

// A directly launched helper must not become a shell-accessible bypass of main's E12A authorization.
// Only the signed Rhythm main process, from this helper's signing team, may use the protocol.
func authorizeParent() throws {
    var ownCode: SecCode?
    var staticCode: SecStaticCode?
    var info: CFDictionary?
    guard SecCodeCopySelf([], &ownCode) == errSecSuccess, let ownCode = ownCode,
          SecCodeCopyStaticCode(ownCode, [], &staticCode) == errSecSuccess, let staticCode = staticCode,
          SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &info) == errSecSuccess,
          let details = info as? [String: Any], let team = details[kSecCodeInfoTeamIdentifier as String] as? String,
          matches(team, "\\A[A-Z0-9]{10}\\z") else { throw Failure.unavailable }
    var requirement: SecRequirement?
    let rule = "anchor apple generic and identifier \"com.rhythm.desktop\" and certificate leaf[subject.OU] = \"\(team)\""
    guard SecRequirementCreateWithString(rule as CFString, [], &requirement) == errSecSuccess,
          let requirement = requirement else { throw Failure.unavailable }
    var parent: SecCode?
    let pid = getppid()
    let attributes = [kSecGuestAttributePid as String: pid] as CFDictionary
    guard pid > 1,
          SecCodeCopyGuestWithAttributes(nil, attributes, [], &parent) == errSecSuccess,
          let parent = parent,
          SecCodeCheckValidity(parent, [], requirement) == errSecSuccess,
          getppid() == pid else { throw Failure.unavailable }
}

func matches(_ value: Any?, _ pattern: String) -> Bool {
    guard let text = value as? String else { return false }
    return text.range(of: pattern, options: .regularExpression) != nil
}

// Account database, not HOME/env: all helper processes use the same nonsecret inode.
// Never unlink the lock file: replacing it would allow simultaneous locks on different inodes.
func acquireKeyCreationLock() throws -> Int32 {
    guard let account = getpwuid(getuid()), let home = account.pointee.pw_dir else { throw Failure.unavailable }
    let directory = URL(fileURLWithPath: String(cString: home))
        .appendingPathComponent("Library/Application Support/com.rhythm.desktop.approval-signer", isDirectory: true)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700])
    let dir = open(directory.path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
    guard dir >= 0 else { throw Failure.unavailable }
    defer { close(dir) }
    var directoryInfo = stat()
    guard fstat(dir, &directoryInfo) == 0, directoryInfo.st_uid == getuid(),
          directoryInfo.st_mode & 0o077 == 0 else { throw Failure.unavailable }
    let fd = openat(dir, "key-creation.lock", O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
    guard fd >= 0 else { throw Failure.unavailable }
    var acquired = false
    defer { if !acquired { close(fd) } }
    var info = stat()
    guard fstat(fd, &info) == 0, info.st_uid == getuid(), info.st_nlink == 1,
          info.st_mode & S_IFMT == S_IFREG, info.st_mode & 0o777 == 0o600 else { throw Failure.unavailable }
    let deadline = DispatchTime.now().uptimeNanoseconds + 5_000_000_000
    while flock(fd, LOCK_EX | LOCK_NB) != 0 {
        guard (errno == EWOULDBLOCK || errno == EINTR),
              DispatchTime.now().uptimeNanoseconds < deadline else { throw Failure.unavailable }
        usleep(20_000)
    }
    acquired = true
    return fd
}

func signingKey() throws -> SecKey {
    let lock = try acquireKeyCreationLock()
    defer {
        flock(lock, LOCK_UN)
        close(lock)
    }
    let query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: applicationTag,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecReturnRef as String: true,
        kSecMatchLimit as String: kSecMatchLimitOne
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess, let item = item { return item as! SecKey }
    guard status == errSecItemNotFound else { throw Failure.unavailable }
    var error: Unmanaged<CFError>?
    guard let access = SecAccessControlCreateWithFlags(nil,
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly, .privateKeyUsage, &error) else { throw Failure.unavailable }
    let attributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecPrivateKeyAttrs as String: [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: applicationTag,
            kSecAttrAccessControl as String: access
        ]
    ]
    if let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) { return key }
    // Recover only through the same enclave query, still holding the cross-process lock.
    if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let item = item { return item as! SecKey }
    throw Failure.unavailable
}

func capability() throws -> String {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "rhythm-electron-human-approval-capability",
        kSecAttrAccount as String: "capability-v1"
    ]
    func read() throws -> String? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data,
              let value = String(data: data, encoding: .utf8),
              matches(value, "\\A[A-Za-z0-9_-]{43}\\z") else { throw Failure.keychain }
        return value
    }
    if let value = try read() { return value }
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw Failure.keychain }
    let value = Data(bytes).base64EncodedString().replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    var attributes = query
    attributes[kSecValueData as String] = Data(value.utf8)
    attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let status = SecItemAdd(attributes as CFDictionary, nil)
    if status == errSecDuplicateItem, let existing = try read() { return existing }
    guard status == errSecSuccess else { throw Failure.keychain }
    return value
}

func respond(_ request: [String: Any]) throws -> [String: Any] {
    guard let operation = request["operation"] as? String,
          ["capability", "public-key", "sign"].contains(operation),
          Set(request.keys) == Set(operation == "sign" ? ["operation", "decision"] : ["operation"]) else { throw Failure.invalidRequest }
    var digest: Data?
    if operation == "sign" {
        guard let decision = request["decision"] as? [String: Any],
              Set(decision.keys) == Set(["approvalId", "status", "decisionNonce", "payloadDigest"]),
              matches(decision["approvalId"], "\\A[A-Za-z0-9_-]{1,128}\\z"),
              matches(decision["status"], "\\A(approved|rejected)\\z"),
              matches(decision["decisionNonce"], "\\A[A-Za-z0-9_-]{1,256}\\z"),
              decision["payloadDigest"] is NSNull || matches(decision["payloadDigest"], "\\A[a-f0-9]{64}\\z") else { throw Failure.invalidRequest }
        let canonical = ["rhythm-human-approval-v1", decision["approvalId"] as! String,
                         decision["status"] as! String, decision["decisionNonce"] as! String,
                         decision["payloadDigest"] as? String ?? ""].joined(separator: "\n")
        digest = Data(SHA256.hash(data: Data(canonical.utf8)))
    }
    let key = try signingKey()
    let attributes = SecKeyCopyAttributes(key) as? [String: Any]
    guard attributes?[kSecAttrTokenID as String] as? String == kSecAttrTokenIDSecureEnclave as String,
          attributes?[kSecAttrKeySizeInBits as String] as? Int == 256,
          SecKeyIsAlgorithmSupported(key, .sign, .ecdsaSignatureDigestX962SHA256),
          let publicKey = SecKeyCopyPublicKey(key) else { throw Failure.unavailable }
    var error: Unmanaged<CFError>?
    guard let raw = SecKeyCopyExternalRepresentation(publicKey, &error) as Data?,
          raw.count == 65, raw.first == 4 else { throw Failure.unavailable }
    var result: [String: Any] = ["available": true, "publicKey": raw.base64EncodedString()]
    if operation != "public-key" { result["capability"] = try capability() }
    if let digest = digest {
        guard let signature = SecKeyCreateSignature(key, .ecdsaSignatureDigestX962SHA256,
            digest as CFData, &error) as Data? else { throw Failure.unavailable }
        result["signature"] = signature.base64EncodedString()
    }
    return result
}

// One request, EOF-framed and bounded. No arguments, environment inputs or secret files/diagnostics.
do {
    try authorizeParent()
    var data = Data()
    while data.count <= 4096 {
        let chunk = try FileHandle.standardInput.read(upToCount: 4097 - data.count) ?? Data()
        if chunk.isEmpty { break }
        data.append(chunk)
    }
    guard data.count <= 4096,
          let request = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw Failure.invalidRequest }
    let result = try respond(request)
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result))
} catch {
    // Fixed public codes only. Security.framework errors can contain sensitive account context.
    let code = (error as? Failure) == .invalidRequest ? "INVALID_REQUEST" : "SECURE_ENCLAVE_UNAVAILABLE"
    FileHandle.standardOutput.write(Data("{\"available\":false,\"code\":\"\(code)\"}".utf8))
}
