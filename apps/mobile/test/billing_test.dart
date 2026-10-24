import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:unitravel_mobile/core/billing.dart';
import 'package:unitravel_mobile/core/providers.dart';
import 'package:unitravel_mobile/core/repos.dart';
import 'package:unitravel_mobile/features/billing/billing_screen.dart';
import 'package:unitravel_mobile/l10n/app_localizations.dart';
import 'package:unitravel_mobile/l10n/app_localizations_en.dart';
import 'package:unitravel_mobile/l10n/app_localizations_fa.dart';
import 'package:unitravel_mobile/models/billing.dart';
import 'package:unitravel_mobile/ui/theme.dart';

const invoiceJson = {
  'number': 'INV-2026-000007',
  'status': 'ISSUED',
  'requestRef': 'UT-C-7Q2K9M',
  'productType': 'CARGO',
  'lines': [
    {
      'description': 'Freight (8 kg)',
      'quantity': 1,
      'unitAmount': {'amountMinor': 3600, 'currency': 'GBP'},
      'amount': {'amountMinor': 3600, 'currency': 'GBP'},
    },
    {
      'description': 'Handling',
      'quantity': 1,
      'unitAmount': {'amountMinor': 1400, 'currency': 'GBP'},
      'amount': {'amountMinor': 1400, 'currency': 'GBP'},
    },
  ],
  'total': {'amountMinor': 5000, 'currency': 'GBP'},
  'issuedAt': '2026-11-01T10:00:00.000Z',
  'expiresAt': '2026-11-15T10:00:00.000Z',
  'paidAt': null,
  'cancelledAt': null,
  'cancelReason': null,
  'documentId': '4f0e5d1c-7051-4d1e-9f6c-9b8a7f6e5d40',
};

Invoice invoice(Map<String, Object?> patch) => Invoice.fromJson({...invoiceJson, ...patch});

