import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Persists whether destructive agent tool calls (bash, write, edit) should
/// elevate to a full modal confirmation rather than an inline card prompt.
class DestructiveModalService extends ChangeNotifier {
  static const _key = 'agent_destructive_modal_enabled';

  bool _enabled = false;

  bool get enabled => _enabled;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _enabled = prefs.getBool(_key) ?? false;
    notifyListeners();
  }

  Future<void> setEnabled(bool value) async {
    if (_enabled == value) return;
    _enabled = value;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_key, value);
  }
}
