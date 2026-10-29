import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_error.dart';
import '../../core/format.dart';
import '../../core/pow.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../l10n/app_localizations.dart';
import '../../models/json.dart';
import '../../models/services.dart';
import '../../ui/patterns.dart';
import '../../ui/widgets.dart';
import '../services/service_labels.dart';

/// Purchase tracking (spec §4.5). Signed in: one list of the customer's own flights, cargo, services and invoices. Signed
/// out, or with a reference from someone else's message: reference + phone, a code to that phone, then the status timeline
/// only. The lookup never says whether the reference matched.
class TrackScreen extends ConsumerWidget {
  const TrackScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final signedIn = ref.watch(sessionProvider).status == AuthStatus.signedIn;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.tkTitle),
        leading: signedIn || context.canPop() ? null : IconButton(tooltip: l.back, icon: const BackButtonIcon(), onPressed: () => context.go('/signin')),
      ),
      body: PageBody(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (signedIn) ...[const _Mine(), const SizedBox(height: 24)],
            const TrackLookup(),
            const SizedBox(height: 24),
          ],
        ),
      ),
    );
  }
}

class _Mine extends ConsumerStatefulWidget {
  const _Mine();

  @override
  ConsumerState<_Mine> createState() => _MineState();
}

class _MineState extends ConsumerState<_Mine> {
  String _kind = 'ALL';

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final async = ref.watch(trackProvider);
    final kinds = {'ALL': l.tkAll, 'FLIGHT': l.tkFlights, 'CARGO': l.tkCargo, 'SERVICE': l.tkServices, 'INVOICE': l.tkInvoices};
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(l.tkMine, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 12),
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: [
            for (final e in kinds.entries)
              ChoiceChip(key: Key('track-kind-${e.key}'), label: Text(e.value), selected: _kind == e.key, onSelected: (_) => setState(() => _kind = e.key)),
          ],
        ),
        const SizedBox(height: 12),
        async.when(
          loading: () => const SizedBox(height: 120, child: LoadingList(count: 2)),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(trackProvider)),
          data: (cached) {
            final items = cached.data.where((i) => _kind == 'ALL' || i.kind == _kind).toList();
            return Column(
              children: [
                if (cached.staleSince != null) StaleBanner(savedAt: cached.staleSince!),
                if (items.isEmpty)
                  Padding(padding: const EdgeInsets.symmetric(vertical: 24), child: Text(l.tkEmpty, textAlign: TextAlign.center))
                else
                  for (final i in items)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _TrackTile(item: i, lang: lang, jalali: jalali),
                    ),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _TrackTile extends StatelessWidget {
  const _TrackTile({required this.item, required this.lang, required this.jalali});
  final TrackItem item;
  final String lang;
  final bool jalali;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final kind = switch (item.kind) { 'FLIGHT' => l.tkFlights, 'CARGO' => l.tkCargo, 'SERVICE' => l.tkServices, _ => l.tkInvoices };
    final title = item.kind == 'SERVICE' && item.serviceType != null ? serviceTypeLabel(l, item.serviceType!) : item.title;
    final date = item.updatedAt == null ? '' : formatDate(item.updatedAt!, lang: lang, jalali: jalali);
    return AppCard(
      semanticLabel: '$title, $kind, ${item.ref}, ${item.statusLabel}',
      onTap: () => context.push(item.route),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 2),
                Wrap(spacing: 6, children: [Text(kind, style: Theme.of(context).textTheme.bodySmall), LtrText(item.ref, mono: true, style: Theme.of(context).textTheme.bodySmall), if (date.isNotEmpty) Text(date, style: Theme.of(context).textTheme.bodySmall)]),
              ],
            ),
          ),
          const SizedBox(width: 8),
          ToneChip(item.statusLabel, tone: item.kind == 'SERVICE' ? serviceStatusTone(item.status) : toneForStatus(item.status)),
        ],
      ),
    );
  }
}

enum _Stage { form, code, done }

/// Reference + phone -> 6-digit code -> status timeline. Public endpoints: rate limited and proof-of-work protected.
class TrackLookup extends ConsumerStatefulWidget {
  const TrackLookup({super.key});

  @override
  ConsumerState<TrackLookup> createState() => _TrackLookupState();
}

class _TrackLookupState extends ConsumerState<TrackLookup> {
  final _ref = TextEditingController();
  final _phone = TextEditingController();
  final _code = TextEditingController();
  _Stage _stage = _Stage.form;
  String? _busy;
  String? _error;
  PublicTrack? _view;

