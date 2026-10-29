import 'json.dart';
import 'requests.dart';

/// Request-based services (ADR-0015). The enum names are the API's `type` values.
enum ServiceType {
  visa('VISA', 'visa', 'visa'),
  tour('TOUR_CALLBACK', 'tours', 'tours'),
  cip('CIP', 'cip', 'cip'),
  insurance('INSURANCE', 'insurance', 'insurance'),
  hotel('HOTEL', 'hotels', 'hotels'),
  stay('STAY', 'stays', 'stays'),
  train('TRAIN', 'trains', 'trains'),
  bus('BUS', 'buses', 'buses');

  const ServiceType(this.api, this.menuKey, this.path);
  final String api;
  final String menuKey;

  /// Route segment in `/services/new/:path`.
  final String path;

  static ServiceType? fromApi(String? v) {
    for (final t in values) {
      if (t.api == v) return t;
    }
    return null;
  }

  static ServiceType? fromPath(String? v) {
    for (final t in values) {
      if (t.path == v) return t;
    }
    return null;
  }

  /// Hotels, stays, trains and buses have no provider yet: the form is a request, never a listing.
  bool get listing => this == hotel || this == stay || this == train || this == bus;
  bool get needsTravellers => this == visa || this == insurance;
}

class ServiceSummary {
  const ServiceSummary({required this.ref, required this.type, required this.status, required this.title, required this.createdAt, required this.updatedAt});
  final String ref;
  final ServiceType? type;
  final String status;
  final String title;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  factory ServiceSummary.fromJson(Json j) => ServiceSummary(
    ref: j.str('ref'),
    type: ServiceType.fromApi(j.strOrNull('type')),
    status: j.str('status'),
    title: j.str('title'),
    createdAt: parseDate(j['createdAt']),
    updatedAt: parseDate(j['updatedAt']),
  );
}

class QuoteLine {
  const QuoteLine({required this.kind, required this.label, required this.amount});
  final String kind;
  final String label;
  final Money? amount;
}

class ServiceQuote {
  const ServiceQuote({required this.status, required this.lines, required this.total, required this.validUntil, required this.note});
  final String status;
  final List<QuoteLine> lines;
  final Money? total;
  final DateTime? validUntil;
  final String? note;

  factory ServiceQuote.fromJson(Json j) => ServiceQuote(
    status: j.str('status'),
    lines: [for (final l in j.objs('lines')) QuoteLine(kind: l.str('kind'), label: l.str('label'), amount: Money.from(l['amount']))],
    total: Money.from(j['total']),
    validUntil: parseDate(j['validUntil']),
    note: j.strOrNull('note'),
  );
}

class ServiceDetail {
  const ServiceDetail({
    required this.summary,
    required this.details,
    required this.timeline,
    required this.messages,
    required this.quote,
    required this.canCancel,
    required this.canAcceptQuote,
  });
  final ServiceSummary summary;
  final Json details;
  final List<TimelineItem> timeline;
  final List<MessageItem> messages;
  final ServiceQuote? quote;
  final bool canCancel;
  final bool canAcceptQuote;

  factory ServiceDetail.fromJson(Json j) {
    final q = j.objOrNull('quote');
    return ServiceDetail(
      summary: ServiceSummary.fromJson(j),
      details: j.obj('details'),
      timeline: j.objs('timeline').map(TimelineItem.fromJson).toList(),
      messages: j.objs('messages').map(MessageItem.fromJson).toList(),
      quote: q == null ? null : ServiceQuote.fromJson(q),
      canCancel: j.flag('canCancel'),
      canAcceptQuote: j.flag('canAcceptQuote'),
    );
  }
}

/// One row of `GET /v1/track`: flights, cargo, services and invoices in a single list.
class TrackItem {
  const TrackItem({required this.kind, required this.ref, required this.status, required this.statusLabel, required this.title, required this.serviceType, required this.updatedAt});
  final String kind;
  final String ref;
  final String status;
  final String statusLabel;
  final String title;
  final ServiceType? serviceType;
  final DateTime? updatedAt;

