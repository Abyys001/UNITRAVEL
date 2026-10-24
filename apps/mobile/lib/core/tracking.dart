import '../l10n/app_localizations.dart';

/// Customer-facing label for a tracking event code (Phase E): the raw code is never shown. Unknown codes from a newer
/// server fall back to the neutral "Update".
String trackingLabel(AppL10n l, String code) => switch (code) {
  'PICKED_UP' => l.trackEventPickedUp,
  'RECEIVED' => l.trackEventReceived,
  'DEPARTED' => l.trackEventDeparted,
  'ARRIVED' => l.trackEventArrived,
  'AT_CUSTOMS' => l.trackEventAtCustoms,
  'CLEARED' => l.trackEventCleared,
  'OUT_FOR_DELIVERY' => l.trackEventOutForDelivery,
  'DELIVERED' => l.trackEventDelivered,
  'HELD' => l.trackEventHeld,
  'DAMAGED' => l.trackEventDamaged,
  'RETURNED' => l.trackEventReturned,
  _ => l.trackEventNote,
};
