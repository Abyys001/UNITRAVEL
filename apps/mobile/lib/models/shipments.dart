import 'json.dart';

/// One tracking event as the customer sees it: the effective (corrected) state only.
class TrackEvent {
  const TrackEvent({required this.id, required this.code, required this.location, required this.occurredAt, required this.description, required this.corrected});
  final String id;
  final String code;
  final String location;
  final DateTime? occurredAt;
  final String? description;
  final bool corrected;

  factory TrackEvent.fromJson(Json j) => TrackEvent(
    id: j.str('id'),
    code: j.str('eventCode'),
    location: j.str('location'),
    occurredAt: parseDate(j['occurredAt']),
    description: j.strOrNull('description'),
    corrected: j.flag('corrected'),
  );
}

class ShipmentItem {
  const ShipmentItem({required this.ref, required this.status, required this.statusLabel, required this.laneLabel, required this.awbNumber, required this.estimatedDeliveryAt, required this.timeline});
  final String ref;
  final String status;
  final String statusLabel;
  final String laneLabel;
  final String? awbNumber;
  final DateTime? estimatedDeliveryAt;
  final List<TrackEvent> timeline;

  factory ShipmentItem.fromJson(Json j) => ShipmentItem(
    ref: j.str('ref'),
    status: j.str('status'),
    statusLabel: j.str('statusLabel'),
    laneLabel: j.str('laneLabel'),
    awbNumber: j.strOrNull('awbNumber'),
    estimatedDeliveryAt: parseDate(j['estimatedDeliveryAt']),
    timeline: j.objs('timeline').map(TrackEvent.fromJson).toList(),
  );
}

class ShipmentSummary {
  const ShipmentSummary({required this.total, required this.inTransit, required this.delivered, required this.nextRef, required this.nextLane, required this.nextEta});
  final int total;
  final int inTransit;
  final int delivered;
  final String? nextRef;
  final String? nextLane;
  final DateTime? nextEta;

  factory ShipmentSummary.fromJson(Json j) {
    final next = j.objOrNull('next');
    return ShipmentSummary(
      total: j.integer('total'),
      inTransit: j.integer('inTransit'),
      delivered: j.integer('delivered'),
      nextRef: next?.strOrNull('ref'),
      nextLane: next?.strOrNull('laneLabel'),
      nextEta: parseDate(next?['estimatedDeliveryAt']),
    );
  }
}
