import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../core/site.dart';
import '../../models/json.dart';
import '../../models/services.dart';
import '../../ui/widgets.dart';
import 'service_labels.dart';

final _flightNo = RegExp(r'^[A-Z0-9]{2,3} ?\d{1,4}[A-Z]?$');
String _iso(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';

/// One request form for every request-based service (ADR-0015), driven by [type]. It sends the same `POST
/// /v1/service-requests` body as the website, behind the same flag: a service that is off shows a notice, never a form.
class ServiceFormScreen extends ConsumerStatefulWidget {
  const ServiceFormScreen({super.key, required this.type});
  final ServiceType type;

  @override
  ConsumerState<ServiceFormScreen> createState() => _ServiceFormScreenState();
}

class _ServiceFormScreenState extends ConsumerState<ServiceFormScreen> {
  final _text = <String, TextEditingController>{};
  final _pick = <String, String>{};
  final _travellers = <String>{};
  final _ack = <String, bool>{'notABooking': false, 'privacy': false};
  final _key = const Uuid().v4();
  String? _phoneId;
  bool _busy = false;
  Object? _error;

  TextEditingController _c(String name, [String initial = '']) => _text.putIfAbsent(name, () => TextEditingController(text: initial));
  String _v(String name) => (_text[name]?.text ?? '').trim();

  @override
  void dispose() {
    for (final c in _text.values) {
      c.dispose();
    }
    super.dispose();
  }

  ServiceType get t => widget.type;

  int? _int(String name, int min, int max) {
    final n = int.tryParse(_v(name));
    return n != null && n >= min && n <= max ? n : null;
  }

  bool get _fieldsValid {
    final s = _v;
    switch (t) {
      case ServiceType.visa:
        return RegExp(r'^[A-Za-z]{2}$').hasMatch(s('country')) && _pick['purpose'] != null && s('date').isNotEmpty;
      case ServiceType.tour:
        return s('destination').length >= 2 && s('approx').isNotEmpty && _int('count', 1, 20) != null && s('bestTime').isNotEmpty;
      case ServiceType.cip:
        return _pick['direction'] != null && _flightNo.hasMatch(s('flight').toUpperCase()) && s('date').isNotEmpty && _int('count', 1, 20) != null;
      case ServiceType.insurance:
        return _pick['region'] != null && s('start').isNotEmpty && s('end').isNotEmpty && s('end').compareTo(s('start')) >= 0;
      case ServiceType.hotel || ServiceType.stay:
        return s('location').length >= 2 && s('checkIn').isNotEmpty && s('checkOut').isNotEmpty && s('checkOut').compareTo(s('checkIn')) > 0 && _int('guests', 1, 20) != null && _int('rooms', 1, 10) != null;
      case ServiceType.train || ServiceType.bus:
        return s('from').length >= 2 && s('to').length >= 2 && s('date').isNotEmpty && _int('count', 1, 20) != null;
    }
  }

  Json _details() {
    String? opt(String n) => _v(n).isEmpty ? null : _v(n);
    final note = opt('note');
    final d = switch (t) {
      ServiceType.visa => <String, dynamic>{
        'destinationCountry': _v('country').toUpperCase(),
        'purpose': _pick['purpose'],
        'intendedTravelDate': _v('date'),
        'linkedFlightRequestRef': opt('linked')?.toUpperCase(),
      },
      ServiceType.tour => {'destination': _v('destination'), 'approxDates': _v('approx'), 'travellersCount': _int('count', 1, 20), 'bestTimeToCall': _v('bestTime')},
      ServiceType.cip => {'airport': 'IKA', 'direction': _pick['direction'], 'flightNumber': _v('flight').toUpperCase(), 'date': _v('date'), 'passengersCount': _int('count', 1, 20)},
      ServiceType.insurance => {'destinationRegion': _pick['region'], 'startDate': _v('start'), 'endDate': _v('end')},
      ServiceType.hotel || ServiceType.stay => {'location': _v('location'), 'checkIn': _v('checkIn'), 'checkOut': _v('checkOut'), 'guests': _int('guests', 1, 20), 'rooms': _int('rooms', 1, 10)},
      ServiceType.train || ServiceType.bus => {'from': _v('from'), 'to': _v('to'), 'date': _v('date'), 'passengers': _int('count', 1, 20)},
    };
    d.removeWhere((_, v) => v == null);
    if (note != null) d['note'] = note;
    if (t.needsTravellers) d['travellerIds'] = _travellers.toList();
    return d;
  }

  Future<void> _submit(String contactId) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await ref.read(apiClientProvider).post(
        '/v1/service-requests',
        headers: {'Idempotency-Key': _key},
        body: {'type': t.api, 'details': _details(), 'contactIdentityId': contactId, 'acknowledgements': {'notABooking': true, 'privacy': true}},
      ) as Json;
      ref.invalidate(trackProvider);
      if (mounted) context.pushReplacement('/services/${res.str('ref')}?sent=1');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _date(String name, {String? after}) async {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final min = DateTime.tryParse(after ?? '')?.add(Duration(days: name == 'checkOut' ? 1 : 0)) ?? today;
    final first = min.isBefore(today) ? today : min;
    final d = await showDatePicker(context: context, initialDate: first, firstDate: first, lastDate: today.add(const Duration(days: 730)));
    if (d != null) setState(() => _c(name).text = _iso(d));
  }

  Widget _gap() => const SizedBox(height: 12);

  Widget _field(String name, String label, {bool optional = false, TextInputType? type, int? max, List<TextInputFormatter>? formatters, bool upper = false, bool ltr = false}) {
    final l = context.l;
    return TextField(
      controller: _c(name),
      keyboardType: type,
      maxLength: max,
      inputFormatters: formatters,
      textCapitalization: upper ? TextCapitalization.characters : TextCapitalization.none,
      textDirection: ltr ? TextDirection.ltr : null,
      onChanged: (_) => setState(() {}),
      decoration: InputDecoration(labelText: optional ? '$label (${l.optional})' : label, counterText: ''),
    );
  }

  Widget _number(String name, String label) => _field(name, label, type: TextInputType.number, max: 2, formatters: [FilteringTextInputFormatter.digitsOnly], ltr: true);

  Widget _dateField(String name, String label, {String? after}) => TextField(
    controller: _c(name),
    readOnly: true,
    textDirection: TextDirection.ltr,
    decoration: InputDecoration(labelText: label, suffixIcon: const Icon(Icons.calendar_today_outlined)),
    onTap: () => _date(name, after: after),
  );

  Widget _dropdown(String name, String label, Map<String, String> options) => DropdownButtonFormField<String>(
    initialValue: _pick[name],
    isExpanded: true,
    decoration: InputDecoration(labelText: label),
    items: [for (final e in options.entries) DropdownMenuItem(value: e.key, child: Text(e.value))],
    onChanged: (v) => setState(() => _pick[name] = v ?? ''),
  );

  List<Widget> _typeFields() {
    final l = context.l;
    final gap = _gap();
    switch (t) {
      case ServiceType.visa:
        return [
          _field('country', l.svDestinationCountry, max: 2, upper: true, ltr: true, formatters: [FilteringTextInputFormatter.allow(RegExp('[A-Za-z]'))]),
          gap,
          _dropdown('purpose', l.svPurpose, {'TOURISM': l.svPurposeTourism, 'BUSINESS': l.svPurposeBusiness, 'STUDY': l.svPurposeStudy, 'FAMILY': l.svPurposeFamily, 'TRANSIT': l.svPurposeTransit}),
          gap,
          _dateField('date', l.svTravelDate),
          gap,
          _field('linked', l.svLinkedFlight, optional: true, upper: true, ltr: true, max: 20),
        ];
      case ServiceType.tour:
        return [
          _field('destination', l.svDestination, max: 120),
          gap,
          _field('approx', l.svApproxDates, max: 120),
          gap,
          _number('count', l.svTravellersCount),
          gap,
          _field('bestTime', l.svBestTimeToCall, max: 120),
        ];
      case ServiceType.cip:
        return [
          InputDecorator(decoration: InputDecoration(labelText: l.svAirportIka, border: InputBorder.none), child: const SizedBox.shrink()),
          _dropdown('direction', l.svDirection, {'ARRIVAL': l.svArrival, 'DEPARTURE': l.svDeparture}),
          gap,
          _field('flight', l.svFlightNumber, upper: true, ltr: true, max: 9),
          gap,
          _dateField('date', l.svDate),
          gap,
          _number('count', l.svPassengersCount),
        ];
      case ServiceType.insurance:
        return [
          _dropdown('region', l.svRegion, {'UK': l.svRegionUk, 'SCHENGEN': l.svRegionSchengen, 'EUROPE': l.svRegionEurope, 'WORLDWIDE_EXCL_AMERICAS': l.svRegionWorldExAmericas, 'WORLDWIDE': l.svRegionWorldwide}),
          gap,
          _dateField('start', l.svStartDate),
          gap,
          _dateField('end', l.svEndDate, after: _v('start')),
        ];
      case ServiceType.hotel || ServiceType.stay:
        return [
          _field('location', l.svLocation, max: 120),
          gap,
          _dateField('checkIn', l.svCheckIn),
          gap,
          _dateField('checkOut', l.svCheckOut, after: _v('checkIn')),
          gap,
          Row(children: [Expanded(child: _number('guests', l.svGuests)), const SizedBox(width: 12), Expanded(child: _number('rooms', l.svRooms))]),
        ];
      case ServiceType.train || ServiceType.bus:
        return [
          _field('from', l.svFrom, max: 120),
          gap,
          _field('to', l.svTo, max: 120),
          gap,
          _dateField('date', l.svDate),
          gap,
          _number('count', l.svPassengers),
        ];
    }
  }

  String _title() {
    final l = context.l;
    return switch (t) {
      ServiceType.visa => l.menuVisa,
      ServiceType.tour => l.menuTours,
      ServiceType.cip => l.menuCip,
      ServiceType.insurance => l.menuInsurance,
      _ => serviceTypeLabel(l, t),
    };
  }

  String _lead() {
    final l = context.l;
    return switch (t) {
      ServiceType.visa => l.svVisaLead,
      ServiceType.tour => l.svToursLead,
      ServiceType.cip => l.svCipLead,
      ServiceType.insurance => l.svInsuranceLead,
      _ => l.svListingLead,
    };
  }

  Widget _unavailable() {
    final l = context.l;
    return Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.support_agent, size: 40),
          const SizedBox(height: 12),
          Text(l.svUnavailableTitle, style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(l.svUnavailableBody, textAlign: TextAlign.center),
          const SizedBox(height: 16),
          OutlinedButton(onPressed: () => context.push('/support'), child: Text(l.menuSupport)),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final site = ref.watch(siteConfigProvider);
    final details = ref.watch(myDetailsProvider);
    final travellers = t.needsTravellers ? ref.watch(travellersProvider) : null;
    return Scaffold(
      appBar: AppBar(title: Text(_title())),
      body: PageBody(
        child: site.when(
          loading: () => const LoadingList(count: 3),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(siteConfigProvider)),
          data: (cfg) {
            if (!cfg.on(t.menuKey)) return Center(child: SingleChildScrollView(child: _unavailable()));
            final phones = details.value?.identities.where((i) => i.type == 'PHONE').toList() ?? const [];
            final contact = _phoneId ?? (phones.where((p) => p.verified).firstOrNull ?? phones.firstOrNull)?.id;
            final ready = _fieldsValid && contact != null && _ack.values.every((v) => v) && (!t.needsTravellers || _travellers.isNotEmpty);
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(_lead(), style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 16),
                ..._typeFields(),
                if (t.needsTravellers) ...[
                  SectionTitle(l.svWhoTravelling),
                  if (travellers!.isLoading) const LinearProgressIndicator(),
                  if (travellers.hasError) ErrorBox(travellers.error!, onRetry: () => ref.invalidate(travellersProvider)),
                  if (travellers.hasValue && travellers.value!.isEmpty)
                    Row(children: [Expanded(child: Text(l.svNoTravellers)), TextButton(onPressed: () => context.push('/account/details'), child: Text(l.svAddTravellers))]),
                  for (final x in travellers.value ?? const [])
                    CheckboxListTile(
                      key: Key('traveller-${x.id}'),
                      contentPadding: EdgeInsets.zero,
                      value: _travellers.contains(x.id),
                      title: Text(context.isFa && (x.nameFa ?? '').isNotEmpty ? x.nameFa! : '${x.givenNames} ${x.surname}'),
                      onChanged: (v) => setState(() => v == true ? _travellers.add(x.id) : _travellers.remove(x.id)),
                    ),
                ],
                _gap(),
                _field('note', l.svNote, optional: true, max: 1000, type: TextInputType.multiline),
                SectionTitle(l.svContactPhone),
                if (details.isLoading) const LinearProgressIndicator(),
                if (details.hasValue && phones.isEmpty) Text(l.svNoPhone),
                if (phones.isNotEmpty)
                  DropdownButtonFormField<String>(
                    key: const Key('contact-phone'),
                    initialValue: contact,
                    isExpanded: true,
                    decoration: InputDecoration(labelText: l.svContactPhone),
                    items: [for (final p in phones) DropdownMenuItem(value: p.id, child: LtrText(p.value))],
                    onChanged: (v) => setState(() => _phoneId = v),
                  ),
                const SizedBox(height: 8),
                CheckboxListTile(
                  key: const Key('ack-not-booking'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _ack['notABooking'],
                  title: Text(l.svAckNotBooking),
                  onChanged: (v) => setState(() => _ack['notABooking'] = v ?? false),
                ),
                CheckboxListTile(
                  key: const Key('ack-privacy'),
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _ack['privacy'],
                  title: Text(l.svAckPrivacy),
                  onChanged: (v) => setState(() => _ack['privacy'] = v ?? false),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Semantics(
                    liveRegion: true,
                    child: Text(
                      [
                        _error is ApiException && (_error as ApiException).code == 'FEATURE_DISABLED' ? l.svUnavailableTitle : errorMessage(l, _error!),
                        if (_error is ApiException) ...(_error as ApiException).fieldErrors.entries.map((e) => '${e.key}: ${e.value}'),
                      ].join('\n'),
                      style: TextStyle(color: Theme.of(context).colorScheme.error),
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                FilledButton(key: const Key('service-submit'), onPressed: ready && !_busy ? () => _submit(contact) : null, child: Text(l.svSubmit)),
                const SizedBox(height: 24),
              ],
            );
          },
        ),
      ),
    );
  }
}
