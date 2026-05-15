import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persists an optional remote opencode server URL.
///
/// When [url] is null the app uses the embedded local agent server at
/// AppConstants.agentLocalBaseUrl. Set a non-null URL to point
/// OpencodeClientService at a remote opencode instance instead.
class OpencodeServerService extends ChangeNotifier {
  static const _key = 'opencode_server_url';

  String? _url;

  /// Null means "use embedded server". Non-null overrides with a remote URL.
  String? get url => _url;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _url = prefs.getString(_key);
    notifyListeners();
  }

  Future<void> setUrl(String? value) async {
    final trimmed = (value ?? '').trim().isEmpty ? null : value!.trim();
    if (_url == trimmed) return;
    _url = trimmed;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    if (_url == null) {
      await prefs.remove(_key);
    } else {
      await prefs.setString(_key, _url!);
    }
  }

  Future<void> resetToEmbedded() => setUrl(null);
}
