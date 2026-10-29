import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/services.dart';
import 'providers.dart';

/// Public site configuration (`GET /v1/site`, spec §4.1): which menu items are switched on and the support contacts. Any
/// error means "off" and "no contacts", so a switched-off service is never advertised in the app.
final siteConfigProvider = FutureProvider.autoDispose<SiteConfig>((ref) async {
  try {
    final j = await ref.watch(apiClientProvider).getJson('/v1/site', auth: false);
    return SiteConfig.fromJson(j);
  } catch (_) {
    return SiteConfig.empty;
  }
});

final siteMenuProvider = FutureProvider.autoDispose<Map<String, bool>>((ref) async => (await ref.watch(siteConfigProvider.future)).menu);
