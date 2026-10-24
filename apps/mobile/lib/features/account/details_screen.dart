import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:kit_ui/kit_ui.dart' show XfamTone;

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/pow.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../l10n/app_localizations.dart';
import '../../models/identity.dart';
import '../../models/json.dart';
import '../../models/my_details.dart';
import '../../models/requests.dart';
import '../../ui/patterns.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'traveller_form.dart';

String verificationHelp(AppL10n l, VerificationStatus s) => switch (s) {
  VerificationStatus.verified => l.verifHelpVerified,
  VerificationStatus.submitted => l.verifHelpSubmitted,
  VerificationStatus.correctionRequired => l.verifHelpCorrection,
  VerificationStatus.rejected => l.verifHelpRejected,
  VerificationStatus.unverified => l.verifHelpUnverified,
};

String reasonLabel(AppL10n l, String code) => switch (code) {
  'UNREADABLE_SCAN' => l.reasonUnreadableScan,
  'NAME_MISMATCH' => l.reasonNameMismatch,
  'NUMBER_MISMATCH' => l.reasonNumberMismatch,
  'DOB_MISMATCH' => l.reasonDobMismatch,
  'NATIONALITY_MISMATCH' => l.reasonNationalityMismatch,
  'EXPIRY_MISMATCH' => l.reasonExpiryMismatch,
  'EXPIRED_DOCUMENT' => l.reasonExpiredDocument,
  'NOT_A_PASSPORT' => l.reasonNotAPassport,
  'SCAN_INCOMPLETE' => l.reasonScanIncomplete,
  _ => l.reasonOther,
};

