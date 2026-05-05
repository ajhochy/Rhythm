import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../models/reminder_preferences.dart';

/// Persists [ReminderPreferences] to `shared_preferences` and notifies
/// listeners on change.
class ReminderPreferencesService extends ChangeNotifier {
  static const _kPrefsKey = 'reminder_prefs_v1';

  ReminderPreferences _preferences = const ReminderPreferences();

  /// The current (in-memory) reminder preferences.
  ReminderPreferences get preferences => _preferences;

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /// Loads persisted preferences from storage. Call once at app startup before
  /// [runApp].
  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_kPrefsKey);
    if (raw != null) {
      try {
        final json = jsonDecode(raw) as Map<String, dynamic>;
        _preferences = ReminderPreferences.fromJson(json);
      } catch (_) {
        // Corrupt / incompatible data — fall back to defaults silently.
        _preferences = const ReminderPreferences();
      }
    }
    // No notifyListeners() here — called before runApp, no listeners yet.
  }

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  /// Persists [updated] to storage and notifies listeners.
  Future<void> update(ReminderPreferences updated) async {
    _preferences = updated;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_kPrefsKey, jsonEncode(updated.toJson()));
    notifyListeners();
  }
}
