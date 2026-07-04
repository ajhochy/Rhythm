import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// #890 — Persists the app-level "Default profile" override chosen from the
/// Agent Profile manager sheet.
///
/// Today `AgentsController._resolveDefaultAgentIdForCreate()` hardcodes
/// Secretary as the default profile for new sessions (#889). This service
/// lets the user override that default from the UI. Secretary remains the
/// SEEDED fallback — this only stores an override that, when present and
/// still valid (matches an authorized catalog entry), wins over Secretary.
///
/// Mirrors [ThemeModeService]'s persisted-setting shape: a `ChangeNotifier`
/// backed by `shared_preferences`, loaded once at startup before `runApp`.
class DefaultAgentProfileService extends ChangeNotifier {
  static const _key = 'default_agent_ocagent';

  String? _defaultOcAgent;

  /// The user-configured default profile's engine-agent name (ocAgent).
  /// Null means "unset" — callers should fall back to the seeded default
  /// (Secretary) or the first authorized catalog entry.
  String? get defaultOcAgent => _defaultOcAgent;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    _defaultOcAgent = prefs.getString(_key);
  }

  /// Persists [ocAgent] as the configured default. Pass null to clear the
  /// override and fall back to the seeded default again.
  Future<void> setDefault(String? ocAgent) async {
    if (_defaultOcAgent == ocAgent) return;
    _defaultOcAgent = ocAgent;
    notifyListeners();
    final prefs = await SharedPreferences.getInstance();
    if (ocAgent == null || ocAgent.isEmpty) {
      await prefs.remove(_key);
    } else {
      await prefs.setString(_key, ocAgent);
    }
  }
}
