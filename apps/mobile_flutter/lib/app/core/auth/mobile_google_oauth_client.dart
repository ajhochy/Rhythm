import 'dart:convert';

import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:http/http.dart' as http;

import '../constants/app_constants.dart';
import 'auth_data_source.dart';
import 'auth_user.dart';
import 'oauth_client.dart';

/// Drives Google OAuth 2.0 PKCE authorization-code flow on iOS and Android
/// using [FlutterAppAuth]. After obtaining the authorization code and verifier
/// from the system browser, it POSTs to the backend's
/// `POST /auth/google/desktop-exchange` endpoint (the same one the desktop
/// client uses) to exchange the code for a session token.
///
/// Required build-time defines (pass via `--dart-define`):
///   - `GOOGLE_MOBILE_CLIENT_ID` — your Google OAuth 2.0 client ID for mobile
///   - `GOOGLE_MOBILE_REDIRECT_URI` — e.g. `com.rhythmapp.mobile:/oauth-callback`
class MobileGoogleOAuthClient implements OAuthClient {
  MobileGoogleOAuthClient({
    String? baseUrl,
    String? clientId,
    String? redirectUri,
    FlutterAppAuth? appAuth,
  })  : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl,
        _clientId =
            clientId ?? const String.fromEnvironment('GOOGLE_MOBILE_CLIENT_ID'),
        _redirectUri = redirectUri ??
            const String.fromEnvironment('GOOGLE_MOBILE_REDIRECT_URI'),
        _appAuth = appAuth ?? const FlutterAppAuth();

  static const List<String> _scopes = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.metadata',
  ];

  static const String _discoveryUrl =
      'https://accounts.google.com/.well-known/openid-configuration';

  final String _baseUrl;
  final String _clientId;
  final String _redirectUri;
  final FlutterAppAuth _appAuth;

  @override
  Future<AuthLoginResponse> signIn() async {
    if (_clientId.isEmpty) {
      throw StateError(
        'GOOGLE_MOBILE_CLIENT_ID is not set; '
        'pass --dart-define=GOOGLE_MOBILE_CLIENT_ID=<id> at build time.',
      );
    }
    if (_redirectUri.isEmpty) {
      throw StateError(
        'GOOGLE_MOBILE_REDIRECT_URI is not set; '
        'pass --dart-define=GOOGLE_MOBILE_REDIRECT_URI=<uri> at build time.',
      );
    }

    // flutter_appauth generates PKCE code verifier/challenge internally and
    // returns them on the AuthorizationResponse so we can forward them.
    final authResponse = await _appAuth.authorize(
      AuthorizationRequest(
        _clientId,
        _redirectUri,
        discoveryUrl: _discoveryUrl,
        scopes: _scopes,
        promptValues: ['consent'],
        additionalParameters: {
          'access_type': 'offline',
          'include_granted_scopes': 'true',
        },
      ),
    );

    if (authResponse == null) {
      throw StateError('Google sign-in was cancelled or failed.');
    }

    final code = authResponse.authorizationCode;
    final codeVerifier = authResponse.codeVerifier;

    if (code == null || code.isEmpty) {
      throw StateError('Google OAuth did not return an authorization code.');
    }
    if (codeVerifier == null || codeVerifier.isEmpty) {
      throw StateError('Google OAuth did not return a code verifier.');
    }

    final exchangeResponse = await http.post(
      Uri.parse('$_baseUrl/auth/google/desktop-exchange'),
      headers: {'Content-Type': 'application/json'},
      body: jsonEncode({
        'code': code,
        'codeVerifier': codeVerifier,
        'redirectUri': _redirectUri,
      }),
    );

    if (exchangeResponse.statusCode != 200) {
      throw Exception(
        'Server rejected Google sign-in: '
        '${exchangeResponse.statusCode} ${exchangeResponse.body}',
      );
    }

    final json = jsonDecode(exchangeResponse.body) as Map<String, dynamic>;
    return AuthLoginResponse(
      sessionToken: json['sessionToken'] as String,
      user: AuthUser.fromJson(json['user'] as Map<String, dynamic>),
    );
  }
}
