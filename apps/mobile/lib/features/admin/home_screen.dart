import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart' show SkeletonBox;

import '../../core/format.dart';
import '../../core/session.dart';
import '../../models/admin.dart';
import '../../ui/bento.dart';
import '../../ui/brand_logo.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'admin_providers.dart';
import 'case_tile.dart';
import 'mfa_gate.dart';
import 'settings_sheet.dart';
import 'sla.dart';

/// Admin Home: a bento grid built only from what `/v1/admin/queues/summary`, the queue list and
/// the verification / compliance lists return. Nothing here is estimated.
class AdminHomeScreen extends ConsumerWidget {
  const AdminHomeScreen({super.key});

  Future<void> _refresh(WidgetRef ref) async {
    Haptics.tap();
    ref.invalidate(adminCasesProvider('new'));
    ref.invalidate(pendingVerificationsProvider);
    ref.invalidate(openComplianceCasesProvider);
    try {
      ref.invalidate(queueSummaryProvider);
      await ref.read(queueSummaryProvider.future);
    } catch (_) {
      // The error state renders from the provider; the indicator just stops.
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final summary = ref.watch(queueSummaryProvider);
    final name = ref.watch(sessionProvider.select((s) => s.me?.displayName ?? ''));
    return Scaffold(
      appBar: AppBar(
        title: Text(l.homeTitle),
        actions: [
          IconButton(tooltip: l.settingsTitle, icon: const Icon(Icons.tune), onPressed: () => showAdminSettings(context)),
          const Padding(padding: EdgeInsetsDirectional.only(end: 16), child: BrandLogo(markSize: 28, showPersian: false)),
        ],
      ),
      body: PageBody(
        child: RefreshIndicator(
          onRefresh: () => _refresh(ref),
          child: summary.when(
            // Keep the previous bento on screen while a refresh is in flight.
            skipLoadingOnRefresh: true,
            loading: () => const _HomeSkeleton(),
            error: (e, _) => ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              children: [SizedBox(height: 420, child: AdminErrorView(e, onRetry: () => ref.invalidate(queueSummaryProvider)))],
            ),
            data: (s) => _HomeBody(summary: s, name: name),
          ),
        ),
      ),
    );
  }
}

const _gap = 12.0;

class _HomeBody extends ConsumerWidget {
  const _HomeBody({required this.summary, required this.name});
  final QueueSummary summary;
  final String name;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final theme = Theme.of(context);
    final history = ref.watch(summaryHistoryProvider);
    final perms = ref.watch(sessionProvider.select((s) => s.me?.permissions ?? const <String>[]));
    final verifications = ref.watch(pendingVerificationsProvider);
    final compliance = ref.watch(openComplianceCasesProvider);
    // Gated on the permission up front, so a role without it never sees a made-up zero.
    final counters = <Widget>[
      if (perms.contains('identity.verify'))
        _CountTile(
          icon: Icons.badge_outlined,
          label: l.verificationsWaiting,
          value: verifications,
          note: l.decideInPanel,
          onRetry: () => ref.invalidate(pendingVerificationsProvider),
        ),
      if (perms.contains('compliance.case.read'))
        _CountTile(
          icon: Icons.policy_outlined,
          label: l.complianceOpen,
          value: compliance,
          note: l.decideInPanel,
          onRetry: () => ref.invalidate(openComplianceCasesProvider),
        ),
    ];
    final c = xc(context);
    final dark = isDark(context);

    Widget kpi(int index, String label, int value, String tab, {bool alert = false}) => _KpiTile(
      label: label,
      value: value,
      series: [for (final s in history) s.values[index]],
      since: history.firstOrNull?.at,
      alert: alert && value > 0,
      onTap: () => context.go('/admin/queue?tab=$tab'),
    );

