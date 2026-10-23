import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

class InboxScreen extends ConsumerWidget {
  const InboxScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final jalali = ref.watch(calendarJalaliProvider);
    final async = ref.watch(inboxProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l.inboxTitle),
        actions: [
          if ((async.value?.data.unread ?? 0) > 0 && async.value?.staleSince == null)
            TextButton(
              onPressed: () async {
                try {
                  await ref.read(apiClientProvider).post('/v1/notifications/read', body: {'all': true});
                  ref.invalidate(inboxProvider);
                } on ApiException catch (e) {
                  if (context.mounted) showMessage(context, errorMessage(l, e), error: true);
                }
              },
              child: Text(l.markAllRead),
            ),
        ],
      ),
      body: PageBody(
        child: async.when(
          loading: () => const LoadingList(),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(inboxProvider)),
          data: (cached) {
            final items = cached.data.items;
            return Column(
              children: [
                if (cached.staleSince != null) StaleBanner(savedAt: cached.staleSince!),
                Expanded(
                  child: items.isEmpty
                      ? EmptyState(title: l.inboxEmpty, description: l.inboxEmptyHelp)
                      : RefreshIndicator(
                          onRefresh: () async => ref.refresh(inboxProvider.future),
                          child: ListView.separated(
                            padding: const EdgeInsets.all(16),
                            itemCount: items.length,
                            separatorBuilder: (_, _) => const SizedBox(height: 10),
                            itemBuilder: (context, i) {
                              final n = items[i];
                              return AppCard(
                                semanticLabel: '${n.title}. ${n.body}',
                                onTap: n.linkPath == null ? null : () => _open(context, ref, n.linkPath!),
                                child: Row(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Padding(
                                      padding: const EdgeInsets.only(top: 6, right: 10, left: 0),
                                      child: Icon(Icons.circle, size: 8, color: n.read ? Colors.transparent : Brand.copper),
                                    ),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment: CrossAxisAlignment.start,
                                        children: [
                                          Text(n.title, style: Theme.of(context).textTheme.titleSmall?.copyWith(fontWeight: n.read ? FontWeight.w500 : FontWeight.w700)),
                                          const SizedBox(height: 2),
                                          Text(n.body, style: Theme.of(context).textTheme.bodySmall),
                                          const SizedBox(height: 4),
                                          Text(
                                            formatDateTime(n.createdAt, lang: context.lang, jalali: jalali),
                                            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: xc(context).fgSubtle),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
                        ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }

  void _open(BuildContext context, WidgetRef ref, String path) {
    // Links come from the server as web paths; only app-known ones are followed.
    final admin = ref.read(sessionProvider).isAdminMode;
    final m = RegExp(r'^/requests/(UT-[A-Z]-[A-Z0-9]{6})$', caseSensitive: false).firstMatch(path);
    if (m != null) context.push(admin ? '/admin/case/${m[1]}' : '/requests/${m[1]}');
  }
}
