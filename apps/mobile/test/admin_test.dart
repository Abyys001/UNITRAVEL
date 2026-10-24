import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:unitravel_mobile/app.dart';
import 'package:unitravel_mobile/core/api_error.dart';
import 'package:unitravel_mobile/core/providers.dart';
import 'package:unitravel_mobile/core/session.dart';
import 'package:unitravel_mobile/core/token_store.dart';
import 'package:unitravel_mobile/features/admin/admin_providers.dart';
import 'package:unitravel_mobile/features/admin/case_screen.dart';
import 'package:unitravel_mobile/features/admin/home_screen.dart';
import 'package:unitravel_mobile/features/admin/queue_screen.dart';
import 'package:unitravel_mobile/features/admin/sla.dart';
import 'package:unitravel_mobile/l10n/app_localizations.dart';
import 'package:unitravel_mobile/models/admin.dart';
import 'package:unitravel_mobile/models/me.dart';
import 'package:unitravel_mobile/ui/theme.dart';

import 'support/fake_api.dart';

final _now = DateTime.utc(2026, 10, 24, 12);

class _AdminSession extends SessionNotifier {
  @override
  SessionState build() {
    final j = meJson(admin: true)..['permissions'] = ['identity.verify'];
    return SessionState(status: AuthStatus.signedIn, me: Me.fromJson(j));
  }
}

AdminListItem _item(String ref, {String status = 'NEW', DateTime? due, bool urgent = false, String? assignee, bool breached = false}) => AdminListItem(
  ref: ref,
  status: status,
  routeLabel: 'LON → IKA',
  customer: 'Sara Test',
  travellers: 1,
  firstTravelDate: '2026-11-02',
  urgent: urgent,
  slaDueAt: due,
  slaBreached: breached,
  assignee: assignee,
);

const _summary = QueueSummary(newCount: 3, mine: 1, awaiting: 2, quoted: 4, reserved: 5, slaBreaches: 2, complianceHolds: 1);