Future<void> pump(WidgetTester tester, String lang, Invoice inv, {InvoicePayment pay = const InvoicePayment(offered: false, processing: false)}) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        invoiceProvider.overrideWith((ref, number) async => Cached(inv)),
        invoicePaymentProvider.overrideWith((ref, number) async => pay),
      ],
      child: MaterialApp(
        theme: buildAppTheme(Locale(lang)),
        locale: Locale(lang),
        supportedLocales: AppL10n.supportedLocales,
        localizationsDelegates: AppL10n.localizationsDelegates,
        home: InvoiceScreen(number: inv.number),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fa');
  });

  test('billing JSON: invoice lines and total, quotation without any amount', () {
    final docs = BillingDocs.fromJson({
      'quotations': [
        {
          'number': 'QT-2026-000003',
          'requestRef': 'UT-C-7Q2K9M',
          'productType': 'CARGO',
          'status': 'ACCEPTED',
          'sentAt': '2026-11-01T09:00:00.000Z',
          'validUntil': null,
          'documentId': null,
        },
      ],
      'invoices': [invoiceJson],
    });
    expect(docs.invoices.single.total!.amountMinor, 5000);
    expect(docs.invoices.single.lines.map((l) => l.amount!.amountMinor), [3600, 1400]);
    expect(docs.quotations.single.number, 'QT-2026-000003');
    expect(docs.quotations.single.validUntil, isNull);
  });

  test('every status and cancel reason has translated wording that is not the raw code; cancelled ones say not to pay', () {
    final en = AppL10nEn();
    final fa = AppL10nFa();
    for (final s in ['ISSUED', 'PAID', 'CANCELLED', 'REFUNDED']) {
      expect(invoiceStatusLabel(en, s), isNot(s));
      expect(RegExp(r'[؀-ۿ]').hasMatch(invoiceStatusLabel(fa, s)), isTrue, reason: s);
    }
    for (final s in ['SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED']) {
      expect(quoteStatusLabel(en, s), isNot(s));
      expect(RegExp(r'[؀-ۿ]').hasMatch(quoteStatusLabel(fa, s)), isTrue, reason: s);
    }
    for (final c in ['CORRECTION', 'CUSTOMER_REQUEST', 'DUPLICATE', 'OTHER', 'SOMETHING_NEW']) {
      expect(cancelReasonText(en, c), contains('Do not pay it'));
      expect(cancelReasonText(fa, c), contains('پرداخت نکنید'));
    }
    expect(cancelReasonText(en, 'EXPIRED'), contains('expired'));
  });

  for (final lang in ['en', 'fa']) {
    testWidgets('an issued invoice shows its lines, total and expiry note in $lang', (tester) async {
      await pump(tester, lang, invoice({}));
      expect(find.text(lang == 'en' ? 'Awaiting payment' : 'در انتظار پرداخت'), findsOneWidget);
      expect(find.byKey(const Key('invoice-total')), findsOneWidget);
      expect(find.textContaining(lang == 'en' ? '£50' : '۵۰'), findsWidgets);
      expect(find.text('Freight (8 kg)'), findsOneWidget);
      expect(find.text(lang == 'en' ? 'Download PDF' : 'دریافت PDF'), findsOneWidget);
      expect(find.textContaining('ISSUED'), findsNothing);
    });

    testWidgets('a cancelled invoice says not to pay it in $lang and offers no payment note', (tester) async {
      await pump(tester, lang, invoice({'status': 'CANCELLED', 'cancelReason': 'CORRECTION', 'cancelledAt': '2026-11-02T10:00:00.000Z'}));
      expect(find.byKey(const Key('cancel-reason')), findsOneWidget);
      expect(find.textContaining(lang == 'en' ? 'Do not pay it' : 'پرداخت نکنید'), findsOneWidget);
      expect(find.text(lang == 'en' ? 'Cancelled' : 'لغو شده'), findsOneWidget);
      expect(find.textContaining(lang == 'en' ? 'expires on' : 'منقضی می‌شود'), findsNothing);
    });
  }

  test('the pay page is the website, in the app language, with no payment key in the app (ADR-0007)', () {
    expect(payPageUri('INV-2026-000007', 'fa').toString(), 'http://localhost:4000/fa/billing/INV-2026-000007/pay');
    expect(payPageUri('INV-2026-000007', 'en').path, '/en/billing/INV-2026-000007/pay');
  });

  for (final lang in ['en', 'fa']) {
    testWidgets('card payment is offered only when the server says so, in $lang', (tester) async {
      await pump(tester, lang, invoice({}));
      expect(find.byKey(const Key('pay-online')), findsNothing);
      expect(find.textContaining(lang == 'en' ? 'tells you how to pay' : 'اعلام می‌کند'), findsOneWidget);
    });

    testWidgets('an offered invoice shows the pay button that opens the website, in $lang', (tester) async {
      await pump(tester, lang, invoice({}), pay: const InvoicePayment(offered: true, processing: false));
      expect(find.byKey(const Key('pay-online')), findsOneWidget);
      expect(find.text(lang == 'en' ? 'Pay by card on our website' : 'پرداخت با کارت در وب‌سایت ما'), findsOneWidget);
      expect(find.textContaining(lang == 'en' ? 'never pass through this app' : 'از این برنامه عبور نمی‌کند'), findsOneWidget);
    });

    testWidgets('a payment in progress says not to pay again and hides the button, in $lang', (tester) async {
      await pump(tester, lang, invoice({}), pay: const InvoicePayment(offered: true, processing: true));
      expect(find.byKey(const Key('pay-online')), findsNothing);
      expect(find.byKey(const Key('pay-processing')), findsOneWidget);
    });

    testWidgets('a paid invoice never offers payment, in $lang', (tester) async {
      await pump(tester, lang, invoice({'status': 'PAID', 'paidAt': '2026-11-02T10:00:00.000Z'}), pay: const InvoicePayment(offered: true, processing: false));
      expect(find.byKey(const Key('pay-online')), findsNothing);
    });
  }
}
