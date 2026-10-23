import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import '../models/json.dart';
import 'api_error.dart';

/// Implemented by the session: supplies the bearer token and recovers from
/// 401s (refresh + `/me`, ch. 10.5).
abstract interface class AuthDelegate {
  String? get accessToken;

  /// Refresh tokens and reload `/me`. Returns true when the call may be retried.
  Future<bool> recover(String code);
}

/// Error codes that mean "your token is stale, refresh and retry once".
const recoverableAuthCodes = {'TOKEN_EXPIRED', 'PERMISSIONS_CHANGED', 'UNAUTHENTICATED'};

class ApiClient {
  ApiClient(
    this._dio, {
    required this.deviceId,
    required this.localeCode,
    String? platform,
  }) : platform = platform ?? _platformHeader();

  final Dio _dio;
  final String deviceId;
  final String Function() localeCode;
  final String platform;
  AuthDelegate? delegate;

  static String _platformHeader() {
    if (kIsWeb) return 'web';
    return defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query, bool auth = true}) =>
      send('GET', path, query: query, auth: auth);

  Future<dynamic> post(String path, {Object? body, Map<String, String>? headers, bool auth = true, bool retry = true}) =>
      send('POST', path, body: body ?? <String, dynamic>{}, headers: headers, auth: auth, retry: retry);

  Future<dynamic> patch(String path, {Object? body}) => send('PATCH', path, body: body);

  Future<Json> getJson(String path, {Map<String, dynamic>? query, bool auth = true}) async =>
      (await get(path, query: query, auth: auth)) as Json;

  Future<dynamic> send(
    String method,
    String path, {
    Map<String, dynamic>? query,
    Object? body,
    Map<String, String>? headers,
    bool auth = true,
    bool retry = true,
  }) async {
    final d = delegate;
    // No access token (cold start offline, or after a failed refresh): get one first.
    if (auth && retry && d != null && d.accessToken == null) {
      await d.recover('UNAUTHENTICATED');
    }
    try {
      final res = await _dio.request<dynamic>(
        path,
        data: body,
        queryParameters: query,
        options: Options(
          method: method,
          headers: {
            'x-device-id': deviceId,
            'x-client-platform': platform,
            'accept-language': localeCode(),
            if (auth && d?.accessToken != null) 'authorization': 'Bearer ${d!.accessToken}',
            ...?headers,
          },
        ),
      );
      return res.data;
    } on DioException catch (e) {
      final err = ApiException.fromDio(e);
      if (auth && retry && d != null && err.status == 401 && recoverableAuthCodes.contains(err.code)) {
        if (await d.recover(err.code)) {
          return send(method, path, query: query, body: body, headers: headers, auth: auth, retry: false);
        }
      }
      throw err;
    }
  }
}