  @override
  void dispose() {
    _ref.dispose();
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  String _message(AppL10n l, Object e) {
    if (e is! ApiException) return l.errGeneric;
    return switch (e.code) {
      'RATE_LIMITED' => l.tkRateLimited,
      'OTP_INVALID' => l.tkOtpInvalid,
      'OTP_EXPIRED' => l.tkOtpExpired,
      'OTP_LOCKED' => l.tkOtpLocked,
      ApiException.networkCode => l.errNetwork,
      _ => l.errGeneric,
    };
  }

  Future<void> _lookup() async {
    final l = context.l;
    final api = ref.read(apiClientProvider);
    final body = <String, dynamic>{'ref': _ref.text.trim().toUpperCase(), 'phone': _phone.text.trim(), 'deviceId': ref.read(deviceIdProvider)};
    setState(() {
      _error = null;
      _busy = 'send';
    });
    try {
      try {
        await api.post('/v1/track/lookup', body: body, auth: false);
      } on ApiException catch (e) {
        final pow = e.body?['challenge'];
        if (e.code != 'CHALLENGE_REQUIRED' || pow is! Map<String, dynamic>) rethrow;
        if (mounted) setState(() => _busy = 'pow');
        final solution = await solvePow(pow);
        if (solution == null) rethrow;
        await api.post('/v1/track/lookup', body: {...body, 'challenge': solution}, auth: false);
      }
      if (mounted) setState(() => _stage = _Stage.code);
    } catch (e) {
      if (mounted) setState(() => _error = _message(l, e));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _verify() async {
    final l = context.l;
    setState(() {
      _error = null;
      _busy = 'verify';
    });
    try {
      final res = await ref.read(apiClientProvider).post(
        '/v1/track/verify',
        body: {'ref': _ref.text.trim().toUpperCase(), 'phone': _phone.text.trim(), 'code': _code.text, 'deviceId': ref.read(deviceIdProvider)},
        auth: false,
      ) as Json;
      if (mounted) {
        setState(() {
          _view = PublicTrack.fromJson(res);
          _stage = _Stage.done;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = _message(l, e));
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  String _statusLabel(AppL10n l, PublicTrack v, String s) {
    if (v.kind == 'SERVICE') return serviceStatusLabel(l, s);
    final t = s.replaceAll('_', ' ').toLowerCase();
    return t.isEmpty ? s : '${t[0].toUpperCase()}${t.substring(1)}';
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final theme = Theme.of(context);
    final busy = _busy != null;
    final canSend = _ref.text.trim().length >= 6 && _phone.text.trim().length >= 6;
    return AppCard(
      key: const Key('track-lookup'),
      padding: const EdgeInsets.all(20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l.tkLookupTitle, style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(l.tkLookupLead, style: theme.textTheme.bodySmall),
          const SizedBox(height: 16),
          if (_stage != _Stage.done) ...[
            TextField(
              key: const Key('track-ref'),
              controller: _ref,
              enabled: _stage == _Stage.form,
              textCapitalization: TextCapitalization.characters,
              textDirection: TextDirection.ltr,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(labelText: l.tkRef, hintText: l.tkRefHint),
            ),
            const SizedBox(height: 12),
            TextField(
              key: const Key('track-phone'),
              controller: _phone,
              enabled: _stage == _Stage.form,
              keyboardType: TextInputType.phone,
              textDirection: TextDirection.ltr,
              autofillHints: const [AutofillHints.telephoneNumber],
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(labelText: l.tkPhone),
            ),
            if (_stage == _Stage.code) ...[
              const SizedBox(height: 12),
              Semantics(liveRegion: true, child: Text(l.tkSent, style: theme.textTheme.bodySmall)),
              const SizedBox(height: 12),
              TextField(
                key: const Key('track-code'),
                controller: _code,
                keyboardType: TextInputType.number,
                textDirection: TextDirection.ltr,
                maxLength: 6,
                inputFormatters: [FilteringTextInputFormatter.digitsOnly],
                autofillHints: const [AutofillHints.oneTimeCode],
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(labelText: l.tkCode, counterText: ''),
              ),
            ],
            const SizedBox(height: 16),
            FilledButton(
              key: const Key('track-submit'),
              onPressed: busy || (_stage == _Stage.form ? !canSend : _code.text.length != 6) ? null : (_stage == _Stage.form ? _lookup : _verify),
              child: Text(_stage == _Stage.form ? l.tkSendCode : l.tkVerify),
            ),
            if (_busy == 'pow') Padding(padding: const EdgeInsets.only(top: 8), child: Text(l.tkChecking, style: theme.textTheme.bodySmall)),
            if (_error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Semantics(liveRegion: true, child: Text(_error!, style: TextStyle(color: theme.colorScheme.error)))),
          ] else if (_view != null) ...[
            Text(l.tkResult(_view!.ref), key: const Key('track-result'), style: theme.textTheme.titleSmall),
            const SizedBox(height: 12),
            AppTimeline(
              currentIndex: 0,
              entries: [
                for (final t in _view!.timeline.reversed) AppTimelineEntry(title: _statusLabel(l, _view!, t.status), subtitle: formatDateTime(t.at, lang: lang, jalali: jalali)),
              ],
            ),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => setState(() {
                _stage = _Stage.form;
                _view = null;
                _code.clear();
              }),
              child: Text(l.tkAgain),
            ),
          ],
        ],
      ),
    );
  }
}
