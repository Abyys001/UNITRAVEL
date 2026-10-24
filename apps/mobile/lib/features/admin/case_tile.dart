import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart' show XfamTone;

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../l10n/app_localizations.dart';
import '../../models/admin.dart';
import '../../ui/bento.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'admin_providers.dart';
import 'sla.dart';

/// "2h 15m" / "۲ ساعت ۱۵ دقیقه".
String durationText(AppL10n l, String lang, Duration d) => durationParts(d)
    .map((p) {
      final n = digits('${p.$1}', lang);
      return switch (p.$2) {
        'd' => l.durDays(n),
        'h' => l.durHours(n),
        _ => l.durMinutes(n),
      };
    })
    .join(' ');

/// Label for an SLA level at `now`; null when the case carries no SLA.
String? slaLabel(AppL10n l, String lang, SlaLevel level, DateTime due, DateTime now) => switch (level) {
  SlaLevel.none => null,
  SlaLevel.breached => l.slaOverdue(durationText(l, lang, now.difference(due))),
  _ => l.slaLeft(durationText(l, lang, due.difference(now))),
};

XfamTone slaTone(SlaLevel level) => switch (level) {
  SlaLevel.breached => XfamTone.danger,
  SlaLevel.risk => XfamTone.warning,
  _ => XfamTone.neutral,
};

/// Countdown chip. Text always says how long is left or over; colour and icon are reinforcement.
class SlaChip extends ConsumerWidget {
  const SlaChip({super.key, required this.status, required this.due});
  final String status;
  final DateTime? due;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final now = ref.watch(nowProvider).value ?? DateTime.now();
    final level = slaLevel(status: status, due: due, now: now);
    final text = due == null ? null : slaLabel(context.l, context.lang, level, due!, now);
    if (text == null) return const SizedBox.shrink();
    return ToneChip(text, tone: slaTone(level), icon: level == SlaLevel.breached ? Icons.error_outline : Icons.timer_outlined);
  }
}

/// Claims `ref` from a list. Re-reads the case so the API's own `allowed` and version decide, never the list row.
Future<bool> claimFromList(BuildContext context, WidgetRef ref, String requestRef) async {
  final l = context.l;
  final api = ref.read(apiClientProvider);
  try {
    final c = await ref.refresh(adminCaseProvider(requestRef).future);
    final claim = c.command('claim');
    if (claim == null || !claim.allowed) {
      Haptics.warn();
      if (context.mounted) showMessage(context, claim?.reason == null ? l.allowedNone : l.commandNotAllowed(claim!.reason!), error: true);
      return false;
    }
    await api.post('/v1/admin/flight-requests/$requestRef/commands/claim', body: {}, headers: {'If-Match': '${c.version}'});
    Haptics.success();
    ref.invalidate(queueSummaryProvider);
    ref.invalidate(adminCasesProvider);
    ref.invalidate(adminCaseProvider(requestRef));
    if (context.mounted) showMessage(context, l.claimed);
    return true;
  } on ApiException catch (e) {
    Haptics.warn();
    if (context.mounted) showMessage(context, errorMessage(l, e), error: true);
    return false;
  }
}

/// One case row, shared by Queue and Search. Unassigned rows can be swiped to claim when [swipeToClaim].
class CaseTile extends ConsumerWidget {
  const CaseTile({super.key, required this.item, this.swipeToClaim = false});
  final AdminListItem item;
  final bool swipeToClaim;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final theme = Theme.of(context);
    final c = xc(context);
    final now = ref.watch(nowProvider).value ?? DateTime.now();
    final level = slaLevel(status: item.status, due: item.slaDueAt, now: now);
    final sla = item.slaDueAt == null ? null : slaLabel(l, lang, level, item.slaDueAt!, now);
    final meta = '${item.customer}${sep(lang)}${formatIsoDate(item.firstTravelDate, lang: lang, jalali: jalali)}${sep(lang)}${item.assignee ?? l.unassigned}';
    final canSwipe = swipeToClaim && item.assignee == null;
    void open() => context.push('/admin/case/${item.ref}');
    Future<void> claim() async {
      await claimFromList(context, ref, item.ref);
    }

    final card = Semantics(
      container: true,
      button: true,
      excludeSemantics: true,
      label: [item.ref, item.routeLabel, meta, staffStatusLabel(l, item.status), ?sla, if (item.urgent) l.urgent].join('. '),
      onTap: open,
      customSemanticsActions: {if (canSwipe) CustomSemanticsAction(label: l.claim): claim},
      child: Material(
        color: c.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(Brand.tileRadius),
          side: BorderSide(color: level == SlaLevel.breached ? c.dangerBorder : c.border, width: level == SlaLevel.breached ? 1.5 : 1),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: open,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 88),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      LtrText(item.ref, style: theme.textTheme.labelLarge?.copyWith(color: accentText(context), letterSpacing: 0.8)),
                      if (item.urgent) ...[const SizedBox(width: 6), ToneChip(l.urgent, tone: XfamTone.danger, solid: true)],
                      const Spacer(),
                      ToneChip(staffStatusLabel(l, item.status), tone: toneForStatus(item.status)),
                    ],
                  ),
                  const SizedBox(height: 8),
                  Text(item.routeLabel, style: theme.textTheme.titleMedium),
                  const SizedBox(height: 2),
                  Text(meta, style: theme.textTheme.bodySmall?.copyWith(color: c.fgMuted)),
                  if (sla != null) ...[const SizedBox(height: 10), SlaChip(status: item.status, due: item.slaDueAt)],
                ],
              ),
            ),
          ),
        ),
      ),
    );
    if (!canSwipe) return card;
    return Dismissible(
      key: ValueKey('claim-${item.ref}'),
      direction: DismissDirection.startToEnd,
      // The row never leaves: claiming is a server round trip and the list refetches on success.
      confirmDismiss: (_) async {
        await claim();
        return false;
      },
      background: Container(
        alignment: AlignmentDirectional.centerStart,
        padding: const EdgeInsetsDirectional.only(start: 24),
        decoration: BoxDecoration(
          color: c.successSubtle,
          borderRadius: BorderRadius.circular(Brand.tileRadius),
          border: Border.all(color: c.successBorder),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.back_hand_outlined, color: c.successSubtleFg),
            const SizedBox(width: 8),
            Text(
              l.claim,
              style: theme.textTheme.labelLarge?.copyWith(color: c.successSubtleFg, fontWeight: FontWeight.w700),
            ),
          ],
        ),
      ),
      child: card,
    );
  }
}
