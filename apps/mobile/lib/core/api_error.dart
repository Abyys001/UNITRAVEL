import 'package:dio/dio.dart';

/// RFC 9457 problem document as sent by the API: `{type, title, status, code, detail, errors[]}`.
class ApiException implements Exception {
  const ApiException({
    required this.status,
    required this.code,
    required this.title,
    this.detail,
    this.fieldErrors = const {},
    this.retryAfter,
    this.body,
  });

  /// HTTP status; 0 when the server could not be reached.
  final int status;
  final String code;
  final String title;
  final String? detail;
  final Map<String, String> fieldErrors;
  final int? retryAfter;
  final Map<String, dynamic>? body;

  bool get isNetwork => status == 0;

  static const networkCode = 'NETWORK';

  factory ApiException.network([Object? cause]) => ApiException(
    status: 0,
    code: networkCode,
    title: 'Network unreachable',
    detail: cause?.toString(),
  );

  factory ApiException.fromDio(DioException e) {
    final res = e.response;
    if (res == null) return ApiException.network(e.message);
    final data = res.data;
    if (data is Map<String, dynamic>) {
      final errors = <String, String>{};
      final raw = data['errors'];
      if (raw is List) {
        for (final item in raw.whereType<Map<String, dynamic>>()) {
          final path = '${item['path'] ?? ''}';
          errors[path] = '${item['message'] ?? item['code'] ?? ''}';
        }
      }
      return ApiException(
        status: res.statusCode ?? 0,
        code: '${data['code'] ?? 'INTERNAL'}',
        title: '${data['title'] ?? 'Request failed'}',
        detail: data['detail'] as String?,
        fieldErrors: errors,
        retryAfter: (data['retryAfter'] as num?)?.toInt(),
        body: data,
      );
    }
    return ApiException(
      status: res.statusCode ?? 0,
      code: 'INTERNAL',
      title: 'Request failed',
    );
  }

  @override
  String toString() => 'ApiException($status $code: $title)';
}
