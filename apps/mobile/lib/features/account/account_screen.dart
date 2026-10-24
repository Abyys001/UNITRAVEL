import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart' show XfamTone;

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../ui/bento.dart';
import '../../ui/theme.dart';
import '../admin/settings_sheet.dart';
import '../../ui/widgets.dart';
import '../../ui/patterns.dart';
import 'traveller_form.dart';

class AccountScreen extends ConsumerStatefulWidget {
  const AccountScreen({super.key});

  @override
  ConsumerState<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends ConsumerState<AccountScreen> {
  bool _busy = false;

  Future<void> _patch(Map<String, Object?> patch) async {
    setState(() => _busy = true);
    try {
      await ref.read(sessionProvider.notifier).updateMe(patch);
    } on ApiException catch (e) {
      if (mounted) showMessage(context, errorMessage(context.l, e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _setLanguage(String code) async {
    await ref.read(localeProvider.notifier).set(code);
    await _patch({'preferredLocale': code});
  }

  Future<void> _signOut() async {
    final l = context.l;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(l.signOutConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.cancel)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(l.signOut)),
        ],
      ),
    );
    if (ok == true) await ref.read(sessionProvider.notifier).signOut();
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final me = ref.watch(sessionProvider).me;
    final lang = context.lang;
    if (me == null) return const SizedBox.shrink();
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.accountTitle)),
      body: PageBody(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            AppCard(
              child: Row(
                children: [
                  CircleAvatar(
                    backgroundColor: Brand.navy950,
                    child: Text(
                      me.displayName.isEmpty ? '?' : me.displayName.characters.first.toUpperCase(),
                      style: const TextStyle(color: Colors.white),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(me.displayName, style: theme.textTheme.titleMedium),
                        if (me.phone != null) LtrText(me.phone!, style: theme.textTheme.bodySmall),
                      ],
                    ),
                  ),
                  if (me.admin) ToneChip(l.roleStaff, tone: XfamTone.info),
                ],
              ),
            ),
            SectionTitle(l.preferences),
            Text(l.languageLabel, style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            SegmentedButton<String>(
              showSelectedIcon: false,
              segments: [
                ButtonSegment(value: 'en', label: Text(l.langEnglish)),
                ButtonSegment(value: 'fa', label: Text(l.langPersian)),
              ],
              selected: {lang},
              onSelectionChanged: _busy ? null : (s) => _setLanguage(s.first),
            ),
            const SizedBox(height: 16),
            Text(l.calendarLabel, style: theme.textTheme.labelLarge),
            const SizedBox(height: 8),
            SegmentedButton<String>(
              showSelectedIcon: false,
              segments: [
                ButtonSegment(value: 'GREGORIAN', label: Text(l.calendarGregorian)),
                ButtonSegment(value: 'JALALI', label: Text(l.calendarJalali)),
              ],
              selected: {me.calendar},
              onSelectionChanged: _busy ? null : (s) => _patch({'calendar': s.first}),
            ),
            if (me.admin) ...[
              SectionTitle(l.adminMode),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l.onDuty),
                subtitle: Text(l.onDutyHelp),
                value: me.onDuty,
                onChanged: _busy ? null : (v) => _patch({'onDuty': v}),
              ),
              ListTile(
                key: const Key('admin-settings-link'),
                contentPadding: EdgeInsets.zero,
                minTileHeight: 56,
                leading: const Icon(Icons.tune),
                title: Text(l.settingsTitle),
                subtitle: Text(l.settingsHelp),
                trailing: Icon(chevronIcon(context)),
                onTap: () => showAdminSettings(context),
              ),
            ] else ...[
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.badge_outlined),
                title: Text(l.detailsLink),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/account/details'),
              ),
              ListTile(
                key: const Key('billing-link'),
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.receipt_long_outlined),
                title: Text(l.billingTitle),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/account/billing'),
              ),
              SectionTitle(l.myTravellers),
              const _TravellerList(),
            ],
            const SizedBox(height: 24),
            OutlinedButton.icon(onPressed: _signOut, icon: const Icon(Icons.logout), label: Text(l.signOut)),
            const SizedBox(height: 12),
            Center(child: Text(l.version('0.1.0'), style: theme.textTheme.bodySmall?.copyWith(color: xc(context).fgSubtle))),
          ],
        ),
      ),
    );
  }
}

class _TravellerList extends ConsumerWidget {
  const _TravellerList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final async = ref.watch(travellersProvider);
    return async.when(
      loading: () => const Padding(padding: EdgeInsets.all(16), child: LinearProgressIndicator()),
      error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(travellersProvider)),
      data: (list) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (list.isEmpty) Text(l.noTravellers),
          for (final t in list)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.person_outline),
              title: Text(t.fullName),
              subtitle: t.documentComplete ? null : Text(l.documentMissing),
              trailing: t.document == null ? null : ToneChip(verificationLook(l, t.verification.status).$2, tone: verificationLook(l, t.verification.status).$1),
            ),
          TextButton.icon(
            onPressed: () => showTravellerSheet(context),
            icon: const Icon(Icons.person_add_alt),
            label: Text(l.addTraveller),
          ),
        ],
      ),
    );
  }
}
