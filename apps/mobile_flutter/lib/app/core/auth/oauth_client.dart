import 'auth_data_source.dart';

/// Platform-agnostic interface for OAuth sign-in flows.
///
/// Implementations are responsible for driving the full OAuth dance (PKCE
/// authorization code flow) and exchanging the resulting code with the backend.
/// The returned [AuthLoginResponse] contains the session token and user that
/// [AuthSessionService] will persist and expose to the rest of the app.
abstract class OAuthClient {
  Future<AuthLoginResponse> signIn();
}
