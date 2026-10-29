import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart' show XfamTone;

import '../../core/site.dart';
import '../../l10n/app_localizations.dart';
import '../../models/services.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

enum Availability { available, requestOnly, comingSoon }

class ExplorerItem {
  const ExplorerItem(this.key, this.icon, this.label, this.blurb, this.state, this.route);
  final String key;
  final IconData icon;
  final String label;
  final String blurb;
  final Availability state;

  /// Null while the service is not available: a tile never leads to a dead page.
  final String? route;
}

/// The 14 menu items of the site, each with its real state. Flights, cargo, tracking and support are native screens that
/// work without a flag; every request-based service follows `GET /v1/site` and reads "Coming soon" while it is off.
/// The travel card is not built (O14), so it is always "Coming soon".
List<ExplorerItem> explorerItems(AppL10n l, SiteConfig site) {
  final core = site.menu.isEmpty;
  Availability flag(String k, {bool always = false}) => (always && core) || site.on(k) ? Availability.available : Availability.comingSoon;
  ExplorerItem request(String key, IconData icon, String label, String blurb, ServiceType t) {
    final on = site.on(t.menuKey);
    return ExplorerItem(key, icon, label, blurb, on ? Availability.requestOnly : Availability.comingSoon, on ? '/services/new/${t.path}' : null);
  }

  ExplorerItem native(String key, IconData icon, String label, String blurb, String route, {bool always = false, Availability? when}) {
    final s = when ?? flag(key, always: always);
    return ExplorerItem(key, icon, label, blurb, s, s == Availability.comingSoon ? null : route);
  }

  return [
    ExplorerItem('flights', Icons.flight_takeoff, l.menuFlights, l.exFlights, Availability.available, '/search'),
    request('hotels', Icons.hotel_outlined, l.menuHotels, l.exHotels, ServiceType.hotel),
    request('trains', Icons.train_outlined, l.menuTrains, l.exTrains, ServiceType.train),
    request('buses', Icons.directions_bus_outlined, l.menuBuses, l.exBuses, ServiceType.bus),
    request('stays', Icons.house_outlined, l.menuStays, l.exStays, ServiceType.stay),
    request('visa', Icons.approval_outlined, l.menuVisa, l.exVisa, ServiceType.visa),
    request('tours', Icons.public, l.menuTours, l.exTours, ServiceType.tour),
    request('cip', Icons.chair_outlined, l.menuCip, l.exCip, ServiceType.cip),
    native('cargo', Icons.inventory_2_outlined, l.menuCargo, l.exCargo, '/cargo', when: Availability.requestOnly),
    request('insurance', Icons.health_and_safety_outlined, l.menuInsurance, l.exInsurance, ServiceType.insurance),
    ExplorerItem('card', Icons.credit_card_outlined, l.menuCard, l.exCard, Availability.comingSoon, null),
    native('club', Icons.star_outline, l.menuClub, l.exClub, '/club'),
    native('track', Icons.manage_search, l.menuTrack, l.exTrack, '/track', always: true),
    native('support', Icons.support_agent, l.menuSupport, l.exSupport, '/support', always: true),
  ];
}

String availabilityLabel(AppL10n l, Availability a) => switch (a) {
  Availability.available => l.stateAvailable,
  Availability.requestOnly => l.stateRequestOnly,
  Availability.comingSoon => l.stateComingSoon,
};

XfamTone availabilityTone(Availability a) => switch (a) {
  Availability.available => XfamTone.success,
  Availability.requestOnly => XfamTone.info,
  Availability.comingSoon => XfamTone.neutral,
};

class ServicesScreen extends ConsumerWidget {
  const ServicesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final site = ref.watch(siteConfigProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.servicesTitle)),
      body: PageBody(
        child: site.when(
          loading: () => const LoadingList(),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(siteConfigProvider)),
          data: (cfg) => RefreshIndicator(
            onRefresh: () async => ref.refresh(siteConfigProvider.future),
            child: LayoutBuilder(
              builder: (context, box) {
                const gap = 12.0;
                const pad = 16.0;
                final cols = box.maxWidth >= 900 ? 3 : (box.maxWidth >= 560 ? 2 : 1);
                final w = (box.maxWidth - pad * 2 - gap * (cols - 1)) / cols;
                return ListView(
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(pad),
                  children: [
                    Text(l.exploreLead, style: Theme.of(context).textTheme.bodyMedium),
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: gap,
                      runSpacing: gap,
                      children: [for (final it in explorerItems(l, cfg)) SizedBox(width: w, child: ExplorerTile(item: it))],
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }
}

class ExplorerTile extends StatelessWidget {
  const ExplorerTile({super.key, required this.item});
  final ExplorerItem item;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final soon = item.state == Availability.comingSoon;
    final theme = Theme.of(context);
    final state = availabilityLabel(l, item.state);
    final tile = AppCard(
      semanticLabel: '${item.label}, $state. ${item.blurb}',
      onTap: item.route == null ? null : () => item.route == '/search' ? context.go(item.route!) : context.push(item.route!),
      child: Opacity(
        opacity: soon ? 0.72 : 1,
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 64),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(shape: BoxShape.circle, color: Colors.white, border: Border.all(color: Brand.orange, width: 2)),
                child: Icon(item.icon, color: Brand.navy950, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(item.label, style: theme.textTheme.titleSmall),
                    const SizedBox(height: 2),
                    Text(item.blurb, style: theme.textTheme.bodySmall?.copyWith(color: xc(context).fgMuted)),
                    const SizedBox(height: 6),
                    ToneChip(state, tone: availabilityTone(item.state)),
                  ],
                ),
              ),
              if (item.route != null) const Padding(padding: EdgeInsetsDirectional.only(start: 4, top: 10), child: Icon(Icons.chevron_right)),
            ],
          ),
        ),
      ),
    );
    return Container(key: Key('explorer-${item.key}'), child: tile);
  }
}
