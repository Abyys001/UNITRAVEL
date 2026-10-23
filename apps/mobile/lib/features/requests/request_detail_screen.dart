import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kit_ui/kit_ui.dart' hide TimelineEntry;
import 'package:kit_ui/kit_ui.dart' as kit show TimelineEntry;
import 'package:uuid/uuid.dart';

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

/// Customer request detail (flight or cargo): status timeline in customer
/// labels, messages, quote cards with Accept, tickets (ch. 11, 15).
class RequestDetailScreen extends ConsumerStatefulWidget {
  const RequestDetailScreen({super.key, required this.requestRef});
  final String requestRef;

  @override
  ConsumerState<RequestDetailScreen> createState() => _RequestDetailScreenState();
}

class _RequestDetailScreenState extends ConsumerState<RequestDetailScreen> {
  final _message = TextEditingController();
  bool _busy = false;

  String get _base => isCargoRef(widget.requestRef) ? '/v1/cargo-requests' : '/v1/flight-requests';

  @override
  void dispose() {
    _message.dispose();
    super.dispose();
  }

  Future<void> _run(Future<Object?> Function() action) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(requestDetailProvider(widget.requestRef));
      ref.invalidate(requestsProvider);
      await ref.read(requestDetailProvider(widget.requestRef).future);
    } on ApiException catch (e) {
      if (mounted) showMessage(context, errorMessage(context.l, e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _sendMessage() async {
    final text = _message.text.trim();
    if (text.isEmpty) return;
    await _run(() => ref.read(apiClientProvider).post('$_base/${widget.requestRef}/messages', body: {'body': text}));
    _message.clear();
  }

  Future<bool> _confirm(String title, String body, String yes, String no) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(title),
        content: Text(body),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(no)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(yes)),
        ],
      ),
    );
    return ok ?? false;
  }

  Future<void> _accept(QuoteItem q, QuoteOption o) async {
    final l = context.l;
    final ok = await _confirm(
      l.acceptConfirmTitle,
      l.acceptConfirmBody(o.label, formatMoney(o.total, context.lang)),
      l.acceptOption,
      l.cancel,
    );
    if (!ok) return;
    await _run(
      () => ref.read(apiClientProvider).post(
        '$_base/${widget.requestRef}/quotes/${q.id}/accept',
        body: {'optionId': o.id},
        headers: {'Idempotency-Key': const Uuid().v4()},
      ),
    );
  }

  Future<void> _cancelRequest() async {
    final l = context.l;
    final ok = await _confirm(l.cancelConfirmTitle, l.cancelConfirmBody, l.cancelRequest, l.keepRequest);
    if (!ok) return;
    await _run(() => ref.read(apiClientProvider).post('$_base/${widget.requestRef}/cancel', body: {}));
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final async = ref.watch(requestDetailProvider(widget.requestRef));
    return Scaffold(
      appBar: AppBar(title: Text(l.requestDetail)),
      body: PageBody(
        child: async.when(
          loading: () => const LoadingList(count: 3),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(requestDetailProvider(widget.requestRef))),
          data: (cached) => Column(
            children: [
              if (cached.staleSince != null) StaleBanner(savedAt: cached.staleSince!),
              Expanded(
                child: RefreshIndicator(
                  onRefresh: () async => ref.refresh(requestDetailProvider(widget.requestRef).future),
                  child: _body(context, cached),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, Cached<Json> cached) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final theme = Theme.of(context);
    final raw = cached.data;
    final cargo = isCargoRef(widget.requestRef);
    final offline = cached.staleSince != null;

    final status = raw.str('status');
    final statusLabel = raw.str('statusLabel');
    final route = cargo
        ? '${raw.obj('lane').str('origin')} → ${raw.obj('lane').str('destination')}'
        : raw.str('routeLabel');
    final d = cargo ? null : RequestDetail.fromJson(raw);
    final timeline = (cargo ? raw.objs('timeline').map(TimelineItem.fromJson).toList() : d!.timeline).reversed.toList();
    final messages = (cargo ? raw.objs('messages').map(MessageItem.fromJson) : d!.messages).toList();
    final quotes = (cargo ? const <QuoteItem>[] : d!.quotes);
    final actions = raw.strs('actions');
    final canCancel = actions.contains('CANCEL');
    final canMessage = actions.contains('MESSAGE') || actions.contains('RESPOND') || !cargo;

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        Row(
          children: [
            Expanded(
              child: Semantics(
                label: '${l.referenceLabel} ${widget.requestRef}',
                child: Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: LtrText(widget.requestRef, style: theme.textTheme.titleMedium?.copyWith(color: Brand.copperDark, letterSpacing: 1)),
                ),
              ),
            ),
            ToneChip(statusLabel, tone: toneForStatus(status)),
          ],
        ),
        const SizedBox(height: 8),
        Text(route, style: theme.textTheme.headlineSmall),
        if (d != null && d.submittedAt != null)
          Text(
            l.submittedOn(formatDateTime(d.submittedAt, lang: lang, jalali: jalali)),
            style: theme.textTheme.bodySmall?.copyWith(color: xc(context).fgMuted),
          ),
        if (d != null && d.travellers.isNotEmpty) ...[
          const SizedBox(height: 4),
          Text('${l.travellersLabel}: ${d.travellers.join(', ')}', style: theme.textTheme.bodySmall),
        ],
        if (quotes.any((q) => q.open)) ...[
          SectionTitle(l.quotes),
          for (final q in quotes.where((q) => q.open || q.acceptedOptionId != null)) _QuoteCard(q: q, onAccept: offline || _busy ? null : _accept),
        ],
        if (d != null && d.tickets.isNotEmpty) ...[
          SectionTitle(l.tickets),
          for (final t in d.tickets)
            AppCard(
              child: Row(
                children: [
                  const Icon(Icons.confirmation_number_outlined),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [Text(t.traveller), LtrText(t.number, mono: true)],
                    ),
                  ),
                  ToneChip(t.status, tone: XfamTone.success),
                ],
              ),
            ),
        ],
        SectionTitle(l.statusTimeline),
        TimelineList(
          entries: [
            for (var i = 0; i < timeline.length; i++)
              kit.TimelineEntry(
                title: timeline[i].label,
                subtitle: timeline[i].detail,
                timestampLabel: formatDateTime(timeline[i].at, lang: lang, jalali: jalali),
                tone: i == 0 ? XfamTone.success : XfamTone.neutral,
                iconName: i == 0 ? 'circle-check' : 'circle',
              ),
          ],
        ),
        if (cargo) _cargoExtras(context, raw),
        SectionTitle(l.messages),
        if (messages.isEmpty) Text(l.noMessages, style: theme.textTheme.bodySmall),
        for (final m in messages) _MessageBubble(m: m),
        if (canMessage && !offline) ...[
          const SizedBox(height: 8),
          TextField(
            controller: _message,
            minLines: 1,
            maxLines: 4,
            decoration: InputDecoration(
              hintText: l.messageHint,
              suffixIcon: IconButton(tooltip: l.send, onPressed: _busy ? null : _sendMessage, icon: const Icon(Icons.send)),
            ),
          ),
        ],
        if (canCancel && !offline) ...[
          const SizedBox(height: 24),
          OutlinedButton(
            style: OutlinedButton.styleFrom(foregroundColor: Brand.brick),
            onPressed: _busy ? null : _cancelRequest,
            child: Text(l.cancelRequest),
          ),
        ],
      ],
    );
  }

  Widget _cargoExtras(BuildContext context, Json raw) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final tracking = raw.objs('tracking');
    final w = raw.obj('weights');
    final chargeable = w['chargeableKg'] as num?;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (chargeable != null)
          Padding(
            padding: const EdgeInsets.only(top: 12),
            child: Text(l.chargeableWeight(digits(chargeable.toStringAsFixed(1), lang))),
          ),
        SectionTitle(l.tracking),
        if (tracking.isEmpty) Text(l.noTracking, style: Theme.of(context).textTheme.bodySmall),
        for (final t in tracking)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text('${t.str('eventCode')}${sep(lang)}${t.str('location')}'),
            subtitle: Text(formatDateTime(parseDate(t['occurredAt']), lang: lang, jalali: jalali)),
          ),
      ],
    );
  }
}

