import 'json.dart';

/// Customer-facing invoice (ADR-0006): amounts exist only here, on an issued invoice; a draft never reaches the app.
class InvoiceLine {
  const InvoiceLine({required this.description, required this.quantity, required this.unitAmount, required this.amount});
  final String description;
  final int quantity;
  final Money? unitAmount;
  final Money? amount;

  factory InvoiceLine.fromJson(Json j) => InvoiceLine(
    description: j.str('description'),
    quantity: j.integer('quantity', 1),
    unitAmount: Money.from(j['unitAmount']),
    amount: Money.from(j['amount']),
  );
}

class Invoice {
  const Invoice({
    required this.number, required this.status, required this.requestRef, required this.productType, required this.lines, required this.total,
    required this.issuedAt, required this.expiresAt, required this.paidAt, required this.cancelledAt, required this.cancelReason, required this.documentId,
  });
  final String number;
  final String status;
  final String requestRef;
  final String productType;
  final List<InvoiceLine> lines;
  final Money? total;
  final DateTime? issuedAt;
  final DateTime? expiresAt;
  final DateTime? paidAt;
  final DateTime? cancelledAt;
  final String? cancelReason;
  final String? documentId;

  factory Invoice.fromJson(Json j) => Invoice(
    number: j.str('number'),
    status: j.str('status'),
    requestRef: j.str('requestRef'),
    productType: j.str('productType', 'FLIGHT'),
    lines: j.objs('lines').map(InvoiceLine.fromJson).toList(),
    total: Money.from(j['total']),
    issuedAt: parseDate(j['issuedAt']),
    expiresAt: parseDate(j['expiresAt']),
    paidAt: parseDate(j['paidAt']),
    cancelledAt: parseDate(j['cancelledAt']),
    cancelReason: j.strOrNull('cancelReason'),
    documentId: j.strOrNull('documentId'),
  );
}

/// The sent quote with its number and PDF; carries no amount (the quote itself is on the request page).
class Quotation {
  const Quotation({required this.number, required this.requestRef, required this.productType, required this.status, required this.sentAt, required this.validUntil, required this.documentId});
  final String number;
  final String requestRef;
  final String productType;
  final String status;
  final DateTime? sentAt;
  final DateTime? validUntil;
  final String? documentId;

  factory Quotation.fromJson(Json j) => Quotation(
    number: j.str('number'),
    requestRef: j.str('requestRef'),
    productType: j.str('productType', 'FLIGHT'),
    status: j.str('status'),
    sentAt: parseDate(j['sentAt']),
    validUntil: parseDate(j['validUntil']),
    documentId: j.strOrNull('documentId'),
  );
}

class BillingDocs {
  const BillingDocs(this.quotations, this.invoices);
  final List<Quotation> quotations;
  final List<Invoice> invoices;

  factory BillingDocs.fromJson(Json j) => BillingDocs(j.objs('quotations').map(Quotation.fromJson).toList(), j.objs('invoices').map(Invoice.fromJson).toList());
}

/// The payment state the server reports for an own invoice (ADR-0007); read from the database, never from a redirect.
class InvoicePayment {
  const InvoicePayment({required this.offered, required this.processing});
  final bool offered;
  final bool processing;

  factory InvoicePayment.fromJson(Json j) => InvoicePayment(offered: j['offered'] == true, processing: j['processing'] == true);
}
