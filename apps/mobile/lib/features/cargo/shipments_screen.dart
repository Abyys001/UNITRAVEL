import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../models/shipments.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'tracking_timeline.dart';

/// The delivery estimate is always labelled and followed by a note that it is not a promise (Phase E).
class EtaBlock extends ConsumerWidget {
  const EtaBlock({super.key, required this.at});
  final DateTime? at;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final jalali = ref.watch(calendarJalaliProvider);
    final t = Theme.of(context).textTheme;
    return Column(
      key: const Key('eta'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(l.etaLabel, style: t.labelMedium?.copyWith(color: Brand.steel)),
        Text(at == null ? l.etaNone : formatDate(at!.toLocal(), lang: context.lang, jalali: jalali), style: t.titleMedium),
        if (at != null) Text(l.etaNote, style: t.bodySmall?.copyWith(color: Brand.steel)),
      ],
    );
  }
}

/// Shipments overview: summary card plus one card per shipment with its timeline.
class ShipmentsScreen extends ConsumerWidget {
  const ShipmentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final list = ref.watch(shipmentsProvider);
    final summary = ref.watch(shipmentSummaryProvider).value?.data;
    return Scaffold(
      appBar: AppBar(title: Text(l.shipmentsTitle)),
      body: PageBody(
        child: list.when(
          loading: () => const LoadingList(),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(shipmentsProvider)),
          data: (cached) {
            final items = cached.data;
            return RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(shipmentsProvider);
                ref.invalidate(shipmentSummaryProvider);
                await ref.read(shipmentsProvider.future);
              },
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(l.shipmentsIntro),
                  const SizedBox(height: 12),
                  if (summary != null && summary.total > 0) _SummaryCard(s: summary),
                  if (items.isEmpty) Padding(padding: const EdgeInsets.only(top: 32), child: Center(child: Text(l.shipmentsEmpty, textAlign: TextAlign.center))),
                  for (final s in items)
                    Padding(
                      padding: const EdgeInsets.only(top: 12),
                      child: AppCard(
                        key: Key('shipment-${s.ref}'),
                        onTap: () => context.push('/requests/${s.ref}'),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(children: [
                              Expanded(child: Text(s.laneLabel, style: Theme.of(context).textTheme.titleMedium)),
                              ToneChip(s.statusLabel),
                            ]),
                            Text(
                              [digits(s.ref, lang), if (s.awbNumber != null) l.awbLabel(s.awbNumber!)].join(sep(lang)),
                              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Brand.steel),
                              textDirection: TextDirection.ltr,
                            ),
                            const SizedBox(height: 12),
                            TrackingTimeline(events: s.timeline),
                            const SizedBox(height: 4),
                            EtaBlock(at: s.estimatedDeliveryAt),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({required this.s});
  final ShipmentSummary s;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lang = context.lang;
    final t = Theme.of(context).textTheme;
    Widget stat(String label, int v) => Expanded(
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: t.labelMedium?.copyWith(color: Brand.steel)),
        Text(digits('$v', lang), style: t.headlineSmall),
      ]),
    );
    return AppCard(
      key: const Key('shipments-summary'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [stat(l.shipmentsTotal, s.total), stat(l.shipmentsInTransit, s.inTransit), stat(l.shipmentsDelivered, s.delivered)]),
          if (s.nextRef != null) ...[
            const Divider(height: 24),
            Text(l.shipmentsNext, style: t.labelMedium?.copyWith(color: Brand.steel)),
            Text(s.nextLane ?? '', style: t.titleSmall),
            const SizedBox(height: 4),
            EtaBlock(at: s.nextEta),
          ],
        ],
      ),
    );
  }
}