class _QuoteCard extends ConsumerWidget {
  const _QuoteCard({required this.q, required this.onAccept});
  final QuoteItem q;
  final Future<void> Function(QuoteItem, QuoteOption)? onAccept;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: AppCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (q.validUntil != null)
              Text(
                l.quoteValidUntil(formatDateTime(q.validUntil, lang: lang, jalali: jalali)),
                style: Theme.of(context).textTheme.bodySmall?.copyWith(color: xc(context).fgMuted),
              ),
            for (final o in q.options) ...[
              const Divider(height: 24),
              Row(
                children: [
                  Expanded(child: Text(o.label, style: Theme.of(context).textTheme.titleSmall)),
                  Text(formatMoney(o.total, lang), style: Theme.of(context).textTheme.titleMedium),
                ],
              ),
              if (o.route.isNotEmpty) Text(o.route, style: Theme.of(context).textTheme.bodySmall),
              if (o.ticketingModel == 'SEPARATE_TICKETS') Padding(padding: const EdgeInsets.only(top: 6), child: ToneChip(l.badgeSeparate, tone: XfamTone.danger)),
              if (o.unknownFields.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Text(l.unknownFields(o.unknownFields.join(', ')), style: Theme.of(context).textTheme.bodySmall),
                ),
              const SizedBox(height: 8),
              if (q.acceptedOptionId == o.id)
                ToneChip(l.quoteAccepted, tone: XfamTone.success, solid: true, icon: Icons.check)
              else if (q.open)
                FilledButton(onPressed: onAccept == null ? null : () => onAccept!(q, o), child: Text(l.acceptOption)),
            ],
          ],
        ),
      ),
    );
  }
}

class _MessageBubble extends ConsumerWidget {
  const _MessageBubble({required this.m});
  final MessageItem m;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final jalali = ref.watch(calendarJalaliProvider);
    final mine = m.fromCustomer;
    final c = xc(context);
    return Align(
      alignment: mine ? AlignmentDirectional.centerEnd : AlignmentDirectional.centerStart,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.all(12),
        constraints: const BoxConstraints(maxWidth: 520),
        decoration: BoxDecoration(
          color: mine ? Brand.navy : c.surface,
          border: mine ? null : Border.all(color: Brand.mist),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(mine ? l.youLabel : m.author, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: mine ? Brand.copper : c.fgMuted)),
            const SizedBox(height: 2),
            Text(m.body, style: TextStyle(color: mine ? Colors.white : null)),
            const SizedBox(height: 4),
            Text(
              formatDateTime(m.at, lang: context.lang, jalali: jalali),
              style: Theme.of(context).textTheme.labelSmall?.copyWith(color: mine ? const Color(0xFFB9C0CB) : c.fgSubtle),
            ),
          ],
        ),
      ),
    );
  }
}
