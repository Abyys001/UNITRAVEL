import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:unitravel_mobile/app.dart';
import 'package:unitravel_mobile/core/providers.dart';
import 'package:unitravel_mobile/core/token_store.dart';

import 'support/fake_api.dart';

void main() {
  testWidgets('Persian switches the whole sign-in screen to RTL with Persian strings', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = FakeAdapter((o) => problem(404, 'NOT_FOUND'));
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sharedPreferencesProvider.overrideWithValue(prefs),
          tokenStoreProvider.overrideWithValue(MemoryTokenStore()),
          dioProvider.overrideWithValue(dio),
        ],
        child: const UniTravelApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Send code'), findsOneWidget);
    expect(Directionality.of(tester.element(find.text('Send code'))), TextDirection.ltr);

    await tester.tap(find.bySemanticsLabel('فارسی'));
    await tester.pumpAndSettle();

    expect(find.text('ارسال کد'), findsOneWidget);
    expect(Directionality.of(tester.element(find.text('ارسال کد'))), TextDirection.rtl);
    expect(prefs.getString('ut.locale'), 'fa');
  });

  group('test sign-in box (ADR-0012)', () {
    Future<FakeAdapter> pump(WidgetTester tester, Handler handler) async {
      tester.view.physicalSize = const Size(800, 1800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      SharedPreferences.setMockInitialValues({});
      FlutterSecureStorage.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final adapter = FakeAdapter(handler);
      final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = adapter;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            sharedPreferencesProvider.overrideWithValue(prefs),
            tokenStoreProvider.overrideWithValue(MemoryTokenStore()),
            dioProvider.overrideWithValue(dio),
          ],
          child: const UniTravelApp(),
        ),
      );
      await tester.pumpAndSettle();
      return adapter;
    }

    testWidgets('is hidden when the probe fails', (tester) async {
      await pump(tester, (o) => problem(404, 'NOT_FOUND'));
      expect(find.byKey(const ValueKey('test-sign-in')), findsNothing);
    });

    testWidgets('is hidden when the API reports it disabled', (tester) async {
      await pump(tester, (o) => json({'enabled': false}));
      expect(find.byKey(const ValueKey('test-sign-in')), findsNothing);
    });

    testWidgets('shows when enabled and submits the email with client MOBILE', (tester) async {
      final adapter = await pump(tester, (o) {
        if (o.path == '/v1/auth/test-sign-in' && o.method == 'GET') return json({'enabled': true});
        if (o.path == '/v1/auth/test-sign-in' && o.method == 'POST') {
          return json({'isNewUser': false, 'needsProfile': false, 'mfaRequired': false, 'mfaEnrolmentRequired': false, 'tokens': tokensJson('1')});
        }
        if (o.path == '/v1/me') return json(meJson());
        return problem(404, 'NOT_FOUND');
      });
      expect(find.byKey(const ValueKey('test-sign-in')), findsOneWidget);
      expect(find.text('Test sign-in (testing phase)'), findsOneWidget);

      await tester.tap(find.text('owner@unitravel.example'));
      await tester.pump();
      await tester.tap(find.text('Sign in without a code'));
      await tester.pumpAndSettle();

      final post = adapter.calls.firstWhere((c) => c.method == 'POST' && c.path == '/v1/auth/test-sign-in');
      final body = post.data as Map<String, dynamic>;
      expect(body['client'], 'MOBILE');
      expect(body['email'], 'owner@unitravel.example');
      expect((body['deviceId'] as String).length, greaterThanOrEqualTo(8));
      expect(adapter.count('GET', '/v1/me'), 1);
    });
  });
}
