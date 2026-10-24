import 'package:flutter/foundation.dart';

/// Build-time configuration (`--dart-define=API_URL=...`).
abstract final class AppConfig {
  static const apiUrl = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://localhost:4100',
  );

  /// The website, where invoices are paid by card (ADR-0007): the app opens its pay page in the system browser and
  /// holds no payment keys of its own.
  static const webUrl = String.fromEnvironment(
    'WEB_URL',
    defaultValue: 'http://localhost:4000',
  );

  /// Registers a placeholder push token on web builds (real FCM/APNs credentials
  /// are a Stage 0 item), so the device-registration path is exercised end to end.
  static const registerPlaceholderPush = bool.fromEnvironment(
    'PUSH_PLACEHOLDER',
    defaultValue: true,
  );

  /// `?semantics` in the page URL (or `--dart-define=SEMANTICS=true`) turns on the
  /// accessibility tree up front. Browser automation locates elements through it.
  static bool get semantics =>
      const bool.fromEnvironment('SEMANTICS') ||
      (kIsWeb && Uri.base.queryParameters.containsKey('semantics'));
}