    final mix = [
      HealthSegment(l.summaryNew, summary.newCount, dark ? Brand.sky : Brand.royal),
      HealthSegment(l.summaryAwaiting, summary.awaiting, dark ? Brand.orange300 : Brand.orange700),
      HealthSegment(l.summaryQuoted, summary.quoted, dark ? Brand.cyan : Brand.navy800),
      HealthSegment(l.summaryReserved, summary.reserved, c.success),
    ];

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
      children: [
        if (name.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: 12, top: 4),
            child: Text(l.homeGreeting(name), style: theme.textTheme.bodyMedium?.copyWith(color: c.fgMuted)),
          ),
        _Hero(summary: summary),
        const SizedBox(height: _gap),
        _Pair(kpi(0, l.summaryNew, summary.newCount, 'new'), kpi(5, l.summarySla, summary.slaBreaches, 'new', alert: true)),
        const SizedBox(height: _gap),
        _Pair(kpi(1, l.summaryMine, summary.mine, 'mine'), kpi(2, l.summaryAwaiting, summary.awaiting, 'awaiting')),
        const SizedBox(height: _gap),
        BentoTile(
          semanticLabel: '${l.queueMix}: ${mix.map((m) => '${m.label} ${digits('${m.value}', lang)}').join(', ')}',
          onTap: () => context.go('/admin/queue?tab=new'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(l.queueMix, style: theme.textTheme.titleSmall)),
                  Text(l.openCases(summary.openTotal), style: theme.textTheme.labelMedium?.copyWith(color: c.fgMuted)),
                ],
              ),
              const SizedBox(height: 12),
              HealthBar(segments: mix),
              const SizedBox(height: 12),
              if (summary.openTotal == 0)
                Text(l.queueMixEmpty, style: theme.textTheme.bodySmall?.copyWith(color: c.fgMuted))
              else
                Wrap(
                  spacing: 16,
                  runSpacing: 6,
                  children: [
                    for (final m in mix)
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 10,
                            height: 10,
                            decoration: BoxDecoration(color: m.color, borderRadius: BorderRadius.circular(3)),
                          ),
                          const SizedBox(width: 6),
                          Text('${m.label} ${digits('${m.value}', lang)}', style: theme.textTheme.labelMedium),
                        ],
                      ),
                  ],
                ),
            ],
          ),
        ),
        const SizedBox(height: _gap),
        _Pair(
          _CountTile(icon: Icons.gpp_maybe_outlined, label: l.complianceHolds, value: AsyncData<int?>(summary.complianceHolds), note: l.decideInPanel),
          _CountTile(
            icon: Icons.schedule_send_outlined,
            label: l.ticketingSoon,
            value: AsyncData<int?>(summary.deadlines.length),
            note: summary.deadlines.isEmpty ? null : _deadlineNote(context, summary.deadlines.first),
            onTap: summary.deadlines.isEmpty ? null : () => context.push('/admin/case/${summary.deadlines.first.ref}'),
          ),
        ),
        if (counters.isNotEmpty) ...[const SizedBox(height: _gap), counters.length == 1 ? counters.first : _Pair(counters[0], counters[1])],
        Padding(padding: const EdgeInsets.only(top: 8), child: SectionTitle(l.quickActions)),
        _Pair(
          _ActionTile(icon: Icons.person_outline, label: l.mineTitle, onTap: () => context.go('/admin/queue?tab=mine')),
          _ActionTile(icon: Icons.back_hand_outlined, label: l.qaUnclaimed, onTap: () => context.go('/admin/queue?tab=new')),
        ),
        const SizedBox(height: _gap),
        _Pair(
          _ActionTile(icon: Icons.search, label: l.qaFind, onTap: () => context.go('/admin/search')),
          _ActionTile(icon: Icons.tune, label: l.settingsTitle, onTap: () => showAdminSettings(context)),
        ),
        const SizedBox(height: 16),
        Center(
          child: Text(
            l.dataNote,
            style: theme.textTheme.bodySmall?.copyWith(color: c.fgSubtle),
            textAlign: TextAlign.center,
          ),
        ),
      ],
    );
  }
}

String _deadlineNote(BuildContext context, TicketingDeadline d) {
  final l = context.l;
  final left = d.deadline.difference(DateTime.now());
  final time = durationText(l, context.lang, left);
  return left.isNegative ? l.deadlinePast(d.ref, time) : l.deadlineIn(d.ref, time);
}

class _Pair extends StatelessWidget {
  const _Pair(this.a, this.b);
  final Widget a;
  final Widget b;

  @override
  Widget build(BuildContext context) => IntrinsicHeight(
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Expanded(child: a),
        const SizedBox(width: _gap),
        Expanded(child: b),
      ],
    ),
  );
}

