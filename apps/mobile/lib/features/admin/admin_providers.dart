import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../models/admin.dart';
import '../../models/json.dart';

final queueSummaryProvider = FutureProvider.autoDispose<QueueSummary>((ref) async {
  return QueueSummary.fromJson(await ref.watch(apiClientProvider).getJson('/v1/admin/queues/summary'));
});

/// Cases for `tab` (`new|mine|awaiting|quoted|reserved`).
final adminCasesProvider = FutureProvider.autoDispose.family<List<AdminListItem>, String>((ref, tab) async {
  final j = await ref.watch(apiClientProvider).getJson('/v1/admin/flight-requests', query: {'tab': tab, 'limit': 50});
  return j.objs('items').map(AdminListItem.fromJson).toList();
});

final adminCaseProvider = FutureProvider.autoDispose.family<AdminCase, String>((ref, id) async {
  return AdminCase.fromJson(await ref.watch(apiClientProvider).getJson('/v1/admin/flight-requests/$id'));
});
