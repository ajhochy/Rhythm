class AppError implements Exception {
  AppError(this.message, {this.code, this.statusCode});

  final String message;
  final String? code;
  final int? statusCode;

  factory AppError.notFound(String resource) => AppError(
        '$resource not found',
        code: 'NOT_FOUND',
        statusCode: 404,
      );

  factory AppError.badRequest(String message) => AppError(
        message,
        code: 'BAD_REQUEST',
        statusCode: 400,
      );

  @override
  String toString() => message;
}
