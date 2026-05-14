import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:rhythm_desktop/app/core/errors/app_error.dart';
import 'package:rhythm_desktop/app/core/utils/http_utils.dart';

void main() {
  group('assertOk', () {
    test('does not throw for 2xx responses', () {
      final response = http.Response('{"ok":true}', 200);
      expect(() => assertOk(response), returnsNormally);
    });

    test(
      '400 with structured body throws AppError with message, code, statusCode',
      () {
        final response = http.Response(
          '{"error":{"code":"BAD_REQUEST","message":"agent not configured: \'claude\'"}}',
          400,
        );
        final AppError error = _catchAppError(() => assertOk(response));
        expect(error.message, contains('agent not configured'));
        expect(error.code, equals('BAD_REQUEST'));
        expect(error.statusCode, equals(400));
      },
    );

    test(
      '500 with empty body throws AppError with unexpected-error message',
      () {
        final response = http.Response('', 500);
        final AppError error = _catchAppError(() => assertOk(response));
        expect(error.message, contains('unexpected error'));
        expect(error.message, contains('HTTP 500'));
        expect(error.statusCode, equals(500));
      },
    );

    test(
      '400 with non-JSON body throws AppError with Request-failed fallback',
      () {
        final response = http.Response('Bad request', 400);
        final AppError error = _catchAppError(() => assertOk(response));
        expect(error.message, contains('Request failed'));
        expect(error.message, contains('HTTP 400'));
        expect(error.statusCode, equals(400));
      },
    );

    test('5xx with empty body uses unexpected-error message', () {
      final response = http.Response('', 503);
      final AppError error = _catchAppError(() => assertOk(response));
      expect(error.message, contains('unexpected error'));
      expect(error.message, contains('HTTP 503'));
    });
  });
}

AppError _catchAppError(void Function() fn) {
  try {
    fn();
    fail('Expected AppError to be thrown');
  } on AppError catch (e) {
    return e;
  }
}
