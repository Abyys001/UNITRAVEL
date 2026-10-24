import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import 'api_client.dart';
import 'cache.dart';
import 'config.dart';
import 'token_store.dart';

final sharedPreferencesProvider = Provider<SharedPreferences>(
  (ref) => throw UnimplementedError('override sharedPreferencesProvider'),
);

final tokenStoreProvider = Provider<TokenStore>((ref) => const SecureTokenStore());

final dioProvider = Provider<Dio>(
  (ref) => Dio(
    BaseOptions(
      baseUrl: AppConfig.apiUrl,
      connectTimeout: const Duration(seconds: 15),
      receiveTimeout: const Duration(seconds: 30),
      contentType: Headers.jsonContentType,
    ),
  ),
);

final cacheProvider = Provider<JsonCache>((ref) => JsonCache(ref.watch(sharedPreferencesProvider)));

/// Stable random id per install, sent as `x-device-id` and with OTP requests.
final deviceIdProvider = Provider<String>((ref) {
  final prefs = ref.watch(sharedPreferencesProvider);
  final existing = prefs.getString('ut.device_id');
  if (existing != null) return existing;
  final id = const Uuid().v4();
  prefs.setString('ut.device_id', id);
  return id;
});

/// UI language: EN or FA (FA switches the whole app to RTL).
class LocaleNotifier extends Notifier<Locale> {
  static const _key = 'ut.locale';

  @override
  Locale build() {
    final saved = ref.watch(sharedPreferencesProvider).getString(_key);
    return Locale(saved == 'fa' ? 'fa' : 'en');
  }

  Future<void> set(String code) async {
    state = Locale(code == 'fa' ? 'fa' : 'en');
    await ref.read(sharedPreferencesProvider).setString(_key, state.languageCode);
  }
}

final localeProvider = NotifierProvider<LocaleNotifier, Locale>(LocaleNotifier.new);

/// Light / dark / system, persisted. Only admin mode follows it (see app.dart); customer screens stay light.
class ThemeModeNotifier extends Notifier<ThemeMode> {
  static const _key = 'ut.theme_mode';

  @override
  ThemeMode build() {
    final saved = ref.watch(sharedPreferencesProvider).getString(_key);
    return ThemeMode.values.where((m) => m.name == saved).firstOrNull ?? ThemeMode.system;
  }

  Future<void> set(ThemeMode mode) async {
    state = mode;
    await ref.read(sharedPreferencesProvider).setString(_key, mode.name);
  }
}

final themeModeProvider = NotifierProvider<ThemeModeNotifier, ThemeMode>(ThemeModeNotifier.new);

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    ref.watch(dioProvider),
    deviceId: ref.watch(deviceIdProvider),
    localeCode: () => ref.read(localeProvider).languageCode,
  );
});
