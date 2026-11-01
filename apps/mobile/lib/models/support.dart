import 'json.dart';

/// Support topics accepted by `POST /v1/support/tickets`.
const supportTopics = [
  'BOOKING',
  'PAYMENT',
  'DOCUMENTS',
  'VISA',
  'CARGO',
  'ACCOUNT',
  'FEEDBACK',
  'OTHER',
];

class TicketMessage {
  const TicketMessage({
    required this.id,
    required this.fromCustomer,
    required this.authorName,
    required this.body,
    required this.createdAt,
  });
  final String id;
  final bool fromCustomer;
  final String authorName;
  final String body;
  final DateTime? createdAt;

  factory TicketMessage.fromJson(Json j) => TicketMessage(
    id: j.str('id'),
    fromCustomer: j.str('direction') == 'FROM_CUSTOMER',
    authorName: j.str('authorName'),
    body: j.str('body'),
    createdAt: parseDate(j['createdAt']),
  );
}

/// A customer's own ticket. Internal staff notes never reach the API payload, so there is nothing to hide here.
class Ticket {
  const Ticket({
    required this.ref,
    required this.topic,
    required this.subject,
    required this.status,
    required this.requestRef,
    required this.updatedAt,
    required this.lastMessageAt,
    this.messages = const [],
    this.canReply = false,
  });
  final String ref;
  final String topic;
  final String subject;
  final String status;
  final String? requestRef;
  final DateTime? updatedAt;
  final DateTime? lastMessageAt;
  final List<TicketMessage> messages;
  final bool canReply;

  factory Ticket.fromJson(Json j) => Ticket(
    ref: j.str('ref'),
    topic: j.str('topic', 'OTHER'),
    subject: j.str('subject'),
    status: j.str('status', 'OPEN'),
    requestRef: j.strOrNull('requestRef'),
    updatedAt: parseDate(j['updatedAt']),
    lastMessageAt: parseDate(j['lastMessageAt']),
    messages: j.objs('messages').map(TicketMessage.fromJson).toList(),
    canReply: j.flag('canReply'),
  );
}
