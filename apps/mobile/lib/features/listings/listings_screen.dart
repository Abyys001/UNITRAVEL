import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart' show XfamTone;

import '../../core/format.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../l10n/app_localizations.dart';
import '../../models/listings.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

String listingKindLabel(AppL10n l, ListingKind k) => switch (k) {
  ListingKind.flights => l.menuFlights,
  ListingKind.buses => l.menuBuses,
  ListingKind.trains => l.menuTrains,
  ListingKind.stays => l.menuStays,
};

IconData listingKindIcon(ListingKind k) => switch (k) {
  ListingKind.flights => Icons.flight_takeoff,
  ListingKind.buses => Icons.directions_bus_outlined,
  ListingKind.trains => Icons.train_outlined,
  ListingKind.stays => Icons.house_outlined,
};

/// Where "Make a request" leads: the existing request flows stay as they are.
String listingRequestRoute(ListingKind k) => switch (k) {
  ListingKind.flights => '/search',
  ListingKind.buses => '/services/new/buses',
  ListingKind.trains => '/services/new/trains',
  ListingKind.stays => '/services/new/stays',
};

/// Browse entry for the Services tab: one tile per vertical, each opening its list.
class ListingsBrowse extends StatelessWidget {
  const ListingsBrowse({super.key, required this.kinds});
  final List<ListingKind> kinds;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final theme = Theme.of(context);
    return Column(
      key: const Key('listings-browse'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionTitle(l.lsBrowse),
        Text(
          l.lsBrowseLead,
          style: theme.textTheme.bodySmall?.copyWith(
            color: xc(context).fgMuted,
          ),
        ),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final k in kinds)
              ActionChip(
                key: Key('browse-${k.path}'),
                avatar: Icon(listingKindIcon(k), size: 18),
                label: Text(listingKindLabel(l, k)),
                onPressed: () => context.push('/listings/${k.path}'),
              ),
          ],
        ),
      ],
    );
  }
}

/// Public listings for one vertical (ADR-0021). Everything shown comes from the payload: curated rows are labelled
/// indicative and carry a price only when staff quoted one; flights are cached results with the time they were fetched and
/// never an amount. With nothing to show, the page sends the customer to the team instead of inventing options.
class ListingsScreen extends ConsumerStatefulWidget {
  const ListingsScreen({super.key, required this.kind});
  final ListingKind kind;

  @override
  ConsumerState<ListingsScreen> createState() => _ListingsScreenState();
}

class _ListingsScreenState extends ConsumerState<ListingsScreen> {
  final _filter = TextEditingController();
  String _to = '';

  @override
  void dispose() {
    _filter.dispose();
    super.dispose();
  }

  void _apply() => setState(() => _to = _filter.text.trim());

  void _clear() {
    _filter.clear();
    setState(() => _to = '');
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final kind = widget.kind;
    final flights = kind == ListingKind.flights;
    // The flights cache is keyed by airport code, so only a three-letter code goes to the server; other text filters nothing.
    final query = (
      kind: kind,
      to: !flights || RegExp(r'^[A-Za-z]{3}$').hasMatch(_to) ? _to : '',
    );
    final async = ref.watch(listingsProvider(query));
    return Scaffold(
      appBar: AppBar(title: Text(listingKindLabel(l, kind))),
      body: PageBody(
        child: RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(listingsProvider(query));
            await ref.read(listingsProvider(query).future);
          },
          child: ListView(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: navInset(context, const EdgeInsets.all(16)),
            children: [
              TextField(
                key: const Key('listings-filter'),
                controller: _filter,
                textInputAction: TextInputAction.search,
                textCapitalization: flights
                    ? TextCapitalization.characters
                    : TextCapitalization.words,
                onSubmitted: (_) => _apply(),
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: l.lsFilter,
                  hintText: flights ? l.lsFilterFlightsHint : null,
                  suffixIcon: _filter.text.isEmpty && _to.isEmpty
                      ? IconButton(
                          tooltip: l.lsFilterApply,
                          icon: const Icon(Icons.search),
                          onPressed: _apply,
                        )
                      : Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              tooltip: l.lsClear,
                              icon: const Icon(Icons.close),
                              onPressed: _clear,
                            ),
                            IconButton(
                              tooltip: l.lsFilterApply,
                              icon: const Icon(Icons.search),
                              onPressed: _apply,
                            ),
                          ],
                        ),
                ),
              ),
              const SizedBox(height: 12),
              async.when(
                loading: () =>
                    const SizedBox(height: 240, child: LoadingList(count: 3)),
                error: (e, _) => ErrorBox(
                  e,
                  onRetry: () => ref.invalidate(listingsProvider(query)),
                ),
                data: (view) => _Body(kind: kind, view: view, filter: _to),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Body extends ConsumerWidget {
  const _Body({required this.kind, required this.view, required this.filter});
  final ListingKind kind;
  final ListingsView view;
  final String filter;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final theme = Theme.of(context);
    // Flights with a non-code filter: narrow the (small) cached list on the device, by destination code.
    final flights = [
      for (final f in view.flights)
        if (filter.isEmpty ||
            f.destination.toLowerCase().contains(filter.toLowerCase()))
          f,
    ];
    final empty = kind == ListingKind.flights
        ? flights.isEmpty
        : view.curated.isEmpty;
    if (empty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Column(
          key: const Key('listings-empty'),
          children: [
            Icon(listingKindIcon(kind), size: 40, color: xc(context).fgMuted),
            const SizedBox(height: 12),
            Text(l.lsEmptyTitle, style: theme.textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(l.lsEmptyBody, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(
              key: const Key('listings-ask'),
              onPressed: () => context.push('/support/new'),
              child: Text(l.lsAsk),
            ),
            TextButton(
              key: const Key('listings-request'),
              onPressed: () => context.push(listingRequestRoute(kind)),
              child: Text(l.lsRequest),
            ),
          ],
        ),
      );
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          kind == ListingKind.flights ? l.lsFlightsNote : l.lsIndicativeNote,
          key: const Key('listings-note'),
          style: theme.textTheme.bodySmall?.copyWith(
            color: xc(context).fgMuted,
          ),
        ),
        const SizedBox(height: 12),
        if (kind == ListingKind.flights)
          for (final f in flights)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _FlightCard(item: f),
            )
        else
          for (final c in view.curated)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _CuratedCard(item: c),
            ),
        const SizedBox(height: 4),
        Center(
          child: TextButton(
            key: const Key('listings-request'),
            onPressed: () => context.push(listingRequestRoute(kind)),
            child: Text(l.lsRequest),
          ),
        ),
        Center(
          child: TextButton(
            key: const Key('listings-ask'),
            onPressed: () => context.push('/support/new'),
            child: Text(l.lsAsk),
          ),
        ),
      ],
    );
  }
}

