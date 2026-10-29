import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart' show XfamTone;
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_error.dart';
import '../../core/config.dart';
import '../../core/errors_l10n.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../core/site.dart';
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
            const SiteServiceLinks(),
            SectionTitle(l.helpTitle),
            ListTile(key: const Key('learn-link'), contentPadding: EdgeInsets.zero, minTileHeight: 56, leading: const Icon(Icons.menu_book_outlined), title: Text(l.learnTitle), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/learn')),
            ListTile(key: const Key('glossary-link'), contentPadding: EdgeInsets.zero, minTileHeight: 56, leading: const Icon(Icons.translate), title: Text(l.glossaryTitle), trailing: const Icon(Icons.chevron_right), onTap: () => context.push('/glossary')),
            const HelpLinks(),
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

/// A static content page on the website (FAQ, travel rules, buying guide), in the app's language.
Uri helpPageUri(String lang, String path) => Uri.parse('${AppConfig.webUrl}/$lang$path');

/// Account › Help: opens the website's content pages in the browser, like the invoice pay page.
class HelpLinks extends StatelessWidget {
  const HelpLinks({super.key});

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lang = context.lang;
    final entries = [
      ('help-faq', Icons.help_outline, l.helpFaq, '/faq'),
      ('help-travel-rules', Icons.rule_folder_outlined, l.helpTravelRules, '/travel-rules'),
      ('help-flight-guide', Icons.menu_book_outlined, l.helpFlightGuide, '/flights/guide'),
    ];
    return Column(
      children: [
        for (final (key, icon, label, path) in entries)
          ListTile(
            key: Key(key),
            contentPadding: EdgeInsets.zero,
            minTileHeight: 56,
            leading: Icon(icon),
            title: Text(label),
            trailing: const Icon(Icons.open_in_new, size: 18),
            onTap: () async {
              final ok = await launchUrl(helpPageUri(lang, path), mode: LaunchMode.externalApplication);
              if (!ok && context.mounted) showMessage(context, l.billingOpenFailed, error: true);
            },
          ),
      ],
    );
  }
}

/// Account › Services: every switched-on service, opened as a native screen (the same flag set as the website menu,
/// `GET /v1/site`, spec §4.1). The full explorer with availability states is the Services tab; this is the shortcut list.
class SiteServiceLinks extends ConsumerWidget {
  const SiteServiceLinks({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final menu = ref.watch(siteMenuProvider).value ?? const <String, bool>{};
    final entries = <(String, IconData, String, String)>[
      ('hotels', Icons.hotel_outlined, l.menuHotels, '/services/new/hotels'),
      ('stays', Icons.house_outlined, l.menuStays, '/services/new/stays'),
      ('trains', Icons.train_outlined, l.menuTrains, '/services/new/trains'),
      ('buses', Icons.directions_bus_outlined, l.menuBuses, '/services/new/buses'),
      ('visa', Icons.approval_outlined, l.menuVisa, '/services/new/visa'),
      ('tours', Icons.public, l.menuTours, '/services/new/tours'),
      ('cip', Icons.chair_outlined, l.menuCip, '/services/new/cip'),
      ('insurance', Icons.health_and_safety_outlined, l.menuInsurance, '/services/new/insurance'),
      ('club', Icons.star_outline, l.menuClub, '/club'),
      ('track', Icons.manage_search, l.menuTrack, '/track'),
      ('support', Icons.support_agent, l.menuSupport, '/support'),
    ].where((e) => menu[e.$1] == true).toList();
    if (entries.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionTitle(l.servicesTitle),
        for (final (key, icon, label, path) in entries)
          ListTile(
            key: Key('site-$key'),
            contentPadding: EdgeInsets.zero,
            minTileHeight: 56,
            leading: Icon(icon),
            title: Text(label),
            trailing: const Icon(Icons.chevron_right),
            onTap: () => context.push(path),
          ),
      ],
    );
  }
}
