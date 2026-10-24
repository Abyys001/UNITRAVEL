import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:kit_ui/kit_ui.dart' show EmptyState, ErrorState, XfamTone;
import 'package:shared_preferences/shared_preferences.dart';
import 'package:unitravel_mobile/app.dart';
import 'package:unitravel_mobile/core/providers.dart';
import 'package:unitravel_mobile/core/repos.dart';
import 'package:unitravel_mobile/core/token_store.dart';
import 'package:unitravel_mobile/features/billing/billing_screen.dart';
import 'package:unitravel_mobile/features/cargo/shipments_screen.dart';
import 'package:unitravel_mobile/features/requests/request_detail_screen.dart';
import 'package:unitravel_mobile/l10n/app_localizations.dart';
import 'package:unitravel_mobile/models/billing.dart';
import 'package:unitravel_mobile/models/identity.dart';
import 'package:unitravel_mobile/models/json.dart';
import 'package:unitravel_mobile/models/shipments.dart';
import 'package:unitravel_mobile/ui/patterns.dart';
import 'package:unitravel_mobile/ui/theme.dart';
import 'package:unitravel_mobile/ui/widgets.dart';

import '../support/fake_api.dart';

// Phase F: golden images of the major screens in en and fa at phone and tablet/desktop widths. Fonts are the app's own
// (Montserrat, Vazirmatn) so Persian shapes are real; data is fixed (fixtures recorded from the API, see
// apps/web/e2e/visual-capture.spec.ts). Update on purpose:  flutter test test/golden --update-goldens

const sizes = {'phone': Size(390, 844), 'tablet': Size(1024, 768)};

Future<void> loadFont(String family, List<String> files) async {
  final loader = FontLoader(family);
  for (final f in files) {
    loader.addFont(Future.value(ByteData.sublistView(File(f).readAsBytesSync())));
  }
  await loader.load();
}

Json fixture(String name) => jsonDecode(File('test/golden/fixtures/$name.json').readAsStringSync()) as Json;
List<Object?> fixtureList(String name) => jsonDecode(File('test/golden/fixtures/$name.json').readAsStringSync()) as List<Object?>;

Invoice invoice(String status) => Invoice.fromJson({
  'number': 'INV-2026-000007',
  'status': status,
  'requestRef': 'UT-C-7Q2K9M',
  'productType': 'CARGO',
  'lines': [
    {'description': 'Freight (8 kg)', 'quantity': 1, 'unitAmount': {'amountMinor': 3600, 'currency': 'GBP'}, 'amount': {'amountMinor': 3600, 'currency': 'GBP'}},
    {'description': 'Handling', 'quantity': 1, 'unitAmount': {'amountMinor': 1400, 'currency': 'GBP'}, 'amount': {'amountMinor': 1400, 'currency': 'GBP'}},
  ],
  'total': {'amountMinor': 5000, 'currency': 'GBP'},
  'issuedAt': '2026-11-01T10:00:00.000Z',
  'expiresAt': '2026-11-15T10:00:00.000Z',
  'paidAt': status == 'PAID' ? '2026-11-02T10:00:00.000Z' : null,
  'cancelledAt': null,
  'cancelReason': null,
  'documentId': '4f0e5d1c-7051-4d1e-9f6c-9b8a7f6e5d40',
});

List<Override> _none(String _) => const [];

class Shot {
  const Shot(this.name, this.build, {this.overrides = _none});
  final String name;
  final Widget Function(String lang) build;
  final List<Override> Function(String lang) overrides;
}