class _CuratedCard extends ConsumerWidget {
  const _CuratedCard({required this.item});
  final CuratedListing item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final t = Theme.of(context).textTheme;
    final route = [
      if (item.fromPlace != null) item.fromPlace!,
      item.toPlace,
    ].join(' → ');
    final summary = item.summary(lang);
    return AppCard(
      key: Key('listing-${item.id}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(item.title(lang), style: t.titleSmall)),
              ToneChip(l.lsIndicative, tone: XfamTone.neutral),
            ],
          ),
          const SizedBox(height: 4),
          Text(route, style: t.bodyMedium),
          if (item.operator != null)
            Text(
              item.operator!,
              style: t.bodySmall?.copyWith(color: Brand.steel),
            ),
          if (summary.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(summary, style: t.bodySmall),
            ),
          // A price exists only when staff quoted one; otherwise there is no amount to show at all.
          if (item.price != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                l.lsQuotedPrice(formatMoney(item.price, lang)),
                style: t.titleSmall,
                key: Key('listing-price-${item.id}'),
              ),
            ),
          if (item.validUntil != null)
            Text(
              l.quoteValidUntil(
                formatDate(
                  item.validUntil!.toLocal(),
                  lang: lang,
                  jalali: jalali,
                ),
              ),
              style: t.bodySmall?.copyWith(color: Brand.steel),
            ),
        ],
      ),
    );
  }
}

class _FlightCard extends ConsumerWidget {
  const _FlightCard({required this.item});
  final FlightListing item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final t = Theme.of(context).textTheme;
    final label = item.label == 'SANDBOX' ? l.lsSandbox : l.lsCached;
    final h = item.durationMin ~/ 60;
    final m = item.durationMin % 60;
    final duration = lang == 'fa'
        ? '${digits('$h', lang)}:${digits(m.toString().padLeft(2, '0'), lang)}'
        : '${h}h ${m}m';
    final departs = DateTime.tryParse(item.departureDate);
    return AppCard(
      key: Key(
        'flight-${item.origin}-${item.destination}-${item.departureLocal}',
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: LtrText(
                  '${item.origin} → ${item.destination}',
                  style: t.titleMedium,
                  mono: true,
                ),
              ),
              ToneChip(
                label,
                tone: item.label == 'SANDBOX'
                    ? XfamTone.warning
                    : XfamTone.info,
              ),
            ],
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 8,
            children: [
              if (departs != null)
                Text(
                  l.lsDeparts(formatDate(departs, lang: lang, jalali: jalali)),
                  style: t.bodySmall,
                ),
              Text(
                item.stops == 0
                    ? l.lsDirect
                    : l.lsStops(digits('${item.stops}', lang)),
                style: t.bodySmall,
              ),
              Text(duration, style: t.bodySmall),
              if (item.carriers.isNotEmpty)
                Text(item.carriers.join(', '), style: t.bodySmall),
            ],
          ),
          if (item.fetchedAt != null)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                l.lsFetched(
                  formatDateTime(
                    item.fetchedAt!.toLocal(),
                    lang: lang,
                    jalali: jalali,
                  ),
                ),
                style: t.bodySmall?.copyWith(color: Brand.steel),
                key: const Key('flight-fetched'),
              ),
            ),
        ],
      ),
    );
  }
}
