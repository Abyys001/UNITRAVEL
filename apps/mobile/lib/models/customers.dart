import 'json.dart';

/// Staff customer list row (`GET /v1/admin/customers`); contact details arrive masked.
class CustomerItem {
  const CustomerItem({
    required this.id,
    required this.displayName,
    required this.email,
    required this.phone,
    required this.verified,
    required this.status,
    required this.lastActiveAt,
    required this.online,
    required this.lastScreen,
    required this.openRequests,
    required this.signInCount,
  });
  final String id;
  final String displayName;
  final String? email;
  final String? phone;
  final bool verified;
  final String status;
  final DateTime? lastActiveAt;
  final bool online;
  final String? lastScreen;
  final int openRequests;
  final int signInCount;

  String? get contact => email ?? phone;

  factory CustomerItem.fromJson(Json j) => CustomerItem(
    id: j.str('id'),
    displayName: j.str('displayName'),
    email: j.strOrNull('email'),
    phone: j.strOrNull('phone'),
    verified: j.flag('verified'),
    status: j.str('status', 'ACTIVE'),
    lastActiveAt: parseDate(j['lastActiveAt']),
    online: j.flag('online'),
    lastScreen: j.strOrNull('lastScreen'),
    openRequests: j.integer('openRequests'),
    signInCount: j.integer('signInCount'),
  );
}

class CustomerPage {
  const CustomerPage(this.items, this.nextCursor);
  final List<CustomerItem> items;
  final String? nextCursor;

  factory CustomerPage.fromJson(Json j) => CustomerPage(
    j.objs('items').map(CustomerItem.fromJson).toList(),
    j.strOrNull('nextCursor'),
  );
}

class ActivityEntry {
  const ActivityEntry({
    required this.id,
    required this.kind,
    required this.screen,
    required this.ref,
    required this.client,
    required this.occurredAt,
  });
  final String id;
  final String kind;
  final String? screen;
  final String? ref;
  final String? client;
  final DateTime? occurredAt;

  factory ActivityEntry.fromJson(Json j) => ActivityEntry(
    id: j.str('id'),
    kind: j.str('kind'),
    screen: j.strOrNull('screen'),
    ref: j.strOrNull('ref'),
    client: j.strOrNull('client'),
    occurredAt: parseDate(j['occurredAt']),
  );
}

class CustomerActivity {
  const CustomerActivity({
    required this.retentionDays,
    required this.trackingEnabled,
    required this.activeSessions,
    required this.totalSessions,
    required this.entries,
    required this.nextCursor,
  });
  final int retentionDays;
  final bool trackingEnabled;
  final int activeSessions;
  final int totalSessions;
  final List<ActivityEntry> entries;
  final String? nextCursor;

  factory CustomerActivity.fromJson(Json j) {
    final sessions = j.obj('sessions');
    final activity = j.obj('activity');
    return CustomerActivity(
      retentionDays: j.integer('retentionDays', 90),
      trackingEnabled: j.flag('trackingEnabled', true),
      activeSessions: sessions.integer('active'),
      totalSessions: sessions.integer('total'),
      entries: activity.objs('items').map(ActivityEntry.fromJson).toList(),
      nextCursor: activity.strOrNull('nextCursor'),
    );
  }
}
