import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../l10n/app_localizations.dart';
import '../../models/search.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'truth_badges.dart';

const _tabs = ['BEST', 'CHEAPEST', 'FASTEST', 'SINGLE_TICKET'];

class ResultsScreen extends ConsumerStatefulWidget {
  const ResultsScreen({super.key, required this.searchId});
  final String searchId;

  @override
  ConsumerState<ResultsScreen> createState() => _ResultsScreenState();
}

class _ResultsScreenState extends ConsumerState<ResultsScreen> {
  late final SearchPoller _controller;
  StreamSubscription<SearchSnapshot>? _sub;
  late SearchSnapshot _snap;

  @override
  void initState() {
    super.initState();
    _controller = SearchPoller(ref.read(apiClientProvider), widget.searchId);
    _snap = _controller.snapshot;
    _sub = _controller.state.stream.listen((s) {
      if (mounted) setState(() => _snap = s);
    });
    _controller.start();
  }

  @override
  void dispose() {
    _sub?.cancel();
    _controller.dispose();
    super.dispose();
  }

  String _tabLabel(AppL10n l, String t) => switch (t) {
    'CHEAPEST' => l.tabCheapest,
    'FASTEST' => l.tabFastest,
    'SINGLE_TICKET' => l.tabSingle,
    _ => l.tabBest,
  };

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final s = _snap.state;
    final items = _snap.items;
    return DefaultTabController(
      length: _tabs.length,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l.resultsTitle),
          bottom: PreferredSize(
            preferredSize: const Size.fromHeight(48 + 28),
            child: Column(
              children: [
                _ProgressLine(state: s),
                TabBar(
                  isScrollable: true,
                  tabAlignment: TabAlignment.start,
                  onTap: (i) => _controller.setTab(_tabs[i]),
                  tabs: [for (final t in _tabs) Tab(text: _tabLabel(l, t))],
                ),
              ],
            ),
          ),
        ),
        body: PageBody(child: _body(context, l, s, items)),
      ),
    );
  }

  Widget _body(BuildContext context, AppL10n l, SearchState? s, List<Itinerary> items) {
    if (_snap.error != null && s == null) {
      return ErrorBox(_snap.error!, onRetry: _controller.retry);
    }
    if (s == null) return const LoadingList();
    if (items.isEmpty && s.running) return const LoadingList();
    if (items.isEmpty) {
      return ListView(
        padding: const EdgeInsets.all(24),
        children: [
          const SizedBox(height: 24),
          Icon(Icons.travel_explore, size: 48, color: xc(context).fgSubtle),
          const SizedBox(height: 12),
          Text(s.status == 'FAILED' ? l.searchFailed : l.noResults, textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(l.noResultsHelp, textAlign: TextAlign.center),
          const SizedBox(height: 20),
          _ManualCard(searchId: widget.searchId),
        ],
      );
    }
    return ListView.separated(
      padding: const EdgeInsets.all(16),
      itemCount: items.length + 2,
      separatorBuilder: (_, _) => const SizedBox(height: 12),
      itemBuilder: (context, i) {
        if (i == items.length) {
          return s.nextCursor == null
              ? const SizedBox.shrink()
              : OutlinedButton(onPressed: _controller.loadMore, child: Text(l.loadMore));
        }
        if (i == items.length + 1) return _ManualCard(searchId: widget.searchId);
        return ResultCard(it: items[i], searchId: widget.searchId);
      },
    );
  }
}

class _ManualCard extends StatelessWidget {
  const _ManualCard({required this.searchId});
  final String searchId;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    return AppCard(
      onTap: () => context.push('/search/manual/$searchId'),
      semanticLabel: l.manualRequest,
      child: Row(
        children: [
          const Icon(Icons.support_agent),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l.manualRequest, style: Theme.of(context).textTheme.titleSmall),
                Text(l.manualRequestHelp, style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
          ),
          const Icon(Icons.chevron_right),
        ],
      ),
    );
  }
}

class _ProgressLine extends StatelessWidget {
  const _ProgressLine({required this.state});
  final SearchState? state;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final s = state;
    final total = s?.progress.total ?? 0;
    final done = s?.progress.done ?? 0;
    final text = s == null
        ? l.loading
        : s.running
        ? l.searchingSources(total, done)
        : s.status == 'PARTIAL'
        ? l.searchPartial(total, done)
        : s.status == 'FAILED'
        ? l.searchFailed
        : l.searchComplete(total);
    return Semantics(
      liveRegion: true,
      container: true,
      label: text,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 6),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ExcludeSemantics(child: Text(text, style: Theme.of(context).textTheme.bodySmall)),
            const SizedBox(height: 4),
            LinearProgressIndicator(
              value: s == null || s.running ? (total == 0 ? null : done / total) : 1,
              minHeight: 3,
              color: Brand.copper,
              backgroundColor: Brand.mist,
            ),
          ],
        ),
      ),
    );
  }
}

class ResultCard extends ConsumerWidget {
  const ResultCard({super.key, required this.it, required this.searchId});
  final Itinerary it;
  final String searchId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final slices = it.slices;
    final price = formatMoney(it.total, lang);
    final route = slices.isEmpty ? '' : slices.map((s) => '${s.origin} → ${s.destination}').join(sep(lang));
    return AppCard(
      semanticLabel: '$route, $price',
      onTap: () => context.push('/search/itinerary/${Uri.encodeComponent(it.id)}?search=$searchId'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: TruthBadges(it)),
              const SizedBox(width: 8),
              Text(price, style: Theme.of(context).textTheme.titleLarge),
            ],
          ),
          const SizedBox(height: 10),
          for (final slice in slices) _SliceRow(slice: slice, it: it),
          if (it.connections.isNotEmpty) ...[
            const SizedBox(height: 4),
            for (final c in it.connections)
              Text(
                l.layoverAt(formatDuration(l, c.layoverMin, lang), c.at),
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: xc(context).fgMuted),
              ),
          ],
          const SizedBox(height: 4),
          Text(
            '${formatDuration(l, it.durationMin, lang)}${sep(lang)}${it.stops == 0 ? l.stopsDirect : l.stopsCount(it.stops)}',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: xc(context).fgMuted),
          ),
        ],
      ),
    );
  }
}

class _SliceRow extends StatelessWidget {
  const _SliceRow({required this.slice, required this.it});
  final SliceView slice;
  final Itinerary it;

  @override
  Widget build(BuildContext context) {
    final lang = context.lang;
    final first = slice.segments.first;
    final last = slice.segments.last;
    final plus = dayOffset(first.departLocal, last.arriveLocal);
    final style = Theme.of(context).textTheme.titleSmall;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(
        children: [
          LtrText(localTime(first.departLocal, lang), style: style),
          const SizedBox(width: 6),
          LtrText(slice.origin, style: Theme.of(context).textTheme.bodySmall),
          const Expanded(child: Divider(indent: 8, endIndent: 8)),
          LtrText(slice.destination, style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(width: 6),
          LtrText(localTime(last.arriveLocal, lang) + (plus > 0 ? ' ${context.l.dayPlus(digits('$plus', lang))}' : ''), style: style),
        ],
      ),
    );
  }
}
