import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart' show XfamTone;

import '../../core/api_error.dart';
import '../../core/format.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../models/json.dart';
import '../../models/services.dart';
import '../../ui/widgets.dart';

/// Customer club (ADR-0016): the customer's own tier, benefits and credit. While the club is switched off the API answers
/// `enabled: false` and the screen says so; a customer who is not a member sees an invitation, never a sign-up form.
class ClubScreen extends ConsumerWidget {
  const ClubScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final async = ref.watch(clubProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.menuClub)),
      body: PageBody(
        child: async.when(
          loading: () => const LoadingList(count: 2),
          // FEATURE_DISABLED is the same honest "not available" as `enabled: false`.
          error: (e, _) => e is ApiException && e.code == 'FEATURE_DISABLED' ? _Notice(text: l.clUnavailable) : ErrorBox(e, onRetry: () => ref.invalidate(clubProvider)),
          data: (club) => RefreshIndicator(
            onRefresh: () async => ref.refresh(clubProvider.future),
            child: club.enabled ? _Body(club: club) : ListView(physics: const AlwaysScrollableScrollPhysics(), children: [_Notice(text: l.clUnavailable)]),
          ),
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.text});
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(24),
    child: Column(
      children: [
        const Icon(Icons.star_outline, size: 40),
        const SizedBox(height: 12),
        Text(text, key: const Key('club-notice'), textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyLarge),
        const SizedBox(height: 16),
        OutlinedButton(onPressed: () => context.push('/support'), child: Text(context.l.menuSupport)),
      ],
    ),
  );
}

class _Body extends ConsumerWidget {
  const _Body({required this.club});
  final ClubView club;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final theme = Theme.of(context);
    if (!club.member) {
      return ListView(physics: const AlwaysScrollableScrollPhysics(), padding: const EdgeInsets.all(16), children: [AppCard(key: const Key('club-not-member'), child: Text(l.clNotMember)), const SizedBox(height: 12), Text(l.clHow, style: theme.textTheme.bodySmall)]);
    }
    final tier = (lang == 'fa' ? club.tierFa : club.tierEn) ?? club.tierEn ?? '';
    String applies(String a) => switch (a) { 'FLIGHT' => l.clApFlight, 'CARGO' => l.clApCargo, 'SERVICE' => l.clApService, _ => l.clApAny };
    String value(ClubBenefit b) => switch (b.kind) {
      'DISCOUNT_PERCENT' => l.clPercent(b.value),
      'DISCOUNT_FIXED' => l.clFixed(formatMoney(Money(b.value, b.currency ?? 'GBP'), lang)),
      'BONUS_CREDIT' => '${l.clCredit}: ${formatMoney(Money(b.value, b.currency ?? 'GBP'), lang)}',
      _ => l.clPerk,
    };
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        AppCard(
          key: const Key('club-member'),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(l.clLevel, style: theme.textTheme.labelMedium),
              Text(tier, style: theme.textTheme.headlineSmall),
              if (club.joinedAt != null) Text(l.clSince(formatDate(club.joinedAt!, lang: lang, jalali: jalali)), style: theme.textTheme.bodySmall),
              if (club.status != 'ACTIVE') ...[const SizedBox(height: 8), ToneChip(l.clSuspended, tone: XfamTone.warning)],
            ],
          ),
        ),
        if (club.credit.any((m) => m.amountMinor > 0)) ...[
          SectionTitle(l.clCredit),
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [for (final m in club.credit) Text(formatMoney(m, lang), style: theme.textTheme.titleLarge), const SizedBox(height: 4), Text(l.clCreditNote, style: theme.textTheme.bodySmall)],
            ),
          ),
        ],
        SectionTitle(l.clBenefits),
        if (club.benefits.isEmpty) Text(l.clNoBenefits),
        for (final b in club.benefits)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: AppCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(value(b), style: theme.textTheme.titleSmall),
                  if (b.description(lang).isNotEmpty) Text(b.description(lang)),
                  const SizedBox(height: 6),
                  Wrap(spacing: 8, children: [ToneChip(applies(b.appliesTo)), if (b.validTo != null) ToneChip(l.clValidUntil(formatDate(b.validTo!, lang: lang, jalali: jalali)))]),
                ],
              ),
            ),
          ),
        const SizedBox(height: 8),
        Text(l.clHow, style: theme.textTheme.bodySmall),
      ],
    );
  }
}
