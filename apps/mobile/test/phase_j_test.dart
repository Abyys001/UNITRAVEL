import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:unitravel_mobile/core/activity.dart';
import 'package:unitravel_mobile/core/api_client.dart';
import 'package:unitravel_mobile/core/providers.dart';
import 'package:unitravel_mobile/core/session.dart';
import 'package:unitravel_mobile/core/site.dart';
import 'package:unitravel_mobile/features/admin/customers_screen.dart';
import 'package:unitravel_mobile/features/admin/home_screen.dart';
import 'package:unitravel_mobile/features/billing/billing_screen.dart';
import 'package:unitravel_mobile/features/listings/listings_screen.dart';
import 'package:unitravel_mobile/features/services/service_explorer.dart';
import 'package:unitravel_mobile/features/support/support_screen.dart';
import 'package:unitravel_mobile/features/support/support_tickets.dart';
import 'package:unitravel_mobile/l10n/app_localizations.dart';
import 'package:unitravel_mobile/l10n/app_localizations_en.dart';
import 'package:unitravel_mobile/models/listings.dart';
import 'package:unitravel_mobile/models/me.dart';
import 'package:unitravel_mobile/models/services.dart';
import 'package:unitravel_mobile/ui/theme.dart';

import 'support/fake_api.dart';

class _Customer extends SessionNotifier {
  @override
  SessionState build() => SessionState(status: AuthStatus.signedIn, me: Me.fromJson(meJson()));
}

List<String> staffPermissions = ['customer.read'];

class _Staff extends SessionNotifier {
  @override
  SessionState build() {
    final j = meJson(admin: true)..['permissions'] = staffPermissions;
    return SessionState(status: AuthStatus.signedIn, me: Me.fromJson(j));
  }
}

Future<Widget> app(Widget home, {String lang = 'en', List<Override> overrides = const [], FakeAdapter? adapter, GoRouter? router, bool staff = false}) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = adapter ?? FakeAdapter((o) => problem(404, 'NOT_FOUND'));
  return ProviderScope(
    retry: (_, _) => null,
    overrides: [sharedPreferencesProvider.overrideWithValue(prefs), dioProvider.overrideWithValue(dio), sessionProvider.overrideWith(staff ? _Staff.new : _Customer.new), ...overrides],
    child: MaterialApp.router(
      theme: buildAppTheme(Locale(lang)),
      locale: Locale(lang),
      supportedLocales: AppL10n.supportedLocales,
      localizationsDelegates: AppL10n.localizationsDelegates,
      routerConfig:
          router ??
          GoRouter(
            routes: [GoRoute(path: '/', builder: (_, _) => home)],
          ),
    ),
  );
}

