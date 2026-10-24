import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/format.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../models/requests.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'package:kit_ui/kit_ui.dart';

class RequestsScreen extends ConsumerWidget {
  const RequestsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final async = ref.watch(requestsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.requestsTitle)),
      body: PageBody(
        child: async.when(
          loading: () => const LoadingList(),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(requestsProvider)),
          data: (cached) {
            final items = cached.data;
            return Column(
              children: [
                if (cached.staleSince != null) StaleBanner(savedAt: cached.staleSince!),
                Expanded(
                  child: items.isEmpty
                      ? EmptyState(
                          title: l.noRequests,
                          description: l.noRequestsHelp,
                          iconName: 'plane',
                          actionLabel: l.startSearch,
                          onAction: () => context.go('/search'),
                        )
                      : RefreshIndicator(
                          onRefresh: () async => ref.refresh(requestsProvider.future),
                          child: ListView.separated(
                            padding: const EdgeInsets.all(16),
                            itemCount: items.length,
                            separatorBuilder: (_, _) => const SizedBox(height: 12),
                            itemBuilder: (context, i) => RequestTile(item: items[i]),
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
}

class RequestTile extends ConsumerWidget {
  const RequestTile({super.key, required this.item});
  final RequestListItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final date = formatIsoDate(item.firstDate, lang: lang, jalali: jalali);
    return AppCard(
      semanticLabel: '${item.ref}, ${item.routeLabel}, ${item.statusLabel}',
      onTap: () => context.push('/requests/${item.ref}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              LtrText(item.ref, style: Theme.of(context).textTheme.labelLarge?.copyWith(color: Brand.orange700, letterSpacing: 0.8)),
              if (item.isCargo) ...[const SizedBox(width: 8), ToneChip(l.navCargo)],
              const Spacer(),
              ToneChip(item.statusLabel, tone: toneForStatus(item.status)),
            ],
          ),
          const SizedBox(height: 8),
          Text(item.routeLabel, style: Theme.of(context).textTheme.titleMedium),
          if (date.isNotEmpty) Text(date, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: xc(context).fgMuted)),
          if (item.unread > 0)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: ToneChip(l.unreadMessages(item.unread), tone: XfamTone.info, solid: true),
            ),
        ],
      ),
    );
  }
}
