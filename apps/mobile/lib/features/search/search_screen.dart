import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../l10n/app_localizations.dart';
import '../../models/json.dart';
import '../../models/search.dart';
import '../../ui/brand_logo.dart';
import '../../ui/route_arcs.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'place_picker.dart';
import 'search_form_state.dart';

class SearchScreen extends ConsumerStatefulWidget {
  const SearchScreen({super.key});

  @override
  ConsumerState<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends ConsumerState<SearchScreen> {
  bool _busy = false;
  Object? _error;
  FormProblem? _problem;

  Future<void> _submit() async {
    final form = ref.read(searchFormProvider);
    final problem = form.validate();
    setState(() {
      _problem = problem;
      _error = null;
    });
    if (problem != null) return;
    setState(() => _busy = true);
    try {
      final res = await ref.read(apiClientProvider).post('/v1/flight-searches', body: form.toJson()) as Json;
      if (mounted) context.push('/search/results/${res.str('id')}');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _problemText(AppL10n l, FormProblem p) => switch (p) {
    FormProblem.missingPlace => l.problemMissingPlace,
    FormProblem.samePlace => l.problemSamePlace,
    FormProblem.missingDate => l.problemMissingDate,
    FormProblem.dateOrder => l.problemDateOrder,
    FormProblem.infants => l.problemInfants,
  };

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final form = ref.watch(searchFormProvider);
    final notifier = ref.read(searchFormProvider.notifier);
    final multi = form.tripType == TripType.multiCity || form.tripType == TripType.openJaw;
    final tripLabels = {
      TripType.oneWay: l.tripOneWay,
      TripType.roundTrip: l.tripReturn,
      TripType.openJaw: l.tripOpenJaw,
      TripType.multiCity: l.tripMultiCity,
    };

    return Scaffold(
      body: PageBody(
        child: ListView(
          padding: EdgeInsets.zero,
          children: [
            RouteArcsHeader(
              height: 285,
              child: SafeArea(
                bottom: false,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const BrandLogo(onDark: true, markSize: 40),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                    Semantics(header: true, child: Text(l.searchTitle, style: Theme.of(context).textTheme.displaySmall?.copyWith(color: Colors.white))),
                    const SizedBox(height: 4),
                    Text(l.searchSubtitle, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Brand.onDarkMuted)),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const Padding(padding: EdgeInsets.fromLTRB(16, 4, 16, 0), child: _ServiceRow()),
            Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      for (final t in TripType.values)
                        ChoiceChip(
                          label: Text(tripLabels[t]!),
                          selected: form.tripType == t,
                          onSelected: (_) => notifier.setTripType(t),
                        ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  if (!multi) ...[
                    _RouteFields(index: 0),
                    const SizedBox(height: 12),
                    _DateField(index: 0, label: l.date),
                    if (form.tripType == TripType.roundTrip) ...[
                      const SizedBox(height: 12),
                      _DateField(index: 1, label: l.returnDate),
                    ],
                  ] else
                    for (var i = 0; i < form.legs.length; i++) ...[
                      Row(
                        children: [
                          Expanded(child: Text(l.leg(i + 1), style: Theme.of(context).textTheme.titleSmall)),
                          if (form.tripType == TripType.multiCity && form.legs.length > 2)
                            TextButton(onPressed: () => notifier.removeLeg(i), child: Text(l.removeFlight)),
                        ],
                      ),
                      _RouteFields(index: i, swappable: false),
                      const SizedBox(height: 8),
                      _DateField(index: i, label: l.date),
                      const SizedBox(height: 16),
                    ],
                  if (form.tripType == TripType.multiCity && form.legs.length < 4)
                    Align(
                      alignment: AlignmentDirectional.centerStart,
                      child: TextButton.icon(onPressed: notifier.addLeg, icon: const Icon(Icons.add), label: Text(l.addFlight)),
                    ),
                  const _TravellersCard(),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: form.cabin,
                    decoration: InputDecoration(labelText: l.cabin),
                    items: [
                      DropdownMenuItem(value: 'ECONOMY', child: Text(l.cabinEconomy)),
                      DropdownMenuItem(value: 'PREMIUM_ECONOMY', child: Text(l.cabinPremium)),
                      DropdownMenuItem(value: 'BUSINESS', child: Text(l.cabinBusiness)),
                      DropdownMenuItem(value: 'FIRST', child: Text(l.cabinFirst)),
                    ],
                    onChanged: (v) => notifier.update((f) => f.copyWith(cabin: v)),
                  ),
                  const _PreferencesCard(),
                  if (_problem != null || _error != null) ...[
                    const SizedBox(height: 12),
                    Semantics(
                      liveRegion: true,
                      child: Text(
                        _problem != null ? _problemText(l, _problem!) : errorMessage(l, _error!),
                        style: const TextStyle(color: Brand.danger),
                      ),
                    ),
                  ],
                  const SizedBox(height: 16),
                  FilledButton.icon(
                    onPressed: _busy ? null : _submit,
                    icon: _busy
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Icon(Icons.search),
                    label: Text(l.searchFlights),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _RouteFields extends ConsumerWidget {
  const _RouteFields({required this.index, this.swappable = true});
  final int index;
  final bool swappable;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final leg = ref.watch(searchFormProvider.select((f) => f.legs[index]));
    final notifier = ref.read(searchFormProvider.notifier);

    Widget field(String label, Place? value, ValueChanged<Place> onPicked) => Expanded(
      child: Semantics(
        button: true,
        label: '$label: ${value?.name(lang) ?? l.chooseCity}',
        excludeSemantics: true,
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () async {
            final p = await pickPlace(context);
            if (p != null) onPicked(p);
          },
          child: InputDecorator(
            decoration: InputDecoration(labelText: label),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    value?.name(lang) ?? l.chooseCity,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: value == null ? xc(context).fgSubtle : null),
                  ),
                ),
                if (value != null) LtrText(value.code, style: Theme.of(context).textTheme.labelMedium?.copyWith(color: Brand.orange700)),
              ],
            ),
          ),
        ),
      ),
    );

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        field(l.from, leg.from, (p) => notifier.setLeg(index, leg.copyWith(from: p))),
        if (swappable)
          IconButton(
            tooltip: '${l.from} ⇄ ${l.to}',
            onPressed: notifier.swap,
            icon: const Icon(Icons.swap_horiz),
          )
        else
          const SizedBox(width: 8),
        field(l.to, leg.to, (p) => notifier.setLeg(index, leg.copyWith(to: p))),
      ],
    );
  }
}

class _DateField extends ConsumerWidget {
  const _DateField({required this.index, required this.label});
  final int index;
  final String label;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final leg = ref.watch(searchFormProvider.select((f) => f.legs[index]));
    final date = leg.date;
    final primary = date == null ? l.chooseDate : formatDate(date, lang: lang, jalali: jalali);
    // Show the other calendar too, so a Jalali user can still read the Gregorian date airlines use.
    final secondary = date == null ? null : formatDate(date, lang: lang, jalali: !jalali);
    return Semantics(
      button: true,
      label: '$label: $primary',
      excludeSemantics: true,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () async {
          final now = DateTime.now();
          final picked = await showDatePicker(
            context: context,
            initialDate: date ?? now,
            firstDate: DateTime(now.year, now.month, now.day),
            lastDate: now.add(const Duration(days: 360)),
          );
          if (picked != null) ref.read(searchFormProvider.notifier).setLeg(index, leg.copyWith(date: picked));
        },
        child: InputDecorator(
          decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.calendar_today_outlined, size: 20)),
          child: Row(
            children: [
              Expanded(child: Text(primary)),
              if (secondary != null) Text(secondary, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: xc(context).fgSubtle)),
            ],
          ),
        ),
      ),
    );
  }
}