  factory TrackItem.fromJson(Json j) => TrackItem(
    kind: j.str('kind'),
    ref: j.str('ref'),
    status: j.str('status'),
    statusLabel: j.str('statusLabel'),
    title: j.str('title'),
    serviceType: ServiceType.fromApi(j.strOrNull('serviceType')),
    updatedAt: parseDate(j['updatedAt']),
  );

  /// Where the row opens in the app.
  String get route => switch (kind) {
    'SERVICE' => '/services/$ref',
    'INVOICE' => '/account/billing/$ref',
    _ => '/requests/$ref',
  };
}

/// `POST /v1/track/verify`: the status timeline only, no names, amounts or documents.
class PublicTrack {
  const PublicTrack({required this.ref, required this.kind, required this.status, required this.timeline});
  final String ref;
  final String kind;
  final String status;
  final List<({DateTime? at, String status})> timeline;

  factory PublicTrack.fromJson(Json j) => PublicTrack(
    ref: j.str('ref'),
    kind: j.str('kind'),
    status: j.str('status'),
    timeline: [for (final t in j.objs('timeline')) (at: parseDate(t['at']), status: t.str('status'))],
  );
}

class ClubBenefit {
  const ClubBenefit({required this.id, required this.kind, required this.value, required this.currency, required this.appliesTo, required this.descriptionEn, required this.descriptionFa, required this.validTo});
  final String id;
  final String kind;
  final int value;
  final String? currency;
  final String appliesTo;
  final String descriptionEn;
  final String descriptionFa;
  final DateTime? validTo;

  factory ClubBenefit.fromJson(Json j) => ClubBenefit(
    id: j.str('id'),
    kind: j.str('kind'),
    value: j.integer('value'),
    currency: j.strOrNull('currency'),
    appliesTo: j.str('appliesTo', 'ANY'),
    descriptionEn: j.obj('description').str('en'),
    descriptionFa: j.obj('description').str('fa'),
    validTo: parseDate(j['validTo']),
  );

  String description(String lang) {
    final fa = descriptionFa;
    final en = descriptionEn;
    return lang == 'fa' ? (fa.isEmpty ? en : fa) : (en.isEmpty ? fa : en);
  }
}

/// `GET /v1/me/club` (ADR-0016): the customer's own membership. `enabled: false` while the flag is off.
class ClubView {
  const ClubView({required this.enabled, required this.tierEn, required this.tierFa, required this.status, required this.joinedAt, required this.benefits, required this.credit});
  final bool enabled;
  final String? tierEn;
  final String? tierFa;
  final String? status;
  final DateTime? joinedAt;
  final List<ClubBenefit> benefits;
  final List<Money> credit;

  bool get member => status != null;

  factory ClubView.fromJson(Json j) {
    final m = j.objOrNull('member');
    final tier = m?.obj('tier');
    return ClubView(
      enabled: j.flag('enabled'),
      tierEn: tier?.strOrNull('nameEn'),
      tierFa: tier?.strOrNull('nameFa'),
      status: m?.strOrNull('status'),
      joinedAt: parseDate(m?['joinedAt']),
      benefits: j.objs('benefits').map(ClubBenefit.fromJson).toList(),
      credit: [for (final c in (j['creditBalance'] as List? ?? const [])) if (Money.from(c) != null) Money.from(c)!],
    );
  }
}

/// `GET /v1/site`: which menu items are on, plus the support contacts the owner has confirmed.
class SiteConfig {
  const SiteConfig({required this.menu, this.phone, this.email, this.hoursEn, this.hoursFa});
  final Map<String, bool> menu;
  final String? phone;
  final String? email;
  final String? hoursEn;
  final String? hoursFa;

  static const empty = SiteConfig(menu: <String, bool>{});

  bool on(String key) => menu[key] == true;

  factory SiteConfig.fromJson(Json j) {
    final menu = j['menu'];
    final s = j.obj('support');
    final h = s.objOrNull('hours');
    return SiteConfig(
      menu: menu is Map ? {for (final e in menu.entries) if (e.key is String && e.value is bool) e.key as String: e.value as bool} : const <String, bool>{},
      phone: s.strOrNull('phone'),
      email: s.strOrNull('email'),
      hoursEn: h?.strOrNull('en'),
      hoursFa: h?.strOrNull('fa'),
    );
  }
}
