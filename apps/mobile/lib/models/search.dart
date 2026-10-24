import 'json.dart';

enum TripType { oneWay, roundTrip, openJaw, multiCity }

extension TripTypeApi on TripType {
  String get api => switch (this) {
    TripType.oneWay => 'ONE_WAY',
    TripType.roundTrip => 'RETURN',
    TripType.openJaw => 'OPEN_JAW',
    TripType.multiCity => 'MULTI_CITY',
  };
}

class Place {
  const Place({required this.kind, required this.code, required this.nameEn, required this.nameFa, this.country = ''});
  final String kind; // CITY | AIRPORT
  final String code;
  final String nameEn;
  final String nameFa;
  final String country;

  factory Place.fromJson(Json j) => Place(
    kind: j.str('kind', 'CITY'),
    code: j.str('code'),
    nameEn: j.str('nameEn'),
    nameFa: j.str('nameFa'),
    country: j.str('country'),
  );

  /// Wire format: `{city: THR}` or `{airport: IKA}` (ch. 11.3).
  Json get wire => {kind == 'AIRPORT' ? 'airport' : 'city': code};

  /// Name for the current language without the "— all airports" suffix (the code is shown beside it).
  String name(String lang) {
    final full = lang == 'fa' && nameFa.isNotEmpty ? nameFa : nameEn;
    return kind == 'CITY' ? full.split(' — ').first : full;
  }
}

class SearchLeg {
  const SearchLeg({this.from, this.to, this.date});
  final Place? from;
  final Place? to;
  final DateTime? date;

  SearchLeg copyWith({Place? from, Place? to, DateTime? date}) =>
      SearchLeg(from: from ?? this.from, to: to ?? this.to, date: date ?? this.date);
}

class SearchForm {
  const SearchForm({
    this.tripType = TripType.oneWay,
    this.legs = const [SearchLeg()],
    this.adults = 1,
    this.childAges = const [],
    this.infants = 0,
    this.cabin = 'ECONOMY',
    this.maxStops = 2,
    this.allowSelfTransfer = true,
    this.allowOvernight = true,
    this.allowAirportChange = false,
    this.includeGateways = true,
  });

  final TripType tripType;
  final List<SearchLeg> legs;
  final int adults;
  final List<int> childAges;
  final int infants;
  final String cabin;
  final int maxStops;
  final bool allowSelfTransfer;
  final bool allowOvernight;
  final bool allowAirportChange;
  final bool includeGateways;

  int get passengerCount => adults + childAges.length + infants;

  SearchForm copyWith({
    TripType? tripType,
    List<SearchLeg>? legs,
    int? adults,
    List<int>? childAges,
    int? infants,
    String? cabin,
    int? maxStops,
    bool? allowSelfTransfer,
    bool? allowOvernight,
    bool? allowAirportChange,
    bool? includeGateways,
  }) => SearchForm(
    tripType: tripType ?? this.tripType,
    legs: legs ?? this.legs,
    adults: adults ?? this.adults,
    childAges: childAges ?? this.childAges,
    infants: infants ?? this.infants,
    cabin: cabin ?? this.cabin,
    maxStops: maxStops ?? this.maxStops,
    allowSelfTransfer: allowSelfTransfer ?? this.allowSelfTransfer,
    allowOvernight: allowOvernight ?? this.allowOvernight,
    allowAirportChange: allowAirportChange ?? this.allowAirportChange,
    includeGateways: includeGateways ?? this.includeGateways,
  );

  /// The slices actually sent: a return trip derives its second slice from the first.
  List<SearchLeg> get effectiveLegs {
    if (tripType == TripType.oneWay) return [legs.first];
    if (tripType != TripType.roundTrip) return legs;
    final out = legs.first;
    final back = legs.length > 1 ? legs[1] : const SearchLeg();
    return [out, SearchLeg(from: out.to, to: out.from, date: back.date)];
  }

  /// First problem to show the user, or null when the form can be submitted.
  FormProblem? validate() {
    for (final leg in effectiveLegs) {
      if (leg.from == null || leg.to == null) return FormProblem.missingPlace;
      if (leg.from!.code == leg.to!.code) return FormProblem.samePlace;
      if (leg.date == null) return FormProblem.missingDate;
    }
    final legs = effectiveLegs;
    for (var i = 1; i < legs.length; i++) {
      if (legs[i].date!.isBefore(legs[i - 1].date!)) return FormProblem.dateOrder;
    }
    if (infants > adults) return FormProblem.infants;
    return null;
  }

