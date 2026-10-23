import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
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
}
