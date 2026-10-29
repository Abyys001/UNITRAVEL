import 'package:kit_ui/kit_ui.dart' show XfamTone;

import '../../l10n/app_localizations.dart';
import '../../models/services.dart';

String serviceTypeLabel(AppL10n l, ServiceType t) => switch (t) {
  ServiceType.visa => l.menuVisa,
  ServiceType.tour => l.svTourName,
  ServiceType.cip => l.menuCip,
  ServiceType.insurance => l.menuInsurance,
  ServiceType.hotel => l.menuHotels,
  ServiceType.stay => l.menuStays,
  ServiceType.train => l.menuTrains,
  ServiceType.bus => l.menuBuses,
};

/// Customer wording per status (matches the website's `services.status`). A compliance hold reads as "Received": the
/// customer is never told about internal checks.
String serviceStatusLabel(AppL10n l, String status) => switch (status) {
  'SUBMITTED' || 'COMPLIANCE_HOLD' => l.svStatusReceived,
  'IN_PROGRESS' => l.svStatusInProgress,
  'QUOTED' => l.svStatusQuoted,
  'CONFIRMED' => l.svStatusConfirmed,
  'COMPLETED' => l.svStatusCompleted,
  'CANCELLED' => l.svStatusCancelled,
  'CLOSED_NO_RESPONSE' => l.svStatusNoReply,
  'DECLINED' => l.svStatusClosed,
  _ => status,
};

XfamTone serviceStatusTone(String status) => switch (status) {
  'QUOTED' => XfamTone.warning,
  'CONFIRMED' || 'COMPLETED' => XfamTone.success,
  'CANCELLED' || 'DECLINED' || 'CLOSED_NO_RESPONSE' => XfamTone.danger,
  'IN_PROGRESS' => XfamTone.info,
  _ => XfamTone.neutral,
};
