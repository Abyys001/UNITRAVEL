import 'json.dart';

/// Verification state of a traveller document (ADR-0005). The server decides every transition; the app only reads it.
enum VerificationStatus {
  unverified('UNVERIFIED'),
  submitted('SUBMITTED'),
  verified('VERIFIED'),
  rejected('REJECTED'),
  correctionRequired('CORRECTION_REQUIRED');

  const VerificationStatus(this.code);
  final String code;

  static VerificationStatus parse(String? code) =>
      VerificationStatus.values.firstWhere((s) => s.code == code, orElse: () => VerificationStatus.unverified);
}

class VerificationReason {
  const VerificationReason({required this.code, required this.text});
  final String code;

  /// Written by the reviewer for the customer; shown as is.
  final String text;
}

class Verification {
  const Verification({
    required this.status,
    this.confirmedAt,
    this.reviewHash,
    this.reason,
    this.scanDocumentId,
    this.scanFilename,
  });

  static const none = Verification(status: VerificationStatus.unverified);

  final VerificationStatus status;
  final DateTime? confirmedAt;

  /// Hash of the values on screen; sent back on confirm so a change under review is caught.
  final String? reviewHash;
  final VerificationReason? reason;
  final String? scanDocumentId;
  final String? scanFilename;

  bool get hasScan => scanDocumentId != null;

  factory Verification.fromJson(Json j) {
    final reason = j.objOrNull('reason');
    final scan = j.objOrNull('scan');
    return Verification(
      status: VerificationStatus.parse(j.strOrNull('status')),
      confirmedAt: parseDate(j['confirmedAt']),
      reviewHash: j.strOrNull('reviewHash'),
      reason: reason == null ? null : VerificationReason(code: reason.str('code'), text: reason.str('text')),
      scanDocumentId: scan?.strOrNull('documentId'),
      scanFilename: scan?.strOrNull('filename'),
    );
  }
}

class DocumentSummary {
  const DocumentSummary({required this.last4, required this.issuingCountry, required this.expiryDate});
  final String last4;
  final String issuingCountry;
  final String expiryDate;

  factory DocumentSummary.fromJson(Json j) =>
      DocumentSummary(last4: j.str('last4'), issuingCountry: j.str('issuingCountry'), expiryDate: j.str('expiryDate'));
}

class ContactMethod {
  const ContactMethod({required this.id, required this.type, required this.value, required this.verified});
  final String id;
  final String type;
  final String value;
  final bool verified;
}

class Address {
  const Address({required this.line1, this.line2, required this.city, required this.postcode, required this.country});
  final String line1;
  final String? line2;
  final String city;
  final String postcode;
  final String country;

  Json toJson() => {'line1': line1, if (line2 != null && line2!.isNotEmpty) 'line2': line2, 'city': city, 'postcode': postcode, 'country': country};
}
