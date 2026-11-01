import 'json.dart';

/// A staff-curated bus, train or stay row. Always indicative; [price] is non-null only when staff quoted one.
class CuratedListing {
  const CuratedListing({
    required this.id,
    required this.titleEn,
    required this.titleFa,
    required this.summaryEn,
    required this.summaryFa,
    required this.fromPlace,
    required this.toPlace,
    required this.operator,
    required this.price,
    required this.validUntil,
  });
  final String id;
  final String titleEn;
  final String titleFa;
  final String summaryEn;
  final String summaryFa;
  final String? fromPlace;
  final String toPlace;
  final String? operator;
  final Money? price;
  final DateTime? validUntil;

  String title(String lang) =>
      lang == 'fa' && titleFa.isNotEmpty ? titleFa : titleEn;
  String summary(String lang) =>
      lang == 'fa' && summaryFa.isNotEmpty ? summaryFa : summaryEn;

  factory CuratedListing.fromJson(Json j) => CuratedListing(
    id: j.str('id'),
    titleEn: j.obj('title').str('en'),
    titleFa: j.obj('title').str('fa'),
    summaryEn: j.obj('summary').str('en'),
    summaryFa: j.obj('summary').str('fa'),
    fromPlace: j.strOrNull('fromPlace'),
    toPlace: j.str('toPlace'),
    operator: j.strOrNull('operator'),
    price: Money.from(j['price']),
    validUntil: parseDate(j['validUntil']),
  );
}

/// A cached live-adapter result. There is deliberately no amount: customers see none before a sent quote.
class FlightListing {
  const FlightListing({
    required this.label,
    required this.fetchedAt,
    required this.origin,
    required this.destination,
    required this.departureDate,
    required this.carriers,
    required this.stops,
    required this.durationMin,
    required this.departureLocal,
    required this.arrivalLocal,
  });
  final String label;
  final DateTime? fetchedAt;
  final String origin;
  final String destination;
  final String departureDate;
  final List<String> carriers;
  final int stops;
  final int durationMin;
  final String departureLocal;
  final String arrivalLocal;

  factory FlightListing.fromJson(Json j) => FlightListing(
    label: j.str('label', 'CACHED_OFFER'),
    fetchedAt: parseDate(j['fetchedAt']),
    origin: j.str('origin'),
    destination: j.str('destination'),
    departureDate: j.str('departureDate'),
    carriers: j.strs('carriers'),
    stops: j.integer('stops'),
    durationMin: j.integer('durationMin'),
    departureLocal: j.str('departureLocal'),
    arrivalLocal: j.str('arrivalLocal'),
  );
}

/// One of the four public listing verticals.
enum ListingKind {
  flights('flights'),
  buses('buses'),
  trains('trains'),
  stays('stays');

  const ListingKind(this.path);
  final String path;

  static ListingKind? fromPath(String? p) =>
      values.where((k) => k.path == p).firstOrNull;
}

class ListingsView {
  const ListingsView({
    this.curated = const [],
    this.flights = const [],
    this.noSources = false,
  });
  final List<CuratedListing> curated;
  final List<FlightListing> flights;

  /// Flights only: no live adapter is enabled or nothing is cached yet.
  final bool noSources;

  bool get isEmpty => curated.isEmpty && flights.isEmpty;

  factory ListingsView.fromJson(ListingKind kind, Json j) =>
      kind == ListingKind.flights
      ? ListingsView(
          flights: j.objs('items').map(FlightListing.fromJson).toList(),
          noSources: j['notice'] == 'NO_SOURCES',
        )
      : ListingsView(
          curated: j.objs('items').map(CuratedListing.fromJson).toList(),
        );
}
