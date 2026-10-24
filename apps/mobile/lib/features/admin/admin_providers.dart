import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/session.dart';
import '../../models/admin.dart';
import '../../models/json.dart';

final queueSummaryProvider = FutureProvider.autoDispose<QueueSummary>((ref) async {
  final s = QueueSummary.fromJson(await ref.watch(apiClientProvider).getJson('/v1/admin/queues/summary'));
  // After the await: not a provider-initialisation side effect. Observed values only feed the device-local trend.
  ref.read(summaryHistoryProvider.notifier).record(s);
  return s;
});

/// Cases for `tab` (`new|mine|awaiting|quoted|reserved`).
final adminCasesProvider = FutureProvider.autoDispose.family<List<AdminListItem>, String>((ref, tab) async {
  final j = await ref.watch(apiClientProvider).getJson('/v1/admin/flight-requests', query: {'tab': tab, 'limit': 50});
  return j.objs('items').map(AdminListItem.fromJson).toList();
});

/// Server-side lookup by reference or phone fragment (same endpoint, `q`).
final adminSearchProvider = FutureProvider.autoDispose.family<List<AdminListItem>, String>((ref, q) async {
  final j = await ref.watch(apiClientProvider).getJson('/v1/admin/flight-requests', query: {'q': q, 'limit': 25});
  return j.objs('items').map(AdminListItem.fromJson).toList();
});

final adminCaseProvider = FutureProvider.autoDispose.family<AdminCase, String>((ref, id) async {
  return AdminCase.fromJson(await ref.watch(apiClientProvider).getJson('/v1/admin/flight-requests/$id'));
});

/// Identity checks waiting for review, or null when this account may not see them (no `identity.verify`).
final pendingVerificationsProvider = FutureProvider.autoDispose<int?>((ref) async {
  final perms = ref.watch(sessionProvider.select((s) => s.me?.permissions ?? const <String>[]));
  if (!perms.contains('identity.verify')) return null;
  final raw = await ref.watch(apiClientProvider).get('/v1/admin/verifications');
  return raw is List ? raw.length : 0;
});

/// Open compliance cases, or null without `compliance.case.read`.
final openComplianceCasesProvider = FutureProvider.autoDispose<int?>((ref) async {
  final perms = ref.watch(sessionProvider.select((s) => s.me?.permissions ?? const <String>[]));
  if (!perms.contains('compliance.case.read')) return null;
  final raw = await ref.watch(apiClientProvider).get('/v1/admin/compliance/cases', query: {'status': 'OPEN'});
  return raw is List ? raw.length : 0;
});

/// Wall clock for SLA countdowns, ticking twice a minute.
final nowProvider = StreamProvider.autoDispose<DateTime>((ref) async* {
  yield DateTime.now();
  yield* Stream.periodic(const Duration(seconds: 30), (_) => DateTime.now());
});

/// One observed summary. The API has no history endpoint, so trends are built from what this device has seen.
class SummarySample {
  const SummarySample(this.at, this.values);
  final DateTime at;
  final List<int> values;

  Map<String, dynamic> toJson() => {'t': at.toIso8601String(), 'v': values};
  static SummarySample? tryParse(Object? o) {
    if (o is! Map<String, dynamic>) return null;
    final at = parseDate(o['t']);
    final v = o['v'];
    if (at == null || v is! List || v.length != 6 || v.any((e) => e is! int)) return null;
    return SummarySample(at, v.cast<int>());
  }
}

class SummaryHistory extends Notifier<List<SummarySample>> {
  static const maxSamples = 24;
  static const minGap = Duration(minutes: 2);

  String get _key => 'ut.admin.summary.${ref.read(sessionProvider).me?.id ?? 'anon'}';

  @override
  List<SummarySample> build() {
    final raw = ref.watch(sharedPreferencesProvider).getString(_key);
    if (raw == null) return const [];
    try {
      return [for (final e in jsonDecode(raw) as List) ?SummarySample.tryParse(e)];
    } on FormatException {
      return const [];
    }
  }

  /// Stores a sample when the values changed or the last one is older than [minGap].
  void record(QueueSummary s, {DateTime? now}) {
    final at = now ?? DateTime.now();
    final values = s.samples;
    final last = state.lastOrNull;
    final same = last != null && _equal(last.values, values);
    if (last != null && same && at.difference(last.at) < minGap) return;
    final next = [...state, SummarySample(at, values)];
    state = next.length > maxSamples ? next.sublist(next.length - maxSamples) : next;
    ref.read(sharedPreferencesProvider).setString(_key, jsonEncode(state.map((e) => e.toJson()).toList()));
  }

  static bool _equal(List<int> a, List<int> b) {
    for (var i = 0; i < a.length; i++) {
      if (a[i] != b[i]) return false;
    }
    return true;
  }
}

final summaryHistoryProvider = NotifierProvider<SummaryHistory, List<SummarySample>>(SummaryHistory.new);
