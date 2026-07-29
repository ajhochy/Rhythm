import 'dart:convert';
import 'package:http/http.dart' as http;
import '../../../app/core/constants/app_constants.dart';

class AnthropicAccount {
  const AnthropicAccount({
    required this.id,
    required this.label,
    required this.status,
    this.subscriptionType,
    required this.expires,
  });

  final String id;
  final String label;
  final String status; // 'ok' | 'needs_relogin'
  final String? subscriptionType;
  final int expires;

  factory AnthropicAccount.fromJson(Map<String, dynamic> json) =>
      AnthropicAccount(
        id: json['id'] as String,
        label: json['label'] as String? ?? json['id'] as String,
        status: json['status'] as String? ?? 'ok',
        subscriptionType: json['subscriptionType'] as String?,
        expires: (json['expires'] as num?)?.toInt() ?? 0,
      );
}

class AnthropicAccountsDataSource {
  AnthropicAccountsDataSource({http.Client? client})
    : _client = client ?? http.Client();

  final http.Client _client;
  final String _base =
      '${AppConstants.agentLocalBaseUrl}/opencode/auth/accounts';

  Future<({List<AnthropicAccount> accounts, String? defaultAccountId})>
  list() async {
    final res = await _client.get(Uri.parse(_base));
    if (res.statusCode != 200) {
      throw Exception('accounts list failed: HTTP ${res.statusCode}');
    }
    final data = jsonDecode(res.body) as Map<String, dynamic>;
    return (
      accounts: ((data['accounts'] as List<dynamic>?) ?? [])
          .map((e) => AnthropicAccount.fromJson(e as Map<String, dynamic>))
          .toList(),
      defaultAccountId: data['defaultAccountId'] as String?,
    );
  }

  Future<String> loginStart(String accountId, String label) async {
    final res = await _client.post(
      Uri.parse('$_base/login-start'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'accountId': accountId, 'label': label}),
    );
    if (res.statusCode != 200) {
      throw Exception('login start failed: HTTP ${res.statusCode}');
    }
    return (jsonDecode(res.body) as Map<String, dynamic>)['authorizeUrl']
        as String;
  }

  Future<void> loginComplete(String accountId, String code) async {
    final res = await _client.post(
      Uri.parse('$_base/login-complete'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'accountId': accountId, 'code': code}),
    );
    if (res.statusCode != 200) {
      String reason = 'HTTP ${res.statusCode}';
      try {
        reason =
            (jsonDecode(res.body) as Map<String, dynamic>)['reason']
                as String? ??
            reason;
      } catch (_) {}
      throw Exception(reason);
    }
  }

  Future<void> setDefault(String accountId) async {
    final res = await _client.patch(
      Uri.parse('$_base/default'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({'accountId': accountId}),
    );
    if (res.statusCode != 200) {
      throw Exception('set default failed: HTTP ${res.statusCode}');
    }
  }

  Future<void> remove(String accountId) async {
    final res = await _client.delete(Uri.parse('$_base/$accountId'));
    if (res.statusCode != 200) {
      throw Exception('remove failed: HTTP ${res.statusCode}');
    }
  }
}

/// App-run-scoped id → label cache so sync UI (session header badge,
/// spillover toast) can resolve account labels without a per-render fetch.
/// Falls back to the raw id until [ensureLoaded] completes.
class AnthropicAccountsLabelCache {
  static final Map<String, String> _labels = {};
  static List<AnthropicAccount> _accounts = const [];
  static Future<void>? _loading;

  /// Fetch labels once per app run (best-effort; failures leave the cache
  /// empty so [labelFor] falls back to raw ids).
  static Future<void> ensureLoaded() {
    return _loading ??= () async {
      try {
        final result = await AnthropicAccountsDataSource().list();
        _accounts = result.accounts;
        for (final a in result.accounts) {
          _labels[a.id] = a.label;
        }
      } catch (_) {
        _loading = null; // allow a retry on the next call
      }
    }();
  }

  static String labelFor(String id) => _labels[id] ?? id;

  /// Connected accounts (empty until [ensureLoaded] completes). Backs the
  /// session-header account switcher menu.
  static List<AnthropicAccount> get accounts => _accounts;
}
