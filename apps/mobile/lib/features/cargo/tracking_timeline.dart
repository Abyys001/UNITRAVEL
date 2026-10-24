import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/format.dart';
import '../../core/session.dart';
import '../../core/tracking.dart';
import '../../models/shipments.dart';
import '../../ui/patterns.dart';
import '../../ui/widgets.dart';

/// Shipment timeline on the shared [AppTimeline]. Labels come from the l10n catalogue, never the raw code (Phase E).
/// Shared by the shipments overview and the cargo request screen.
class TrackingTimeline extends ConsumerWidget {
  const TrackingTimeline({super.key, required this.events});
  final List<TrackEvent> events;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    if (events.isEmpty) return Text(l.trackingNoEvents, style: Theme.of(context).textTheme.bodySmall);
    return KeyedSubtree(
      key: const Key('tracking-timeline'),
      child: AppTimeline(
        entries: [
          for (final e in events)
            AppTimelineEntry(
              title: trackingLabel(l, e.code),
              note: e.corrected ? l.trackingUpdated : null,
              subtitle: [e.location, formatDateTime(e.occurredAt, lang: lang, jalali: jalali), if (e.description != null) e.description!].join(sep(lang)),
            ),
        ],
      ),
    );
  }
}
