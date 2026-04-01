import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'auth_data_source.dart';
import 'auth_session_store.dart';
import 'auth_user.dart';

enum AuthStatus {
  checking,
  authenticated,
  unauthenticated,
  signingIn,
}

class AuthSessionService extends ChangeNotifier {
  AuthSessionService(this._dataSource) {
    instance = this;
  }

  static late AuthSessionService instance;
  static const _sessionTokenKey = 'session_token';

  final AuthDataSource _dataSource;

  AuthStatus _status = AuthStatus.checking;
  AuthUser? _currentUser;
  String? _errorMessage;
  String? _sessionToken;
  bool _restoreAttempted = false;
  bool _googleInitialized = false;

  AuthStatus get status => _status;
  AuthUser? get currentUser => _currentUser;
  String? get errorMessage => _errorMessage;
  bool get isAuthenticated => _status == AuthStatus.authenticated;
  String? get sessionToken => _sessionToken;

  Future<void> restoreSession() async {
    if (_restoreAttempted) return;
    _restoreAttempted = true;
    _status = AuthStatus.checking;
    _errorMessage = null;
    notifyListeners();

    final prefs = await SharedPreferences.getInstance();
    final storedToken = prefs.getString(_sessionTokenKey);
    if (storedToken == null || storedToken.isEmpty) {
      _sessionToken = null;
      AuthSessionStore.setSessionToken(null);
      _status = AuthStatus.unauthenticated;
      notifyListeners();
      return;
    }

    try {
      final user = await _dataSource.me(storedToken);
      _sessionToken = storedToken;
      _currentUser = user;
      AuthSessionStore.setSessionToken(storedToken);
      _status = AuthStatus.authenticated;
    } catch (error) {
      await _clearLocalSession();
      _errorMessage = error.toString();
      _status = AuthStatus.unauthenticated;
    }
    notifyListeners();
  }

  Future<void> signInWithGoogle() async {
    _status = AuthStatus.signingIn;
    _errorMessage = null;
    notifyListeners();

    try {
      await _initializeGoogle();
      final account = await GoogleSignIn.instance.authenticate();
      final authentication = account.authentication;
      final googleIdToken = authentication.idToken;
      if (googleIdToken == null || googleIdToken.isEmpty) {
        throw Exception('Google Sign-In did not return an ID token.');
      }

      final login = await _dataSource.loginWithGoogleIdToken(googleIdToken);
      _sessionToken = login.sessionToken;
      _currentUser = login.user;
      AuthSessionStore.setSessionToken(login.sessionToken);

      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_sessionTokenKey, login.sessionToken);

      _status = AuthStatus.authenticated;
    } catch (error) {
      await _clearLocalSession();
      _status = AuthStatus.unauthenticated;
      _errorMessage = error.toString();
    }
    notifyListeners();
  }

  Future<void> logout() async {
    try {
      await _dataSource.logout();
    } catch (_) {
      // Local logout should still succeed if the server session is already gone.
    }
    await _clearLocalSession();
    _status = AuthStatus.unauthenticated;
    notifyListeners();
  }

  Future<void> _initializeGoogle() async {
    if (_googleInitialized) return;
    const clientId = String.fromEnvironment('GOOGLE_DESKTOP_CLIENT_ID');
    await GoogleSignIn.instance.initialize(
      clientId: clientId.isEmpty ? null : clientId,
    );
    _googleInitialized = true;
  }

  Future<void> _clearLocalSession() async {
    _sessionToken = null;
    _currentUser = null;
    AuthSessionStore.setSessionToken(null);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_sessionTokenKey);
  }
}
