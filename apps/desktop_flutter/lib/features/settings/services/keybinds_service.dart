import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Default keystroke strings for agent UI actions.
class KeybindDefaults {
  static const send = 'Enter';
  static const newSession = 'Cmd+N';
  static const cancelTurn = 'Esc';
  static const switchSession = 'Cmd+[';
}

/// Persists user-defined keystroke strings for the four agent UI actions.
///
/// Keystroke values are stored as plain strings (e.g. "Cmd+N", "Esc").
/// No validation is performed — the user is responsible for entering a
/// recognisable keystroke. Consumers should treat the value as an opaque
/// display label until a proper keystroke parser is wired.
class KeybindsService extends ChangeNotifier {
  static const _prefixSend = 'keybind_send';
  static const _prefixNewSession = 'keybind_new_session';
  static const _prefixCancelTurn = 'keybind_cancel_turn';
  static const _prefixSwitchSession = 'keybind_switch_session';

  String _send = KeybindDefaults.send;
  String _newSession = KeybindDefaults.newSession;
  String _cancelTurn = KeybindDefaults.cancelTurn;
  String _switchSession = KeybindDefaults.switchSession;

  String get send => _send;
  String get newSession => _newSession;
  String get cancelTurn => _cancelTurn;
  String get switchSession => _switchSession;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _send = prefs.getString(_prefixSend) ?? KeybindDefaults.send;
    _newSession =
        prefs.getString(_prefixNewSession) ?? KeybindDefaults.newSession;
    _cancelTurn =
        prefs.getString(_prefixCancelTurn) ?? KeybindDefaults.cancelTurn;
    _switchSession =
        prefs.getString(_prefixSwitchSession) ?? KeybindDefaults.switchSession;
    notifyListeners();
  }

  Future<void> setSend(String value) =>
      _set(_prefixSend, value, () => _send = value);
  Future<void> setNewSession(String value) =>
      _set(_prefixNewSession, value, () => _newSession = value);
  Future<void> setCancelTurn(String value) =>
      _set(_prefixCancelTurn, value, () => _cancelTurn = value);
  Future<void> setSwitchSession(String value) =>
      _set(_prefixSwitchSession, value, () => _switchSession = value);

  Future<void> resetToDefaults() async {
    _send = KeybindDefaults.send;
    _newSession = KeybindDefaults.newSession;
    _cancelTurn = KeybindDefaults.cancelTurn;
    _switchSession = KeybindDefaults.switchSession;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await Future.wait([
      prefs.remove(_prefixSend),
      prefs.remove(_prefixNewSession),
      prefs.remove(_prefixCancelTurn),
      prefs.remove(_prefixSwitchSession),
    ]);
  }

  Future<void> _set(
    String key,
    String value,
    void Function() assign,
  ) async {
    assign();
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(key, value);
  }
}
