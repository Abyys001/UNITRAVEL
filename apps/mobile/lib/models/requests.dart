import 'json.dart';

class RequestListItem {
  const RequestListItem({
    required this.ref,
    required this.productType,
    required this.status,
    required this.statusLabel,
    required this.routeLabel,
    required this.firstDate,
    required this.updatedAt,
    required this.unread,
  });
  final String ref;
  final String productType; // FLIGHT | CARGO
  final String status;
  final String statusLabel;
  final String routeLabel;
  final String? firstDate;
  final DateTime? updatedAt;
  final int unread;

  bool get isCargo => productType == 'CARGO';

  factory RequestListItem.fromJson(Json j) => RequestListItem(
    ref: j.str('ref'),
    productType: j.str('productType', 'FLIGHT'),
    status: j.str('status'),
    statusLabel: j.str('statusLabel'),
    routeLabel: j.str('routeLabel'),
    firstDate: j.strOrNull('firstDate'),
    updatedAt: parseDate(j['updatedAt']),
    unread: j.integer('unread'),
  );
}

class TimelineItem {
  const TimelineItem({required this.at, required this.kind, required this.label, this.detail});
  final DateTime? at;
  final String kind;
  final String label;
  final String? detail;

  factory TimelineItem.fromJson(Json j) => TimelineItem(
    at: parseDate(j['at']),
    kind: j.str('kind'),
    label: j.str('label'),
    detail: j.strOrNull('detail'),
  );
}

class MessageItem {
  const MessageItem({required this.id, required this.fromCustomer, required this.body, required this.author, required this.at});
  final String id;
  final bool fromCustomer;
  final String body;
  final String author;
  final DateTime? at;

  factory MessageItem.fromJson(Json j) => MessageItem(
    id: j.str('id'),
    fromCustomer: j.str('direction') == 'FROM_CUSTOMER',
    body: j.str('body'),
    author: j.str('authorName'),
    at: parseDate(j['createdAt']),
  );
}

class QuoteOption {
  const QuoteOption({required this.id, required this.label, required this.total, required this.ticketingModel, required this.route, required this.unknownFields});
  final String id;
  final String label;
  final Money? total;
  final String ticketingModel;
  final String route;
  final List<String> unknownFields;

  factory QuoteOption.fromJson(Json j) {
    final slices = j.objs('slices');
    final route = slices.map((s) => '${s.str('origin')} → ${s.str('destination')}').join('  ·  ');
    return QuoteOption(
      id: j.str('id'),
      label: j.str('label'),
      total: Money.from(j.obj('priceBreakdown')['total']),
      ticketingModel: j.str('ticketingModel'),
      route: route,
      unknownFields: j.strs('unknownFields'),
    );
  }
}

class QuoteItem {
  const QuoteItem({required this.id, required this.status, required this.validUntil, required this.options, required this.acceptedOptionId});
  final String id;
  final String status;
  final DateTime? validUntil;
  final List<QuoteOption> options;
  final String? acceptedOptionId;

  bool get open => status == 'SENT';

  factory QuoteItem.fromJson(Json j) => QuoteItem(
    id: j.str('id'),
    status: j.str('status'),
    validUntil: parseDate(j['validUntil']),
    options: j.objs('options').map(QuoteOption.fromJson).toList(),
    acceptedOptionId: j.strOrNull('acceptedOptionId'),
  );
}

class TicketItem {
  const TicketItem({required this.number, required this.traveller, required this.status, required this.carrier});
  final String number;
  final String traveller;
  final String status;
  final String carrier;

  factory TicketItem.fromJson(Json j) => TicketItem(
    number: j.str('ticketNumber'),
    traveller: j.str('travellerName'),
    status: j.str('status'),
    carrier: j.str('validatingCarrier'),
  );
}

/// Customer view of a flight request (`FlightRequestCustomerView`).
class RequestDetail {
  const RequestDetail({
    required this.ref,
    required this.kind,
    required this.status,
    required this.statusLabel,
    required this.routeLabel,
    required this.firstTravelDate,
    required this.submittedAt,
    required this.updatedAt,
    required this.timeline,
    required this.messages,
    required this.quotes,
    required this.tickets,
    required this.actions,
    required this.travellers,
    required this.truthBadge,
    required this.raw,
  });
  final String ref;
  final String kind;
  final String status;
  final String statusLabel;
  final String routeLabel;
  final String? firstTravelDate;
  final DateTime? submittedAt;
  final DateTime? updatedAt;
  final List<TimelineItem> timeline;
  final List<MessageItem> messages;
  final List<QuoteItem> quotes;
  final List<TicketItem> tickets;
  final List<String> actions;
  final List<String> travellers;
  final String truthBadge;
  final Json raw;

  bool can(String action) => actions.contains(action);

  factory RequestDetail.fromJson(Json j) => RequestDetail(
    ref: j.str('ref'),
    kind: j.str('kind'),
    status: j.str('status'),
    statusLabel: j.str('statusLabel'),
    routeLabel: j.str('routeLabel'),
    firstTravelDate: j.strOrNull('firstTravelDate'),
    submittedAt: parseDate(j['submittedAt']),
    updatedAt: parseDate(j['updatedAt']),
    timeline: j.objs('timeline').map(TimelineItem.fromJson).toList(),
    messages: j.objs('messages').map(MessageItem.fromJson).toList(),
    quotes: j.objs('quotes').map(QuoteItem.fromJson).toList(),
    tickets: j.objs('tickets').map(TicketItem.fromJson).toList(),
    actions: j.strs('actions'),
    travellers: j.objs('travellers').map((t) => t.str('name')).toList(),
    truthBadge: j.str('truthBadge'),
    raw: j,
  );
}

class Traveller {
  const Traveller({required this.id, required this.givenNames, required this.surname, required this.nameFa, required this.documentComplete, required this.relationship});
  final String id;
  final String givenNames;
  final String surname;
  final String? nameFa;
  final bool documentComplete;
  final String relationship;

  String get fullName => '$givenNames $surname'.trim();

  factory Traveller.fromJson(Json j) => Traveller(
    id: j.str('id'),
    givenNames: j.str('givenNames'),
    surname: j.str('surname'),
    nameFa: j.strOrNull('nameFa'),
    documentComplete: j.flag('documentComplete'),
    relationship: j.str('relationship', 'SELF'),
  );
}

class InboxEntry {
  const InboxEntry({required this.id, required this.title, required this.body, required this.createdAt, required this.read, required this.critical, this.linkPath});
  final String id;
  final String title;
  final String body;
  final DateTime? createdAt;
  final bool read;
  final bool critical;
  final String? linkPath;

  factory InboxEntry.fromJson(Json j) => InboxEntry(
    id: j.str('id'),
    title: j.str('title'),
    body: j.str('body'),
    createdAt: parseDate(j['createdAt']),
    read: j['readAt'] != null,
    critical: j.flag('critical'),
    linkPath: j.obj('data').strOrNull('linkPath'),
  );
}

class CargoLane {
  const CargoLane({required this.id, required this.label, required this.enabled, required this.services, required this.notice, required this.originCountry, required this.destinationCountry});
  final String id;
  final String label;
  final bool enabled;
  final List<String> services;
  final String? notice;
  final String originCountry;
  final String destinationCountry;

  factory CargoLane.fromJson(Json j) => CargoLane(
    id: j.str('id'),
    label: j.str('label'),
    enabled: j.flag('enabled'),
    services: j.strs('services'),
    notice: j.strOrNull('notice'),
    originCountry: j.str('originCountry'),
    destinationCountry: j.str('destinationCountry'),
  );
}
