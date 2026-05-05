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
}
