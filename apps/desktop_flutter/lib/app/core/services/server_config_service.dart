import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

class ServerConfigService extends ChangeNotifier {
  static const _key = 'server_url';
  static const _definedDefaultUrl = String.fromEnvironment(
    'RHYTHM_SERVER_URL',
    defaultValue: 'http://localhost:4000',
  );

  static String get defaultUrl => _definedDefaultUrl;

  String _url = defaultUrl;
  String get url => _url;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _url = prefs.getString(_key) ?? defaultUrl;
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
