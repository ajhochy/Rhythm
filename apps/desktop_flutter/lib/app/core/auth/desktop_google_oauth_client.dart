import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

import '../constants/app_constants.dart';
import 'auth_data_source.dart';
import 'auth_user.dart';

/// Drives Google OAuth 2.0 authorization-code flow with PKCE from the desktop
/// app, using a loopback HTTP server as the redirect target. Avoids the
/// google_sign_in SDK entirely (and its Data Protection Keychain requirement).
class DesktopGoogleOAuthClient {
  DesktopGoogleOAuthClient({String? baseUrl, String? clientId})
      : _baseUrl = baseUrl ?? AppConstants.apiBaseUrl,
        _clientId = clientId ??
            const String.fromEnvironment('GOOGLE_DESKTOP_CLIENT_ID');

  static const List<String> _scopes = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.metadata',
  ];

  final String _baseUrl;
  final String _clientId;

  Future<AuthLoginResponse> signIn() async {
    if (_clientId.isEmpty) {
      throw StateError(
        'GOOGLE_DESKTOP_CLIENT_ID is not set; cannot start Google sign-in.',
      );
    }

    final codeVerifier = _generateCodeVerifier();
    final codeChallenge = _codeChallengeFor(codeVerifier);
    final state = _randomUrlSafeString(32);

    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final port = server.port;
    final redirectUri = 'http://127.0.0.1:$port/callback';

    final authUrl = Uri.https('accounts.google.com', '/o/oauth2/v2/auth', {
      'client_id': _clientId,
      'redirect_uri': redirectUri,
      'response_type': 'code',
      'scope': _scopes.join(' '),
      'code_challenge': codeChallenge,
      'code_challenge_method': 'S256',
      'state': state,
      'access_type': 'offline',
      'prompt': 'consent',
      'include_granted_scopes': 'true',
    });

    final launched = await launchUrl(
      authUrl,
      mode: LaunchMode.externalApplication,
    );
    if (!launched) {
      await server.close(force: true);
      throw StateError('Could not open the browser for Google sign-in.');
    }

    try {
      final code = await _awaitCallback(server, expectedState: state)
          .timeout(const Duration(minutes: 5));

      final exchangeResponse = await http.post(
        Uri.parse('$_baseUrl/auth/google/desktop-exchange'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'code': code,
          'codeVerifier': codeVerifier,
          'redirectUri': redirectUri,
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
    } finally {
      await server.close(force: true);
    }
  }

  Future<String> _awaitCallback(
    HttpServer server, {
    required String expectedState,
  }) async {
    await for (final request in server) {
      if (request.uri.path != '/callback') {
        request.response.statusCode = HttpStatus.notFound;
        await request.response.close();
        continue;
      }

      final params = request.uri.queryParameters;
      final code = params['code'];
      final error = params['error'];
      final state = params['state'];

      _writeBrowserResponse(request, error: error, hasCode: code != null);
      await request.response.close();

      if (error != null) {
        throw Exception('Google OAuth error: $error');
      }
      if (state != expectedState) {
        throw Exception('Google OAuth state mismatch');
      }
      if (code == null || code.isEmpty) {
        throw Exception('Google OAuth did not return a code');
      }
      return code;
    }
    throw Exception('Loopback server closed before receiving callback');
  }

  void _writeBrowserResponse(
    HttpRequest request, {
    String? error,
    required bool hasCode,
  }) {
    final body = error != null
        ? '<h2>Sign-in failed</h2><p>$error</p><p>You can close this window.</p>'
        : hasCode
            ? '<h2>Signed in</h2><p>You can close this window and return to Rhythm.</p>'
            : '<h2>Missing code</h2><p>You can close this window.</p>';
    request.response
      ..statusCode = HttpStatus.ok
      ..headers.contentType = ContentType.html
      ..write(
        '<html><body style="font-family: -apple-system, sans-serif; padding: 32px;">$body</body></html>',
      );
  }

  String _generateCodeVerifier() => _randomUrlSafeString(64);

  String _codeChallengeFor(String verifier) {
    final digest = sha256.convert(utf8.encode(verifier));
    return base64Url.encode(digest.bytes).replaceAll('=', '');
  }

  String _randomUrlSafeString(int byteLength) {
    final random = Random.secure();
    final bytes = List<int>.generate(byteLength, (_) => random.nextInt(256));
    return base64Url.encode(bytes).replaceAll('=', '');
  }
}
