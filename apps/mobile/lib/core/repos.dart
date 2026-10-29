import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/json.dart';
import '../models/my_details.dart';
import '../models/requests.dart';
import '../models/billing.dart';
import '../models/services.dart';
import '../models/shipments.dart';
import '../models/search.dart';
import 'api_client.dart';
import 'api_error.dart';
import 'providers.dart';

/// Data plus, when it was served from the offline cache, when it was saved.
class Cached<T> {
  const Cached(this.data, [this.staleSince]);
  final T data;
  final DateTime? staleSince;
}

/// Network first, then the persistent cache when the server cannot be reached.
Future<Cached<T>> readThrough<T>(
  Ref ref,
  String cacheKey,
  Future<Object?> Function() fetch,
  T Function(Object? raw) parse,
) async {
  final cache = ref.read(cacheProvider);
  try {
    final raw = await fetch();
    await cache.put(cacheKey, raw);
    return Cached(parse(raw));
  } on ApiException catch (e) {
    final hit = e.isNetwork ? cache.get(cacheKey) : null;
    if (hit == null) rethrow;
    return Cached(parse(hit.data), hit.savedAt);
  }
}

final requestsProvider = FutureProvider.autoDispose<Cached<List<RequestListItem>>>((ref) {
  final api = ref.watch(apiClientProvider);
  return readThrough(
    ref,
    'requests',
    () => api.get('/v1/requests'),
    (raw) => (raw as List).whereType<Json>().map(RequestListItem.fromJson).toList(),
  );
});

bool isCargoRef(String ref) => ref.toUpperCase().startsWith('UT-C-');

final requestDetailProvider = FutureProvider.autoDispose.family<Cached<Json>, String>((ref, id) {
  final api = ref.watch(apiClientProvider);
  final path = isCargoRef(id) ? '/v1/cargo-requests/$id' : '/v1/flight-requests/$id';
  return readThrough(ref, 'request.$id', () => api.get(path), (raw) => raw as Json);
});

final myDetailsProvider = FutureProvider.autoDispose<MyDetails>((ref) async {
  final raw = await ref.watch(apiClientProvider).get('/v1/me/details');
  return MyDetails.fromJson(raw as Json);
});

final travellersProvider = FutureProvider.autoDispose<List<Traveller>>((ref) async {
  final raw = await ref.watch(apiClientProvider).get('/v1/me/travellers');
  return (raw as List).whereType<Json>().map(Traveller.fromJson).toList();
});

class InboxData {
  const InboxData(this.items, this.unread);
  final List<InboxEntry> items;
  final int unread;
}

final inboxProvider = FutureProvider.autoDispose<Cached<InboxData>>((ref) {
  final api = ref.watch(apiClientProvider);
  return readThrough(
    ref,
    'inbox',
    () => api.get('/v1/notifications'),
    (raw) {
      final j = raw as Json;
      return InboxData(j.objs('items').map(InboxEntry.fromJson).toList(), j.integer('unread'));
    },
  );
});

final shipmentsProvider = FutureProvider.autoDispose<Cached<List<ShipmentItem>>>((ref) {
  final api = ref.watch(apiClientProvider);
  return readThrough(
    ref,
    'shipments',
    () => api.get('/v1/shipments'),
    (raw) => (raw as List).whereType<Json>().map(ShipmentItem.fromJson).toList(),
  );
});

final shipmentSummaryProvider = FutureProvider.autoDispose<Cached<ShipmentSummary>>((ref) {
  final api = ref.watch(apiClientProvider);
  return readThrough(ref, 'shipments.summary', () => api.get('/v1/shipments/summary'), (raw) => ShipmentSummary.fromJson(raw as Json));
});

final cargoLanesProvider = FutureProvider.autoDispose<List<CargoLane>>((ref) async {
  final raw = await ref.watch(apiClientProvider).get('/v1/cargo/lanes');
  return (raw as List).whereType<Json>().map(CargoLane.fromJson).toList();
});

/// Drives one search: create, then poll every 1.5 s with back-off until it is
/// no longer RUNNING (polling, not SSE, on mobile — ch. 29.3).
class SearchPoller {
  SearchPoller(this._api, this.id, {this.initialDelay = const Duration(milliseconds: 1500)});

  final ApiClient _api;
  final String id;
  final Duration initialDelay;
  final state = StreamController<SearchSnapshot>.broadcast();
  Timer? _timer;
  bool _disposed = false;
  String _tab = 'BEST';
  SearchState? _latest;
  Object? _error;
  var _attempt = 0;
  var _extra = <Itinerary>[];

