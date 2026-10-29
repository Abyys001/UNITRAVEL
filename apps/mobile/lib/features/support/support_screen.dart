import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/site.dart';
import '../../core/session.dart';
import '../../ui/widgets.dart';
import '../account/account_screen.dart' show helpPageUri;

/// Support (spec §4.6): phone and email come from Developer Panel › Settings through `GET /v1/site`. Placeholder contacts
/// are never shown, and hours appear only once the client has confirmed them (O13, O15): no 24-hour claim. There is no live
/// chat; customers write to us from the page of their own request.
class SupportScreen extends ConsumerWidget {
  const SupportScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final site = ref.watch(siteConfigProvider);
    final signedIn = ref.watch(sessionProvider).status == AuthStatus.signedIn;
    Future<void> open(Uri uri) async {
      final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
      if (!ok && context.mounted) showMessage(context, l.billingOpenFailed, error: true);
    }

    return Scaffold(
      appBar: AppBar(title: Text(l.spTitle)),
      body: PageBody(
        child: site.when(
          loading: () => const LoadingList(count: 2),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(siteConfigProvider)),
          data: (cfg) {
            final hours = lang == 'fa' ? (cfg.hoursFa ?? cfg.hoursEn) : (cfg.hoursEn ?? cfg.hoursFa);
            final none = cfg.phone == null && cfg.email == null;
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(l.spLead),
                const SizedBox(height: 16),
                AppCard(
                  key: const Key('support-contacts'),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (none) Text(l.spSoon),
                      if (cfg.phone != null)
                        ListTile(
                          key: const Key('support-phone'),
                          contentPadding: EdgeInsets.zero,
                          minTileHeight: 56,
                          leading: const Icon(Icons.phone_outlined),
                          title: Text(l.spPhone),
                          subtitle: LtrText(cfg.phone!),
                          onTap: () => open(Uri(scheme: 'tel', path: cfg.phone!.replaceAll(RegExp(r'\s'), ''))),
                        ),
                      if (cfg.email != null)
                        ListTile(
                          key: const Key('support-email'),
                          contentPadding: EdgeInsets.zero,
                          minTileHeight: 56,
                          leading: const Icon(Icons.mail_outline),
                          title: Text(l.spEmail),
                          subtitle: LtrText(cfg.email!),
                          onTap: () => open(Uri(scheme: 'mailto', path: cfg.email!)),
                        ),
                      if (hours != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text('${l.spHours}: $hours')),
                    ],
                  ),
                ),
                const SizedBox(height: 8),
                ListTile(
                  key: const Key('support-faq'),
                  contentPadding: EdgeInsets.zero,
                  minTileHeight: 56,
                  leading: const Icon(Icons.help_outline),
                  title: Text(l.helpFaq),
                  trailing: const Icon(Icons.open_in_new, size: 18),
                  onTap: () => open(helpPageUri(lang, '/faq')),
                ),
                if (signedIn)
                  ListTile(
                    key: const Key('support-requests'),
                    contentPadding: EdgeInsets.zero,
                    minTileHeight: 56,
                    leading: const Icon(Icons.assignment_outlined),
                    title: Text(l.spMessage),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () => context.go('/requests'),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}