/// "Needs you now": the breach / unclaimed / ticketing-deadline signals, then the most urgent unclaimed cases.
class _Hero extends ConsumerWidget {
  const _Hero({required this.summary});
  final QueueSummary summary;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final theme = Theme.of(context);
    final cases = ref.watch(adminCasesProvider('new'));
    final now = ref.watch(nowProvider).value ?? DateTime.now();
    final white = theme.textTheme;
    Widget signal(IconData icon, String text, Color color, VoidCallback onTap) => InkWell(
      onTap: () {
        Haptics.select();
        onTap();
      },
      borderRadius: BorderRadius.circular(12),
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 48),
        child: Row(
          children: [
            Icon(icon, color: color, size: 22),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                text,
                style: white.titleSmall?.copyWith(color: Colors.white, fontWeight: FontWeight.w700),
              ),
            ),
            Icon(chevronIcon(context), color: Brand.onDarkMuted),
          ],
        ),
      ),
    );

    final next = (cases.value ?? const <AdminListItem>[]).take(3).toList();
    return BentoTile(
      gradient: heroGradient,
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Semantics(
            header: true,
            child: Text(summary.allClear ? l.heroAllClear : l.heroNeedsYou, style: white.headlineSmall?.copyWith(color: Colors.white)),
          ),
          const SizedBox(height: 6),
          if (summary.allClear)
            Text(l.heroAllClearHelp, style: white.bodyMedium?.copyWith(color: Brand.onDarkMuted))
          else ...[
            if (summary.slaBreaches > 0)
              signal(Icons.error_outline, l.heroSlaBreached(summary.slaBreaches), const Color(0xFFFFB4AC), () => context.go('/admin/queue?tab=new')),
            if (summary.newCount > 0) signal(Icons.inbox_outlined, l.heroNewUnclaimed(summary.newCount), Brand.sky, () => context.go('/admin/queue?tab=new')),
            if (summary.deadlines.isNotEmpty)
              signal(
                Icons.schedule_send_outlined,
                l.heroDeadlines(summary.deadlines.length),
                Brand.orange300,
                () => context.push('/admin/case/${summary.deadlines.first.ref}'),
              ),
          ],
          if (next.isNotEmpty) ...[
            const SizedBox(height: 14),
            Text(l.heroNextUp, style: white.labelMedium?.copyWith(color: Brand.onDarkMuted)),
            const SizedBox(height: 6),
            for (final item in next) _NextRow(item: item, now: now, lang: lang),
          ],
          if (cases.isLoading && next.isEmpty && !summary.allClear)
            const Padding(
              padding: EdgeInsets.only(top: 14),
              child: SkeletonBox(height: 48, borderRadius: BorderRadius.all(Radius.circular(12))),
            ),
        ],
      ),
    );
  }
}

class _NextRow extends StatelessWidget {
  const _NextRow({required this.item, required this.now, required this.lang});
  final AdminListItem item;
  final DateTime now;
  final String lang;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final level = slaLevel(status: item.status, due: item.slaDueAt, now: now);
    final sla = item.slaDueAt == null ? null : slaLabel(l, lang, level, item.slaDueAt!, now);
    final color = switch (level) {
      SlaLevel.breached => const Color(0xFFFFB4AC),
      SlaLevel.risk => Brand.orange300,
      _ => Brand.onDarkMuted,
    };
    return Semantics(
      button: true,
      excludeSemantics: true,
      label: [item.ref, item.routeLabel, ?sla].join('. '),
      onTap: () => context.push('/admin/case/${item.ref}'),
      child: InkWell(
        onTap: () {
          Haptics.select();
          context.push('/admin/case/${item.ref}');
        },
        borderRadius: BorderRadius.circular(12),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 52),
          child: Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        item.routeLabel,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(color: Colors.white),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      LtrText(item.ref, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: Brand.onDarkMuted, letterSpacing: 0.8)),
                    ],
                  ),
                ),
                if (sla != null) ...[
                  Icon(level == SlaLevel.breached ? Icons.error_outline : Icons.timer_outlined, size: 14, color: color),
                  const SizedBox(width: 4),
                  Text(
                    sla,
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(color: color, fontWeight: FontWeight.w700),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _KpiTile extends StatelessWidget {
  const _KpiTile({required this.label, required this.value, required this.series, required this.since, required this.onTap, this.alert = false});
  final String label;
  final int value;
  final List<int> series;
  final DateTime? since;
  final bool alert;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lang = context.lang;
    final theme = Theme.of(context);
    final c = xc(context);
    final hasTrend = series.length >= 2;
    final delta = hasTrend ? series.last - series.first : 0;
    final trendWord = delta > 0 ? l.trendUp : (delta < 0 ? l.trendDown : l.trendFlat);
    final color = alert ? c.danger : (isDark(context) ? Brand.sky : Brand.royal);
    final sinceText = since == null
        ? ''
        : digits(MaterialLocalizations.of(context).formatTimeOfDay(TimeOfDay.fromDateTime(since!.toLocal()), alwaysUse24HourFormat: true), lang);
    return BentoTile(
      onTap: onTap,
      minHeight: 132,
      semanticLabel: '$label: ${digits('$value', lang)}. ${hasTrend ? l.trendSince(trendWord, sinceText) : l.trendNone}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: theme.textTheme.labelLarge?.copyWith(color: c.fgMuted)),
          const SizedBox(height: 4),
          Text(digits('$value', lang), style: theme.textTheme.displaySmall?.copyWith(color: alert ? c.danger : c.fg, height: 1.1)),
          const Spacer(),
          if (hasTrend) ...[
            Sparkline(values: series, color: color),
            const SizedBox(height: 4),
            Text(l.trendSince(trendWord, sinceText), style: theme.textTheme.labelSmall?.copyWith(color: c.fgMuted)),
          ] else
            // No trend until this device has seen two summaries; a flat placeholder keeps the tile height stable.
            Container(
              height: 2,
              margin: const EdgeInsets.only(bottom: 12),
              decoration: BoxDecoration(color: c.border, borderRadius: BorderRadius.circular(2)),
            ),
        ],
      ),
    );
  }
}

