import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers.dart';

/// Public site configuration (`GET /v1/site`, spec §4.1): which menu items are switched on. Any error means "off", so a
/// switched-off service is never advertised in the app.
final siteMenuProvider = FutureProvider.autoDispose<Map<String, bool>>((ref) async {
  try {
    final j = await ref.watch(apiClientProvider).getJson('/v1/site', auth: false);
    final menu = j['menu'];
    if (menu is! Map) return const <String, bool>{};
    return {
      for (final e in menu.entries)
        if (e.key is String && e.value is bool) e.key as String: e.value as bool,
    };
  } catch (_) {
    return const <String, bool>{};
  }
});