Future<void> _pump(
  WidgetTester tester,
  Widget screen, {
  required List<Override> overrides,
  Locale locale = const Locale('en'),
  Brightness brightness = Brightness.light,
}) async {
  SharedPreferences.setMockInitialValues({});
  final prefs = await SharedPreferences.getInstance();
  tester.view.physicalSize = const Size(390 * 3, 1700 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  final router = GoRouter(
    routes: [
      GoRoute(path: '/', builder: (_, _) => screen),
      GoRoute(
        path: '/admin/queue',
        builder: (_, _) => const Scaffold(body: Text('QUEUE ROUTE')),
      ),
      GoRoute(
        path: '/admin/case/:ref',
        builder: (_, s) => Scaffold(body: Text('CASE ${s.pathParameters['ref']}')),
      ),
      GoRoute(
        path: '/admin/search',
        builder: (_, _) => const Scaffold(body: Text('SEARCH ROUTE')),
      ),
    ],
  );
  await tester.pumpWidget(
    ProviderScope(
      retry: (_, _) => null,
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        sessionProvider.overrideWith(_AdminSession.new),
        nowProvider.overrideWith((ref) => Stream.value(_now)),
        pendingVerificationsProvider.overrideWith((ref) async => 3),
        openComplianceCasesProvider.overrideWith((ref) async => null),
        ...overrides,
      ],
      child: MaterialApp.router(
        routerConfig: router,
        locale: locale,
        supportedLocales: AppL10n.supportedLocales,
        localizationsDelegates: const [
          AppL10n.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        theme: buildAppTheme(locale),
        darkTheme: buildAppTheme(locale, brightness: Brightness.dark),
        themeMode: brightness == Brightness.dark ? ThemeMode.dark : ThemeMode.light,
      ),
    ),
  );
}

void main() {
  group('SLA rules', () {
    test('only NEW / SUBMITTED carry an SLA; risk window is 2 h', () {
      expect(slaLevel(status: 'NEW', due: _now.add(const Duration(hours: 5)), now: _now), SlaLevel.ok);
      expect(slaLevel(status: 'NEW', due: _now.add(const Duration(minutes: 90)), now: _now), SlaLevel.risk);
      expect(slaLevel(status: 'SUBMITTED', due: _now.subtract(const Duration(minutes: 1)), now: _now), SlaLevel.breached);
      expect(slaLevel(status: 'QUOTED', due: _now.subtract(const Duration(hours: 9)), now: _now), SlaLevel.none);
      expect(slaLevel(status: 'NEW', due: null, now: _now), SlaLevel.none);
    });

    test('durations keep the two largest units', () {
      expect(durationParts(const Duration(hours: 2, minutes: 15)), [(2, 'h'), (15, 'm')]);
      expect(durationParts(const Duration(days: 1, hours: 3, minutes: 5)), [(1, 'd'), (3, 'h')]);
      expect(durationParts(const Duration(seconds: 20)), [(0, 'm')]);
    });
  });

  group('tri-state truth', () {
    Map<String, dynamic> bag(Object? checked) => {'segmentIndex': 0, 'checked': checked};
    test('UNKNOWN, missing or partial baggage stays UNKNOWN, never known', () {
      expect(TriFact.baggage([]).state, Tri.unknown);
      expect(
        TriFact.baggage([
          bag({'status': 'UNKNOWN'}),
        ]).state,
        Tri.unknown,
      );
      expect(
        TriFact.baggage([
          bag({'status': 'KNOWN', 'value': <String, dynamic>{}}),
        ]).state,
        Tri.unknown,
      );
      expect(
        TriFact.baggage([
          bag({
            'status': 'KNOWN',
            'value': {'pieces': 1},
          }),
          bag({'status': 'UNKNOWN'}),
        ]).state,
        Tri.unknown,
      );
    });

    test('zero pieces is NOT INCLUDED, pieces is KNOWN, differing segments are flagged', () {
      expect(
        TriFact.baggage([
          bag({
            'status': 'KNOWN',
            'value': {'pieces': 0},
          }),
        ]).state,
        Tri.notIncluded,
      );
      final one = TriFact.baggage([
        bag({
          'status': 'KNOWN',
          'value': {'pieces': 1, 'kgPerPiece': 23},
        }),
      ]);
      expect((one.state, one.pieces, one.kg), (Tri.known, 1, 23));
      expect(
        TriFact.baggage([
          bag({
            'status': 'KNOWN',
            'value': {'pieces': 1},
          }),
          bag({
            'status': 'KNOWN',
            'value': {'pieces': 2},
          }),
        ]).varies,
        isTrue,
      );
    });

    test('change / refund: any UNKNOWN ticket makes it UNKNOWN', () {
      Map<String, dynamic> offer(Object change) => {
        'conditions': {'change': change},
      };
      expect(
        TriFact.condition([
          offer({
            'status': 'KNOWN',
            'value': {'allowed': true},
          }),
        ], 'change').state,
        Tri.known,
      );
      expect(
        TriFact.condition([
          offer({
            'status': 'KNOWN',
            'value': {'allowed': false},
          }),
        ], 'change').state,
        Tri.notIncluded,
      );
      expect(
        TriFact.condition([
          offer({
            'status': 'KNOWN',
            'value': {'allowed': true},
          }),
          offer({'status': 'UNKNOWN'}),
        ], 'change').state,
        Tri.unknown,
      );
      expect(TriFact.condition([<String, dynamic>{}], 'change').state, Tri.unknown);
    });

    test('a case with no baggage or condition facts, with or without a snapshot, blocks quoting', () {
      expect(
        CaseTruth.fromJson({
          'snapshot': {'itinerary': <String, dynamic>{}},
        }).hasUnknown,
        isTrue,
      );
      expect(CaseTruth.fromJson(<String, dynamic>{}).hasUnknown, isTrue);
    });
  });

  group('trend history', () {
    test('records changes, skips duplicates inside the gap, caps the length, and survives a restart', () async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      final container = ProviderContainer(overrides: [sharedPreferencesProvider.overrideWithValue(prefs), sessionProvider.overrideWith(_AdminSession.new)]);
      addTearDown(container.dispose);
      final h = container.read(summaryHistoryProvider.notifier);
      h.record(_summary, now: _now);
      h.record(_summary, now: _now.add(const Duration(minutes: 1)));
      expect(container.read(summaryHistoryProvider), hasLength(1));
      h.record(_summary, now: _now.add(const Duration(minutes: 3)));
      expect(container.read(summaryHistoryProvider), hasLength(2), reason: 'same values but past the gap');
      h.record(const QueueSummary(newCount: 9, mine: 1, awaiting: 2, quoted: 4, reserved: 5, slaBreaches: 2), now: _now.add(const Duration(minutes: 4)));
      expect(container.read(summaryHistoryProvider).last.values.first, 9);
      for (var i = 0; i < 40; i++) {
        h.record(
          QueueSummary(newCount: i, mine: 0, awaiting: 0, quoted: 0, reserved: 0, slaBreaches: 0),
          now: _now.add(Duration(hours: i + 1)),
        );
      }
      expect(container.read(summaryHistoryProvider), hasLength(SummaryHistory.maxSamples));

      final again = ProviderContainer(overrides: [sharedPreferencesProvider.overrideWithValue(prefs), sessionProvider.overrideWith(_AdminSession.new)]);
      addTearDown(again.dispose);
      expect(again.read(summaryHistoryProvider), hasLength(SummaryHistory.maxSamples));
    });
  });

  group('Home', () {
    testWidgets('bento shows the hero signals, KPI tiles and permission-gated counters', (tester) async {
      await _pump(
        tester,
        const AdminHomeScreen(),
        overrides: [
          queueSummaryProvider.overrideWith(
            (ref) async => QueueSummary(
              newCount: 3,
              mine: 1,
              awaiting: 2,
              quoted: 4,
              reserved: 5,
              slaBreaches: 2,
              complianceHolds: 1,
              deadlines: [TicketingDeadline('UT-F-ABC234', _now.add(const Duration(hours: 3)))],
            ),
          ),
          adminCasesProvider.overrideWith((ref, tab) async => [_item('UT-F-AAA111', due: _now.subtract(const Duration(minutes: 30)))]),
        ],
      );
      await tester.pumpAndSettle();
      expect(find.text('Control deck'), findsOneWidget);
      expect(find.text('Needs you now'), findsOneWidget);
      expect(find.text('2 cases are past their SLA'), findsOneWidget);
      expect(find.text('3 new cases are unclaimed'), findsOneWidget);
      expect(find.text('1 ticketing deadline within 24 h'), findsOneWidget);
      expect(find.text('Overdue by 30m'), findsOneWidget);
      expect(find.text('ID checks waiting'), findsOneWidget);
      expect(find.text('Open compliance cases'), findsNothing, reason: 'no compliance.case.read: tile hidden, not zero');
      expect(find.text('Compliance holds'), findsOneWidget);
      expect(find.textContaining('since'), findsNothing, reason: 'one sample is not a trend');
      expect(find.bySemanticsLabel(RegExp('Trend builds up')), findsWidgets);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('a trend line appears once the device has seen two summaries', (tester) async {
      await _pump(
        tester,
        const AdminHomeScreen(),
        overrides: [
          queueSummaryProvider.overrideWith((ref) async => _summary),
          adminCasesProvider.overrideWith((ref, tab) async => const []),
          summaryHistoryProvider.overrideWith(() => _SeededHistory()),
        ],
      );
      await tester.pumpAndSettle();
      expect(find.textContaining('Rising since'), findsWidgets);
      expect(find.byType(CustomPaint), findsWidgets);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('all clear state when nothing needs the user', (tester) async {
      await _pump(
        tester,
        const AdminHomeScreen(),
        overrides: [
          queueSummaryProvider.overrideWith((ref) async => const QueueSummary(newCount: 0, mine: 0, awaiting: 0, quoted: 0, reserved: 0, slaBreaches: 0)),
          adminCasesProvider.overrideWith((ref, tab) async => const []),
        ],
      );
      await tester.pumpAndSettle();
      expect(find.text('All clear'), findsOneWidget);
      expect(find.text('No open cases right now.'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('skeleton while loading, error with retry afterwards', (tester) async {
      final gate = Completer<QueueSummary>();
      var calls = 0;
      await _pump(
        tester,
        const AdminHomeScreen(),
        overrides: [
          queueSummaryProvider.overrideWith((ref) {
            calls++;
            return calls == 1 ? gate.future : Future.value(_summary);
          }),
          adminCasesProvider.overrideWith((ref, tab) async => const []),
        ],
      );
      await tester.pump();
      expect(find.bySemanticsLabel('Loading…'), findsWidgets);
      gate.completeError(const ApiException(status: 500, code: 'INTERNAL', title: 'x'));
      await tester.pumpAndSettle();
      expect(find.text('Retry'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      await tester.pumpAndSettle();
      expect(find.text('Needs you now'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('Persian renders RTL with Persian strings and digits; dark mode uses the ink background', (tester) async {
      await _pump(
        tester,
        const AdminHomeScreen(),
        locale: const Locale('fa'),
        brightness: Brightness.dark,
        overrides: [queueSummaryProvider.overrideWith((ref) async => _summary), adminCasesProvider.overrideWith((ref, tab) async => const [])],
      );
      await tester.pumpAndSettle();
      expect(find.text('پیشخوان'), findsOneWidget);
      expect(find.text('نیاز به اقدام شما'), findsOneWidget);
      expect(Directionality.of(tester.element(find.text('پیشخوان'))), TextDirection.rtl);
      expect(find.textContaining('۲'), findsWidgets);
      expect(Theme.of(tester.element(find.text('پیشخوان'))).scaffoldBackgroundColor, Brand.ink);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('tapping the unclaimed-cases quick action goes to the queue', (tester) async {
      await _pump(
        tester,
        const AdminHomeScreen(),
        overrides: [queueSummaryProvider.overrideWith((ref) async => _summary), adminCasesProvider.overrideWith((ref, tab) async => const [])],
      );
      await tester.pumpAndSettle();
      await tester.scrollUntilVisible(find.text('Unclaimed cases'), 200, scrollable: find.byType(Scrollable).first);
      await tester.tap(find.text('Unclaimed cases'));
      await tester.pumpAndSettle();
      expect(find.text('QUEUE ROUTE'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });
  });

  group('Queue', () {
    final items = [
      _item('UT-F-AAA111', due: _now.subtract(const Duration(hours: 1, minutes: 30)), urgent: true, breached: true),
      _item('UT-F-BBB222', due: _now.add(const Duration(hours: 1))),
      _item('UT-F-CCC333', due: _now.add(const Duration(hours: 20)), assignee: 'Dana'),
    ];

    List<Override> base(Future<List<AdminListItem>> Function() load) => [
      queueSummaryProvider.overrideWith((ref) async => _summary),
      adminCasesProvider.overrideWith((ref, tab) => load()),
    ];

    testWidgets('lists cases with live SLA countdown chips and tab counts', (tester) async {
      await _pump(tester, const QueueScreen(), overrides: base(() async => items));
      await tester.pumpAndSettle();
      expect(find.text('Overdue by 1h 30m'), findsOneWidget);
      expect(find.text('1h left'), findsOneWidget);
      expect(find.text('20h left'), findsOneWidget);
      expect(find.text('3 cases'), findsOneWidget);
      expect(find.text('New 3'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('filter chips narrow the list and can be cleared', (tester) async {
      await _pump(tester, const QueueScreen(), overrides: base(() async => items));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilterChip, 'Urgent'));
      await tester.pumpAndSettle();
      expect(find.text('UT-F-AAA111'), findsOneWidget);
      expect(find.text('UT-F-BBB222'), findsNothing);
      expect(find.text('Showing 1 of 3'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilterChip, 'Urgent'));
      await tester.tap(find.widgetWithText(FilterChip, 'SLA at risk'));
      await tester.pumpAndSettle();
      expect(find.text('UT-F-BBB222'), findsOneWidget, reason: '1 h left is inside the 2 h risk window');
      expect(find.text('UT-F-CCC333'), findsNothing);
      await tester.enterText(find.byType(TextField), 'zzz');
      await tester.pumpAndSettle();
      expect(find.text('No case matches these filters'), findsOneWidget);
      await tester.tap(find.text('Clear filters'));
      await tester.pumpAndSettle();
      expect(find.text('3 cases'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('empty queue, loading skeleton and error each have a state', (tester) async {
      await _pump(tester, const QueueScreen(), overrides: base(() async => const []));
      await tester.pumpAndSettle();
      expect(find.text('Nothing in this queue'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());

      final gate = Completer<List<AdminListItem>>();
      await _pump(tester, const QueueScreen(), overrides: base(() => gate.future));
      await tester.pump();
      expect(find.bySemanticsLabel('Loading…'), findsWidgets);
      gate.completeError(const ApiException(status: 500, code: 'INTERNAL', title: 'x'));
      await tester.pumpAndSettle();
      expect(find.text('Retry'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('swipe-to-claim exists only on unassigned rows of the New tab', (tester) async {
      await _pump(tester, const QueueScreen(), overrides: base(() async => items));
      await tester.pumpAndSettle();
      expect(find.byType(Dismissible), findsNWidgets(2), reason: 'the assigned row has no claim action');
      await tester.pumpWidget(const SizedBox());
    });
  });

  group('Case', () {
    Map<String, dynamic> caseJson({
      Object? snapshot,
      List<Map<String, dynamic>> actions = const [
        {'command': 'claim', 'allowed': true},
      ],
      String payment = 'NONE',
    }) => {
      'ref': 'UT-F-AAA111',
      'version': 3,
      'status': 'NEW',
      'statusLabel': 'New',
      'paymentStatus': payment,
      'routeLabel': 'LON → IKA',
      'firstTravelDate': '2026-11-02',
      'urgent': true,
      'customer': {'nameLatin': 'Sara Test', 'displayName': 'Sara', 'phone': '+98•••34'},
      'assignee': null,
      'sla': {'dueAt': _now.subtract(const Duration(hours: 2)).toIso8601String()},
      'customerNote': 'Window seat please',
      'query': {
        'passengers': [
          {'type': 'ADT'},
        ],
      },
      'timeline': [
        {'at': '2026-10-24T09:00:00Z', 'kind': 'STATUS', 'label': 'New · submit'},
        {'at': '2026-10-24T10:00:00Z', 'kind': 'CONTACT', 'label': 'Call: NO_ANSWER'},
      ],
      'messages': [
        {'direction': 'FROM_CUSTOMER', 'body': 'Is my booking confirmed?', 'authorName': 'Sara', 'createdAt': '2026-10-24T09:30:00Z'},
      ],
      'notes': [
        {'body': 'Check baggage', 'author': 'Dana', 'createdAt': '2026-10-24T09:45:00Z'},
      ],
      'snapshot': snapshot,
      'quotes': <Object>[],
      'reservations': <Object>[],
      'tickets': <Object>[],
      'actions': actions,
      'kind': 'FLIGHT',
    };

    Future<void> pumpCase(WidgetTester tester, Map<String, dynamic> j, {Locale locale = const Locale('en')}) => _pump(
      tester,
      const CaseScreen(requestRef: 'UT-F-AAA111'),
      locale: locale,
      overrides: [adminCaseProvider.overrideWith((ref, id) async => AdminCase.fromJson(j))],
    );

    testWidgets('sticky action bar, SLA chip, truth ladder with UNKNOWN never shown as known, merged activity', (tester) async {
      await pumpCase(
        tester,
        caseJson(
          snapshot: {
            'itinerary': {'components': <Object>[]},
          },
          payment: 'PAID',
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Claim'), findsOneWidget);
      expect(find.byTooltip('More actions'), findsOneWidget);
      expect(find.text('Overdue by 2h'), findsOneWidget);
      expect(find.text('UNKNOWN'), findsWidgets);
      expect(find.text('Known'), findsNothing, reason: 'no baggage / condition facts were supplied');
      expect(find.text('UNKNOWN items must be confirmed before a quote can be sent.'), findsOneWidget);
      expect(find.text('Paid'), findsOneWidget);
      expect(find.text('Payment, reservation and ticket are separate facts. A payment never means a booking.'), findsOneWidget);
      expect(find.text('Is my booking confirmed?'), findsOneWidget);
      expect(find.text('Check baggage'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('sections collapse and expand', (tester) async {
      await pumpCase(tester, caseJson(snapshot: null));
      await tester.pumpAndSettle();
      expect(find.text('Window seat please'), findsOneWidget);
      await tester.tap(find.text('Customer'));
      await tester.pumpAndSettle();
      expect(find.text('Window seat please'), findsNothing);
      await tester.tap(find.text('Customer'));
      await tester.pumpAndSettle();
      expect(find.text('Window seat please'), findsOneWidget);
      await tester.pumpWidget(const SizedBox());
    });

    testWidgets('without a claim command the primary action is messaging; Persian renders RTL', (tester) async {
      await pumpCase(tester, caseJson(snapshot: null, actions: const []), locale: const Locale('fa'));
      await tester.pumpAndSettle();
      expect(find.text('پیام به مشتری'), findsOneWidget);
      expect(find.text('برداشتن پرونده'), findsNothing);
      expect(find.text('آنچه می‌دانیم'), findsOneWidget);
      expect(Directionality.of(tester.element(find.text('آنچه می‌دانیم'))), TextDirection.rtl);
      await tester.pumpWidget(const SizedBox());
    });
  });

  group('App shell', () {
    testWidgets('admin lands on Home with five tabs, badges, and the theme toggle persists dark mode', (tester) async {
      SharedPreferences.setMockInitialValues({});
      final prefs = await SharedPreferences.getInstance();
      // Wider than the smallest phone: the existing splash logo (72dp mark) overflows by ~9dp at 390dp.
      tester.view.physicalSize = const Size(430 * 3, 932 * 3);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.reset);
      final store = MemoryTokenStore();
      await store.writeRefreshToken('refresh-0');
      final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))
        ..httpClientAdapter = FakeAdapter((o) {
          switch (o.path) {
            case '/v1/auth/refresh':
              return json(tokensJson('1'));
            case '/v1/me':
              return json(meJson(admin: true));
            case '/v1/admin/queues/summary':
              return json({
                'new': 3,
                'mine': 1,
                'awaitingCustomer': 0,
                'quoted': 0,
                'reserved': 0,
                'slaBreaches': 2,
                'complianceHolds': 0,
                'deadlinesNext24h': <Object>[],
              });
            case '/v1/admin/flight-requests':
              return json({'items': <Object>[], 'nextCursor': null});
            case '/v1/notifications':
              return json({'items': <Object>[], 'unread': 4});
          }
          return problem(404, 'NOT_FOUND');
        });
      await tester.pumpWidget(
        ProviderScope(
          retry: (_, _) => null,
          overrides: [
            sharedPreferencesProvider.overrideWithValue(prefs),
            tokenStoreProvider.overrideWithValue(store),
            dioProvider.overrideWithValue(dio),
            nowProvider.overrideWith((ref) => Stream.value(_now)),
          ],
          child: const UniTravelApp(),
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Control deck'), findsOneWidget);
      for (final label in ['Home', 'Queue', 'Search', 'Alerts', 'Me']) {
        expect(
          find.descendant(of: find.byType(NavigationBar), matching: find.text(label)),
          findsOneWidget,
          reason: label,
        );
      }
      expect(
        find.descendant(of: find.byType(NavigationBar), matching: find.text('4')),
        findsOneWidget,
        reason: 'unread alerts badge',
      );
      expect(
        find.descendant(of: find.byType(NavigationBar), matching: find.text('2')),
        findsOneWidget,
        reason: 'SLA breach badge on Home',
      );

      await tester.tap(find.byTooltip('Settings'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Dark'));
      await tester.pumpAndSettle();
      expect(prefs.getString('ut.theme_mode'), 'dark');
      expect(Theme.of(tester.element(find.byType(NavigationBar))).brightness, Brightness.dark);
      await tester.pumpWidget(const SizedBox());
    });
  });
}

class _SeededHistory extends SummaryHistory {
  @override
  List<SummarySample> build() => [
    SummarySample(_now.subtract(const Duration(hours: 2)), [1, 0, 0, 0, 0, 0]),
    SummarySample(_now.subtract(const Duration(hours: 1)), [2, 0, 0, 0, 0, 0]),
    SummarySample(_now, [3, 1, 2, 4, 5, 2]),
  ];
}
