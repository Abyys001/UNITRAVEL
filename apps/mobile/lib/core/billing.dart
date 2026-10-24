import 'package:kit_ui/kit_ui.dart' show XfamTone;

import '../l10n/app_localizations.dart';

/// Customer wording for invoice and quotation states and cancel reasons (ADR-0006): raw codes are never shown.
String invoiceStatusLabel(AppL10n l, String status) => switch (status) {
  'PAID' => l.invoicePaid,
  'CANCELLED' => l.invoiceCancelled,
  'REFUNDED' => l.invoiceRefunded,
  _ => l.invoiceIssued,
};

XfamTone invoiceTone(String status) => switch (status) {
  'PAID' => XfamTone.success,
  'CANCELLED' || 'REFUNDED' => XfamTone.danger,
  _ => XfamTone.neutral,
};

String quoteStatusLabel(AppL10n l, String status) => switch (status) {
  'ACCEPTED' => l.quoteAccepted,
  'DECLINED' => l.quoteDeclined,
  'EXPIRED' => l.quoteExpired,
  'SUPERSEDED' => l.quoteSuperseded,
  _ => l.quoteSent,
};

/// Every cancelled invoice says not to pay it; an unknown reason from a newer server falls back to the generic line.
String cancelReasonText(AppL10n l, String? code) => switch (code) {
  'EXPIRED' => l.cancelReasonExpired,
  'CORRECTION' => l.cancelReasonCorrection,
  'CUSTOMER_REQUEST' => l.cancelReasonCustomerRequest,
  'DUPLICATE' => l.cancelReasonDuplicate,
  _ => l.cancelReasonOther,
};
