import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../models/admin.dart';
import '../../models/json.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'admin_providers.dart';
import 'mfa_gate.dart';

/// One case, triage only (ch. 15.8): claim, ask for info, message, note, log a call.
/// Quotes, records and compliance decisions are intentionally absent on mobile v1.
class CaseScreen extends ConsumerStatefulWidget {
  const CaseScreen({super.key, required this.requestRef});
  final String requestRef;

  @override
  ConsumerState<CaseScreen> createState() => _CaseScreenState();
}

class _CaseScreenState extends ConsumerState<CaseScreen> {
  bool _busy = false;

  String get _base => '/v1/admin/flight-requests/${widget.requestRef}';

  Future<void> _run(Future<Object?> Function() action, {String? done}) async {
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(adminCaseProvider(widget.requestRef));
      ref.invalidate(queueSummaryProvider);
      ref.invalidate(adminCasesProvider);
      await ref.read(adminCaseProvider(widget.requestRef).future);
      if (mounted && done != null) showMessage(context, done);
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.code == 'VERSION_CONFLICT') ref.invalidate(adminCaseProvider(widget.requestRef));
      showMessage(context, errorMessage(context.l, e), error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<String?> _askText(String title, String hint) async {
    final l = context.l;
    final controller = TextEditingController();
    final text = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (ctx) => Padding(
        padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.viewInsetsOf(ctx).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(title, style: Theme.of(ctx).textTheme.titleLarge),
            const SizedBox(height: 12),
            TextField(controller: controller, autofocus: true, minLines: 3, maxLines: 6, decoration: InputDecoration(hintText: hint)),
            const SizedBox(height: 12),
            FilledButton(onPressed: () => Navigator.pop(ctx, controller.text.trim()), child: Text(l.send)),
          ],
        ),
      ),
    );
    controller.dispose();
    return (text == null || text.isEmpty) ? null : text;
  }

  Future<void> _logCall() async {
    final l = context.l;
    final outcomes = {
      'REACHED': l.outcomeReached,
      'NO_ANSWER': l.outcomeNoAnswer,
      'BUSY': l.outcomeBusy,
      'WRONG_NUMBER': l.outcomeWrongNumber,
      'CALL_BACK_REQUESTED': l.outcomeCallBack,
    };
    final picked = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(padding: const EdgeInsets.all(16), child: Text(l.logCall, style: Theme.of(ctx).textTheme.titleLarge)),
            for (final e in outcomes.entries) ListTile(title: Text(e.value), onTap: () => Navigator.pop(ctx, e.key)),
          ],
        ),
      ),
    );
    if (picked == null) return;
    await _run(
      () => ref.read(apiClientProvider).post('$_base/contact-attempts', body: {'channel': 'PHONE', 'outcome': picked}),
      done: l.actionDone,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final async = ref.watch(adminCaseProvider(widget.requestRef));
    return Scaffold(
      appBar: AppBar(title: Text(l.caseTitle)),
      body: PageBody(
        child: async.when(
          loading: () => const LoadingList(count: 3),
          error: (e, _) => AdminErrorView(e, onRetry: () => ref.invalidate(adminCaseProvider(widget.requestRef))),
          data: (c) => _body(context, c),
        ),
      ),
    );
  }

  Widget _body(BuildContext context, AdminCase c) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final theme = Theme.of(context);
    final claim = c.command('claim');

    Widget tile(IconData icon, String label, VoidCallback? onTap) => OutlinedButton.icon(
      onPressed: _busy ? null : onTap,
      icon: Icon(icon, size: 18),
      label: Text(label),
    );

    return RefreshIndicator(
      onRefresh: () async => ref.refresh(adminCaseProvider(widget.requestRef).future),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          Row(
            children: [
              Expanded(
                child: Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: LtrText(c.ref, style: theme.textTheme.titleMedium?.copyWith(color: Brand.copperDark, letterSpacing: 1)),
                ),
              ),
              ToneChip(staffStatusLabel(l, c.status), tone: toneForStatus(c.status)),
            ],
          ),
          const SizedBox(height: 6),
          Text(c.routeLabel, style: theme.textTheme.headlineSmall),
          Text(
            '${formatIsoDate(c.firstTravelDate, lang: lang, jalali: jalali)}${sep(lang)}${l.travellerCount(c.passengers.length)}',
            style: theme.textTheme.bodySmall,
          ),
          const SizedBox(height: 12),
          AppCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l.customerLabel, style: theme.textTheme.labelSmall),
                Text(c.customerName, style: theme.textTheme.titleMedium),
                if (c.phone != null) LtrText(c.phone!),
                const SizedBox(height: 8),
                Text('${l.assignee}: ${c.assignee ?? l.unassigned}', style: theme.textTheme.bodySmall),
                if (c.slaDueAt != null)
                  Text(l.slaDue(formatDateTime(c.slaDueAt, lang: lang, jalali: jalali)), style: theme.textTheme.bodySmall),
                if (c.customerNote != null && c.customerNote!.isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Text(c.customerNote!, style: theme.textTheme.bodyMedium),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (claim != null)
                FilledButton.icon(
                  onPressed: (_busy || !claim.allowed)
                      ? null
                      : () => _run(
                          () => ref.read(apiClientProvider).post('$_base/commands/claim', body: {}, headers: {'If-Match': '${c.version}'}),
                          done: l.claimed,
                        ),
                  icon: const Icon(Icons.back_hand_outlined, size: 18),
                  label: Text(l.claim),
                ),
              if (c.canDial)
                tile(Icons.call, l.callCustomer, () => launchUrl(Uri(scheme: 'tel', path: c.phone))),
              tile(Icons.phone_callback_outlined, l.logCall, _logCall),
              if (c.allowed('request_info'))
                tile(Icons.help_outline, l.requestInfo, () async {
                  final t = await _askText(l.requestInfo, l.requestInfoHint);
                  if (t != null) {
                    await _run(
                      () => ref.read(apiClientProvider).post('$_base/commands/request_info', body: {'message': t}, headers: {'If-Match': '${c.version}'}),
                      done: l.actionDone,
                    );
                  }
                }),
              tile(Icons.chat_bubble_outline, l.messageCustomer, () async {
                final t = await _askText(l.messageCustomer, l.messageHint);
                if (t != null) {
                  await _run(() => ref.read(apiClientProvider).post('$_base/messages', body: {'body': t}), done: l.actionDone);
                }
              }),
              tile(Icons.sticky_note_2_outlined, l.addNote, () async {
                final t = await _askText(l.addNote, l.noteHint);
                if (t != null) await _run(() => ref.read(apiClientProvider).post('$_base/notes', body: {'body': t}), done: l.actionDone);
              }),
            ],
          ),
          if (claim != null && !claim.allowed && claim.reason != null)
            Padding(padding: const EdgeInsets.only(top: 8), child: Text(l.commandNotAllowed(claim.reason!), style: theme.textTheme.bodySmall)),
          const SizedBox(height: 8),
          Text(l.mobileTriageOnly, style: theme.textTheme.bodySmall?.copyWith(color: xc(context).fgMuted)),
          SectionTitle(l.statusTimeline),
          for (final t in c.timeline.reversed)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              title: Text(t.str('label')),
              subtitle: Text(formatDateTime(parseDate(t['at']), lang: lang, jalali: jalali)),
            ),
          SectionTitle(l.messages),
          if (c.messages.isEmpty) Text(l.noMessages, style: theme.textTheme.bodySmall),
          for (final m in c.messages)
            ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(m.str('direction') == 'FROM_CUSTOMER' ? Icons.south_west : Icons.north_east, size: 18),
              title: Text(m.str('body')),
              subtitle: Text('${m.str('authorName')}${sep(lang)}${formatDateTime(parseDate(m['createdAt']), lang: lang, jalali: jalali)}'),
            ),
          if (c.notes.isNotEmpty) ...[
            SectionTitle(l.notes),
            for (final n in c.notes)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                title: Text(n.str('body')),
                subtitle: Text('${n.str('author')}${sep(lang)}${formatDateTime(parseDate(n['createdAt']), lang: lang, jalali: jalali)}'),
              ),
          ],
        ],
      ),
    );
  }
}
