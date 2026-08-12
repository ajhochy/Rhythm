class AuthSessionStore {
  static String? _sessionToken;

  static String? get sessionToken => _sessionToken;

  static void setSessionToken(String? token) {
    _sessionToken = token;
  }

  static Map<String, String> headers({bool json = false}) {
    final headers = <String, String>{};
    if (json) {
      headers['Content-Type'] = 'application/json';
    }
    if (_sessionToken != null && _sessionToken!.isNotEmpty) {
      headers['Authorization'] = 'Bearer $_sessionToken';
    }
    return headers;
  }

  /// Headers for the loopback agent server trust boundary.
  ///
  /// Cloud bearer tokens are intentionally excluded: a present but stale
  /// cloud token causes AGENT_LOCAL requests to fail closed instead of using
  /// the server's local bypass.
  static Map<String, String> localHeaders({bool json = false}) {
    return json ? {'Content-Type': 'application/json'} : {};
  }
}