/// My details: contact methods, profile, optional address, passport with scan upload and review-then-confirm (ADR-0005).
class DetailsScreen extends ConsumerWidget {
  const DetailsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final async = ref.watch(myDetailsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.detailsTitle)),
      body: PageBody(
        child: async.when(
          loading: () => const Padding(padding: EdgeInsets.all(16), child: LinearProgressIndicator()),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(myDetailsProvider)),
          data: (d) => ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Text(l.detailsIntro, style: Theme.of(context).textTheme.bodyMedium),
              SectionTitle(l.contactTitle),
              Text(l.contactHelp, style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 8),
              for (final i in d.identities)
                ListTile(
                  contentPadding: EdgeInsets.zero,
                  leading: Icon(i.type == 'EMAIL' ? Icons.mail_outline : Icons.phone_outlined),
                  title: LtrText(i.value),
                  trailing: ToneChip(i.verified ? l.verifiedLabel : l.notVerifiedLabel, tone: i.verified ? XfamTone.success : XfamTone.neutral),
                ),
              const AddIdentityForm(),
              SectionTitle(l.detProfile),
              _ProfileForm(details: d),
              SectionTitle(l.addressTitle),
              Text(l.addressHelp, style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 8),
              _AddressForm(address: d.address),
              SectionTitle(l.passportTitle),
              Text(l.passportHelp, style: Theme.of(context).textTheme.bodySmall),
              const SizedBox(height: 8),
              if (d.self?.document == null) Text(l.passportAddDetails) else PassportVerificationCard(traveller: d.self!),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: () async {
                  await showTravellerSheet(context);
                  ref.invalidate(myDetailsProvider);
                  ref.invalidate(travellersProvider);
                },
                icon: const Icon(Icons.edit_outlined),
                label: Text(d.self?.document == null ? l.addTraveller : l.passportEdit),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ProfileForm extends ConsumerStatefulWidget {
  const _ProfileForm({required this.details});
  final MyDetails details;

  @override
  ConsumerState<_ProfileForm> createState() => _ProfileFormState();
}

class _ProfileFormState extends ConsumerState<_ProfileForm> {
  late final _fa = TextEditingController(text: widget.details.nameFa ?? '');
  late final _time = TextEditingController(text: widget.details.contactTimePref ?? '');
  bool _busy = false;

  @override
  void dispose() {
    _fa.dispose();
    _time.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      await ref.read(apiClientProvider).patch('/v1/me/details', body: {
        'nameFa': _fa.text.trim().isEmpty ? null : _fa.text.trim(),
        'contactTimePref': _time.text.trim().isEmpty ? null : _time.text.trim(),
      });
      ref.invalidate(myDetailsProvider);
      if (mounted) showMessage(context, context.l.savedLabel);
    } on ApiException catch (e) {
      if (mounted) showMessage(context, errorMessage(context.l, e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final d = widget.details;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        LtrText('${d.givenNamesLatin ?? ''} ${d.surnameLatin ?? ''}'.trim(), style: Theme.of(context).textTheme.titleSmall),
        const SizedBox(height: 8),
        TextField(controller: _fa, textDirection: TextDirection.rtl, decoration: InputDecoration(labelText: l.nameFaLabel)),
        const SizedBox(height: 8),
        TextField(controller: _time, decoration: InputDecoration(labelText: l.contactTimeLabel)),
        const SizedBox(height: 8),
        FilledButton(onPressed: _busy ? null : _save, child: Text(l.save)),
      ],
    );
  }
}

class _AddressForm extends ConsumerStatefulWidget {
  const _AddressForm({required this.address});
  final Address? address;

  @override
  ConsumerState<_AddressForm> createState() => _AddressFormState();
}

class _AddressFormState extends ConsumerState<_AddressForm> {
  late final _l1 = TextEditingController(text: widget.address?.line1 ?? '');
  late final _l2 = TextEditingController(text: widget.address?.line2 ?? '');
  late final _city = TextEditingController(text: widget.address?.city ?? '');
  late final _post = TextEditingController(text: widget.address?.postcode ?? '');
  late final _country = TextEditingController(text: widget.address?.country ?? 'GB');
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    for (final c in [_l1, _l2, _city, _post, _country]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save(Object? address) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiClientProvider).patch('/v1/me/details', body: {'address': address});
      ref.invalidate(myDetailsProvider);
      if (mounted) showMessage(context, context.l.savedLabel);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        TextField(controller: _l1, autofillHints: const [AutofillHints.streetAddressLine1], decoration: InputDecoration(labelText: l.addressLine1)),
        const SizedBox(height: 8),
        TextField(controller: _l2, decoration: InputDecoration(labelText: l.addressLine2)),
        const SizedBox(height: 8),
        TextField(controller: _city, decoration: InputDecoration(labelText: l.addressCity)),
        const SizedBox(height: 8),
        TextField(controller: _post, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: l.addressPostcode)),
        const SizedBox(height: 8),
        TextField(controller: _country, textCapitalization: TextCapitalization.characters, maxLength: 2, textDirection: TextDirection.ltr, decoration: InputDecoration(labelText: l.addressCountry)),
        if (_error != null) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(errorMessage(l, _error!), style: const TextStyle(color: Brand.danger))),
        Row(
          children: [
            FilledButton(
              onPressed: _busy
                  ? null
                  : () => _save(Address(line1: _l1.text.trim(), line2: _l2.text.trim(), city: _city.text.trim(), postcode: _post.text.trim(), country: _country.text.trim().toUpperCase()).toJson()),
              child: Text(l.save),
            ),
            if (widget.address != null) ...[
              const SizedBox(width: 8),
              OutlinedButton(onPressed: _busy ? null : () => _save(null), child: Text(l.removeAddress)),
            ],
          ],
        ),
      ],
    );
  }
}

/// Add a phone or email and verify it with the one-time code (`POST /v1/me/identities`, then `/v1/auth/otp/verify`).
/// Used on the details screen and inline on the request form when the account has no verified phone.
class AddIdentityForm extends ConsumerStatefulWidget {
  const AddIdentityForm({super.key, this.phoneOnly = false, this.onDone});
  final bool phoneOnly;
  final VoidCallback? onDone;

  @override
  ConsumerState<AddIdentityForm> createState() => _AddIdentityFormState();
}