  Json toJson() {
    String isoDate(DateTime d) =>
        '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    return {
      'tripType': tripType.api,
      'slices': [
        for (final l in effectiveLegs)
          {'from': l.from!.wire, 'to': l.to!.wire, 'date': isoDate(l.date!)},
      ],
      'passengers': [
        for (var i = 0; i < adults; i++) {'type': 'ADT'},
        for (final age in childAges) {'type': 'CHD', 'age': age},
        for (var i = 0; i < infants; i++) {'type': 'INF'},
      ],
      'cabin': cabin,
      'preferences': {
        'maxStops': maxStops,
        'allowSelfTransfer': allowSelfTransfer,
        'allowOvernight': allowOvernight,
        'allowAirportChange': allowAirportChange,
        'includeGateways': includeGateways,
      },
    };
  }
}

enum FormProblem { missingPlace, samePlace, missingDate, dateOrder, infants }

class SearchProgress {
  const SearchProgress({required this.total, required this.done, this.slow = const []});
  final int total;
  final int done;
  final List<String> slow;
}

class SearchState {
  const SearchState({
    required this.id,
    required this.status,
    required this.progress,
    required this.results,
    required this.notices,
    required this.nextCursor,
    required this.total,
    required this.query,
  });
  final String id;
  final String status; // RUNNING | COMPLETE | PARTIAL | FAILED
  final SearchProgress progress;
  final List<Itinerary> results;
  final List<String> notices;
  final String? nextCursor;
  final int total;
  final Json query;

  bool get running => status == 'RUNNING';

  factory SearchState.fromJson(Json j) {
    final p = j.obj('progress');
    final results = j.objs('results').map(Itinerary.fromJson).toList();
    return SearchState(
      id: j.str('id'),
      status: j.str('status', 'RUNNING'),
      progress: SearchProgress(
        total: p.integer('sourcesTotal'),
        done: p.integer('sourcesDone'),
        slow: p.strs('slowSources'),
      ),
      results: results,
      notices: j.strs('notices'),
      nextCursor: j.strOrNull('nextCursor'),
      total: j.integer('total', results.length),
      query: j.obj('query'),
    );
  }
}

class Segment {
  const Segment({
    required this.carrier,
    required this.flightNumber,
    required this.origin,
    required this.destination,
    required this.departLocal,
    required this.arriveLocal,
    required this.departUtc,
    required this.arriveUtc,
    this.aircraft,
    this.originTerminal,
    this.destinationTerminal,
  });
  final String carrier;
  final String flightNumber;
  final String origin;
  final String destination;
  final String departLocal;
  final String arriveLocal;
  final DateTime? departUtc;
  final DateTime? arriveUtc;
  final String? aircraft;
  final String? originTerminal;
  final String? destinationTerminal;

  Duration? get duration => (departUtc != null && arriveUtc != null) ? arriveUtc!.difference(departUtc!) : null;

  factory Segment.fromJson(Json j) => Segment(
    carrier: j.obj('marketing').str('carrier'),
    flightNumber: j.obj('marketing').str('flightNumber'),
    origin: j.obj('origin').str('iata'),
    destination: j.obj('destination').str('iata'),
    departLocal: j.obj('departure').str('local'),
    arriveLocal: j.obj('arrival').str('local'),
    departUtc: parseDate(j.obj('departure')['utc']),
    arriveUtc: parseDate(j.obj('arrival')['utc']),
    aircraft: j.strOrNull('aircraft'),
    originTerminal: j.obj('origin').strOrNull('terminal'),
    destinationTerminal: j.obj('destination').strOrNull('terminal'),
  );
}

class SliceView {
  const SliceView({required this.origin, required this.destination, required this.segments, required this.durationMin});
  final String origin;
  final String destination;
  final List<Segment> segments;
  final int durationMin;

  factory SliceView.fromJson(Json j) => SliceView(
    origin: j.str('origin'),
    destination: j.str('destination'),
    segments: j.objs('segments').map(Segment.fromJson).toList(),
    durationMin: j.integer('durationMin'),
  );
}

class ConnectionView {
  const ConnectionView({
    required this.at,
    required this.layoverMin,
    required this.flags,
    required this.overnight,
    required this.protectedConnection,
    this.advisory,
    this.departAirport,
  });
  final String at;
  final String? departAirport;
  final int layoverMin;
  final List<String> flags;
  final bool overnight;
  final bool protectedConnection;
  final String? advisory;

