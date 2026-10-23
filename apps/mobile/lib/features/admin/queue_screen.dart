import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart' show EmptyState, XfamTone;

import '../../core/format.dart';
import '../../core/session.dart';
import '../../models/admin.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'admin_providers.dart';
import 'mfa_gate.dart';

/// Admin triage list: `Queue` (tabs over the shared queue) or `Mine` (my cases).
class QueueScreen extends ConsumerStatefulWidget {
  const QueueScreen({super.key, this.mine = false});
  final bool mine;

  @override
  ConsumerState<QueueScreen> createState() => _QueueScreenState();
}

class _QueueScreenState extends ConsumerState<QueueScreen> {
  String _tab = 'new';

  String get _active => widget.mine ? 'mine' : _tab;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final tabs = {
      'new': l.tabNew,
      'awaiting': l.tabAwaiting,
      'quoted': l.tabQuoted,
      'reserved': l.tabReserved,
    };
    final cases = ref.watch(adminCasesProvider(_active));
    void reload() {
      ref.invalidate(adminCasesProvider(_active));
      ref.invalidate(queueSummaryProvider);
    }

    return Scaffold(
      appBar: AppBar(title: Text(widget.mine ? l.mineTitle : l.queueTitle)),
      body: PageBody(
        child: Column(
          children: [
            if (!widget.mine) ...[
              const _SummaryStrip(),
              SizedBox(
                height: 52,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  children: [
                    for (final e in tabs.entries)
                      Padding(
                        padding: const EdgeInsetsDirectional.only(end: 8),
                        child: ChoiceChip(label: Text(e.value), selected: _tab == e.key, onSelected: (_) => setState(() => _tab = e.key)),
                      ),
                  ],
                ),
              ),
            ],
            Expanded(
              child: cases.when(
                loading: () => const LoadingList(),
                error: (e, _) => AdminErrorView(e, onRetry: reload),
                data: (items) => items.isEmpty
                    ? EmptyState(title: l.queueEmpty, iconName: 'inbox')
                    : RefreshIndicator(
                        onRefresh: () async => ref.refresh(adminCasesProvider(_active).future),
                        child: ListView.separated(
                          padding: const EdgeInsets.all(16),
                          itemCount: items.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 10),
                          itemBuilder: (context, i) => _CaseTile(item: items[i]),
                        ),
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SummaryStrip extends ConsumerWidget {
  const _SummaryStrip();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final s = ref.watch(queueSummaryProvider).value;
    if (s == null) return const SizedBox(height: 8);
    Widget cell(String label, int n, {bool alert = false}) => Expanded(
      child: Semantics(
        label: '$label: $n',
        excludeSemantics: true,
        child: Column(
          children: [
            Text(digits('$n', lang), style: Theme.of(context).textTheme.titleLarge?.copyWith(color: alert && n > 0 ? Brand.brick : null)),
            Text(label, style: Theme.of(context).textTheme.labelSmall, textAlign: TextAlign.center),
          ],
        ),
      ),
    );
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
      child: Row(
        children: [
          cell(l.summaryNew, s.newCount),
          cell(l.summaryMine, s.mine),
          cell(l.summaryAwaiting, s.awaiting),
          cell(l.summaryQuoted, s.quoted),
          cell(l.summarySla, s.slaBreaches, alert: true),
        ],
      ),
    );
  }
}

class _CaseTile extends ConsumerWidget {
  const _CaseTile({required this.item});
  final AdminListItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    return AppCard(
      semanticLabel: '${item.ref}, ${item.routeLabel}, ${item.customer}',
      onTap: () => context.push('/admin/case/${item.ref}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              LtrText(item.ref, style: Theme.of(context).textTheme.labelLarge?.copyWith(color: Brand.copperDark, letterSpacing: 0.8)),
              if (item.urgent) ...[const SizedBox(width: 6), ToneChip('!', tone: XfamTone.danger, solid: true)],
              const Spacer(),
              if (item.slaBreached)
                ToneChip(l.slaBreached, tone: XfamTone.danger)
              else
                ToneChip(staffStatusLabel(l, item.status), tone: toneForStatus(item.status)),
            ],
          ),
          const SizedBox(height: 6),
          Text(item.routeLabel, style: Theme.of(context).textTheme.titleMedium),
          Text(
            '${item.customer}${sep(lang)}${formatIsoDate(item.firstTravelDate, lang: lang, jalali: jalali)}${sep(lang)}${item.assignee ?? l.unassigned}',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(color: xc(context).fgMuted),
          ),
        ],
      ),
    );
  }
}