class _Stepper extends StatelessWidget {
  const _Stepper({required this.label, required this.value, required this.min, required this.max, required this.onChanged});
  final String label;
  final int value;
  final int min;
  final int max;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(child: Text(label)),
      IconButton.outlined(
        tooltip: '− $label',
        onPressed: value > min ? () => onChanged(value - 1) : null,
        icon: const Icon(Icons.remove),
      ),
      SizedBox(
        width: 40,
        child: Text(digits('$value', context.lang), textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
      ),
      IconButton.outlined(
        tooltip: '+ $label',
        onPressed: value < max ? () => onChanged(value + 1) : null,
        icon: const Icon(Icons.add),
      ),
    ],
  );
}

class _TravellersCard extends ConsumerWidget {
  const _TravellersCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final form = ref.watch(searchFormProvider);
    final n = ref.read(searchFormProvider.notifier);
    final total = form.passengerCount;
    return AppCard(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
        child: ExpansionTile(
          tilePadding: EdgeInsets.zero,
          childrenPadding: EdgeInsets.zero,
          title: Text(l.travellers),
          subtitle: Text(l.travellerCount(total)),
          children: [
            _Stepper(
              label: l.adults,
              value: form.adults,
              min: 1,
              max: 9 - form.childAges.length - form.infants,
              onChanged: (v) => n.update((f) => f.copyWith(adults: v, infants: f.infants > v ? v : f.infants)),
            ),
            _Stepper(
              label: l.children,
              value: form.childAges.length,
              min: 0,
              max: 9 - form.adults - form.infants + form.childAges.length,
              onChanged: (v) => n.update((f) {
                final ages = [...f.childAges];
                while (ages.length < v) {
                  ages.add(8);
                }
                return f.copyWith(childAges: ages.sublist(0, v));
              }),
            ),
            for (var i = 0; i < form.childAges.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: DropdownButtonFormField<int>(
                  initialValue: form.childAges[i],
                  decoration: InputDecoration(labelText: l.childAge(i + 1)),
                  items: [for (var a = 2; a <= 11; a++) DropdownMenuItem(value: a, child: Text(digits('$a', context.lang)))],
                  onChanged: (v) => n.update((f) {
                    final ages = [...f.childAges]..[i] = v ?? 8;
                    return f.copyWith(childAges: ages);
                  }),
                ),
              ),
            _Stepper(
              label: l.infants,
              value: form.infants,
              min: 0,
              max: form.adults.clamp(0, 9 - form.adults - form.childAges.length),
              onChanged: (v) => n.update((f) => f.copyWith(infants: v)),
            ),
          ],
        ),
      ),
    );
  }
}

