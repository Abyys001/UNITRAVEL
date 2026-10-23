import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart';
import 'package:uuid/uuid.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../l10n/app_localizations.dart';
import '../../models/json.dart';
import '../../models/requests.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

String _serviceLabel(AppL10n l, String s) => switch (s) {
  'DOCUMENTS' => l.svcDocuments,
  'PARCEL' => l.svcParcel,
  'EXCESS_BAGGAGE' => l.svcExcess,
  _ => l.svcFreight,
};

/// Cargo tab: lanes the platform serves (ch. 14); mobile v1 requests DOCUMENTS / PARCEL.
class CargoScreen extends ConsumerWidget {
  const CargoScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final async = ref.watch(cargoLanesProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.cargoTitle)),
      body: PageBody(
        child: async.when(
          loading: () => const LoadingList(),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(cargoLanesProvider)),
          data: (lanes) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(l.cargoIntro),
              const SizedBox(height: 12),
              for (final lane in lanes)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: AppCard(
                    semanticLabel: lane.label,
                    onTap: lane.enabled && lane.services.any(_mobileServices.contains)
                        ? () => context.push('/cargo/new?lane=${lane.id}')
                        : null,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(child: Text(lane.label, style: Theme.of(context).textTheme.titleMedium)),
                            if (!lane.enabled) ToneChip(l.laneDisabled, tone: XfamTone.danger) else const Icon(Icons.chevron_right),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          l.laneServices(lane.services.map((s) => _serviceLabel(l, s)).join(sep(context.lang))),
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        if (lane.notice != null) ...[
                          const SizedBox(height: 6),
                          Text(lane.notice!, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: xc(context).fgMuted)),
                        ],
                      ],
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

const _mobileServices = {'DOCUMENTS', 'PARCEL'};

class CargoRequestScreen extends ConsumerStatefulWidget {
  const CargoRequestScreen({super.key, required this.laneId});
  final String laneId;

  @override
  ConsumerState<CargoRequestScreen> createState() => _CargoRequestScreenState();
}

class _CargoRequestScreenState extends ConsumerState<CargoRequestScreen> {
  final _formKey = GlobalKey<FormState>();
  final _idempotencyKey = const Uuid().v4();
  final _c = <String, TextEditingController>{
    for (final k in [
      'shipName', 'shipPhone', 'shipLine', 'shipCity', 'shipPost',
      'conName', 'conPhone', 'conLine', 'conCity', 'conPost',
      'weight', 'length', 'width', 'height', 'contents', 'value',
    ])
      k: TextEditingController(),
  };
  String? _service;
  String _handover = 'PICKUP';
  bool _accuracy = false;
  bool _prohibited = false;
  bool _privacy = false;
  bool _busy = false;
  Object? _error;
  String? _localError;
  late DateTime _ready = DateTime.now().add(const Duration(days: 7));

  static final _latin = RegExp(r"^[A-Za-z0-9][A-Za-z0-9 .,'&\-]*$");

