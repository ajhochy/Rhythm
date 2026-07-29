import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/services.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// #1175 — human-only approval credential and non-exportable decision signer.
///
/// The random capability is stored in the signed app's Keychain container.
/// The native channel owns the P-256 private key and exposes only the public
/// point plus signatures. The local API child receives the capability digest
/// and public point, never either raw capability/private key.
class HumanApprovalSigner {
  HumanApprovalSigner({FlutterSecureStorage? secureStorage})
    : _secureStorage =
          secureStorage ??
          const FlutterSecureStorage(
            mOptions: MacOsOptions(
              accessibility: KeychainAccessibility.first_unlock_this_device,
            ),
          );

  static const _channel = MethodChannel('com.vcrc.rhythm/human-approval');
  static const _capabilityStorageKey = 'human_approval_capability_v1';

  final FlutterSecureStorage _secureStorage;

  Future<String> humanApprovalCapability() async {
    final existing = await _secureStorage.read(key: _capabilityStorageKey);
    if (existing != null && existing.isNotEmpty) return existing;

    final random = Random.secure();
    final bytes = List<int>.generate(32, (_) => random.nextInt(256));
    final created = base64UrlEncode(bytes);
    await _secureStorage.write(key: _capabilityStorageKey, value: created);
    return created;
  }

  Future<String> capabilitySha256() async {
    final capability = await humanApprovalCapability();
    return sha256.convert(utf8.encode(capability)).toString();
  }

  Future<String> publicKey() async {
    final value = await _channel.invokeMethod<String>('getPublicKey');
    if (value == null || value.isEmpty) {
      throw StateError('Human approval public key is unavailable');
    }
    return value;
  }

  Future<String> signDecision({
    required String approvalId,
    required String decisionNonce,
    required String? payloadDigest,
    required String decisionStatus,
  }) async {
    if (decisionStatus != 'approved' && decisionStatus != 'rejected') {
      throw ArgumentError.value(decisionStatus, 'decisionStatus');
    }
    final message = <String>[
      'rhythm-human-approval-v1',
      approvalId,
      decisionStatus,
      decisionNonce,
      payloadDigest ?? '',
    ].join('\n');
    final signature = await _channel.invokeMethod<String>(
      'signDecision',
      <String, Object>{'message': message},
    );
    if (signature == null || signature.isEmpty) {
      throw StateError('Human approval signature is unavailable');
    }
    return signature;
  }
}
