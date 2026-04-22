import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ServerConfigService extends ChangeNotifier {
  static const _key = 'server_url';
  static const _cloudUrl = 'https://api.vcrcapps.com';
  static const _legacyLocalUrl = 'http://localhost:4000';
  static const _definedDefaultUrl = String.fromEnvironment(
    'RHYTHM_SERVER_URL',
    defaultValue: _cloudUrl,
  );

  static String get defaultUrl => _definedDefaultUrl;

  String _url = defaultUrl;
  String get url => _url;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final savedUrl = prefs.getString(_key);
    final shouldMigrateLegacyLocalhost =
        savedUrl == _legacyLocalUrl && defaultUrl != _legacyLocalUrl;
    if (savedUrl == null || shouldMigrateLegacyLocalhost) {
      _url = defaultUrl;
      await prefs.setString(_key, _url);
    } else {
      _url = savedUrl;
    }
    notifyListeners();
  }

  Future<void> save(String url) async {
    final prefs = await SharedPreferences.getInstance();
    final cleaned = url.trimRight().replaceAll(RegExp(r'/$'), '');
    await prefs.setString(_key, cleaned);
    _url = cleaned;
    notifyListeners();
  }
}
