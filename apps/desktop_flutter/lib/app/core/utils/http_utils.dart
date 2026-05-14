import 'dart:convert';

import 'package:http/http.dart' as http;

import '../errors/app_error.dart';

/// Throws [AppError] if [response] has a status code >= 400.
/// Parses the API's standard `{ "error": { "message": "...", "code": "..." } }` body.
/// Handles empty or non-JSON bodies gracefully.
/// The thrown [AppError] carries [AppError.statusCode] and [AppError.code].
void assertOk(http.Response response) {
  if (response.statusCode >= 400) {
    if (response.body.isEmpty) {
      final message = response.statusCode >= 500
          ? 'The server returned an unexpected error (HTTP ${response.statusCode}).'
          : 'Request failed (HTTP ${response.statusCode}).';
      throw AppError(message, statusCode: response.statusCode);
    }

    Map<String, dynamic>? body;
    try {
      body = jsonDecode(response.body) as Map<String, dynamic>?;
    } catch (_) {
      // Non-JSON error body — fall through to status-aware fallback.
    }

    if (body == null) {
      final message = response.statusCode >= 500
          ? 'The server returned an unexpected error (HTTP ${response.statusCode}).'
          : 'Request failed (HTTP ${response.statusCode}).';
      throw AppError(message, statusCode: response.statusCode);
    }

    final errorObj = body['error'] as Map<String, dynamic>?;
    final message = errorObj?['message'] as String? ?? 'Request failed';
    final code = errorObj?['code'] as String?;
    throw AppError(message, code: code, statusCode: response.statusCode);
  }
}