class _PreferencesCard extends ConsumerWidget {
  const _PreferencesCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final form = ref.watch(searchFormProvider);
    final n = ref.read(searchFormProvider.notifier);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: AppCard(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Theme(
          data: Theme.of(context).copyWith(dividerColor: Colors.transparent),
          child: ExpansionTile(
            tilePadding: EdgeInsets.zero,
            childrenPadding: EdgeInsets.zero,
            title: Text(l.connections),
            subtitle: Text(l.stopsAny(form.maxStops)),
            children: [
              Align(
                alignment: AlignmentDirectional.centerStart,
                child: Wrap(
                  spacing: 8,
                  children: [
                    for (var s = 0; s <= 3; s++)
                      ChoiceChip(
                        label: Text(l.stopsAny(s)),
                        selected: form.maxStops == s,
                        onSelected: (_) => n.update((f) => f.copyWith(maxStops: s)),
                      ),
                  ],
                ),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l.allowSelfTransfer),
                value: form.allowSelfTransfer,
                onChanged: (v) => n.update((f) => f.copyWith(allowSelfTransfer: v)),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l.allowOvernight),
                value: form.allowOvernight,
                onChanged: (v) => n.update((f) => f.copyWith(allowOvernight: v)),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l.allowAirportChange),
                value: form.allowAirportChange,
                onChanged: (v) => n.update((f) => f.copyWith(allowAirportChange: v)),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(l.includeGateways),
                subtitle: Text(l.gatewayHint),
                value: form.includeGateways,
                onChanged: (v) => n.update((f) => f.copyWith(includeGateways: v)),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Round outline service shortcuts: orange ring, white fill (brand artwork).
class _ServiceRow extends StatelessWidget {
  const _ServiceRow();

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceAround,
      children: [
        _ServiceIcon(icon: Icons.flight_takeoff, label: l.navSearch, selected: true),
        _ServiceIcon(icon: Icons.inventory_2_outlined, label: l.navCargo, onTap: () => context.push('/cargo')),
        _ServiceIcon(icon: Icons.manage_search, label: l.menuTrack, onTap: () => context.push('/track')),
        _ServiceIcon(icon: Icons.apps, label: l.servicesTitle, onTap: () => context.go('/services')),
      ],
    );
  }
}

class _ServiceIcon extends StatelessWidget {
  const _ServiceIcon({required this.icon, required this.label, this.onTap, this.selected = false});
  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final bool selected;

  @override
  Widget build(BuildContext context) => Semantics(
    button: onTap != null,
    selected: selected,
    label: label,
    excludeSemantics: true,
    child: InkResponse(
      onTap: onTap,
      radius: 44,
      child: SizedBox(
        width: 88,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: Colors.white,
                border: Border.all(color: Brand.orange, width: 2.5),
                boxShadow: selected ? Brand.cardShadow : null,
              ),
              child: Icon(icon, color: Brand.navy950, size: 26),
            ),
            const SizedBox(height: 6),
            Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(fontWeight: selected ? FontWeight.w700 : FontWeight.w500),
            ),
          ],
        ),
      ),
    ),
  );
}
