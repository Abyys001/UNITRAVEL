import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:unitravel_mobile/core/pow.dart';
import 'package:unitravel_mobile/core/session.dart';
import 'package:unitravel_mobile/models/me.dart';
import 'package:unitravel_mobile/models/search.dart';
import 'package:unitravel_mobile/router.dart';

import 'support/fake_api.dart';

void main() {
  group('price confidentiality (ADR-0004)', () {
    test('a customer itinerary carries no amounts and parses without a price block', () {
      final it = Itinerary.fromJson({
        'id': 'itn_1',
        'construction': 'THROUGH',
        'ticketing': 'SINGLE_TICKET',
        'durationMin': 420,
        'stops': 0,
        'components': [
          {
            'source': {'provider': 'duffel', 'rung': 'LIVE_OFFER', 'fake': false},
            'slices': [],
            'baggage': [],
          },
        ],
        'connections': [],
        'truth': [],
        'riskFlags': [],
        'carriers': ['TK'],
        'baggage': [],
      });
      expect(it.id, 'itn_1');
      expect(it.components, hasLength(1));
    });

    test('pre-quote models never read price, score or fee fields', () {
      final src = File('lib/models/search.dart').readAsStringSync();
      expect(src, isNot(contains("'price'")));
      expect(src, isNot(contains("'penalty'")));
      expect(src, isNot(contains("'score'")));
    });
  });

  group('proof of work', () {
    test('finds the number whose sha256(salt+n) matches and encodes the payload', () {
      const salt = 'abc123';
      final target = sha256.convert(utf8.encode('${salt}137')).toString();
      final out = solvePowChallenge({
        'algorithm': 'SHA-256',
        'challenge': target,
        'salt': salt,
        'maxnumber': 1000,
        'signature': 'sig',
      });
      final decoded = jsonDecode(utf8.decode(base64.decode(out!))) as Map<String, dynamic>;
      expect(decoded['number'], 137);
      expect(decoded['signature'], 'sig');
      expect(decoded['algorithm'], 'SHA-256');
    });

    test('returns null when no number in range matches', () {
      expect(
        solvePowChallenge({'algorithm': 'SHA-256', 'challenge': 'nope', 'salt': 's', 'maxnumber': 10, 'signature': 'x'}),
        isNull,
      );
    });
  });

  group('navigation rules (mode comes from /me)', () {
    SessionState signedIn({bool admin = false}) =>
        SessionState(status: AuthStatus.signedIn, me: Me.fromJson(meJson(admin: admin)));

    test('signed-out users go to sign-in and keep the deep link', () {
      const out = SessionState(status: AuthStatus.signedOut);
      expect(redirectFor(out, Uri.parse('/requests/UT-F-ABC234')), '/signin?from=${Uri.encodeComponent('/requests/UT-F-ABC234')}');
      expect(redirectFor(out, Uri.parse('/signin')), isNull);
    });

    test('after sign-in the deep link is honoured', () {
      expect(
        redirectFor(signedIn(), Uri.parse('/signin?from=${Uri.encodeComponent('/requests/UT-F-ABC234')}')),
        '/requests/UT-F-ABC234',
      );
    });

    test('open redirects are ignored', () {
      expect(redirectFor(signedIn(), Uri.parse('/signin?from=${Uri.encodeComponent('//evil.example')}')), '/search');
    });

    test('customers cannot enter admin routes; admins land in admin mode', () {
      expect(redirectFor(signedIn(), Uri.parse('/admin/queue')), '/search');
      expect(redirectFor(signedIn(admin: true), Uri.parse('/search')), '/admin/home');
      expect(redirectFor(signedIn(admin: true), Uri.parse('/admin/queue')), isNull);
    });

    test('an SMS short link opens the case when the user is staff', () {
      expect(redirectFor(signedIn(admin: true), Uri.parse('/requests/UT-F-ABC234')), '/admin/case/UT-F-ABC234');
    });

    test('a new account is sent to complete its profile first', () {
      final j = meJson()..['profile'] = null;
      final s = SessionState(status: AuthStatus.signedIn, me: Me.fromJson(j));
      expect(redirectFor(s, Uri.parse('/search')), '/profile');
      expect(redirectFor(s, Uri.parse('/profile')), isNull);
    });
  });

  group('search form', () {
    const thr = Place(kind: 'CITY', code: 'THR', nameEn: 'Tehran', nameFa: 'تهران');
    const ika = Place(kind: 'AIRPORT', code: 'IKA', nameEn: 'Imam Khomeini', nameFa: 'امام');
    const lon = Place(kind: 'CITY', code: 'LON', nameEn: 'London', nameFa: 'لندن');

    test('one way body matches the SearchQuery contract', () {
      final form = SearchForm(
        legs: [SearchLeg(from: thr, to: lon, date: DateTime(2026, 12, 10))],
        childAges: const [7],
        infants: 1,
      );
      expect(form.validate(), isNull);
      final j = form.toJson();
      expect(j['tripType'], 'ONE_WAY');
      expect((j['slices'] as List).single, {'from': {'city': 'THR'}, 'to': {'city': 'LON'}, 'date': '2026-12-10'});
      expect(j['passengers'], [
        {'type': 'ADT'},
        {'type': 'CHD', 'age': 7},
        {'type': 'INF'},
      ]);
    });

    test('a one way search ignores the spare second leg kept for return trips', () {
      final form = SearchForm(legs: [
        SearchLeg(from: thr, to: lon, date: DateTime(2026, 12, 10)),
        const SearchLeg(),
      ]);
      expect(form.validate(), isNull);
      expect((form.toJson()['slices'] as List).length, 1);
    });

    test('airport places are sent as {airport: code}', () {
      expect(ika.wire, {'airport': 'IKA'});
    });

    test('return trips derive the second slice by reversing the first', () {
      final form = SearchForm(
        tripType: TripType.roundTrip,
        legs: [
          SearchLeg(from: thr, to: lon, date: DateTime(2026, 12, 10)),
          SearchLeg(date: DateTime(2026, 12, 20)),
        ],
      );
      final slices = form.toJson()['slices'] as List;
      expect(slices[1], {'from': {'city': 'LON'}, 'to': {'city': 'THR'}, 'date': '2026-12-20'});
    });

    test('validation catches the common mistakes', () {
      final base = SearchForm(legs: [SearchLeg(from: thr, to: lon, date: DateTime(2026, 12, 10))]);
      expect(const SearchForm().validate(), FormProblem.missingPlace);
      expect(SearchForm(legs: [SearchLeg(from: thr, to: thr, date: DateTime(2026, 12, 10))]).validate(), FormProblem.samePlace);
      expect(const SearchForm(legs: [SearchLeg(from: thr, to: lon)]).validate(), FormProblem.missingDate);
      expect(base.copyWith(infants: 2).validate(), FormProblem.infants);
      expect(
        SearchForm(
          tripType: TripType.roundTrip,
          legs: [
            SearchLeg(from: thr, to: lon, date: DateTime(2026, 12, 10)),
            SearchLeg(date: DateTime(2026, 12, 1)),
          ],
        ).validate(),
        FormProblem.dateOrder,
      );
    });
  });
}
