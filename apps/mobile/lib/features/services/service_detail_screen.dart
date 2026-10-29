import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kit_ui/kit_ui.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../l10n/app_localizations.dart';
import '../../models/json.dart';
import '../../models/services.dart';
import '../../ui/patterns.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../requests/request_detail_screen.dart' show MessageBubble;
import 'service_labels.dart';

/// Customer view of one service request (`GET /v1/service-requests/:ref`): details, a quote once it has been sent, the
/// customer-facing timeline, messages and cancel. Nothing here implies a booking: only the status words the website uses.
class ServiceDetailScreen extends ConsumerStatefulWidget {
  const ServiceDetailScreen({super.key, required this.requestRef, this.justSent = false});
  final String requestRef;
  final bool justSent;

  @override
  ConsumerState<ServiceDetailScreen> createState() => _ServiceDetailScreenState();
}

class _ServiceDetailScreenState extends ConsumerState<ServiceDetailScreen> {
  final _message = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  String get _base => '/v1/service-requests/${widget.requestRef}';

  Future<void> _run(Future<Object?> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(serviceRequestProvider(widget.requestRef));
      ref.invalidate(trackProvider);
      await ref.read(serviceRequestProvider(widget.requestRef).future);
    } on ApiException catch (e) {
      if (mounted) showMessage(context, errorMessage(context.l, e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirm(String title, String body, String yes) async {
    final l = context.l;
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(l.cancel)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(yes)),
        ],
      ),
    );
    return ok ?? false;
  }

  Future<void> _send() async {
    final text = _message.text.trim();
    if (text.isEmpty) return;
    await _run(() => ref.read(apiClientProvider).post('$_base/messages', body: {'body': text}));
    _message.clear();
  }

  Future<void> _accept() async {
    final l = context.l;
    if (await _confirm(l.svAccept, l.svAcceptHint, l.svAccept)) {
      await _run(() => ref.read(apiClientProvider).post('$_base/quote/accept', body: {}));
    }
  }

  Future<void> _cancel() async {
    final l = context.l;
    if (await _confirm(l.svCancel, l.svCancelConfirm, l.svCancel)) {
      await _run(() => ref.read(apiClientProvider).post('$_base/cancel', body: {}));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final async = ref.watch(serviceRequestProvider(widget.requestRef));
    return Scaffold(
      appBar: AppBar(title: Text(l.svDetails)),
      body: PageBody(
        child: async.when(
          loading: () => const LoadingList(count: 3),
          error: (e, _) => e is ApiException && e.status == 404
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Text(l.svNotFound, textAlign: TextAlign.center)))
              : ErrorBox(e, onRetry: () => ref.invalidate(serviceRequestProvider(widget.requestRef))),
          data: (cached) => Column(
            children: [
              if (cached.staleSince != null) StaleBanner(savedAt: cached.staleSince!),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () async => ref.refresh(serviceRequestProvider(widget.requestRef).future),
                  child: _body(context, cached),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _detailValue(AppL10n l, String key, Object? v, String lang, bool jalali) {
    final s = '$v';
    if (key == 'purpose') {
      return switch (s) { 'TOURISM' => l.svPurposeTourism, 'BUSINESS' => l.svPurposeBusiness, 'STUDY' => l.svPurposeStudy, 'FAMILY' => l.svPurposeFamily, 'TRANSIT' => l.svPurposeTransit, _ => s };
    }
    if (key == 'direction') return s == 'ARRIVAL' ? l.svArrival : (s == 'DEPARTURE' ? l.svDeparture : s);
    if (key == 'destinationRegion') {
      return switch (s) { 'UK' => l.svRegionUk, 'SCHENGEN' => l.svRegionSchengen, 'EUROPE' => l.svRegionEurope, 'WORLDWIDE_EXCL_AMERICAS' => l.svRegionWorldExAmericas, 'WORLDWIDE' => l.svRegionWorldwide, _ => s };
    }
    if (RegExp(r'^\d{4}-\d{2}-\d{2}$').hasMatch(s)) return formatIsoDate(s, lang: lang, jalali: jalali);
    return s;
  }

  List<(String, String)> _rows(AppL10n l, Json d, String lang, bool jalali) {
    final labels = <String, String>{
      'destinationCountry': l.svDestinationCountry.split(' (').first,
      'purpose': l.svPurpose,
      'intendedTravelDate': l.svTravelDate,
      'linkedFlightRequestRef': l.svLinkedFlight,
      'destination': l.svDestination,
      'approxDates': l.svApproxDates,
      'travellersCount': l.svTravellersCount,
      'bestTimeToCall': l.svBestTimeToCall,
      'direction': l.svDirection,
      'flightNumber': l.svFlightNumber,
      'date': l.svDate,
      'passengersCount': l.svPassengersCount,
      'destinationRegion': l.svRegion,
      'startDate': l.svStartDate,
      'endDate': l.svEndDate,
      'location': l.svLocation,
      'checkIn': l.svCheckIn,
      'checkOut': l.svCheckOut,
      'guests': l.svGuests,
      'rooms': l.svRooms,
      'from': l.svFrom,
      'to': l.svTo,
      'passengers': l.svPassengers,
      'note': l.svNote,
    };
    return [
      for (final e in d.entries)
        if (labels.containsKey(e.key) && e.value != null && '${e.value}'.isNotEmpty) (labels[e.key]!, _detailValue(l, e.key, e.value, lang, jalali)),
    ];
  }

  Widget _quoteCard(BuildContext context, ServiceQuote q, ServiceDetail d) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final theme = Theme.of(context);
    String kind(String k) => switch (k) { 'THIRD_PARTY_FEE' => l.svLineThirdParty, 'CLUB_DISCOUNT' => l.svLineClubDiscount, _ => l.svLineServiceFee };
    final status = switch (q.status) { 'ACCEPTED' => l.svQuoteAccepted, 'DECLINED' => l.svQuoteDeclined, 'EXPIRED' => l.svQuoteExpired, _ => l.svQuoteSent };
    return AppCard(
      key: const Key('service-quote'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(children: [Expanded(child: Text(l.svQuote, style: theme.textTheme.titleSmall)), ToneChip(status, tone: q.status == 'ACCEPTED' ? XfamTone.success : (q.status == 'SENT' ? XfamTone.warning : XfamTone.neutral))]),
          for (final line in q.lines) ...[
            const Divider(height: 20),
            Row(
              children: [
                Expanded(child: Text(line.label.isEmpty ? kind(line.kind) : '${kind(line.kind)} · ${line.label}')),
                Text('${line.kind == 'CLUB_DISCOUNT' ? '−' : ''}${formatMoney(line.amount, lang)}'),
              ],
            ),
          ],
          const Divider(height: 20),
          Row(children: [Expanded(child: Text(l.svTotal, style: theme.textTheme.titleSmall)), Text(formatMoney(q.total, lang), style: theme.textTheme.titleMedium)]),
          if (q.validUntil != null) Padding(padding: const EdgeInsets.only(top: 6), child: Text(l.svValidUntil(formatDateTime(q.validUntil, lang: lang, jalali: jalali)), style: theme.textTheme.bodySmall?.copyWith(color: xc(context).fgMuted))),
          if ((q.note ?? '').isNotEmpty) Padding(padding: const EdgeInsets.only(top: 6), child: Text(q.note!)),
          if (d.canAcceptQuote) ...[const SizedBox(height: 12), FilledButton(key: const Key('quote-accept'), onPressed: _busy ? null : _accept, child: Text(l.svAccept))],
        ],
      ),
    );
  }

  Widget _body(BuildContext context, Cached<ServiceDetail> cached) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final theme = Theme.of(context);
    final d = cached.data;
    final s = d.summary;
    final offline = cached.staleSince != null;
    final rows = _rows(l, d.details, lang, jalali);
    final timeline = d.timeline.reversed.toList();
    final open = !const ['COMPLETED', 'CANCELLED', 'CLOSED_NO_RESPONSE', 'DECLINED'].contains(s.status);
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        if (widget.justSent)
          Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Semantics(
              liveRegion: true,
              child: AppCard(
                key: const Key('service-sent'),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(l.svSentTitle, style: theme.textTheme.titleSmall), const SizedBox(height: 4), Text(l.svSentBody(s.ref))]),
              ),
            ),
          ),
        Row(
          children: [
            Expanded(child: Align(alignment: AlignmentDirectional.centerStart, child: LtrText(s.ref, style: theme.textTheme.titleMedium?.copyWith(color: Brand.orange700, letterSpacing: 1)))),
            ToneChip(serviceStatusLabel(l, s.status), tone: serviceStatusTone(s.status)),
          ],
        ),
        const SizedBox(height: 8),
        Text(s.type == null ? s.title : serviceTypeLabel(l, s.type!), style: theme.textTheme.headlineSmall),
        if (rows.isNotEmpty) ...[
          SectionTitle(l.svDetails),
          AppCard(
            child: Column(
              children: [
                for (final (k, v) in rows)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 4),
                    child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [Expanded(flex: 2, child: Text(k, style: theme.textTheme.bodySmall?.copyWith(color: xc(context).fgMuted))), Expanded(flex: 3, child: Text(v))]),
                  ),
              ],
            ),
          ),
        ],
        if (d.quote != null) ...[const SizedBox(height: 16), _quoteCard(context, d.quote!, d)],
        SectionTitle(l.svTimeline),
        AppTimeline(
          currentIndex: 0,
          entries: [
            for (final item in timeline) AppTimelineEntry(title: item.label, subtitle: [formatDateTime(item.at, lang: lang, jalali: jalali), if (item.detail != null) item.detail!].join(sep(lang))),
          ],
        ),
        SectionTitle(l.svMessages),
        if (d.messages.isEmpty) Text(l.svNoMessages, style: theme.textTheme.bodySmall),
        for (final m in d.messages) MessageBubble(m: m),
        if (open && !offline) ...[
          const SizedBox(height: 8),
          TextField(
            key: const Key('service-message'),
            controller: _message,
            minLines: 1,
            maxLines: 4,
            decoration: InputDecoration(hintText: l.svMessageHint, suffixIcon: IconButton(tooltip: l.send, onPressed: _busy ? null : _send, icon: const Icon(Icons.send))),
          ),
        ],
        if (d.canCancel && !offline) ...[
          const SizedBox(height: 24),
          OutlinedButton(key: const Key('service-cancel'), style: OutlinedButton.styleFrom(foregroundColor: Brand.danger), onPressed: _busy ? null : _cancel, child: Text(l.svCancel)),
        ],
        const SizedBox(height: 24),
      ],
    );
  }
}
