import 'json.dart';

class TicketingDeadline {
  const TicketingDeadline(this.ref, this.deadline);
  final String ref;
  final DateTime deadline;
}

class QueueSummary {
  const QueueSummary({
    required this.newCount,
    required this.mine,
    required this.awaiting,
    required this.quoted,
    required this.reserved,
    required this.slaBreaches,
    this.complianceHolds = 0,
    this.deadlines = const [],
  });
  final int newCount;
  final int mine;
  final int awaiting;
  final int quoted;
  final int reserved;
  final int slaBreaches;
  final int complianceHolds;

  /// Reservations whose ticketing deadline falls within 24 h (the API's `deadlinesNext24h`), soonest first.
  final List<TicketingDeadline> deadlines;

  /// Open shared-queue cases the health bar splits up (`mine` overlaps these, so it is not part of the total).
  int get openTotal => newCount + awaiting + quoted + reserved;

  /// True when nothing needs the signed-in staff member right now.
  bool get allClear => slaBreaches == 0 && newCount == 0 && deadlines.isEmpty;

  /// Values in the order the trend history stores them.
  List<int> get samples => [newCount, mine, awaiting, quoted, reserved, slaBreaches];

  factory QueueSummary.fromJson(Json j) => QueueSummary(
    newCount: j.integer('new'),
    mine: j.integer('mine'),
    awaiting: j.integer('awaitingCustomer'),
    quoted: j.integer('quoted'),
    reserved: j.integer('reserved'),
    slaBreaches: j.integer('slaBreaches'),
    complianceHolds: j.integer('complianceHolds'),
    deadlines: ([
      for (final d in j.objs('deadlinesNext24h'))
        if (parseDate(d['deadline']) case final at?) TicketingDeadline(d.str('ref'), at),
    ]..sort((a, b) => a.deadline.compareTo(b.deadline))),
  );
}

class AdminListItem {
  const AdminListItem({
    required this.ref,
    required this.status,
    required this.routeLabel,
    required this.customer,
    required this.travellers,
    required this.firstTravelDate,
    required this.urgent,
    required this.slaDueAt,
    required this.slaBreached,
    required this.assignee,
  });
  final String ref;
  final String status;
  final String routeLabel;
  final String customer;
  final int travellers;
  final String? firstTravelDate;
  final bool urgent;
  final DateTime? slaDueAt;
  final bool slaBreached;
  final String? assignee;

  factory AdminListItem.fromJson(Json j) => AdminListItem(
    ref: j.str('ref'),
    status: j.str('status'),
    routeLabel: j.str('routeLabel'),
    customer: j.str('customer'),
    travellers: j.integer('travellers', 1),
    firstTravelDate: j.strOrNull('firstTravelDate'),
    urgent: j.flag('urgent'),
    slaDueAt: parseDate(j['slaDueAt']),
    slaBreached: j.flag('slaBreached'),
    assignee: j.strOrNull('assignee'),
  );
}

class AdminCommand {
  const AdminCommand({required this.command, required this.allowed, this.reason});
  final String command;
  final bool allowed;
  final String? reason;

  factory AdminCommand.fromJson(Json j) => AdminCommand(command: j.str('command'), allowed: j.flag('allowed'), reason: j.strOrNull('reason'));
}

/// Staff detail of one case, trimmed to what triage needs on a phone.
class AdminCase {
  const AdminCase({
    required this.ref,
    required this.version,
    required this.status,
    required this.statusLabel,
    required this.routeLabel,
    required this.firstTravelDate,
    required this.customerName,
    required this.phone,
    required this.assignee,
    required this.slaDueAt,
    required this.customerNote,
    required this.passengers,
    required this.timeline,
    required this.messages,
    required this.notes,
    required this.contacts,
    required this.commands,
    required this.kind,
    required this.paymentStatus,
    required this.urgent,
    required this.truth,
  });
  final String ref;
  final int version;
  final String status;
  final String statusLabel;
  final String routeLabel;
  final String? firstTravelDate;
  final String customerName;
  final String? phone;
  final String? assignee;
  final DateTime? slaDueAt;
  final String? customerNote;
  final List<String> passengers;
  final List<Json> timeline;
  final List<Json> messages;
  final List<Json> notes;
  final List<Json> contacts;
  final List<AdminCommand> commands;
  final String kind;
  final String paymentStatus;
  final bool urgent;
  final CaseTruth truth;

  bool allowed(String c) => commands.any((x) => x.command == c && x.allowed);
  AdminCommand? command(String c) => commands.where((x) => x.command == c).firstOrNull;

  /// Staff phone is masked (`+98•••34`) without PII permission; a masked number cannot be dialled.
  bool get canDial => phone != null && !phone!.contains('•');

