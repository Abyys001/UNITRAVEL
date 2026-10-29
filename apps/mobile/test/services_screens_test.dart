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
import 'package:unitravel_mobile/core/providers.dart';
import 'package:unitravel_mobile/core/repos.dart';
import 'package:unitravel_mobile/core/session.dart';
import 'package:unitravel_mobile/core/site.dart';
import 'package:unitravel_mobile/features/club/club_screen.dart';
import 'package:unitravel_mobile/features/services/service_detail_screen.dart';
import 'package:unitravel_mobile/features/services/service_explorer.dart';
import 'package:unitravel_mobile/features/services/service_form_screen.dart';
import 'package:unitravel_mobile/features/support/support_screen.dart';
import 'package:unitravel_mobile/features/track/track_screen.dart';
import 'package:unitravel_mobile/l10n/app_localizations.dart';
import 'package:unitravel_mobile/l10n/app_localizations_en.dart';
import 'package:unitravel_mobile/models/me.dart';
import 'package:unitravel_mobile/models/my_details.dart';
import 'package:unitravel_mobile/models/requests.dart';
import 'package:unitravel_mobile/models/services.dart';
import 'package:unitravel_mobile/ui/theme.dart';

import 'support/fake_api.dart';

class _SignedIn extends SessionNotifier {
  @override
  SessionState build() => SessionState(status: AuthStatus.signedIn, me: Me.fromJson(meJson()));
}

class _SignedOut extends SessionNotifier {
  @override
  SessionState build() => const SessionState(status: AuthStatus.signedOut);
}

SiteConfig site(Map<String, bool> menu, {String? phone, String? email}) => SiteConfig(menu: menu, phone: phone, email: email);

MyDetails details() => MyDetails.fromJson({
  'identities': [
    {'id': 'i1', 'type': 'PHONE', 'value': '+989120000001', 'verified': true},
  ],
});

Future<Widget> app(Widget home, {String lang = 'en', List<Override> overrides = const [], FakeAdapter? adapter, GoRouter? router, bool signedOut = false}) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = adapter ?? FakeAdapter((o) => problem(404, 'NOT_FOUND'));
  final scope = ProviderScope(
    overrides: [
      sharedPreferencesProvider.overrideWithValue(prefs),
      dioProvider.overrideWithValue(dio),
      sessionProvider.overrideWith(signedOut ? _SignedOut.new : _SignedIn.new),
      ...overrides,
    ],
    child: MaterialApp.router(
      theme: buildAppTheme(Locale(lang)),
      locale: Locale(lang),
      supportedLocales: AppL10n.supportedLocales,
      localizationsDelegates: AppL10n.localizationsDelegates,
      routerConfig: router ?? GoRouter(routes: [GoRoute(path: '/', builder: (_, _) => home)]),
    ),
  );
  return scope;
}

