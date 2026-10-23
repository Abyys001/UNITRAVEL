import 'json.dart';

class QueueSummary {
  const QueueSummary({required this.newCount, required this.mine, required this.awaiting, required this.quoted, required this.reserved, required this.slaBreaches});
  final int newCount;
  final int mine;
  final int awaiting;
  final int quoted;
  final int reserved;
  final int slaBreaches;

  factory QueueSummary.fromJson(Json j) => QueueSummary(
    newCount: j.integer('new'),
    mine: j.integer('mine'),
    awaiting: j.integer('awaitingCustomer'),
    quoted: j.integer('quoted'),
    reserved: j.integer('reserved'),
    slaBreaches: j.integer('slaBreaches'),
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
    );
  }
}