Widget gallery(String lang) => Builder(
  builder: (context) {
    final l = AppL10n.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('Patterns')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          RequestStepper(steps: [l.progressReceived, l.progressReview, l.progressQuote, l.progressBooked, l.progressTicketed], current: 2, label: l.progressLabel, doneLabel: l.progressDone, currentLabel: l.progressCurrent, todoLabel: l.progressTodo),
          const SizedBox(height: 16),
          AppTimeline(entries: [
            AppTimelineEntry(title: l.statusNew, subtitle: 'LHR'),
            AppTimelineEntry(title: l.statusInReview, subtitle: 'IST', note: l.trackingUpdated),
            AppTimelineEntry(title: l.statusQuoted),
          ]),
          DocumentCard(icon: Icons.confirmation_number_outlined, title: const Text('NEDA TESTTRAVELLER'), meta: const LtrText('125 1234567890', mono: true), status: ToneChip(l.statusTicketed, tone: XfamTone.success)),
          const SizedBox(height: 12),
          Wrap(spacing: 8, runSpacing: 8, children: [for (final s in VerificationStatus.values) VerificationBadge(s)]),
          const SizedBox(height: 12),
          PaymentStateBanner(kind: PaymentStateKind.processing, text: l.billingPayProcessing),
          const SizedBox(height: 8),
          PaymentStateBanner(kind: PaymentStateKind.paid, text: l.billingPaidBanner),
          const SizedBox(height: 12),
          EmptyState(title: l.inboxEmpty, description: l.inboxEmptyHelp),
          ErrorState(title: l.errNetwork, retryLabel: l.retry, onRetry: () {}),
        ],
      ),
    );
  },
);

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fa');
    final root = Platform.environment['FLUTTER_ROOT'];
    if (root != null) await loadFont('MaterialIcons', ['$root/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf']);
    await loadFont('Montserrat', ['assets/fonts/montserrat/Montserrat-Regular.ttf']);
    await loadFont('Montserrat', ['assets/fonts/montserrat/Montserrat-Medium.ttf', 'assets/fonts/montserrat/Montserrat-SemiBold.ttf', 'assets/fonts/montserrat/Montserrat-Bold.ttf', 'assets/fonts/montserrat/Montserrat-ExtraBold.ttf']);
    await loadFont('Vazirmatn', ['assets/fonts/vazirmatn/Vazirmatn-Regular.ttf', 'assets/fonts/vazirmatn/Vazirmatn-Medium.ttf', 'assets/fonts/vazirmatn/Vazirmatn-SemiBold.ttf', 'assets/fonts/vazirmatn/Vazirmatn-Bold.ttf', 'assets/fonts/vazirmatn/Vazirmatn-ExtraBold.ttf']);
  });

  final shots = <Shot>[
    Shot('invoice-issued', (_) => const InvoiceScreen(number: 'INV-2026-000007'), overrides: (_) => [
      invoiceProvider.overrideWith((ref, n) async => Cached(invoice('ISSUED'))),
      invoicePaymentProvider.overrideWith((ref, n) async => const InvoicePayment(offered: true, processing: false)),
    ]),
    Shot('invoice-paid', (_) => const InvoiceScreen(number: 'INV-2026-000007'), overrides: (_) => [
      invoiceProvider.overrideWith((ref, n) async => Cached(invoice('PAID'))),
      invoicePaymentProvider.overrideWith((ref, n) async => const InvoicePayment(offered: false, processing: false)),
    ]),
    Shot('request-detail', (_) => const RequestDetailScreen(requestRef: 'UT-F-MP97Y0'), overrides: (lang) => [
      requestDetailProvider.overrideWith((ref, id) async => Cached(fixture('flight_request_$lang'))),
    ]),
    Shot('shipments', (_) => const ShipmentsScreen(), overrides: (lang) => [
      shipmentsProvider.overrideWith((ref) async => Cached(fixtureList('shipments_$lang').whereType<Json>().map(ShipmentItem.fromJson).toList())),
      shipmentSummaryProvider.overrideWith((ref) async => Cached(ShipmentSummary.fromJson(fixture('shipments_summary_$lang')))),
    ]),
    Shot('patterns', gallery),
  ];

  for (final lang in ['en', 'fa']) {
    for (final size in sizes.entries) {
      Future<void> frame(WidgetTester tester, Widget app, List<Override> overrides, String name) async {
        tester.view.physicalSize = size.value;
        tester.view.devicePixelRatio = 1;
        addTearDown(tester.view.reset);
        SharedPreferences.setMockInitialValues({});
        final prefs = await SharedPreferences.getInstance();
        await tester.pumpWidget(ProviderScope(overrides: [sharedPreferencesProvider.overrideWithValue(prefs), tokenStoreProvider.overrideWithValue(MemoryTokenStore()), ...overrides], child: app));
        await tester.pumpAndSettle();
        await expectLater(find.byType(MaterialApp).first, matchesGoldenFile('goldens/$name-$lang-${size.key}.png'));
      }

      for (final s in shots) {
        testWidgets('${s.name} $lang ${size.key}', (tester) async {
          final app = MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: buildAppTheme(Locale(lang)),
            locale: Locale(lang),
            supportedLocales: AppL10n.supportedLocales,
            localizationsDelegates: AppL10n.localizationsDelegates,
            home: s.build(lang),
          );
          await frame(tester, app, s.overrides(lang), s.name);
        });
      }

      testWidgets('sign-in $lang ${size.key}', (tester) async {
        final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = FakeAdapter((o) => problem(404, 'NOT_FOUND'));
        SharedPreferences.setMockInitialValues({'ut.locale': lang});
        await frame(tester, const UniTravelApp(), [dioProvider.overrideWithValue(dio)], 'sign-in');
      });
    }
  }
}
