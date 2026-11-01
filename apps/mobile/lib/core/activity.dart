import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/services.dart';
import 'api_client.dart';
import 'providers.dart';

/// Screen names the API accepts (`ACTIVITY_SCREENS` in packages/contracts/src/activity.ts, ADR-0018). A new screen is a
/// code change on both sides, on purpose.
const activityScreens = {
  'home',
  'search',
  'results',
  'itinerary',
  'flights',
  'hotels',
  'stays',
  'trains',
  'buses',
  'visa',
  'tours',
  'cip',
  'insurance',
  'cargo',
  'shipments',
  'request_new',
  'requests',
  'request_detail',
  'track',
  'account',
  'details',
  'travellers',
  'billing',
  'invoice',
  'pay',
  'inbox',
  'support',
  'support_ticket',
  'club',
  'settings',
  'faq',
  'guides',
  'blog',
  'glossary',
  'sign_in',
};

final _refPattern = RegExp(r'^[A-Z0-9][A-Z0-9-]{2,31}$');

typedef ActivityEvent = ({String screen, String? ref});

/// Maps an app location to an allow-listed screen name plus, for a request or invoice page, its reference. Anything not on
/// the list (admin screens, splash, the services grid) reports nothing. Names only: no query strings, no free text.
ActivityEvent? activityFor(Uri uri) {
  final seg = uri.pathSegments;
  if (seg.isEmpty) return null;
  String? ref(int i) {
    if (seg.length <= i) return null;
    final r = seg[i].toUpperCase();
    return _refPattern.hasMatch(r) ? r : null;
  }

  ActivityEvent? screen(String s, [String? r]) => (screen: s, ref: r);
  switch (seg[0]) {
    case 'search':
      if (seg.length == 1) return screen('search');
      return switch (seg[1]) {
        'results' => screen('results'),
        'itinerary' => screen('itinerary'),
        'request' || 'manual' => screen('request_new'),
        _ => null,
      };
    case 'requests':
      return seg.length == 1
          ? screen('requests')
          : screen('request_detail', ref(1));
    case 'services':
      if (seg.length == 1) return null;
      if (seg[1] == 'new') {
        final t = ServiceType.fromPath(seg.length > 2 ? seg[2] : null);
        final s = switch (t) {
          ServiceType.hotel => 'hotels',
          ServiceType.stay => 'stays',
          ServiceType.train => 'trains',
          ServiceType.bus => 'buses',
          ServiceType.visa => 'visa',
          ServiceType.tour => 'tours',
          ServiceType.cip => 'cip',
          ServiceType.insurance => 'insurance',
          null => null,
        };
        return s == null ? null : screen(s);
      }
      return screen('request_detail', ref(1));
    case 'cargo':
      if (seg.length == 1) return screen('cargo');
      return switch (seg[1]) {
        'shipments' => screen('shipments'),
        'new' => screen('request_new'),
        _ => null,
      };
    case 'listings':
      final k = seg.length > 1 ? seg[1] : '';
      return const {'flights', 'buses', 'trains', 'stays'}.contains(k)
          ? screen(k)
          : null;
    case 'track':
      return screen('track');
    case 'inbox':
      return screen('inbox');
    case 'club':
      return screen('club');
    case 'signin':
      return screen('sign_in');
    case 'glossary':
      return screen('glossary');
    case 'learn':
      return screen(switch (seg.length > 1 ? seg[1] : '') {
        'blog' => 'blog',
        'faq' => 'faq',
        _ => 'guides',
      });
    case 'support':
      return seg.length > 1 && seg[1] == 'tickets' && seg.length > 2
          ? screen('support_ticket', ref(2))
          : screen('support');
    case 'account':
      if (seg.length == 1) return screen('account');
      if (seg[1] == 'details') return screen('details');
      if (seg[1] == 'billing') {
        if (seg.length == 2) return screen('billing');
        return seg.length > 3 && seg[3] == 'payment'
            ? screen('pay', ref(2))
            : screen('invoice', ref(2));
      }
      return null;
  }
  return null;
}

/// Tells the API which screen the signed-in customer is on (`POST /v1/me/activity`, ADR-0018). Fire and forget: a failure is
/// never shown and never retried. At most one report per [minGap]; a screen reached inside that window is sent once the
/// window closes, and only if it still differs from the last one sent.
class ActivityReporter {
  ActivityReporter(this._api, {this.minGap = const Duration(seconds: 2)});

  final ApiClient _api;
  final Duration minGap;
  Timer? _cooling;
  ActivityEvent? _pending;
  ActivityEvent? _last;

  /// Called on every location change while a customer is signed in.
  void onLocation(Uri uri) {
    final e = activityFor(uri);
    if (e == null) return;
    if (_cooling != null) {
      _pending = e;
      return;
    }
    if (e != _last) _send(e);
  }

  /// Forget what was sent, so the next sign-in reports its first screen.
  void reset() {
    _cooling?.cancel();
    _cooling = null;
    _pending = null;
    _last = null;
  }

  void _send(ActivityEvent e) {
    _last = e;
    _cooling = Timer(minGap, _flush);
    unawaited(_post(e));
  }

  void _flush() {
    _cooling = null;
    final p = _pending;
    _pending = null;
    if (p != null && p != _last) _send(p);
  }

  Future<void> _post(ActivityEvent e) async {
    try {
      await _api.post(
        '/v1/me/activity',
        body: {'screen': e.screen, 'ref': ?e.ref},
      );
    } catch (_) {
      // Telemetry must never disturb the app.
    }
  }

  void dispose() => _cooling?.cancel();
}

final activityReporterProvider = Provider<ActivityReporter>((ref) {
  final r = ActivityReporter(ref.watch(apiClientProvider));
  ref.onDispose(r.dispose);
  return r;
});