class _CountTile extends StatelessWidget {
  const _CountTile({required this.icon, required this.label, required this.value, this.note, this.onTap, this.onRetry});
  final IconData icon;
  final String label;
  final AsyncValue<int?> value;
  final String? note;
  final VoidCallback? onTap;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lang = context.lang;
    final theme = Theme.of(context);
    final c = xc(context);
    final failed = value.hasError;
    final shown = value.value;
    return BentoTile(
      onTap: failed ? onRetry : onTap,
      minHeight: 112,
      semanticLabel: failed ? '$label. ${l.tileFailed}' : '$label: ${shown == null ? '' : digits('$shown', lang)}${note == null ? '' : '. $note'}',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 20, color: c.fgMuted),
              const SizedBox(width: 8),
              Expanded(
                child: Text(label, style: theme.textTheme.labelLarge?.copyWith(color: c.fgMuted)),
              ),
            ],
          ),
          const SizedBox(height: 6),
          if (value.isLoading)
            const SkeletonBox(height: 32, width: 56)
          else if (failed)
            Text(l.tileFailed, style: theme.textTheme.bodySmall?.copyWith(color: c.danger))
          else
            Text(
              digits('${shown ?? 0}', lang),
              style: theme.textTheme.headlineMedium?.copyWith(color: c.fg, fontWeight: FontWeight.w800),
            ),
          if (note != null) ...[const SizedBox(height: 4), Text(note!, style: theme.textTheme.labelSmall?.copyWith(color: c.fgSubtle))],
        ],
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => BentoTile(
    onTap: onTap,
    minHeight: 64,
    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    semanticLabel: label,
    child: Row(
      children: [
        Icon(icon, color: isDark(context) ? Brand.sky : Brand.royal),
        const SizedBox(width: 12),
        Expanded(child: Text(label, style: Theme.of(context).textTheme.titleSmall)),
      ],
    ),
  );
}

class _HomeSkeleton extends StatelessWidget {
  const _HomeSkeleton();

  @override
  Widget build(BuildContext context) {
    const r = BorderRadius.all(Radius.circular(Brand.tileRadius));
    return Semantics(
      label: context.l.loading,
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: const [
          SkeletonBox(height: 220, borderRadius: r),
          SizedBox(height: _gap),
          Row(
            children: [
              Expanded(child: SkeletonBox(height: 132, borderRadius: r)),
              SizedBox(width: _gap),
              Expanded(child: SkeletonBox(height: 132, borderRadius: r)),
            ],
          ),
          SizedBox(height: _gap),
          Row(
            children: [
              Expanded(child: SkeletonBox(height: 132, borderRadius: r)),
              SizedBox(width: _gap),
              Expanded(child: SkeletonBox(height: 132, borderRadius: r)),
            ],
          ),
          SizedBox(height: _gap),
          SkeletonBox(height: 100, borderRadius: r),
        ],
      ),
    );
  }
}
