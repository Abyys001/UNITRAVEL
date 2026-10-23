import '../l10n/app_localizations.dart';
import 'api_error.dart';

/// User-facing text for an API failure. Codes are stable (ch. 24.2); the
/// server's `title` is only a last resort because it is not always localised.
String errorMessage(AppL10n l, Object error) {
  if (error is! ApiException) return l.errGeneric;
  switch (error.code) {
    case ApiException.networkCode:
      return l.errNetwork;
    case 'RATE_LIMITED':
      final s = error.retryAfter;
      return s == null ? l.errRateLimited : l.errRateLimitedIn(s);
    case 'OTP_INVALID':
      return l.errOtpInvalid;
    case 'OTP_EXPIRED':
      return l.errOtpExpired;
    case 'OTP_LOCKED':
      return l.errOtpLocked;
    case 'VALIDATION_FAILED':
      return error.fieldErrors.isEmpty
          ? l.errValidation
          : '${l.errValidation} ${error.fieldErrors.values.where((v) => v.isNotEmpty).take(2).join('; ')}';
    case 'FORBIDDEN':
    case 'PHONE_NOT_VERIFIED':
      return l.errForbidden;
    case 'NOT_FOUND':
      return l.errNotFound;
    case 'VERSION_CONFLICT':
    case 'INVALID_TRANSITION':
      return l.errConflict;
    case 'OFFER_EXPIRED':
      return l.errOfferExpired;
    case 'PRICE_CHANGED':
      return l.errPriceChanged;
    case 'SEARCH_EXPIRED':
      return l.errSearchExpired;
    case 'SUPPLIER_UNAVAILABLE':
      return l.errSupplier;
    case 'FEATURE_DISABLED':
    case 'LANE_DISABLED':
      return l.errFeatureDisabled;
    case 'MFA_REQUIRED':
    case 'STEP_UP_REQUIRED':
      return l.errMfa;
    default:
      return error.title.isEmpty ? l.errGeneric : error.title;
  }
}

/// Codes that mean "show the second-factor gate" in admin mode.
bool needsSecondFactor(Object error) =>
    error is ApiException && (error.code == 'MFA_REQUIRED' || error.code == 'STEP_UP_REQUIRED');