  factory AdminCase.fromJson(Json j) {
    final cust = j.obj('customer');
    return AdminCase(
      ref: j.str('ref'),
      version: j.integer('version'),
      status: j.str('status'),
      statusLabel: j.str('statusLabel'),
      routeLabel: j.str('routeLabel'),
      firstTravelDate: j.strOrNull('firstTravelDate'),
      customerName: cust.str('nameLatin').isNotEmpty ? cust.str('nameLatin') : cust.str('displayName'),
      phone: cust.strOrNull('phone'),
      assignee: j.objOrNull('assignee')?.strOrNull('name'),
      slaDueAt: parseDate(j.obj('sla')['dueAt']),
      customerNote: j.strOrNull('customerNote'),
      passengers: j.obj('query').objs('passengers').map((p) => p.str('type')).toList(),
      timeline: j.objs('timeline'),
      messages: j.objs('messages'),
      notes: j.objs('notes'),
      contacts: j.objs('contacts'),
      commands: j.objs('actions').map(AdminCommand.fromJson).toList(),
      kind: j.str('kind'),
      paymentStatus: j.str('paymentStatus', 'NONE'),
      urgent: j.flag('urgent'),
      truth: CaseTruth.fromJson(j),
    );
  }
}

/// Tri-state of a supplier-sourced fact (booklet ch. 12.5, rule 3): never infer UNKNOWN as known.
enum Tri { known, notIncluded, unknown }

/// One fact with its state. `pieces`/`kg` only for baggage, `varies` when segments or tickets disagree.
class TriFact {
  const TriFact(this.state, {this.pieces, this.kg, this.varies = false});
  const TriFact.unknown() : this(Tri.unknown);
  final Tri state;
  final int? pieces;
  final num? kg;
  final bool varies;

  /// Checked baggage across every segment of every ticket. Missing or partial data stays UNKNOWN.
  static TriFact baggage(List<Json> segments) {
    if (segments.isEmpty) return const TriFact.unknown();
    final counts = <int>[];
    num? kg;
    for (final b in segments) {
      final checked = b.obj('checked');
      final pieces = checked.str('status') == 'KNOWN' ? checked.obj('value').intOrNull('pieces') : null;
      if (pieces == null) return const TriFact.unknown();
      counts.add(pieces);
      final w = checked.obj('value')['kgPerPiece'];
      if (w is num) kg = kg == null || w < kg ? w : kg;
    }
    final least = counts.reduce((a, b) => a < b ? a : b);
    final most = counts.reduce((a, b) => a > b ? a : b);
    if (most == 0) return const TriFact(Tri.notIncluded);
    return TriFact(Tri.known, pieces: least, kg: kg, varies: least != most);
  }

  /// A change/refund rule across tickets: allowed, not allowed, or UNKNOWN when any ticket says nothing.
  static TriFact condition(List<Json> offers, String key) {
    if (offers.isEmpty) return const TriFact.unknown();
    final allowed = <bool>[];
    for (final o in offers) {
      final c = o.obj('conditions').obj(key);
      if (c.str('status') != 'KNOWN') return const TriFact.unknown();
      allowed.add(c.obj('value').flag('allowed'));
    }
    final yes = allowed.where((a) => a).length;
    if (yes == 0) return const TriFact(Tri.notIncluded);
    return TriFact(Tri.known, varies: yes != allowed.length);
  }
}

/// What the case actually has on file, kept as separate rungs (rule 3: snapshot, quote, reservation, ticket, payment).
class CaseTruth {
  const CaseTruth({
    required this.hasSnapshot,
    required this.baggage,
    required this.change,
    required this.refund,
    required this.quoteStatuses,
    required this.reservationStatus,
    required this.ticketingDeadline,
    required this.tickets,
  });
  final bool hasSnapshot;
  final TriFact baggage;
  final TriFact change;
  final TriFact refund;
  final List<String> quoteStatuses;
  final String? reservationStatus;
  final DateTime? ticketingDeadline;
  final int tickets;

  /// Any UNKNOWN attribute blocks sending a quote (rule 3); with no snapshot every attribute is UNKNOWN.
  bool get hasUnknown => [baggage, change, refund].any((f) => f.state == Tri.unknown);

  factory CaseTruth.fromJson(Json j) {
    final snap = j.objOrNull('snapshot');
    final it = snap?.obj('itinerary') ?? const <String, dynamic>{};
    final components = it.objs('components');
    final segmentBags = it.objs('baggage').isNotEmpty ? it.objs('baggage') : [for (final c in components) ...c.objs('baggage')];
    final reservations = j.objs('reservations').where((r) => const {'HELD', 'CONFIRMED'}.contains(r.str('status')));
    final res = reservations.firstOrNull;
    return CaseTruth(
      hasSnapshot: snap != null,
      baggage: snap == null ? const TriFact.unknown() : TriFact.baggage(segmentBags),
      change: snap == null ? const TriFact.unknown() : TriFact.condition(components, 'change'),
      refund: snap == null ? const TriFact.unknown() : TriFact.condition(components, 'refund'),
      quoteStatuses: j.objs('quotes').map((q) => q.str('status')).toList(),
      reservationStatus: res?.str('status'),
      ticketingDeadline: parseDate(res?['ticketingDeadline']),
      tickets: j.objs('tickets').length,
    );
  }
}
