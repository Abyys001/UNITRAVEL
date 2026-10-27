import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:unitravel_mobile/features/account/account_screen.dart';
import 'package:unitravel_mobile/l10n/app_localizations.dart';
import 'package:unitravel_mobile/ui/theme.dart';

/// Records the URLs url_launcher is asked to open (no platform plugin runs in widget tests).
List<String> _captureLaunches(WidgetTester tester) {
  final urls = <String>[];
  tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('plugins.flutter.io/url_launcher'), (call) async {
    if (call.method == 'launch') urls.add((call.arguments as Map)['url'] as String);
    return true;
  });
  addTearDown(() => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(const MethodChannel('plugins.flutter.io/url_launcher'), null));
  return urls;
}

Future<void> _pump(WidgetTester tester, String lang) => tester.pumpWidget(
  MaterialApp(
    locale: Locale(lang),
    theme: buildAppTheme(Locale(lang)),
    localizationsDelegates: const [AppL10n.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
    supportedLocales: AppL10n.supportedLocales,
    home: const Scaffold(body: HelpLinks()),
  ),
);

void main() {
  testWidgets('Account help opens the FAQ, travel rules and buying guide pages in the app language', (tester) async {
    final urls = _captureLaunches(tester);
    await _pump(tester, 'en');
    expect(find.text('FAQ'), findsOneWidget);
    expect(find.text('Travel rules'), findsOneWidget);
    expect(find.text('Buying guide'), findsOneWidget);

    await tester.tap(find.byKey(const Key('help-faq')));
    await tester.tap(find.byKey(const Key('help-travel-rules')));
    await tester.tap(find.byKey(const Key('help-flight-guide')));
    await tester.pump();
    expect(urls, ['http://localhost:4000/en/faq', 'http://localhost:4000/en/travel-rules', 'http://localhost:4000/en/flights/guide']);
  });

  testWidgets('Persian labels and /fa URLs', (tester) async {
    final urls = _captureLaunches(tester);
    await _pump(tester, 'fa');
    expect(find.text('سوالات متداول'), findsOneWidget);
    expect(find.text('قوانین سفر'), findsOneWidget);
    expect(find.text('راهنمای خرید بلیت'), findsOneWidget);
    await tester.tap(find.byKey(const Key('help-flight-guide')));
    await tester.pump();
    expect(urls, ['http://localhost:4000/fa/flights/guide']);
  });

  test('helpPageUri builds the locale-prefixed web URL', () {
    expect(helpPageUri('fa', '/faq').toString(), 'http://localhost:4000/fa/faq');
  });
}