  String get tab => _tab;

  SearchSnapshot get snapshot => SearchSnapshot(_latest, _error, _extra);

  void start() => _poll();

  void setTab(String tab) {
    if (tab == _tab) return;
    _tab = tab;
    _latest = null;
    _extra = [];
    _push();
    _timer?.cancel();
    _poll();
  }

  Future<void> loadMore() async {
    final cursor = _latest?.nextCursor;
    if (cursor == null) return;
    try {
      final page = await _fetch(cursor: cursor);
      _extra = [..._extra, ...page.results];
      _latest = SearchState(
        id: page.id,
        status: page.status,
        progress: page.progress,
        results: _latest!.results,
        notices: page.notices,
        nextCursor: page.nextCursor,
        total: page.total,
        query: page.query,
      );
      _push();
    } on ApiException catch (e) {
      _error = e;
      _push();
    }
  }

  Future<SearchState> _fetch({String? cursor}) async {
    final raw = await _api.getJson(
      '/v1/flight-searches/$id',
      query: {'tab': _tab, 'limit': 20, 'cursor': ?cursor},
    );
    return SearchState.fromJson(raw);
  }

  Future<void> _poll() async {
    if (_disposed) return;
    final tabAtStart = _tab;
    try {
      final s = await _fetch();
      if (_disposed || tabAtStart != _tab) return;
      _latest = s;
      _error = null;
      _extra = [];
      _push();
      if (s.running) {
        _attempt++;
        final ms = (initialDelay.inMilliseconds * (1 + _attempt * 0.25)).round().clamp(0, 5000);
        _timer = Timer(Duration(milliseconds: ms), _poll);
      }
    } on ApiException catch (e) {
      if (_disposed) return;
      _error = e;
      _push();
      // Keep trying through transient network trouble; a 4xx is final.
      if (e.isNetwork || e.status >= 500) {
        _timer = Timer(const Duration(seconds: 4), _poll);
      }
    }
  }

  void retry() {
    _error = null;
    _push();
    _poll();
  }

  void _push() {
    if (!_disposed) state.add(snapshot);
  }

  void dispose() {
    _disposed = true;
    _timer?.cancel();
    state.close();
  }
}

class SearchSnapshot {
  const SearchSnapshot(this.state, this.error, this.more);
  final SearchState? state;
  final Object? error;
  final List<Itinerary> more;

  List<Itinerary> get items => [...?state?.results, ...more];
}

final billingProvider = FutureProvider.autoDispose<Cached<BillingDocs>>((ref) {
  final api = ref.watch(apiClientProvider);
  return readThrough(ref, 'billing', () => api.get('/v1/billing/documents'), (raw) => BillingDocs.fromJson(raw as Json));
});

/// Whether the server offers online card payment for an invoice (feature flag, eligibility policy, time left). The app never decides.
final invoicePaymentProvider = FutureProvider.autoDispose.family<InvoicePayment, String>((ref, number) async {
  final raw = await ref.watch(apiClientProvider).get('/v1/billing/invoices/$number/payment') as Json;
  return InvoicePayment.fromJson(raw);
});

/// One own invoice by number; a non-owner (or unknown number) is a 404 from the API.
final invoiceProvider = FutureProvider.autoDispose.family<Cached<Invoice>, String>((ref, number) {
  final api = ref.watch(apiClientProvider);
  return readThrough(ref, 'billing.$number', () => api.get('/v1/billing/invoices/$number'), (raw) => Invoice.fromJson(raw as Json));
});

// ---- services, tracking, club (ADR-0015, ADR-0016) ----

final serviceRequestProvider = FutureProvider.autoDispose.family<Cached<ServiceDetail>, String>((ref, id) {
  final api = ref.watch(apiClientProvider);
  return readThrough(ref, 'service.$id', () => api.get('/v1/service-requests/$id'), (raw) => ServiceDetail.fromJson(raw as Json));
});

final trackProvider = FutureProvider.autoDispose<Cached<List<TrackItem>>>((ref) {
  final api = ref.watch(apiClientProvider);
  return readThrough(ref, 'track', () => api.get('/v1/track'), (raw) => (raw as List).whereType<Json>().map(TrackItem.fromJson).toList());
});

final clubProvider = FutureProvider.autoDispose<ClubView>((ref) async {
  final raw = await ref.watch(apiClientProvider).get('/v1/me/club');
  return ClubView.fromJson(raw as Json);
});