void tall(WidgetTester tester) {
  tester.view.physicalSize = const Size(900, 4000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Map<String, dynamic> money(int minor, [String c = 'GBP']) => {'amountMinor': minor, 'currency': c};

Map<String, dynamic> pageJson(String number, {String status = 'ISSUED', String? payUrl, bool offered = false, String? offline}) => {
  'invoiceNumber': number,
  'status': status,
  'requestRef': 'UT-S-ABC123',
  'productType': 'SERVICE',
  'issuer': {'name': 'Uni Travel Ltd', 'address': '1 High St', 'phone': '+44 20 0000 0000', 'email': 'hi@example.test', 'registration': '123456', 'vatNumber': null, 'registeredAddress': null},
  'customerName': 'Sara Test',
  'issuedAt': '2026-10-30T10:00:00Z',
  'dueAt': '2026-11-10T10:00:00Z',
  'currency': 'GBP',
  'lines': [
    {'description': 'Hotel night', 'quantity': 2, 'unitAmount': money(5000), 'amount': money(10000)},
  ],
  'total': money(10000),
  'paidAt': null,
  'pdfDocumentId': null,
  'pdfUrl': null,
  'online': {'offered': offered, 'reasons': <String>[]},
  'payUrl': payUrl,
  'offlineInstructions': offline,
};

Map<String, dynamic> ticketJson(String ref, {String status = 'OPEN', bool canReply = true, List<Map<String, dynamic>> messages = const []}) => {
  'ref': ref,
  'topic': 'PAYMENT',
  'subject': 'Invoice question',
  'status': status,
  'requestRef': null,
  'createdAt': '2026-10-30T10:00:00Z',
  'updatedAt': '2026-10-30T11:00:00Z',
  'lastMessageAt': '2026-10-30T11:00:00Z',
  'messages': messages,
  'canReply': canReply,
};

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fa');
  });

  group('activity telemetry', () {
    test('only allow-listed screens are reported; unknown routes report nothing', () {
      expect(activityFor(Uri.parse('/search'))?.screen, 'search');
      expect(activityFor(Uri.parse('/search/results/abc'))?.screen, 'results');
      expect(activityFor(Uri.parse('/requests/ut-f-abc123'))?.ref, 'UT-F-ABC123');
      expect(activityFor(Uri.parse('/services/new/buses'))?.screen, 'buses');
      expect(activityFor(Uri.parse('/services/new/tours'))?.screen, 'tours');
      expect(activityFor(Uri.parse('/services/UT-S-ABC123'))?.screen, 'request_detail');
      expect(activityFor(Uri.parse('/account/billing/INV-2026-000123'))?.screen, 'invoice');
      expect(activityFor(Uri.parse('/account/billing/INV-2026-000123/payment'))?.screen, 'pay');
      expect(activityFor(Uri.parse('/support/tickets/TK-ABC234'))?.screen, 'support_ticket');
      expect(activityFor(Uri.parse('/listings/stays'))?.screen, 'stays');
      expect(activityFor(Uri.parse('/services')), isNull, reason: 'the grid is not on the allow-list');
      expect(activityFor(Uri.parse('/admin/home')), isNull);
      expect(activityFor(Uri.parse('/splash')), isNull);
      expect(activityFor(Uri.parse('/listings/planes')), isNull);
    });

    test('a ref that is not a reference is dropped, the screen still counts', () {
      final e = activityFor(Uri.parse('/requests/not a ref!'));
      expect(e?.screen, 'request_detail');
      expect(e?.ref, isNull);
    });

    testWidgets('one report per window, the newest screen follows, repeats and failures are silent', (tester) async {
      final adapter = FakeAdapter((o) => o.path == '/v1/me/activity' && (o.data as Map)['screen'] == 'inbox' ? problem(500, 'INTERNAL') : ResponseBody.fromString('', 204));
      final api = ApiClient(
        Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = adapter,
        deviceId: 'dev-12345678',
        localeCode: () => 'en',
      );
      // Real time with a short window: Dio needs real timers and microtasks.
      const gap = Duration(milliseconds: 150);
      final r = ActivityReporter(api, minGap: gap);
      List<String> sent() => [for (final c in adapter.calls) (c.data as Map)['screen'] as String];
      Future<void> wait(Duration d) => Future<void>.delayed(d);

      await tester.runAsync(() async {
        r.onLocation(Uri.parse('/search'));
        r.onLocation(Uri.parse('/requests'));
        r.onLocation(Uri.parse('/inbox'));
        r.onLocation(Uri.parse('/services'));
        await wait(const Duration(milliseconds: 50));
        expect(sent(), ['search'], reason: 'inside the window only the first goes out');

        await wait(gap + const Duration(milliseconds: 100));
        expect(sent(), ['search', 'inbox'], reason: 'the window closes and sends the latest screen; a 500 is swallowed');

        await wait(gap);
        r.onLocation(Uri.parse('/inbox'));
        await wait(gap + const Duration(milliseconds: 100));
        expect(sent().length, 2, reason: 'the same screen twice in a row is not sent again');
        r.dispose();
      });
    });
  });

  group('support', () {
    testWidgets('the contact form stays disabled until it is valid, then posts the website body with an idempotency key', (tester) async {
      tall(tester);
      final adapter = FakeAdapter((o) {
        if (o.method == 'POST' && o.path == '/v1/support/tickets') return json({'ref': 'TK-ABC234', 'status': 'OPEN', 'createdAt': '2026-10-30T10:00:00Z'}, status: 201);
        return problem(404, 'NOT_FOUND');
      });
      await tester.pumpWidget(await app(const SupportFormScreen(), adapter: adapter));
      await tester.pumpAndSettle();
      FilledButton submit() => tester.widget<FilledButton>(find.byKey(const Key('support-submit')));
      expect(submit().onPressed, isNull);

      await tester.enterText(find.byKey(const Key('support-name')), 'Sara Test');
      await tester.enterText(find.byKey(const Key('support-phone-field')), '');
      await tester.enterText(find.byKey(const Key('support-message')), 'My invoice total looks wrong.');
      await tester.pump();
      expect(submit().onPressed, isNull, reason: 'needs an email or a phone');

      await tester.enterText(find.byKey(const Key('support-email-field')), 'sara@example.test');
      await tester.pump();
      expect(submit().onPressed, isNotNull);

      await tester.tap(find.byKey(const Key('support-submit')));
      await tester.pumpAndSettle();
      final call = adapter.calls.singleWhere((c) => c.path == '/v1/support/tickets');
      final body = call.data as Map;
      expect(body['email'], 'sara@example.test');
      expect(body.containsKey('phone'), isFalse);
      expect(body['topic'], 'BOOKING');
      expect(body['locale'], 'en');
      expect((body['deviceId'] as String).length, greaterThanOrEqualTo(8));
      expect(call.headers['Idempotency-Key'], isNotNull);
      expect(find.byKey(const Key('support-sent')), findsOneWidget);
      expect(find.textContaining('TK-ABC234'), findsOneWidget);
    });

    testWidgets('a proof-of-work challenge is solved and the same message is sent again with the answer', (tester) async {
      tall(tester);
      const salt = 'salt-', number = 3;
      final target = sha256.convert(utf8.encode('$salt$number')).toString();
      var first = true;
      final adapter = FakeAdapter((o) {
        if (o.path != '/v1/support/tickets') return problem(404, 'NOT_FOUND');
        if (first) {
          first = false;
          return problem(
            428,
            'CHALLENGE_REQUIRED',
            extra: {
              'challenge': {'algorithm': 'SHA-256', 'challenge': target, 'maxnumber': 10, 'salt': salt, 'signature': 'sig'},
            },
          );
        }
        return json({'ref': 'TK-ABC234', 'status': 'OPEN', 'createdAt': '2026-10-30T10:00:00Z'}, status: 201);
      });
      await tester.pumpWidget(await app(const SupportFormScreen(), adapter: adapter));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('support-email-field')), 'sara@example.test');
      await tester.enterText(find.byKey(const Key('support-message')), 'Please call me back about my visa.');
      await tester.pump();
      await tester.runAsync(() async {
        await tester.tap(find.byKey(const Key('support-submit')));
        await Future<void>.delayed(const Duration(milliseconds: 600));
      });
      await tester.pumpAndSettle();
      final posts = adapter.calls.where((c) => c.path == '/v1/support/tickets').toList();
      expect(posts.length, 2);
      expect((posts.first.data as Map).containsKey('challenge'), isFalse);
      expect((posts.last.data as Map)['challenge'], isA<String>());
      expect(find.byKey(const Key('support-sent')), findsOneWidget);
    });

    testWidgets('my messages: list, then a thread with staff reply and a reply box; a closed thread has none', (tester) async {
      tall(tester);
      final adapter = FakeAdapter((o) {
        if (o.method == 'GET' && o.path == '/v1/support/tickets') {
          return json([ticketJson('TK-ABC234'), ticketJson('TK-ZZZ999', status: 'CLOSED', canReply: false)]);
        }
        if (o.method == 'GET' && o.path == '/v1/support/tickets/TK-ABC234') {
          return json(
            ticketJson(
              'TK-ABC234',
              messages: [
                {'id': 'm1', 'direction': 'FROM_CUSTOMER', 'authorName': 'Sara Test', 'body': 'Total looks wrong', 'createdAt': '2026-10-30T10:00:00Z'},
                {'id': 'm2', 'direction': 'TO_CUSTOMER', 'authorName': 'Aria', 'body': 'We are checking it', 'createdAt': '2026-10-30T11:00:00Z'},
              ],
            ),
          );
        }
        if (o.method == 'GET' && o.path == '/v1/support/tickets/TK-ZZZ999') return json(ticketJson('TK-ZZZ999', status: 'CLOSED', canReply: false));
        if (o.method == 'POST' && o.path == '/v1/support/tickets/TK-ABC234/messages') return json({'ok': true}, status: 201);
        return problem(404, 'NOT_FOUND');
      });
      final router = GoRouter(
        routes: [
          GoRoute(path: '/', builder: (_, _) => const TicketsScreen()),
          GoRoute(
            path: '/support/tickets/:ref',
            builder: (_, s) => TicketScreen(ticketRef: s.pathParameters['ref']!),
          ),
        ],
      );
      await tester.pumpWidget(await app(const SizedBox(), adapter: adapter, router: router));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('ticket-TK-ABC234')), findsOneWidget);
      expect(find.text(AppL10nEn().stStatusClosed), findsOneWidget);

      await tester.tap(find.byKey(const Key('ticket-TK-ABC234')));
      await tester.pumpAndSettle();
      expect(find.text('We are checking it'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('ticket-reply')), 'Thanks, any news?');
      await tester.pump();
      await tester.tap(find.byKey(const Key('ticket-send')));
      await tester.pumpAndSettle();
      final post = adapter.calls.singleWhere((c) => c.method == 'POST');
      expect((post.data as Map)['body'], 'Thanks, any news?');

      router.go('/support/tickets/TK-ZZZ999');
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('ticket-reply')), findsNothing);
      expect(find.byKey(const Key('ticket-closed')), findsOneWidget);
    });

    testWidgets('the support page links to writing to us and to my messages', (tester) async {
      await tester.pumpWidget(await app(const SupportScreen(), overrides: [siteConfigProvider.overrideWith((ref) async => SiteConfig.empty)]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('support-write')), findsOneWidget);
      expect(find.byKey(const Key('support-tickets')), findsOneWidget);
    });
  });

  group('billing', () {
    testWidgets('available to pay lists what the server sent; a quote leads to its request, an invoice to its payment page', (tester) async {
      tall(tester);
      final adapter = FakeAdapter((o) {
        switch (o.path) {
          case '/v1/billing/documents':
            return json({'quotations': <Object>[], 'invoices': <Object>[]});
          case '/v1/billing/purchasable':
            return json([
              {
                'kind': 'INVOICE',
                'action': 'PAY',
                'requestRef': 'UT-S-ABC123',
                'number': 'INV-2026-000007',
                'title': 'Hotel in Istanbul',
                'productType': 'SERVICE',
                'amount': money(10000),
                'dueAt': '2026-11-10T10:00:00Z',
              },
              {
                'kind': 'QUOTE',
                'action': 'ACCEPT',
                'requestRef': 'UT-S-DEF456',
                'number': 'QT-2026-000003',
                'title': 'Airport lounge',
                'productType': 'SERVICE',
                'amount': money(4500),
                'dueAt': '2026-11-12T10:00:00Z',
              },
            ]);
        }
        return problem(404, 'NOT_FOUND');
      });
      final router = GoRouter(
        routes: [
          GoRoute(path: '/', builder: (_, _) => const BillingScreen()),
          GoRoute(path: '/account/billing/:n/payment', builder: (_, s) => Text('PAYPAGE ${s.pathParameters['n']}')),
          GoRoute(path: '/services/:ref', builder: (_, s) => Text('SERVICE ${s.pathParameters['ref']}')),
        ],
      );
      await tester.pumpWidget(await app(const SizedBox(), adapter: adapter, router: router));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('purchasable')), findsOneWidget);
      expect(find.text('£100'), findsOneWidget);
      await tester.tap(find.byKey(const Key('purchasable-QT-2026-000003')));
      await tester.pumpAndSettle();
      expect(find.text('SERVICE UT-S-DEF456'), findsOneWidget);
      router.go('/');
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('purchasable-INV-2026-000007')));
      await tester.pumpAndSettle();
      expect(find.text('PAYPAGE INV-2026-000007'), findsOneWidget);
    });

    testWidgets('nothing available: no section at all', (tester) async {
      final adapter = FakeAdapter((o) => o.path == '/v1/billing/documents' ? json({'quotations': <Object>[], 'invoices': <Object>[]}) : json(<Object>[]));
      await tester.pumpWidget(await app(const BillingScreen(), adapter: adapter));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('purchasable')), findsNothing);
    });

    testWidgets('payment page with online payment: lines, total and the pay button; it never says booked', (tester) async {
      tall(tester);
      final adapter = FakeAdapter(
        (o) => o.path == '/v1/billing/invoices/INV-2026-000007/payment-page'
            ? json(pageJson('INV-2026-000007', offered: true, payUrl: 'https://site.test/en/billing/INV-2026-000007/pay'))
            : problem(404, 'NOT_FOUND'),
      );
      await tester.pumpWidget(await app(const PaymentPageScreen(number: 'INV-2026-000007'), adapter: adapter));
      await tester.pumpAndSettle();
      expect(find.text('Uni Travel Ltd'), findsOneWidget);
      expect(find.textContaining('Hotel night'), findsOneWidget);
      expect(find.byKey(const Key('pp-total')), findsOneWidget);
      expect(find.byKey(const Key('pp-pay-online')), findsOneWidget);
      expect(find.byKey(const Key('pp-offline')), findsNothing);
      expect(find.textContaining(RegExp('booked', caseSensitive: false)), findsNothing);
    });

    testWidgets('payment page without online payment: offline instructions from the server, no pay button', (tester) async {
      tall(tester);
      final adapter = FakeAdapter((o) => json(pageJson('INV-2026-000007', offline: 'Bank transfer to account 1234.')));
      await tester.pumpWidget(await app(const PaymentPageScreen(number: 'INV-2026-000007'), adapter: adapter));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pp-pay-online')), findsNothing);
      expect(find.text('Bank transfer to account 1234.'), findsOneWidget);
    });

    testWidgets('payment page: online flagged but no payUrl, or a paid invoice, shows no pay button', (tester) async {
      tall(tester);
      final adapter = FakeAdapter((o) => json(pageJson('INV-2026-000007', offered: true)));
      await tester.pumpWidget(await app(const PaymentPageScreen(number: 'INV-2026-000007'), adapter: adapter));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pp-pay-online')), findsNothing);
      expect(find.byKey(const Key('pp-offline')), findsOneWidget, reason: 'no server text: the honest "contact us" line');
    });

    testWidgets('payment page with nothing set offline says to contact us', (tester) async {
      tall(tester);
      final adapter = FakeAdapter((o) => json({...pageJson('INV-2026-000007', status: 'PAID'), 'paidAt': '2026-11-01T10:00:00Z'}));
      await tester.pumpWidget(await app(const PaymentPageScreen(number: 'INV-2026-000007'), adapter: adapter));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('pp-pay-online')), findsNothing);
      expect(find.byKey(const Key('pp-offline')), findsNothing);
      expect(find.byKey(const Key('pay-banner-paid')), findsOneWidget);
      expect(find.text(AppL10nEn().ppNotBooking), findsOneWidget);
    });
  });

  group('listings', () {
    Map<String, dynamic> curated(String id, {Map<String, dynamic>? price}) => {
      'id': id,
      'vertical': 'BUS',
      'title': {'en': 'Tehran to Isfahan', 'fa': 'تهران به اصفهان'},
      'summary': {'en': 'Daily VIP coach', 'fa': 'اتوبوس وی‌آی‌پی'},
      'fromPlace': 'Tehran',
      'toPlace': 'Isfahan',
      'operator': 'Seiro Safar',
      'label': 'INDICATIVE',
      'price': price,
      'validUntil': null,
      'updatedAt': '2026-10-30T10:00:00Z',
    };

    testWidgets('buses: indicative label and note, a price only where staff quoted one', (tester) async {
      tall(tester);
      final adapter = FakeAdapter(
        (o) => o.path == '/v1/listings/buses'
            ? json({
                'vertical': 'BUS',
                'items': [curated('a'), curated('b', price: money(2500))],
                'notice': 'INDICATIVE_ONLY',
              })
            : problem(404, 'NOT_FOUND'),
      );
      await tester.pumpWidget(await app(const ListingsScreen(kind: ListingKind.buses), adapter: adapter));
      await tester.pumpAndSettle();
      expect(find.text(AppL10nEn().lsIndicative), findsNWidgets(2));
      expect(find.text(AppL10nEn().lsIndicativeNote), findsOneWidget);
      expect(find.byKey(const Key('listing-price-a')), findsNothing);
      expect(find.byKey(const Key('listing-price-b')), findsOneWidget);
      expect(find.textContaining('£25'), findsOneWidget);
    });

    testWidgets('the destination filter is sent to the server', (tester) async {
      tall(tester);
      final adapter = FakeAdapter((o) => json({'vertical': 'BUS', 'items': <Object>[], 'notice': 'INDICATIVE_ONLY'}));
      await tester.pumpWidget(await app(const ListingsScreen(kind: ListingKind.buses), adapter: adapter));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('listings-filter')), 'Isfahan');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();
      expect(adapter.calls.last.queryParameters['to'], 'Isfahan');
    });

    testWidgets('flights: cached label with the fetch time, never an amount', (tester) async {
      tall(tester);
      final adapter = FakeAdapter(
        (o) => json({
          'items': [
            {
              'label': 'CACHED_OFFER',
              'fetchedAt': '2026-10-31T08:00:00Z',
              'origin': 'LHR',
              'destination': 'IKA',
              'departureDate': '2026-11-20',
              'carriers': ['TK'],
              'stops': 1,
              'durationMin': 540,
              'departureLocal': '2026-11-20T09:00',
              'arrivalLocal': '2026-11-20T20:00',
            },
          ],
          'notice': null,
        }),
      );
      await tester.pumpWidget(await app(const ListingsScreen(kind: ListingKind.flights), adapter: adapter));
      await tester.pumpAndSettle();
      expect(find.text(AppL10nEn().lsCached), findsOneWidget);
      expect(find.byKey(const Key('flight-fetched')), findsOneWidget);
      expect(find.text(AppL10nEn().lsFlightsNote), findsOneWidget);
      expect(find.textContaining(RegExp(r'[£$€]')), findsNothing);
      expect(find.text('LHR → IKA'), findsOneWidget);
    });

    testWidgets('flights with no source: empty state asks the team and links to support', (tester) async {
      tall(tester);
      final adapter = FakeAdapter((o) => json({'items': <Object>[], 'notice': 'NO_SOURCES'}));
      final router = GoRouter(
        routes: [
          GoRoute(
            path: '/',
            builder: (_, _) => const ListingsScreen(kind: ListingKind.flights),
          ),
          GoRoute(path: '/support/new', builder: (_, _) => const Text('SUPPORT FORM')),
        ],
      );
      await tester.pumpWidget(await app(const SizedBox(), adapter: adapter, router: router));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('listings-empty')), findsOneWidget);
      await tester.tap(find.byKey(const Key('listings-ask')));
      await tester.pumpAndSettle();
      expect(find.text('SUPPORT FORM'), findsOneWidget);
    });

    testWidgets('services tab: flights are always browsable, the others follow their switch', (tester) async {
      await tester.pumpWidget(
        await app(
          const ServicesScreen(),
          overrides: [
            siteConfigProvider.overrideWith((ref) async => const SiteConfig(menu: {'buses': true})),
          ],
        ),
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.byKey(const Key('listings-browse')), 300, scrollable: find.byType(Scrollable).first);
      expect(find.byKey(const Key('browse-flights')), findsOneWidget);
      expect(find.byKey(const Key('browse-buses')), findsOneWidget);
      expect(find.byKey(const Key('browse-trains')), findsNothing);
      expect(find.byKey(const Key('browse-stays')), findsNothing);
    });
  });

  group('admin customers', () {
    Map<String, dynamic> customer(String id, String name, {bool online = false, String? lastScreen, String? lastActiveAt}) => {
      'id': id,
      'displayName': name,
      'email': 's***@example.test',
      'phone': null,
      'verified': true,
      'status': 'ACTIVE',
      'createdAt': '2026-09-01T10:00:00Z',
      'lastActiveAt': lastActiveAt,
      'online': online,
      'lastScreen': lastScreen,
      'openRequests': 2,
      'signInCount': 5,
    };

    testWidgets('list shows the online dot state, last seen and last screen; search sends q', (tester) async {
      tall(tester);
      final adapter = FakeAdapter((o) {
        if (o.path == '/v1/admin/customers') {
          return json({
            'items': [
              customer('c1', 'Sara Online', online: true, lastScreen: 'billing', lastActiveAt: '2026-11-01T09:59:00Z'),
              customer('c2', 'Omid Away', lastActiveAt: '2026-10-20T09:00:00Z'),
              customer('c3', 'Nima New'),
            ],
            'nextCursor': null,
          });
        }
        return problem(404, 'NOT_FOUND');
      });
      await tester.pumpWidget(await app(const CustomersScreen(), adapter: adapter, staff: true));
      await tester.pumpAndSettle();
      final l = AppL10nEn();
      expect(find.byKey(const Key('customer-c1')), findsOneWidget);
      expect(tester.widgetList<OnlineDot>(find.byType(OnlineDot)).map((d) => d.online).toList(), [true, false, false]);
      expect(find.text(l.cuLastScreen(l.scrBilling)), findsOneWidget);
      expect(find.text(l.cuNeverSeen), findsOneWidget);
      await tester.enterText(find.byKey(const Key('customers-search')), 'sara');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();
      expect(adapter.calls.last.queryParameters['q'], 'sara');
    });

    testWidgets('detail shows the activity timeline with screen names, sessions and the tracking-off notice', (tester) async {
      tall(tester);
      final adapter = FakeAdapter((o) {
        if (o.path == '/v1/admin/customers/c1/activity') {
          return json({
            'customerId': 'c1',
            'retentionDays': 90,
            'trackingEnabled': false,
            'sessions': {'active': 1, 'total': 3, 'recent': <Object>[]},
            'activity': {
              'items': [
                {'id': 'a1', 'kind': 'SCREEN_VIEW', 'screen': 'pay', 'ref': 'INV-2026-000007', 'client': 'MOBILE', 'network': null, 'occurredAt': '2026-11-01T09:59:00Z'},
                {'id': 'a2', 'kind': 'SIGN_IN', 'screen': null, 'ref': null, 'client': 'MOBILE', 'network': null, 'occurredAt': '2026-11-01T09:50:00Z'},
              ],
              'nextCursor': null,
            },
          });
        }
        return problem(404, 'NOT_FOUND');
      });
      await tester.pumpWidget(await app(const CustomerDetailScreen(customerId: 'c1'), adapter: adapter, staff: true));
      await tester.pumpAndSettle();
      final l = AppL10nEn();
      expect(find.text(l.cuKindView('${l.scrPay} · INV-2026-000007')), findsOneWidget);
      expect(find.text(l.cuKindSignIn), findsOneWidget);
      expect(find.byKey(const Key('customer-sessions')), findsOneWidget);
      expect(find.byKey(const Key('customer-tracking-off')), findsOneWidget);
    });

    for (final (perms, shown) in [
      (['customer.read'], true),
      (<String>[], false),
    ]) {
      testWidgets('the admin home card is ${shown ? 'shown' : 'hidden'} with permissions $perms', (tester) async {
        tall(tester);
        staffPermissions = perms;
        addTearDown(() => staffPermissions = ['customer.read']);
        final adapter = FakeAdapter((o) {
          if (o.path == '/v1/admin/queues/summary') {
            return json({'new': 0, 'mine': 0, 'awaitingCustomer': 0, 'quoted': 0, 'reserved': 0, 'slaBreaches': 0, 'complianceHolds': 0, 'deadlinesNext24h': <Object>[]});
          }
          if (o.path == '/v1/admin/flight-requests') return json({'items': <Object>[], 'nextCursor': null});
          return problem(404, 'NOT_FOUND');
        });
        await tester.pumpWidget(await app(const AdminHomeScreen(), adapter: adapter, staff: true));
        await tester.pumpAndSettle();
        if (shown) {
          await tester.scrollUntilVisible(find.byKey(const Key('home-customers')), 300, scrollable: find.byType(Scrollable).first);
        }
        expect(find.byKey(const Key('home-customers')), shown ? findsOneWidget : findsNothing);
      });
    }
  });
}