class _AddIdentityFormState extends ConsumerState<AddIdentityForm> {
  final _value = TextEditingController();
  final _code = TextEditingController();
  String _type = 'PHONE';
  String? _challengeId;
  String _normalised = '';
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    _value.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final api = ref.read(apiClientProvider);
    final body = <String, dynamic>{'type': _type, 'value': _value.text.trim(), 'deviceId': ref.read(deviceIdProvider)};
    try {
      Json res;
      try {
        res = (await api.post('/v1/me/identities', body: body)) as Json;
      } on ApiException catch (e) {
        final pow = e.body?['challenge'];
        if (e.code != 'CHALLENGE_REQUIRED' || pow is! Map<String, dynamic>) rethrow;
        final solution = await solvePow(pow);
        if (solution == null) rethrow;
        res = (await api.post('/v1/me/identities', body: {...body, 'challenge': solution})) as Json;
      }
      setState(() {
        _challengeId = res.str('challengeId');
        _normalised = res.str('normalised', _value.text.trim());
      });
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(apiClientProvider).post('/v1/auth/otp/verify', body: {
        'challengeId': _challengeId,
        'code': _code.text.trim(),
        'deviceId': ref.read(deviceIdProvider),
        'client': 'MOBILE',
      });
      await ref.read(sessionProvider.notifier).loadMe();
      ref.invalidate(myDetailsProvider);
      if (!mounted) return;
      setState(() {
        _challengeId = null;
        _value.clear();
        _code.clear();
      });
      widget.onDone?.call();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (_challengeId == null) ...[
          if (!widget.phoneOnly)
            SegmentedButton<String>(
              showSelectedIcon: false,
              segments: [
                ButtonSegment(value: 'PHONE', label: Text(l.detPhone)),
                ButtonSegment(value: 'EMAIL', label: Text(l.emailLabel)),
              ],
              selected: {_type},
              onSelectionChanged: (s) => setState(() => _type = s.first),
            ),
          const SizedBox(height: 8),
          TextField(
            controller: _value,
            textDirection: TextDirection.ltr,
            keyboardType: _type == 'EMAIL' ? TextInputType.emailAddress : TextInputType.phone,
            decoration: InputDecoration(labelText: widget.phoneOnly ? l.detPhone : l.addContact),
          ),
          const SizedBox(height: 8),
          FilledButton(onPressed: _busy || _value.text.trim().length < 3 ? null : _send, child: Text(l.sendCode)),
        ] else ...[
          Text(l.detCodeSent(_normalised)),
          const SizedBox(height: 8),
          TextField(controller: _code, textDirection: TextDirection.ltr, keyboardType: TextInputType.number, autofillHints: const [AutofillHints.oneTimeCode], decoration: InputDecoration(labelText: l.codeLabel)),
          const SizedBox(height: 8),
          FilledButton(onPressed: _busy ? null : _verify, child: Text(l.verifyCode)),
        ],
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(errorMessage(l, _error!), style: const TextStyle(color: Brand.danger))),
      ],
    );
  }
}

/// Scan upload and review-then-confirm for one traveller. The server decides every state; this only asks.
class PassportVerificationCard extends ConsumerStatefulWidget {
  const PassportVerificationCard({super.key, required this.traveller});
  final Traveller traveller;

  @override
  ConsumerState<PassportVerificationCard> createState() => _PassportVerificationCardState();
}

class _PassportVerificationCardState extends ConsumerState<PassportVerificationCard> {
  bool _busy = false;
  String? _note;
  bool _noteIsError = false;

  void _refresh() {
    ref.invalidate(myDetailsProvider);
    ref.invalidate(travellersProvider);
  }

  static String _mimeOf(XFile f) {
    final name = f.name.toLowerCase();
    return name.endsWith('.png') ? 'image/png' : 'image/jpeg';
  }

