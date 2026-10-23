import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

typedef Handler = ResponseBody Function(RequestOptions o);

/// In-memory HTTP adapter: tests describe the API as a function of the request.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);
  Handler handler;
  final List<RequestOptions> calls = [];

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    calls.add(options);
    return handler(options);
  }

  @override
  void close({bool force = false}) {}

  int count(String method, String path) => calls.where((c) => c.method == method && c.path == path).length;
}

ResponseBody json(Object body, {int status = 200}) => ResponseBody.fromString(
  jsonEncode(body),
  status,
  headers: {Headers.contentTypeHeader: ['application/json']},
);

ResponseBody problem(int status, String code, {String title = 'Problem', Map<String, dynamic>? extra}) =>
    json({'type': 'x', 'title': title, 'status': status, 'code': code, ...?extra}, status: status);

Map<String, dynamic> meJson({bool admin = false, String locale = 'en', String calendar = 'GREGORIAN', int permVersion = 1}) => {
  'id': 'u1',
  'displayName': 'Test User',
  'status': 'ACTIVE',
  'preferredLocale': locale,
  'calendar': calendar,
  'timezone': 'Asia/Tehran',
  'identities': [
    {'id': 'i1', 'type': 'PHONE', 'value': '+989120000001', 'verifiedAt': '2026-01-01T00:00:00Z', 'isPrimary': true},
  ],
  'roles': admin ? ['customer', 'admin'] : ['customer'],
  'permissions': <String>[],
  'flags': {'cargo.enabled': true},
  'permVersion': permVersion,
  'profile': {'givenNamesLatin': 'Test', 'surnameLatin': 'User', 'nameFa': null, 'contactTimePref': null},
  'notificationPrefs': <String, bool>{},
  'mfa': {'level': 0, 'enrolled': <String>[], 'stepUpValidUntil': null},
  'onDuty': false,
  'surfaces': {'customer': true, 'admin': admin, 'developer': false},
};

Map<String, dynamic> tokensJson(String n) => {
  'accessToken': 'access-$n',
  'accessExpiresAt': '2099-01-01T00:00:00Z',
  'refreshToken': 'refresh-$n',
  'refreshExpiresAt': '2099-02-01T00:00:00Z',
};