void tall(WidgetTester tester) {
  tester.view.physicalSize = const Size(900, 4000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fa');
  });

  group('service explorer', () {
    test('lists all 14 menu items; only live ones have a route', () {
      final items = explorerItems(AppL10nEn(), site({'hotels': true, 'visa': false, 'club': true, 'track': true, 'support': true, 'flights': true, 'cargo': true}));
      expect(items.length, 14);
      ExplorerItem by(String k) => items.firstWhere((i) => i.key == k);
      expect(by('hotels').state, Availability.requestOnly);
      expect(by('hotels').route, '/services/new/hotels');
      expect(by('visa').state, Availability.comingSoon);
      expect(by('visa').route, isNull, reason: 'a switched-off service never leads anywhere');
      expect(by('trains').state, Availability.comingSoon);
      expect(by('card').state, Availability.comingSoon);
      expect(by('card').route, isNull);
      expect(by('flights').state, Availability.available);
      expect(by('cargo').route, '/cargo');
      expect(by('club').state, Availability.available);
    });

    test('club follows its flag; a failed /v1/site call advertises no request service', () {
      final off = explorerItems(AppL10nEn(), site({'club': false}));
      expect(off.firstWhere((i) => i.key == 'club').state, Availability.comingSoon);
      final empty = explorerItems(AppL10nEn(), SiteConfig.empty);
      expect(empty.where((i) => i.state == Availability.requestOnly).map((i) => i.key), ['cargo']);
      expect(empty.firstWhere((i) => i.key == 'track').state, Availability.available);
    });

    for (final lang in ['en', 'fa']) {
      testWidgets('shows the availability words in $lang', (tester) async {
        await tester.pumpWidget(await app(const ServicesScreen(), lang: lang, overrides: [siteConfigProvider.overrideWith((ref) async => site({'hotels': true}))]));
        await tester.pumpAndSettle();
        final l = lang == 'en' ? AppL10nEn() : lookupAppL10n(const Locale('fa'));
        expect(find.text(l.stateRequestOnly), findsWidgets);
        expect(find.text(l.stateComingSoon), findsWidgets);
        expect(find.byKey(const Key('explorer-card')), findsOneWidget);
      });
    }
  });

  group('service request form', () {
    testWidgets('flag off shows the notice, never the form', (tester) async {
      await tester.pumpWidget(await app(const ServiceFormScreen(type: ServiceType.tour), overrides: [siteConfigProvider.overrideWith((ref) async => site({'tours': false}))]));
      await tester.pumpAndSettle();
      expect(find.text(AppL10nEn().svUnavailableTitle), findsOneWidget);
      expect(find.byKey(const Key('service-submit')), findsNothing);
    });

    testWidgets('submit stays disabled until the fields and both acknowledgements are set, then posts the website body', (tester) async {
      tall(tester);
      final adapter = FakeAdapter((o) {
        if (o.method == 'POST' && o.path == '/v1/service-requests') return json({'ref': 'UT-S-ABC123', 'status': 'SUBMITTED'}, status: 201);
        return problem(404, 'NOT_FOUND');
      });
      final router = GoRouter(routes: [
        GoRoute(path: '/', builder: (_, _) => const ServiceFormScreen(type: ServiceType.tour)),
        GoRoute(path: '/services/:ref', builder: (_, s) => Text('detail ${s.pathParameters['ref']}')),
      ]);
      await tester.pumpWidget(await app(const SizedBox(), adapter: adapter, router: router, overrides: [
        siteConfigProvider.overrideWith((ref) async => site({'tours': true})),
        myDetailsProvider.overrideWith((ref) async => details()),
      ]));
      await tester.pumpAndSettle();
      final submit = find.byKey(const Key('service-submit'));
      bool enabled() => tester.widget<FilledButton>(submit).onPressed != null;
      expect(enabled(), isFalse);

      final fields = find.byType(TextField);
      await tester.enterText(fields.at(0), 'Istanbul');
      await tester.enterText(fields.at(1), 'March');
      await tester.enterText(fields.at(2), '2');
      await tester.enterText(fields.at(3), 'Evenings');
      await tester.pump();
      expect(enabled(), isFalse, reason: 'acknowledgements missing');
      await tester.ensureVisible(find.byKey(const Key('ack-not-booking')));
      await tester.tap(find.byKey(const Key('ack-not-booking')));
      await tester.tap(find.byKey(const Key('ack-privacy')));
      await tester.pump();
      expect(enabled(), isTrue);

      await tester.tap(submit);
      await tester.pumpAndSettle();
      final post = adapter.calls.firstWhere((c) => c.method == 'POST');
      expect(post.headers['Idempotency-Key'], isNotNull);
      final body = post.data as Map<String, dynamic>;
      expect(body['type'], 'TOUR_CALLBACK');
      expect(body['contactIdentityId'], 'i1');
      expect(body['acknowledgements'], {'notABooking': true, 'privacy': true});
      expect(body['details'], {'destination': 'Istanbul', 'approxDates': 'March', 'travellersCount': 2, 'bestTimeToCall': 'Evenings'});
      expect(find.text('detail UT-S-ABC123'), findsOneWidget);
    });

    testWidgets('visa needs a traveller; without a verified phone the form cannot be sent', (tester) async {
      tall(tester);
      await tester.pumpWidget(await app(const ServiceFormScreen(type: ServiceType.visa), overrides: [
        siteConfigProvider.overrideWith((ref) async => site({'visa': true})),
        myDetailsProvider.overrideWith((ref) async => MyDetails.fromJson({'identities': <Object>[]})),
        travellersProvider.overrideWith((ref) async => <Traveller>[]),
      ]));
      await tester.pumpAndSettle();
      expect(find.text(AppL10nEn().svNoTravellers), findsOneWidget);
      await tester.ensureVisible(find.text(AppL10nEn().svNoPhone));
      expect(find.text(AppL10nEn().svNoPhone), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byKey(const Key('service-submit'))).onPressed, isNull);
    });
  });

  group('service request detail', () {
    Map<String, dynamic> detail({Map<String, dynamic>? quote, bool accept = false, String status = 'QUOTED'}) => {
      'ref': 'UT-S-ABC123',
      'type': 'VISA',
      'status': status,
      'title': 'Visa',
      'createdAt': '2026-10-29T10:00:00.000Z',
      'updatedAt': '2026-10-29T11:00:00.000Z',
      'details': {'destinationCountry': 'GB', 'purpose': 'TOURISM', 'intendedTravelDate': '2026-12-01', 'travellerIds': ['t1']},
      'timeline': [
        {'at': '2026-10-29T10:00:00.000Z', 'kind': 'STATUS', 'label': 'Received'},
      ],
      'messages': [
        {'id': 'm1', 'direction': 'TO_CUSTOMER', 'body': 'We need your passport scan', 'authorName': 'Sara', 'createdAt': '2026-10-29T10:30:00.000Z'},
      ],
      'quote': quote,
      'canCancel': true,
      'canAcceptQuote': accept,
    };

    final quote = {
      'status': 'SENT',
      'lines': [
        {'kind': 'SERVICE_FEE', 'label': 'Visa help', 'amount': {'amountMinor': 6000, 'currency': 'GBP'}},
        {'kind': 'CLUB_DISCOUNT', 'label': '', 'amount': {'amountMinor': 1500, 'currency': 'GBP'}},
      ],
      'total': {'amountMinor': 4500, 'currency': 'GBP'},
      'validUntil': '2026-11-20T10:00:00.000Z',
      'note': null,
    };

    testWidgets('shows details, the sent quote with its discount line, messages; accept posts', (tester) async {
      tall(tester);
      final adapter = FakeAdapter((o) {
        if (o.path == '/v1/service-requests/UT-S-ABC123/quote/accept') return json(detail(quote: {...quote, 'status': 'ACCEPTED'}, status: 'CONFIRMED'));
        if (o.path == '/v1/service-requests/UT-S-ABC123') return json(detail(quote: quote, accept: true));
        return problem(404, 'NOT_FOUND');
      });
      await tester.pumpWidget(await app(const ServiceDetailScreen(requestRef: 'UT-S-ABC123'), adapter: adapter));
      await tester.pumpAndSettle();
      final l = AppL10nEn();
      expect(find.text(l.svStatusQuoted), findsOneWidget);
      expect(find.text('GB'), findsOneWidget);
      expect(find.text(l.svPurposeTourism), findsOneWidget);
      expect(find.textContaining('Customer club discount'), findsOneWidget);
      expect(find.textContaining('−'), findsWidgets);
      expect(find.text('We need your passport scan'), findsOneWidget);
      expect(find.textContaining('t1'), findsNothing, reason: 'traveller ids are not shown');
      await tester.ensureVisible(find.byKey(const Key('quote-accept')));
      await tester.tap(find.byKey(const Key('quote-accept')));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, l.svAccept).last);
      await tester.pumpAndSettle();
      expect(adapter.count('POST', '/v1/service-requests/UT-S-ABC123/quote/accept'), 1);
    });

    testWidgets('no accept button unless the API says it can be accepted; a missing request reads as not found', (tester) async {
      tall(tester);
      await tester.pumpWidget(await app(const ServiceDetailScreen(requestRef: 'UT-S-ABC123'), adapter: FakeAdapter((o) => json(detail(quote: quote)))));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('quote-accept')), findsNothing);

      await tester.pumpWidget(await app(const ServiceDetailScreen(requestRef: 'UT-S-NOPE00'), adapter: FakeAdapter((o) => problem(404, 'NOT_FOUND'))));
      await tester.pumpAndSettle();
      expect(find.text(AppL10nEn().svNotFound), findsOneWidget);
    });
  });

  group('tracking', () {
    testWidgets('signed in: one list across flights, cargo, services and invoices, filterable, rows open their record', (tester) async {
      final items = [
        {'kind': 'FLIGHT', 'ref': 'UT-F-AAAAAA', 'status': 'QUOTED', 'statusLabel': 'Quote ready', 'title': 'IKA → LHR', 'serviceType': null, 'updatedAt': '2026-10-29T10:00:00.000Z'},
        {'kind': 'SERVICE', 'ref': 'UT-S-BBBBBB', 'status': 'IN_PROGRESS', 'statusLabel': 'Being handled', 'title': 'Visa', 'serviceType': 'VISA', 'updatedAt': '2026-10-28T10:00:00.000Z'},
      ];
      final router = GoRouter(routes: [
        GoRoute(path: '/', builder: (_, _) => const TrackScreen()),
        GoRoute(path: '/services/:ref', builder: (_, s) => Text('service ${s.pathParameters['ref']}')),
        GoRoute(path: '/requests/:ref', builder: (_, s) => Text('request ${s.pathParameters['ref']}')),
      ]);
      await tester.pumpWidget(await app(const SizedBox(), router: router, overrides: [trackProvider.overrideWith((ref) async => Cached(items.map(TrackItem.fromJson).toList()))]));
      await tester.pumpAndSettle();
      expect(find.text('IKA → LHR'), findsOneWidget);
      expect(find.text('Quote ready'), findsOneWidget);
      await tester.tap(find.byKey(const Key('track-kind-SERVICE')));
      await tester.pump();
      expect(find.text('IKA → LHR'), findsNothing);
      await tester.tap(find.text('UT-S-BBBBBB'));
      await tester.pumpAndSettle();
      expect(find.text('service UT-S-BBBBBB'), findsOneWidget);
    });

    testWidgets('signed out: reference + phone, a code, then only the status timeline', (tester) async {
      final adapter = FakeAdapter((o) {
        if (o.path == '/v1/track/lookup') return json({'accepted': true}, status: 202);
        if (o.path == '/v1/track/verify') {
          return json({'ref': 'UT-S-BBBBBB', 'kind': 'SERVICE', 'serviceType': 'VISA', 'status': 'IN_PROGRESS', 'timeline': [{'at': '2026-10-28T10:00:00.000Z', 'status': 'SUBMITTED'}, {'at': '2026-10-29T10:00:00.000Z', 'status': 'IN_PROGRESS'}]});
        }
        return problem(404, 'NOT_FOUND');
      });
      await tester.pumpWidget(await app(const TrackScreen(), adapter: adapter, signedOut: true));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('track-lookup')), findsOneWidget);
      expect(tester.widget<FilledButton>(find.byKey(const Key('track-submit'))).onPressed, isNull);
      await tester.enterText(find.byKey(const Key('track-ref')), 'ut-s-bbbbbb');
      await tester.enterText(find.byKey(const Key('track-phone')), '+989120000001');
      await tester.pump();
      await tester.tap(find.byKey(const Key('track-submit')));
      await tester.pumpAndSettle();
      final lookup = adapter.calls.firstWhere((c) => c.path == '/v1/track/lookup');
      expect((lookup.data as Map)['ref'], 'UT-S-BBBBBB');
      expect(find.text(AppL10nEn().tkSent), findsOneWidget, reason: 'same words whether or not the pair matched');
      await tester.enterText(find.byKey(const Key('track-code')), '123456');
      await tester.pump();
      await tester.tap(find.byKey(const Key('track-submit')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('track-result')), findsOneWidget);
      expect(find.text('Being handled'), findsOneWidget);
      expect(find.text('Received'), findsOneWidget);
    });

    testWidgets('a proof-of-work challenge is solved and the lookup retried', (tester) async {
      const salt = 'salt-', number = 3;
      final target = sha256.convert(utf8.encode('$salt$number')).toString();
      var first = true;
      final adapter = FakeAdapter((o) {
        if (o.path == '/v1/track/lookup') {
          if (first) {
            first = false;
            return problem(428, 'CHALLENGE_REQUIRED', extra: {'challenge': {'algorithm': 'SHA-256', 'challenge': target, 'maxnumber': 10, 'salt': salt, 'signature': 'sig'}});
          }
          return json({'accepted': true}, status: 202);
        }
        return problem(404, 'NOT_FOUND');
      });
      await tester.pumpWidget(await app(const TrackScreen(), adapter: adapter, signedOut: true));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('track-ref')), 'UT-S-BBBBBB');
      await tester.enterText(find.byKey(const Key('track-phone')), '+989120000001');
      await tester.pump();
      await tester.runAsync(() async {
        await tester.tap(find.byKey(const Key('track-submit')));
        await Future<void>.delayed(const Duration(milliseconds: 600));
      });
      await tester.pumpAndSettle();
      final lookups = adapter.calls.where((c) => c.path == '/v1/track/lookup').toList();
      expect(lookups.length, 2);
      expect((lookups.last.data as Map)['challenge'], isA<String>());
      expect(find.byKey(const Key('track-code')), findsOneWidget);
    });
  });

  group('customer club', () {
    ClubView view(Map<String, dynamic> j) => ClubView.fromJson(j);

    testWidgets('switched off: an honest notice', (tester) async {
      await tester.pumpWidget(await app(const ClubScreen(), overrides: [clubProvider.overrideWith((ref) async => view({'enabled': false, 'member': null, 'benefits': <Object>[], 'creditBalance': <Object>[]}))]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('club-notice')), findsOneWidget);
      expect(find.byKey(const Key('club-member')), findsNothing);
    });

    testWidgets('not a member: an invitation, no points and no sign-up button', (tester) async {
      await tester.pumpWidget(await app(const ClubScreen(), overrides: [clubProvider.overrideWith((ref) async => view({'enabled': true, 'member': null, 'benefits': <Object>[], 'creditBalance': <Object>[]}))]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('club-not-member')), findsOneWidget);
      expect(find.byType(FilledButton), findsNothing);
    });

    testWidgets('member: tier, benefits and credit with the no-cash-value note, in Persian', (tester) async {
      final j = {
        'enabled': true,
        'member': {'tier': {'code': 'GOLD', 'nameEn': 'Gold', 'nameFa': 'طلایی'}, 'status': 'ACTIVE', 'joinedAt': '2026-09-01T10:00:00.000Z'},
        'benefits': [
          {'id': 'b1', 'kind': 'DISCOUNT_PERCENT', 'value': 10, 'currency': null, 'appliesTo': 'SERVICE', 'description': {'en': 'Ten percent', 'fa': 'ده درصد'}, 'validFrom': '2026-10-01T00:00:00.000Z', 'validTo': '2027-01-01T00:00:00.000Z'},
        ],
        'creditBalance': [
          {'amountMinor': 2500, 'currency': 'GBP'},
        ],
      };
      await tester.pumpWidget(await app(const ClubScreen(), lang: 'fa', overrides: [clubProvider.overrideWith((ref) async => view(j))]));
      await tester.pumpAndSettle();
      expect(find.text('طلایی'), findsOneWidget);
      expect(find.text('ده درصد'), findsOneWidget);
      expect(find.text(lookupAppL10n(const Locale('fa')).clCreditNote), findsOneWidget);
    });
  });

  group('support', () {
    testWidgets('shows only contacts the owner has set; never hours or a 24-hour claim', (tester) async {
      await tester.pumpWidget(await app(const SupportScreen(), overrides: [siteConfigProvider.overrideWith((ref) async => site({}, phone: '+44 20 0000 0000'))]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('support-phone')), findsOneWidget);
      expect(find.byKey(const Key('support-email')), findsNothing);
      expect(find.textContaining(AppL10nEn().spHours), findsNothing);
      expect(find.textContaining('24'), findsNothing);
    });

    testWidgets('no contacts yet: says so instead of showing placeholders', (tester) async {
      await tester.pumpWidget(await app(const SupportScreen(), overrides: [siteConfigProvider.overrideWith((ref) async => site({}))]));
      await tester.pumpAndSettle();
      expect(find.text(AppL10nEn().spSoon), findsOneWidget);
      expect(find.byKey(const Key('support-phone')), findsNothing);
    });
  });
}
