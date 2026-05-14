import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../app/core/constants/app_constants.dart';

/// M5-5: opencode server URL (workspace / remote switching).
///
/// Null means "use the embedded server at agentLocalBaseUrl". Setting a
/// non-null URL points the OpencodeClientService at a remote opencode
/// instance instead; switching back to null restarts the embedded one.
class OpencodeServerService extends ChangeNotifier {
  static const _key = 'opencode_server_url';

  String? _customUrl;
  String? get customUrl => _customUrl;

  String get effectiveUrl => _customUrl ?? AppConstants.agentLocalBaseUrl;

  bool get isRemote => _customUrl != null;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _customUrl = prefs.getString(_key);
    notifyListeners();
  }

  Future<void> setCustomUrl(String? url) async {
    if (url == _customUrl) return;
    _customUrl = url;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    if (url == null) {
      await prefs.remove(_key);
    } else {
      await prefs.setString(_key, url);
    }
  }
}
