import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:unitravel_mobile/core/api_error.dart';
import 'package:unitravel_mobile/core/providers.dart';
import 'package:unitravel_mobile/core/session.dart';
import 'package:unitravel_mobile/core/token_store.dart';

import 'support/fake_api.dart';

/// Auth / permission-refresh contract (ch. 10.5): a 401 `PERMISSIONS_CHANGED` or
/// `TOKEN_EXPIRED` refreshes silently, reloads `/me` (admin mode can appear) and
/// retries the failed call exactly once.
void main() {
  late FakeAdapter adapter;
  late MemoryTokenStore store;
  late ProviderContainer container;

  Future<ProviderContainer> boot({String? refresh}) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    store = MemoryTokenStore();
    if (refresh != null) await store.writeRefreshToken(refresh);
    final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = adapter;
    container = ProviderContainer(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        tokenStoreProvider.overrideWithValue(store),
        dioProvider.overrideWithValue(dio),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  Future<void> signedIn() async {
    await boot(refresh: 'refresh-0');
    container.read(sessionProvider);
    // restore() runs in a microtask; wait for it to settle.
    await container.read(sessionProvider.notifier).restore();
  }

  test('cold start restores the session from the stored refresh token', () async {
    adapter = FakeAdapter((o) {
      if (o.path == '/v1/auth/refresh') return json(tokensJson('1'));
      if (o.path == '/v1/me') return json(meJson());
      return problem(404, 'NOT_FOUND');
    });
    await signedIn();
    final s = container.read(sessionProvider);
    expect(s.status, AuthStatus.signedIn);
    expect(s.isAdminMode, isFalse);
    expect(await store.readRefreshToken(), 'refresh-1', reason: 'refresh token is rotated and persisted');
    expect(container.read(sessionProvider.notifier).accessToken, 'access-1');
  });

  test('401 PERMISSIONS_CHANGED refreshes, reloads /me, retries once and admin mode appears', () async {
    var admin = false;
    var refreshes = 0;
    adapter = FakeAdapter((o) {
      switch (o.path) {
        case '/v1/auth/refresh':
          refreshes++;
          return json(tokensJson('$refreshes'));
        case '/v1/me':
          return json(meJson(admin: admin));
        case '/v1/requests':
          // First call carries the stale token; the retry carries the refreshed one.
          if (o.headers['authorization'] == 'Bearer access-1') {
            return problem(401, 'PERMISSIONS_CHANGED');
          }
          return json([]);
      }
      return problem(404, 'NOT_FOUND');
    });
    admin = false;
    await signedIn();
    expect(container.read(sessionProvider).isAdminMode, isFalse);

    admin = true; // the owner promoted this user in the meantime
    final res = await container.read(apiClientProvider).get('/v1/requests');

    expect(res, isEmpty);
    expect(container.read(sessionProvider).isAdminMode, isTrue, reason: 'navigation rebuilds into admin mode');
    expect(adapter.count('GET', '/v1/requests'), 2, reason: 'original call plus exactly one retry');
    expect(refreshes, 2);
    expect(adapter.calls.last.headers['authorization'], 'Bearer access-2');
  });

  test('401 TOKEN_EXPIRED refreshes and retries', () async {
    var n = 0;
    adapter = FakeAdapter((o) {
      if (o.path == '/v1/auth/refresh') return json(tokensJson('${++n}'));
      if (o.path == '/v1/me') return json(meJson());
      if (o.path == '/v1/notifications') {
        return o.headers['authorization'] == 'Bearer access-1'
            ? problem(401, 'TOKEN_EXPIRED')
            : json({'items': [], 'nextCursor': null, 'unread': 0});
      }
      return problem(404, 'NOT_FOUND');
    });
    await signedIn();
    final res = await container.read(apiClientProvider).get('/v1/notifications');
    expect((res as Map)['unread'], 0);
  });

  test('concurrent 401s share a single refresh', () async {
    var refreshes = 0;
    adapter = FakeAdapter((o) {
      if (o.path == '/v1/auth/refresh') return json(tokensJson('${++refreshes}'));
      if (o.path == '/v1/me') return json(meJson());
      if (o.path == '/v1/requests') {
        return o.headers['authorization'] == 'Bearer access-1' ? problem(401, 'TOKEN_EXPIRED') : json([]);
      }
      return problem(404, 'NOT_FOUND');
    });
    await signedIn();
    final api = container.read(apiClientProvider);
    await Future.wait([api.get('/v1/requests'), api.get('/v1/requests'), api.get('/v1/requests')]);
    expect(refreshes, 2, reason: 'one at cold start, one shared by the three failing calls');
  });

  test('a second 401 after the retry is surfaced, not looped', () async {
    adapter = FakeAdapter((o) {
      if (o.path == '/v1/auth/refresh') return json(tokensJson('9'));
      if (o.path == '/v1/me') return json(meJson());
      if (o.path == '/v1/requests') return problem(401, 'PERMISSIONS_CHANGED');
      return problem(404, 'NOT_FOUND');
    });
    await signedIn();
    await expectLater(
      container.read(apiClientProvider).get('/v1/requests'),
      throwsA(isA<ApiException>().having((e) => e.code, 'code', 'PERMISSIONS_CHANGED')),
    );
    expect(adapter.count('GET', '/v1/requests'), 2);
  });

  test('a rejected refresh token signs the user out and clears storage', () async {
    adapter = FakeAdapter((o) {
      if (o.path == '/v1/auth/refresh') return problem(401, 'UNAUTHENTICATED');
      return problem(404, 'NOT_FOUND');
    });
    await boot(refresh: 'stale');
    container.read(sessionProvider);
    await container.read(sessionProvider.notifier).restore();
    final s = container.read(sessionProvider);
    expect(s.status, AuthStatus.signedOut);
    expect(s.notice, 'session_expired');
    expect(await store.readRefreshToken(), isNull);
  });

  test('offline cold start keeps the cached profile instead of signing out', () async {
    var online = true;
    adapter = FakeAdapter((o) {
      if (!online) throw DioException.connectionError(requestOptions: o, reason: 'offline');
      if (o.path == '/v1/auth/refresh') return json(tokensJson('1'));
      if (o.path == '/v1/me') return json(meJson());
      return problem(404, 'NOT_FOUND');
    });
    await signedIn();
    final prefs = container.read(sharedPreferencesProvider);
    final token = await store.readRefreshToken();

    online = false;
    final c2 = ProviderContainer(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        tokenStoreProvider.overrideWithValue(store..writeRefreshToken(token!)),
        dioProvider.overrideWithValue(Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = adapter),
      ],
    );
    addTearDown(c2.dispose);
    c2.read(sessionProvider);
    await c2.read(sessionProvider.notifier).restore();
    expect(c2.read(sessionProvider).status, AuthStatus.signedIn);
    expect(await store.readRefreshToken(), token, reason: 'a network error must not discard the refresh token');
  });

  test('problem+json parsing keeps code, field errors and retryAfter', () async {
    adapter = FakeAdapter((o) => problem(429, 'RATE_LIMITED', title: 'Too many requests', extra: {'retryAfter': 42, 'errors': [
      {'path': 'value', 'code': 'x', 'message': 'bad'},
    ]}));
    await boot();
    try {
      await container.read(apiClientProvider).get('/v1/anything', auth: false);
      fail('expected ApiException');
    } on ApiException catch (e) {
      expect(e.code, 'RATE_LIMITED');
      expect(e.retryAfter, 42);
      expect(e.fieldErrors['value'], 'bad');
    }
  });
}
