import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart' show XfamTone;

import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../l10n/app_localizations.dart';
import '../../models/json.dart';
import '../../models/search.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'truth_badges.dart';

class ItineraryDetail {
  const ItineraryDetail(this.searchId, this.itinerary);
  final String searchId;
  final Itinerary itinerary;
}

final itineraryProvider = FutureProvider.autoDispose.family<ItineraryDetail, String>((ref, id) async {
  final j = (await ref.watch(apiClientProvider).get('/v1/itineraries/${Uri.encodeComponent(id)}')) as Json;
  return ItineraryDetail(j.str('searchId'), Itinerary.fromJson(j.obj('itinerary')));
});

class ItineraryScreen extends ConsumerStatefulWidget {
  const ItineraryScreen({super.key, required this.itineraryId});
  final String itineraryId;

  @override
  ConsumerState<ItineraryScreen> createState() => _ItineraryScreenState();
}

class _ItineraryScreenState extends ConsumerState<ItineraryScreen> {
  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final async = ref.watch(itineraryProvider(widget.itineraryId));
    return Scaffold(
      appBar: AppBar(title: Text(l.itineraryTitle)),
      body: PageBody(
        child: async.when(
          loading: () => const LoadingList(count: 3),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(itineraryProvider(widget.itineraryId))),
          data: (d) => _content(context, d, d.itinerary),
        ),
      ),
    );
  }

  Widget _content(BuildContext context, ItineraryDetail d, Itinerary it) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final theme = Theme.of(context);
    final fetched = it.oldestFetch;
    final freshness = fetched == null
        ? null
        : (it.anyCached
              ? l.priceFreshnessCached(formatDateTime(fetched, lang: lang, jalali: jalali))
              : l.priceFreshness(formatDateTime(fetched, lang: lang, jalali: jalali)));

    return Column(
      children: [
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              TruthBadges(it, risk: false),
              const SizedBox(height: 12),
              Text(l.priceInQuote, style: theme.textTheme.titleMedium),
              if (freshness != null) ...[
                const SizedBox(height: 8),
                Row(
                  children: [
                    Icon(Icons.schedule, size: 16, color: xc(context).fgMuted),
                    const SizedBox(width: 6),
                    Expanded(child: Text(freshness, style: theme.textTheme.bodySmall)),
                  ],
                ),
              ],
              if (it.anyFake) _Notice(text: l.fakeNotice, tone: XfamTone.danger),
              if (it.startsAtGateway && it.gateway != null)
                _Notice(
                  text: l.gatewayAdvice(it.gateway!.str('iata'), it.gateway!.str('access')),
                  tone: XfamTone.warning,
                ),
              if (it.separateTickets) _Notice(text: l.selfTransferAdvice, tone: XfamTone.danger),
              for (var c = 0; c < it.components.length; c++) ...[
                SectionTitle(it.components.length > 1 ? l.ticketN(c + 1) : l.segments),
                for (var s = 0; s < it.components[c].slices.length; s++)
                  _SliceCard(
                    slice: it.components[c].slices[s],
                    it: it,
                    component: it.components[c],
                    firstSegmentIndex: it.components[c].slices.take(s).fold(0, (n, x) => n + x.segments.length),
                  ),
              ],
              const SizedBox(height: 8),
              Text(l.requestNotBooking, style: theme.textTheme.bodySmall?.copyWith(color: xc(context).fgMuted)),
            ],
          ),
        ),
        SafeArea(
          top: false,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: () => context.push(
                  '/search/request?search=${d.searchId}&itinerary=${Uri.encodeComponent(it.id)}',
                ),
                child: Text(l.requestItinerary),
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text, required this.tone});
  final String text;
  final XfamTone tone;

  @override
  Widget build(BuildContext context) {
    final c = xc(context);
    final (bg, fg) = switch (tone) {
      XfamTone.danger => (c.dangerSubtle, c.dangerSubtleFg),
      _ => (c.warningSubtle, c.warningSubtleFg),
    };
    return Container(
      margin: const EdgeInsets.only(top: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(8)),
      child: Text(text, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: fg)),
    );
  }
}

class _SliceCard extends StatelessWidget {
  const _SliceCard({required this.slice, required this.it, required this.component, required this.firstSegmentIndex});
  final SliceView slice;
  final Itinerary it;
  final TicketComponent component;
  final int firstSegmentIndex;