  Future<void> _upload() async {
    final l = context.l;
    final picked = await ImagePicker().pickImage(source: ImageSource.gallery);
    if (picked == null) return;
    setState(() {
      _busy = true;
      _note = l.scanChecking;
      _noteIsError = false;
    });
    try {
      final bytes = await picked.readAsBytes();
      final mime = _mimeOf(picked);
      final api = ref.read(apiClientProvider);
      final s = (await api.post('/v1/uploads', body: {'filename': picked.name, 'mime': mime, 'size': bytes.length, 'type': 'PASSPORT_SCAN'})) as Json;
      final headers = <String, dynamic>{for (final e in (s['headers'] as Map? ?? {}).entries) '${e.key}': e.value};
      // Straight to object storage with the pre-signed URL; no bearer token goes there.
      await Dio().put<void>(s.str('uploadUrl'), data: bytes, options: Options(headers: headers, contentType: mime, responseType: ResponseType.plain));
      final id = s.str('documentId');
      await api.post('/v1/uploads/$id/complete');
      var status = 'PENDING';
      for (var i = 0; i < 60 && status == 'PENDING'; i++) {
        await Future<void>.delayed(const Duration(milliseconds: 500));
        status = ((await api.get('/v1/uploads/$id')) as Json).str('scanStatus', 'PENDING');
      }
      if (status != 'CLEAN') {
        if (mounted) {
          setState(() {
            _note = l.scanFailed;
            _noteIsError = true;
          });
        }
        return;
      }
      await api.post('/v1/me/travellers/${widget.traveller.id}/identity/scan', body: {'documentId': id});
      if (mounted) setState(() => _note = l.scanReady);
      _refresh();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _note = errorMessage(l, e);
          _noteIsError = true;
        });
      }
    } on DioException {
      if (mounted) {
        setState(() {
          _note = l.errNetwork;
          _noteIsError = true;
        });
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _confirm() async {
    final l = context.l;
    setState(() {
      _busy = true;
      _note = null;
    });
    try {
      await ref.read(apiClientProvider).post('/v1/me/travellers/${widget.traveller.id}/identity/confirm', body: {'reviewHash': widget.traveller.verification.reviewHash});
      if (mounted) {
        setState(() {
          _note = l.confirmSent;
          _noteIsError = false;
        });
      }
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _note = e.code == 'VERSION_CONFLICT' ? l.confirmChanged : errorMessage(l, e);
          _noteIsError = true;
        });
      }
    } finally {
      _refresh();
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final t = widget.traveller;
    final v = t.verification;
    final doc = t.document!;
    final (tone, label) = verificationLook(l, v.status);
    final canConfirm = const {VerificationStatus.unverified, VerificationStatus.rejected, VerificationStatus.correctionRequired}.contains(v.status);
    final theme = Theme.of(context);
    Widget row(String k, String value) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Row(children: [Expanded(child: Text(k, style: theme.textTheme.bodySmall)), LtrText(value, style: theme.textTheme.bodyMedium)]),
    );
    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [ToneChip(label, tone: tone)]),
          const SizedBox(height: 6),
          Text(verificationHelp(l, v.status), style: theme.textTheme.bodySmall),
          if (v.reason != null) ...[
            const SizedBox(height: 8),
            Text(l.reasonTitle, style: theme.textTheme.labelLarge),
            Text(reasonLabel(l, v.reason!.code)),
            if (v.reason!.text.isNotEmpty) Text(v.reason!.text, style: theme.textTheme.bodySmall),
          ],
          const SizedBox(height: 12),
          Text(l.scanTitle, style: theme.textTheme.labelLarge),
          Text(l.scanHelp, style: theme.textTheme.bodySmall),
          const SizedBox(height: 4),
          Text(v.hasScan ? l.scanReceived(v.scanFilename ?? '') : l.scanNone),
          if (v.status == VerificationStatus.verified) Text(l.scanReplaceWarn, style: theme.textTheme.bodySmall),
          const SizedBox(height: 8),
          OutlinedButton.icon(onPressed: _busy ? null : _upload, icon: const Icon(Icons.upload_file), label: Text(v.hasScan ? l.scanReplace : l.scanUpload)),
          if (canConfirm) ...[
            const Divider(height: 24),
            Text(l.reviewTitle, style: theme.textTheme.labelLarge),
            Text(l.reviewHelp, style: theme.textTheme.bodySmall),
            const SizedBox(height: 6),
            row(l.fieldName, t.fullName),
            row(l.fieldDob, t.dateOfBirth),
            row(l.fieldNationality, t.nationality),
            row(l.fieldNumber, '••••${doc.last4}'),
            row(l.fieldIssuing, doc.issuingCountry),
            row(l.fieldExpiry, doc.expiryDate),
            if (!v.hasScan) Text(l.confirmNeedScan, style: const TextStyle(color: Brand.danger)),
            const SizedBox(height: 8),
            FilledButton(onPressed: _busy || !v.hasScan ? null : _confirm, child: Text(l.confirmSend)),
          ],
          if (_note != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_note!, style: TextStyle(color: _noteIsError ? Brand.danger : null))),
        ],
      ),
    );
  }
}
