import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'auth_data_source.dart';
import 'auth_session_store.dart';
import 'auth_user.dart';
import 'workspace_info.dart';

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
  WorkspaceInfo? _currentWorkspace;
  String? _workspaceRole;
  String? _errorMessage;
  String? _sessionToken;
  bool _restoreAttempted = false;
  bool _googleInitialized = false;

  AuthStatus get status => _status;
  AuthUser? get currentUser => _currentUser;
  WorkspaceInfo? get currentWorkspace => _currentWorkspace;
  WorkspaceInfo? get workspace => _currentWorkspace;
  String? get workspaceRole => _workspaceRole;
  bool get hasWorkspace => _currentWorkspace != null;
  bool get isWorkspaceAdmin => _workspaceRole == 'admin';
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
      final meResponse = await _dataSource.me(storedToken);
      _sessionToken = storedToken;
      _currentUser = meResponse.user;
      _currentWorkspace = meResponse.workspace;
      _workspaceRole = meResponse.workspaceRole;
      AuthSessionStore.setSessionToken(storedToken);
      _errorMessage = null;
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

      _errorMessage = null;
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
    if (_googleInitialized) {
      try {
        await GoogleSignIn.instance.signOut();
      } catch (_) {
        // Local session reset still takes precedence.
      }
    }
    await _clearLocalSession();
    _errorMessage = null;
    _status = AuthStatus.unauthenticated;
    notifyListeners();
  }

  void updateCurrentUser(AuthUser user) {
    if (_currentUser?.id != user.id) return;
    _currentUser = user;
    notifyListeners();
  }

  Future<void> _initializeGoogle() async {
    if (_googleInitialized) return;
    // On macOS, GoogleSignIn reads from Info.plist's GIDClientID.
    // The clientId parameter is primarily for Android.
    await GoogleSignIn.instance.initialize();
    _googleInitialized = true;
  }

  void refreshWorkspace(WorkspaceInfo? workspace, String? role) {
    _currentWorkspace = workspace;
    _workspaceRole = role;
    notifyListeners();
  }

  Future<void> refreshFromServer() async {
    if (_sessionToken == null) return;
    try {
      final meResponse = await _dataSource.me(_sessionToken!);
      _currentUser = meResponse.user;
      _currentWorkspace = meResponse.workspace;
      _workspaceRole = meResponse.workspaceRole;
      notifyListeners();
    } catch (_) {
      // Silently fail — caller can handle if needed
    }
  }

  Future<void> _clearLocalSession() async {
    _sessionToken = null;
    _currentUser = null;
    _currentWorkspace = null;
    _workspaceRole = null;
    AuthSessionStore.setSessionToken(null);
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_sessionTokenKey);
  }
}