  @override
  void dispose() {
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  Map<String, dynamic> _party(String p, String country) => {
    'name': _c['${p}Name']!.text.trim(),
    'phone': _c['${p}Phone']!.text.trim(),
    'address': {
      'line1': _c['${p}Line']!.text.trim(),
      'city': _c['${p}City']!.text.trim(),
      if (_c['${p}Post']!.text.trim().isNotEmpty) 'postcode': _c['${p}Post']!.text.trim(),
      'country': country,
    },
  };

  Future<void> _submit(CargoLane lane) async {
    final l = context.l;
    if (!_formKey.currentState!.validate()) return;
    if (!_accuracy || !_prohibited || !_privacy) {
      setState(() => _localError = l.needAcks);
      return;
    }
    final me = ref.read(sessionProvider).me;
    final service = _service ?? lane.services.firstWhere(_mobileServices.contains);
    double num(String k) => double.parse(_c[k]!.text.trim().replaceAll(',', '.'));
    setState(() {
      _busy = true;
      _error = null;
      _localError = null;
    });
    try {
      final iso = '${_ready.year.toString().padLeft(4, '0')}-${_ready.month.toString().padLeft(2, '0')}-${_ready.day.toString().padLeft(2, '0')}';
      final docs = service == 'DOCUMENTS';
      final res = await ref.read(apiClientProvider).post(
        '/v1/cargo-requests',
        headers: {'Idempotency-Key': _idempotencyKey},
        body: {
          'service': service,
          'laneId': lane.id,
          'shipper': _party('ship', lane.originCountry),
          'consignee': _party('con', lane.destinationCountry),
          'shipperIdentityId': me!.contactIdentityId,
          'readyDate': iso,
          'handoverMode': _handover,
          'pieces': [
            {'lengthCm': num('length'), 'widthCm': num('width'), 'heightCm': num('height'), 'weightKg': num('weight')},
          ],
          'items': [
            {
              'description': _c['contents']!.text.trim(),
              'category': docs ? 'DOCUMENTS' : 'PERSONAL_EFFECTS',
              'quantity': 1,
              'unitValue': {'amountMinor': (num('value') * 100).round(), 'currency': 'GBP'},
              'originCountry': lane.originCountry,
              'purpose': docs ? 'DOCUMENTS' : 'GIFT',
            },
          ],
          'declarations': {'batteries': false, 'liquids': false, 'medicines': false, 'magnets': false, 'dangerousGoods': false, 'insuranceRequested': false},
          'declaredTotal': {'amountMinor': (num('value') * 100).round(), 'currency': 'GBP'},
          'consents': {'accuracy': true, 'prohibitedItems': true, 'privacy': true},
        },
      ) as Json;
      ref.invalidate(requestsProvider);
      if (mounted) context.go('/search/done/${res.str('ref')}');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lanes = ref.watch(cargoLanesProvider);
    String? latin(String? v) {
      final t = v?.trim() ?? '';
      if (t.isEmpty) return l.fieldRequired;
      return _latin.hasMatch(t) ? null : l.fieldLatin;
    }

    String? requiredField(String? v) => (v == null || v.trim().isEmpty) ? l.fieldRequired : null;
    String? number(String? v) {
      final n = double.tryParse((v ?? '').trim().replaceAll(',', '.'));
      return (n == null || n <= 0) ? l.fieldRequired : null;
    }

    Widget field(String key, String label, {String? Function(String?)? validator, TextInputType? type, bool ltr = false}) => Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: TextFormField(
        controller: _c[key],
        keyboardType: type,
        textDirection: ltr ? TextDirection.ltr : null,
        decoration: InputDecoration(labelText: label),
        validator: validator ?? requiredField,
      ),
    );

    return Scaffold(
      appBar: AppBar(title: Text(l.cargoRequestTitle)),
      body: PageBody(
        child: lanes.when(
          loading: () => const LoadingList(count: 3),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(cargoLanesProvider)),
          data: (all) {
            final lane = all.where((x) => x.id == widget.laneId).firstOrNull;
            if (lane == null) return const SizedBox.shrink();
            final services = lane.services.where(_mobileServices.contains).toList();
            return Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  Text(lane.label, style: Theme.of(context).textTheme.titleLarge),
                  if (lane.notice != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(lane.notice!, style: Theme.of(context).textTheme.bodySmall)),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    initialValue: _service ?? services.first,
                    decoration: InputDecoration(labelText: l.service),
                    items: [for (final s in services) DropdownMenuItem(value: s, child: Text(_serviceLabel(l, s)))],
                    onChanged: (v) => setState(() => _service = v),
                  ),
                  SectionTitle(l.shipper),
                  field('shipName', l.fullNameLatin, validator: latin, ltr: true),
                  field('shipPhone', l.phone, type: TextInputType.phone, ltr: true),
                  field('shipLine', l.addressLine),
                  field('shipCity', l.cityLabel),
                  field('shipPost', l.postcode, validator: (_) => null, ltr: true),
                  SectionTitle(l.consignee),
                  field('conName', l.fullNameLatin, validator: latin, ltr: true),
                  field('conPhone', l.phone, type: TextInputType.phone, ltr: true),
                  field('conLine', l.addressLine),
                  field('conCity', l.cityLabel),
                  field('conPost', l.postcode, validator: (_) => null, ltr: true),
                  SectionTitle(l.contents),
                  field('contents', l.contents),
                  field('value', l.declaredValue, validator: number, type: const TextInputType.numberWithOptions(decimal: true)),
                  Row(
                    children: [
                      Expanded(child: field('weight', l.weightKg, validator: number, type: const TextInputType.numberWithOptions(decimal: true))),
                      const SizedBox(width: 8),
                      Expanded(child: field('length', l.lengthCm, validator: number, type: const TextInputType.numberWithOptions(decimal: true))),
                    ],
                  ),
                  Row(
                    children: [
                      Expanded(child: field('width', l.widthCm, validator: number, type: const TextInputType.numberWithOptions(decimal: true))),
                      const SizedBox(width: 8),
                      Expanded(child: field('height', l.heightCm, validator: number, type: const TextInputType.numberWithOptions(decimal: true))),
                    ],
                  ),
                  Semantics(
                    button: true,
                    label: '${l.readyDate}: ${formatDate(_ready, lang: context.lang, jalali: ref.watch(calendarJalaliProvider))}',
                    excludeSemantics: true,
                    child: InkWell(
                      onTap: () async {
                        final now = DateTime.now();
                        final d = await showDatePicker(context: context, initialDate: _ready, firstDate: now, lastDate: now.add(const Duration(days: 180)));
                        if (d != null) setState(() => _ready = d);
                      },
                      child: InputDecorator(
                        decoration: InputDecoration(labelText: l.readyDate, suffixIcon: const Icon(Icons.calendar_today_outlined, size: 20)),
                        child: Text(formatDate(_ready, lang: context.lang, jalali: ref.watch(calendarJalaliProvider))),
                      ),
                    ),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    initialValue: _handover,
                    decoration: InputDecoration(labelText: l.handover),
                    items: [
                      DropdownMenuItem(value: 'PICKUP', child: Text(l.handoverPickup)),
                      DropdownMenuItem(value: 'DROP_OFF', child: Text(l.handoverDropoff)),
                    ],
                    onChanged: (v) => setState(() => _handover = v ?? 'PICKUP'),
                  ),
                  const SizedBox(height: 8),
                  CheckboxListTile(contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, value: _accuracy, onChanged: (v) => setState(() => _accuracy = v ?? false), title: Text(l.consentAccuracy)),
                  CheckboxListTile(contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, value: _prohibited, onChanged: (v) => setState(() => _prohibited = v ?? false), title: Text(l.consentProhibited)),
                  CheckboxListTile(contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading, value: _privacy, onChanged: (v) => setState(() => _privacy = v ?? false), title: Text(l.consentPrivacy)),
                  if (_localError != null || _error != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Semantics(liveRegion: true, child: Text(_localError ?? errorMessage(l, _error!), style: const TextStyle(color: Brand.brick))),
                    ),
                  const SizedBox(height: 16),
                  FilledButton(onPressed: _busy ? null : () => _submit(lane), child: Text(_busy ? l.submitting : l.submitCargo)),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}