  factory ConnectionView.fromJson(Json j) => ConnectionView(
    at: j.str('at'),
    departAirport: j.strOrNull('departAirport'),
    layoverMin: j.integer('layoverMin'),
    flags: j.strs('flags'),
    overnight: j.flag('overnight'),
    protectedConnection: j.flag('protected'),
    advisory: j.strOrNull('advisory'),
  );
}

/// One ticket (one supplier offer) inside an itinerary.
class TicketComponent {
  const TicketComponent({required this.provider, required this.rung, required this.fake, required this.fetchedAt, required this.expiresAt, required this.slices, required this.baggage});
  final String provider;
  final String rung;
  final bool fake;
  final DateTime? fetchedAt;
  final DateTime? expiresAt;
  final List<SliceView> slices;
  final List<Json> baggage;

  /// Baggage facts for one segment of this ticket, or null when none were supplied.
  Json? baggageFor(int segmentIndex) =>
      baggage.where((b) => b.integer('segmentIndex') == segmentIndex).firstOrNull;

  factory TicketComponent.fromJson(Json j) {
    final s = j.obj('source');
    return TicketComponent(
      provider: s.str('provider'),
      rung: s.str('rung'),
      fake: s.flag('fake'),
      fetchedAt: parseDate(s['fetchedAt']),
      expiresAt: parseDate(s['expiresAt']),
      slices: j.objs('slices').map(SliceView.fromJson).toList(),
      baggage: j.objs('baggage'),
    );
  }
}

class Itinerary {
  const Itinerary({
    required this.id,
    required this.construction,
    required this.ticketing,
    required this.durationMin,
    required this.components,
    required this.connections,
    required this.truth,
    required this.riskFlags,
    required this.stops,
    required this.carriers,
    required this.baggage,
    this.gateway,
    this.firstDeparture,
    this.lastArrival,
  });
  final String id;
  final String construction; // THROUGH | SELF_TRANSFER | GATEWAY
  final String ticketing; // SINGLE_TICKET | SEPARATE_TICKETS
  final int durationMin;
  final List<TicketComponent> components;
  final List<ConnectionView> connections;
  final List<Json> truth;
  final List<String> riskFlags;
  final int stops;
  final List<String> carriers;
  final Json? gateway;
  final DateTime? firstDeparture;
  final DateTime? lastArrival;

  /// Per-segment baggage facts, tri-state (`KNOWN`/`UNKNOWN`, ch. 12.5).
  final List<Json> baggage;

  bool get separateTickets => ticketing == 'SEPARATE_TICKETS' || riskFlags.contains('SEPARATE_TICKETS');
  bool get startsAtGateway => construction == 'GATEWAY';
  bool get anyFake => truth.any((t) => t['fake'] == true) || components.any((c) => c.fake);
  bool get anyCached => truth.any((t) => t['rung'] == 'CACHED_OFFER');
  bool get allPriced => truth.isNotEmpty && truth.every((t) => t['rung'] == 'PRICED_OFFER');
  bool get anyLive => truth.any((t) => t['rung'] == 'LIVE_OFFER');

  /// Oldest `fetchedAt` across components — what "price freshness" is judged by.
  DateTime? get oldestFetch {
    final all = truth.map((t) => parseDate(t['fetchedAt'])).whereType<DateTime>().toList()..sort();
    return all.firstOrNull;
  }

  List<SliceView> get slices => [for (final c in components) ...c.slices];

  factory Itinerary.fromJson(Json j) {
    return Itinerary(
      id: j.str('id'),
      construction: j.str('construction', 'THROUGH'),
      ticketing: j.str('ticketing', 'SINGLE_TICKET'),
      durationMin: j.integer('durationMin'),
      components: j.objs('components').map(TicketComponent.fromJson).toList(),
      connections: j.objs('connections').map(ConnectionView.fromJson).toList(),
      truth: j.objs('truth'),
      riskFlags: j.strs('riskFlags'),
      stops: j.integer('stops'),
      carriers: j.strs('carriers'),
      gateway: j.objOrNull('gateway'),
      firstDeparture: parseDate(j['firstDeparture']),
      lastArrival: parseDate(j['lastArrival']),
      baggage: j.objs('baggage'),
    );
  }
}
