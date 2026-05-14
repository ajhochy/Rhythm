import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// M5-1: "Require modal for destructive tools" toggle.
///
/// Read by `PermissionCard` (M3-6) to decide whether destructive tool
/// prompts (bash/write/edit) elevate to a modal instead of an inline card.
/// Defaults to `false` — inline cards for everything.
class DestructiveModalService extends ChangeNotifier {
  static const _key = 'agent_destructive_modal';

  bool _enabled = false;
  bool get enabled => _enabled;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _enabled = prefs.getBool(_key) ?? false;
    notifyListeners();
  }

  Future<void> setEnabled(bool v) async {
    if (v == _enabled) return;
    _enabled = v;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_key, v);
  }
}
