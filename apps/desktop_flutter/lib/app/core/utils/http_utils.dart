import 'dart:convert';

import 'package:http/http.dart' as http;

import '../errors/app_error.dart';

/// Throws [AppError] if [response] has a status code >= 400.
/// Parses the API's standard `{ "error": { "message": "..." } }` body.
/// Handles empty or non-JSON bodies gracefully.
void assertOk(http.Response response) {
  if (response.statusCode >= 400) {
    Map<String, dynamic>? body;
    if (response.body.isNotEmpty) {
      try {
        body = jsonDecode(response.body) as Map<String, dynamic>?;
      } catch (_) {
        // Non-JSON error body — fall through to default message.
      }
    }
    final message =
        (body?['error'] as Map<String, dynamic>?)?['message'] as String? ??
        'Request failed';
    throw AppError(message);
  }
}