  String _baggageText(AppL10n l, Json? b, String lang) {
    final checked = b?.obj('checked');
    if (checked == null || checked.str('status') != 'KNOWN') return l.baggageUnknown;
    final v = checked.obj('value');
    final pieces = v.intOrNull('pieces');
    if (pieces == null) return l.baggageUnknown;
    if (pieces == 0) return l.baggageNone;
    final kg = (v['kgPerPiece'] as num?);
    final base = l.baggagePieces(pieces);
    return kg == null ? base : '$base${sep(lang)}${l.baggageKg(digits(kg.toStringAsFixed(kg % 1 == 0 ? 0 : 1), lang))}';
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lang = context.lang;
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                LtrText('${slice.origin} → ${slice.destination}', style: theme.textTheme.titleSmall),
                const Spacer(),
                Text(formatDuration(l, slice.durationMin, lang), style: theme.textTheme.bodySmall),
              ],
            ),
            for (var i = 0; i < slice.segments.length; i++) ...[
              const SizedBox(height: 12),
              _segment(context, slice.segments[i], firstSegmentIndex + i),
              ..._connectionAfter(context, slice.segments[i]),
            ],
          ],
        ),
      ),
    );
  }

  Widget _segment(BuildContext context, Segment s, int index) {
    final l = context.l;
    final lang = context.lang;
    final theme = Theme.of(context);
    final plus = dayOffset(s.departLocal, s.arriveLocal);
    final bag = component.baggageFor(index);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            LtrText(localTime(s.departLocal, lang), style: theme.textTheme.titleMedium),
            const SizedBox(width: 8),
            LtrText(s.origin, style: theme.textTheme.bodyMedium),
            if (s.originTerminal != null) Text('  ${l.terminal(digits(s.originTerminal!, lang))}', style: theme.textTheme.bodySmall),
          ],
        ),
        Padding(
          padding: const EdgeInsetsDirectional.only(start: 8, top: 4, bottom: 4),
          child: Row(
            children: [
              Icon(Icons.flight, size: 14, color: Brand.orange700),
              const SizedBox(width: 6),
              LtrText('${s.carrier} ${s.flightNumber}', style: theme.textTheme.bodySmall, mono: true),
              if (s.duration != null) Text('${sep(lang)}${formatDuration(l, s.duration!.inMinutes, lang)}', style: theme.textTheme.bodySmall),
              if (s.aircraft != null) Text('${sep(lang)}${s.aircraft}', style: theme.textTheme.bodySmall),
            ],
          ),
        ),
        Row(
          children: [
            LtrText(localTime(s.arriveLocal, lang) + (plus > 0 ? ' ${l.dayPlus(digits('$plus', lang))}' : ''), style: theme.textTheme.titleMedium),
            const SizedBox(width: 8),
            LtrText(s.destination, style: theme.textTheme.bodyMedium),
            if (s.destinationTerminal != null) Text('  ${l.terminal(digits(s.destinationTerminal!, lang))}', style: theme.textTheme.bodySmall),
          ],
        ),
        const SizedBox(height: 6),
        Row(
          children: [
            Icon(Icons.luggage_outlined, size: 16, color: xc(context).fgMuted),
            const SizedBox(width: 6),
            Expanded(child: Text(_baggageText(l, bag, lang), style: theme.textTheme.bodySmall)),
          ],
        ),
      ],
    );
  }

  List<Widget> _connectionAfter(BuildContext context, Segment s) {
    final l = context.l;
    final lang = context.lang;
    final matches = it.connections.where((c) => c.at == s.destination);
    if (matches.isEmpty) return const [];
    final c = matches.first;
    final advice = <String>[
      if (it.separateTickets || c.flags.contains('SEPARATE_TICKETS')) l.selfTransferAdvice,
      if (c.overnight || c.flags.contains('OVERNIGHT')) l.overnightAdvice,
      if (c.flags.contains('TIGHT')) l.tightAdvice,
      if (c.flags.contains('AIRPORT_CHANGE')) l.airportChangeAdvice,
    ];
    return [
      const SizedBox(height: 8),
      Container(
        width: double.infinity,
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: xc(context).surfaceSunken, border: Border.all(color: Brand.line), borderRadius: BorderRadius.circular(8)),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l.layoverAt(formatDuration(l, c.layoverMin, lang), c.at), style: Theme.of(context).textTheme.labelLarge),
            for (final a in advice) Padding(padding: const EdgeInsets.only(top: 4), child: Text(a, style: Theme.of(context).textTheme.bodySmall)),
          ],
        ),
      ),
    ];
  }
}
