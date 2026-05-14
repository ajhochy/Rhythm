import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// M5-4: persisted custom keybindings.
///
/// Stored as a JSON map { action -> keystroke } under a single
/// shared_preferences key. Consumers read `binding(action)` and apply
/// the binding via Shortcuts/Actions at the widget tree root.
class KeybindsService extends ChangeNotifier {
  static const _key = 'agent_keybinds';
  static const _defaults = <String, String>{
    'send': 'Enter',
    'newSession': 'Cmd+N',
    'cancelTurn': 'Esc',
    'switchSession': 'Cmd+K',
  };

  Map<String, String> _bindings = Map.of(_defaults);
  Map<String, String> get bindings => Map.unmodifiable(_bindings);

  String binding(String action) => _bindings[action] ?? _defaults[action] ?? '';

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw != null) {
      try {
        final map = (jsonDecode(raw) as Map<String, dynamic>)
            .map((k, v) => MapEntry(k, v.toString()));
        _bindings = {..._defaults, ...map};
      } catch (_) {
        _bindings = Map.of(_defaults);
      }
    }
    notifyListeners();
  }

  Future<void> setBinding(String action, String keystroke) async {
    _bindings = {..._bindings, action: keystroke};
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(_bindings));
  }

  Future<void> reset() async {
    _bindings = Map.of(_defaults);
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}
