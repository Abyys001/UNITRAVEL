import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../models/json.dart';
import '../../models/requests.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Bottom sheet that creates a saved traveller; returns it.
Future<Traveller?> showTravellerSheet(BuildContext context) => showModalBottomSheet<Traveller>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (_) => const _TravellerForm(),
);

class _TravellerForm extends ConsumerStatefulWidget {
  const _TravellerForm();

  @override
  ConsumerState<_TravellerForm> createState() => _TravellerFormState();
}

class _TravellerFormState extends ConsumerState<_TravellerForm> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _given;
  late final TextEditingController _surname;
  final _dob = TextEditingController();
  final _nationality = TextEditingController(text: 'IR');
  String _title = 'MR';
  String _gender = 'M';
  bool _busy = false;
  Object? _error;

  static final _latin = RegExp(r"^[A-Za-z][A-Za-z '\-]*$");

  @override
  void initState() {
    super.initState();
    final me = ref.read(sessionProvider).me;
    _given = TextEditingController(text: me?.givenNamesLatin ?? '');
    _surname = TextEditingController(text: me?.surnameLatin ?? '');
  }

  @override
  void dispose() {
    _given.dispose();
    _surname.dispose();
    _dob.dispose();
    _nationality.dispose();
    super.dispose();
  }

  Future<void> _pickDob() async {
    final now = DateTime.now();
    final d = await showDatePicker(
      context: context,
      initialDate: DateTime(now.year - 30, 1, 1),
      firstDate: DateTime(now.year - 110),
      lastDate: now,
    );
    if (d != null) {
      _dob.text = '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await ref.read(apiClientProvider).post('/v1/me/travellers', body: {
        'title': _title,
        'givenNames': _given.text.trim(),
        'surname': _surname.text.trim(),
        'dateOfBirth': toLatinDigits(_dob.text.trim()),
        'genderOnDocument': _gender,
        'nationality': _nationality.text.trim().toUpperCase(),
        'relationship': (ref.read(travellersProvider).value ?? const []).isEmpty ? 'SELF' : 'FAMILY',
      }) as Json;
      ref.invalidate(travellersProvider);
      if (mounted) Navigator.of(context).pop(Traveller.fromJson(res));
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    String? latin(String? v) {
      final t = v?.trim() ?? '';
      if (t.isEmpty) return l.fieldRequired;
      return _latin.hasMatch(t) ? null : l.fieldLatin;
    }

    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: PageBody(
        child: Form(
          key: _formKey,
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.all(20),
            children: [
              Text(l.travellerFormTitle, style: Theme.of(context).textTheme.titleLarge),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _title,
                decoration: InputDecoration(labelText: l.title),
                items: const [
                  DropdownMenuItem(value: 'MR', child: Text('Mr')),
                  DropdownMenuItem(value: 'MS', child: Text('Ms')),
                  DropdownMenuItem(value: 'MRS', child: Text('Mrs')),
                  DropdownMenuItem(value: 'MISS', child: Text('Miss')),
                  DropdownMenuItem(value: 'MSTR', child: Text('Mstr')),
                  DropdownMenuItem(value: 'DR', child: Text('Dr')),
                ],
                onChanged: (v) => setState(() => _title = v ?? 'MR'),
              ),
              const SizedBox(height: 12),
              TextFormField(controller: _given, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: l.givenNames), validator: latin),
              const SizedBox(height: 12),
              TextFormField(controller: _surname, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: l.surname), validator: latin),
              const SizedBox(height: 12),
              TextFormField(
                controller: _dob,
                textDirection: TextDirection.ltr,
                keyboardType: TextInputType.datetime,
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9۰-۹٠-٩\-]'))],
                decoration: InputDecoration(
                  labelText: l.dateOfBirth,
                  hintText: 'YYYY-MM-DD',
                  suffixIcon: IconButton(tooltip: l.chooseDate, onPressed: _pickDob, icon: const Icon(Icons.calendar_today_outlined)),
                ),
                validator: (v) => RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(toLatinDigits(v?.trim() ?? '')) ? null : l.fieldRequired,
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _gender,
                decoration: InputDecoration(labelText: l.gender),
                items: [
                  DropdownMenuItem(value: 'M', child: Text(l.genderM)),
                  DropdownMenuItem(value: 'F', child: Text(l.genderF)),
                  DropdownMenuItem(value: 'X', child: Text(l.genderX)),
                ],
                onChanged: (v) => setState(() => _gender = v ?? 'M'),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _nationality,
                textDirection: TextDirection.ltr,
                textCapitalization: TextCapitalization.characters,
                maxLength: 2,
                decoration: InputDecoration(labelText: l.nationality, helperText: l.nationalityHint, counterText: ''),
                validator: (v) => RegExp(r'^[A-Za-z]{2}$').hasMatch(v?.trim() ?? '') ? null : l.fieldRequired,
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(errorMessage(l, _error!), style: const TextStyle(color: Brand.brick)),
              ],
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(child: OutlinedButton(onPressed: _busy ? null : () => Navigator.of(context).pop(), child: Text(l.cancel))),
                  const SizedBox(width: 12),
                  Expanded(child: FilledButton(onPressed: _busy ? null : _save, child: Text(l.save))),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
