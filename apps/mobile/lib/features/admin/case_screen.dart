import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kit_ui/kit_ui.dart' show XfamTone;
import 'package:url_launcher/url_launcher.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../models/admin.dart';
import '../../models/json.dart';
import '../../ui/bento.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'admin_providers.dart';
import 'case_tile.dart';
import 'case_truth.dart';
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
      Haptics.success();
      ref.invalidate(adminCaseProvider(widget.requestRef));
      ref.invalidate(queueSummaryProvider);
      ref.invalidate(adminCasesProvider);
      await ref.read(adminCaseProvider(widget.requestRef).future);
      if (mounted && done != null) showMessage(context, done);
    } on ApiException catch (e) {
      Haptics.warn();
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
        padding: EdgeInsets.fromLTRB(20, 4, 20, 20 + MediaQuery.viewInsetsOf(ctx).bottom),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Semantics(header: true, child: Text(title, style: Theme.of(ctx).textTheme.titleLarge)),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              autofocus: true,
              minLines: 3,
              maxLines: 6,
              decoration: InputDecoration(hintText: hint),
            ),
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
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
              child: Semantics(header: true, child: Text(l.logCall, style: Theme.of(ctx).textTheme.titleLarge)),
            ),
            for (final e in outcomes.entries) ListTile(minTileHeight: 48, title: Text(e.value), onTap: () => Navigator.pop(ctx, e.key)),
          ],
        ),
      ),
    );
    if (picked == null) return;
    await _run(() => ref.read(apiClientProvider).post('$_base/contact-attempts', body: {'channel': 'PHONE', 'outcome': picked}), done: l.actionDone);
  }

  Future<void> _claim(AdminCase c) => _run(
    () => ref.read(apiClientProvider).post('$_base/commands/claim', body: {}, headers: {'If-Match': '${c.version}'}),
    done: context.l.claimed,
  );

  Future<void> _requestInfo(AdminCase c) async {
    final l = context.l;
    final t = await _askText(l.requestInfo, l.requestInfoHint);
    if (t == null) return;
    await _run(
      () => ref.read(apiClientProvider).post('$_base/commands/request_info', body: {'message': t}, headers: {'If-Match': '${c.version}'}),
      done: l.actionDone,
    );
  }

  Future<void> _message() async {
    final l = context.l;
    final t = await _askText(l.messageCustomer, l.messageHint);
    if (t != null) await _run(() => ref.read(apiClientProvider).post('$_base/messages', body: {'body': t}), done: l.actionDone);
  }

  Future<void> _note() async {
    final l = context.l;
    final t = await _askText(l.addNote, l.noteHint);
    if (t != null) await _run(() => ref.read(apiClientProvider).post('$_base/notes', body: {'body': t}), done: l.actionDone);
  }

  Future<void> _more(AdminCase c) async {
    final l = context.l;
    final pick = await showModalBottomSheet<String>(
      context: context,
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(minTileHeight: 56, leading: const Icon(Icons.phone_callback_outlined), title: Text(l.logCall), onTap: () => Navigator.pop(ctx, 'call')),
            if (c.allowed('request_info'))
              ListTile(minTileHeight: 56, leading: const Icon(Icons.help_outline), title: Text(l.requestInfo), onTap: () => Navigator.pop(ctx, 'info')),
            ListTile(minTileHeight: 56, leading: const Icon(Icons.sticky_note_2_outlined), title: Text(l.addNote), onTap: () => Navigator.pop(ctx, 'note')),
          ],
        ),
      ),
    );
    switch (pick) {
      case 'call':
        await _logCall();
      case 'info':
        await _requestInfo(c);
      case 'note':
        await _note();
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final async = ref.watch(adminCaseProvider(widget.requestRef));
    final c = async.value;
    return Scaffold(
      appBar: AppBar(title: LtrText(widget.requestRef, style: Theme.of(context).textTheme.titleLarge?.copyWith(letterSpacing: 1))),
      body: PageBody(
        child: async.when(
          skipLoadingOnRefresh: true,
          loading: () => const LoadingList(count: 3),
          error: (e, _) => AdminErrorView(e, onRetry: () => ref.invalidate(adminCaseProvider(widget.requestRef))),
          data: (c) => _body(context, c),
        ),
      ),
      bottomNavigationBar: c == null
          ? null
          : _ActionBar(c: c, busy: _busy, onClaim: () => _claim(c), onMessage: _message, onMore: () => _more(c), semanticsLabel: l.caseActions),
    );
  }

  Widget _body(BuildContext context, AdminCase c) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final theme = Theme.of(context);
    final cc = xc(context);
    final claim = c.command('claim');

    return RefreshIndicator(
      onRefresh: () async {
        Haptics.tap();
        ref.invalidate(adminCaseProvider(widget.requestRef));
        await ref.read(adminCaseProvider(widget.requestRef).future);
      },
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
        children: [
          Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              ToneChip(staffStatusLabel(l, c.status), tone: toneForStatus(c.status)),
              if (c.urgent) ToneChip(l.urgent, tone: XfamTone.danger, solid: true),
              SlaChip(status: c.status, due: c.slaDueAt),
            ],
          ),
          const SizedBox(height: 10),
          Semantics(header: true, child: Text(c.routeLabel, style: theme.textTheme.headlineSmall)),
          const SizedBox(height: 2),
          Text(
            '${formatIsoDate(c.firstTravelDate, lang: lang, jalali: jalali)}${sep(lang)}${l.travellerCount(c.passengers.length)}',
            style: theme.textTheme.bodyMedium?.copyWith(color: cc.fgMuted),
          ),
          const SizedBox(height: 16),
          CollapsibleSection(
            title: l.customerLabel,
            icon: Icons.person_outline,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(c.customerName, style: theme.textTheme.titleMedium),
                if (c.phone != null) LtrText(c.phone!),
                const SizedBox(height: 8),
                Text('${l.assignee}: ${c.assignee ?? l.unassigned}', style: theme.textTheme.bodySmall),
                if (c.slaDueAt != null)
                  Text(
                    l.slaDue(formatDateTime(c.slaDueAt, lang: lang, jalali: jalali)),
                    style: theme.textTheme.bodySmall,
                  ),
                if (c.customerNote != null && c.customerNote!.isNotEmpty) ...[
                  const SizedBox(height: 10),
                  Text(l.customerNote, style: theme.textTheme.labelMedium?.copyWith(color: cc.fgMuted)),
                  Text(c.customerNote!, style: theme.textTheme.bodyMedium),
                ],
              ],
            ),
          ),
          const SizedBox(height: 12),
          CollapsibleSection(
            title: l.caseTruthTitle,
            icon: Icons.fact_check_outlined,
            badge: c.truth.hasUnknown ? ToneChip(l.triUnknown, tone: XfamTone.warning, icon: Icons.help_outline) : null,
            child: CaseTruthCard(c: c, jalali: jalali),
          ),
          const SizedBox(height: 12),
          CollapsibleSection(
            title: l.activityTitle,
            icon: Icons.history,
            child: _Activity(c: c),
          ),
          if (claim != null && !claim.allowed && claim.reason != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(l.commandNotAllowed(claim.reason!), style: theme.textTheme.bodySmall),
            ),
          const SizedBox(height: 12),
          Text(l.mobileTriageOnly, style: theme.textTheme.bodySmall?.copyWith(color: cc.fgMuted)),
        ],
      ),
    );
  }
}

/// Sticky bottom bar: the primary triage step, then call / message / more. Targets are 48dp.
class _ActionBar extends StatelessWidget {
  const _ActionBar({required this.c, required this.busy, required this.onClaim, required this.onMessage, required this.onMore, required this.semanticsLabel});
  final AdminCase c;
  final bool busy;
  final VoidCallback onClaim;
  final VoidCallback onMessage;
  final VoidCallback onMore;
  final String semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final claim = c.command('claim');
    final canClaim = claim != null && claim.allowed;
    final cc = xc(context);
    return Semantics(
      container: true,
      label: semanticsLabel,
      child: Material(
        color: cc.surface,
        elevation: 0,
        shape: Border(top: BorderSide(color: cc.border)),
        child: SafeArea(
          top: false,
          // heightFactor: a bare Align would take the whole screen height and squeeze the body to nothing.
          child: Align(
            heightFactor: 1,
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 680),
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                child: Row(
                  children: [
                    Expanded(
                      child: canClaim
                          ? FilledButton.icon(
                              onPressed: busy
                                  ? null
                                  : () {
                                      Haptics.tap();
                                      onClaim();
                                    },
                              icon: busy
                                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Brand.navy950))
                                  : const Icon(Icons.back_hand_outlined, size: 20),
                              label: Text(l.claim),
                            )
                          : FilledButton.icon(
                              onPressed: busy ? null : onMessage,
                              icon: const Icon(Icons.chat_bubble_outline, size: 20),
                              label: Text(l.messageCustomer),
                            ),
                    ),
                    const SizedBox(width: 8),
                    if (canClaim)
                      IconButton.outlined(tooltip: l.messageCustomer, onPressed: busy ? null : onMessage, icon: const Icon(Icons.chat_bubble_outline)),
                    if (c.canDial) ...[
                      const SizedBox(width: 4),
                      IconButton.outlined(
                        tooltip: l.callCustomer,
                        onPressed: busy ? null : () => launchUrl(Uri(scheme: 'tel', path: c.phone)),
                        icon: const Icon(Icons.call),
                      ),
                    ],
                    const SizedBox(width: 4),
                    IconButton.outlined(tooltip: l.moreActions, onPressed: busy ? null : onMore, icon: const Icon(Icons.more_horiz)),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Card whose header toggles the body. Header is a 48dp+ button; motion is skipped under reduce-motion.
class CollapsibleSection extends StatefulWidget {
  const CollapsibleSection({super.key, required this.title, required this.icon, required this.child, this.badge, this.initiallyOpen = true});
  final String title;
  final IconData icon;
  final Widget child;
  final Widget? badge;
  final bool initiallyOpen;

  @override
  State<CollapsibleSection> createState() => _CollapsibleSectionState();
}

class _CollapsibleSectionState extends State<CollapsibleSection> {
  late bool _open = widget.initiallyOpen;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final cc = xc(context);
    final fast = reduceMotion(context);
    return BentoTile(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Semantics(
            button: true,
            expanded: _open,
            label: widget.title,
            excludeSemantics: true,
            onTap: () => setState(() => _open = !_open),
            child: InkWell(
              onTap: () {
                Haptics.select();
                setState(() => _open = !_open);
              },
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 56),
                child: Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  child: Row(
                    children: [
                      Icon(widget.icon, size: 20, color: cc.fgMuted),
                      const SizedBox(width: 10),
                      Expanded(child: Text(widget.title, style: theme.textTheme.titleMedium)),
                      if (widget.badge != null) ...[widget.badge!, const SizedBox(width: 8)],
                      AnimatedRotation(
                        turns: _open ? 0.5 : 0,
                        duration: fast ? Duration.zero : const Duration(milliseconds: 180),
                        child: Icon(Icons.expand_more, color: cc.fgMuted),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
          AnimatedSize(
            duration: fast ? Duration.zero : const Duration(milliseconds: 200),
            curve: Curves.easeOutCubic,
            alignment: Alignment.topCenter,
            child: _open ? Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 16), child: widget.child) : const SizedBox(width: double.infinity),
          ),
        ],
      ),
    );
  }
}

enum _Kind { status, contact, message, note }

class _Event {
  const _Event(this.kind, this.at, this.title, this.detail, {this.incoming = false});
  final _Kind kind;
  final DateTime? at;
  final String title;
  final String? detail;
  final bool incoming;
}

/// Status changes, calls, messages and notes in one newest-first rail.
class _Activity extends ConsumerStatefulWidget {
  const _Activity({required this.c});
  final AdminCase c;

  @override
  ConsumerState<_Activity> createState() => _ActivityState();
}

class _ActivityState extends ConsumerState<_Activity> {
  _Kind? _only;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final theme = Theme.of(context);
    final cc = xc(context);
    final c = widget.c;
    final events = <_Event>[
      for (final t in c.timeline) _Event(t.str('kind') == 'CONTACT' ? _Kind.contact : _Kind.status, parseDate(t['at']), t.str('label'), t.strOrNull('detail')),
      for (final m in c.messages)
        _Event(
          _Kind.message,
          parseDate(m['createdAt']),
          m.str('direction') == 'FROM_CUSTOMER' ? l.msgFromCustomer : l.msgToCustomer,
          m.str('body'),
          incoming: m.str('direction') == 'FROM_CUSTOMER',
        ),
      for (final n in c.notes) _Event(_Kind.note, parseDate(n['createdAt']), '${l.noteKind}${sep(lang)}${n.str('author')}', n.str('body')),
    ]..sort((a, b) => (b.at ?? DateTime.fromMillisecondsSinceEpoch(0)).compareTo(a.at ?? DateTime.fromMillisecondsSinceEpoch(0)));
    final shown = _only == null ? events : events.where((e) => e.kind == _only).toList();
    final filters = {null: l.filterAll, _Kind.message: l.messages, _Kind.note: l.notes, _Kind.status: l.statusTimeline};

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 48,
          child: ListView(
            scrollDirection: Axis.horizontal,
            children: [
              for (final e in filters.entries)
                Padding(
                  padding: const EdgeInsetsDirectional.only(end: 8),
                  child: ChoiceChip(
                    label: Text(e.value),
                    selected: _only == e.key,
                    showCheckmark: false,
                    onSelected: (_) {
                      Haptics.select();
                      setState(() => _only = e.key);
                    },
                  ),
                ),
            ],
          ),
        ),
        if (shown.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 12),
            child: Text(l.activityEmpty, style: theme.textTheme.bodySmall),
          ),
        for (var i = 0; i < shown.length; i++)
          _Rail(
            first: i == 0,
            last: i == shown.length - 1,
            icon: switch (shown[i].kind) {
              _Kind.status => Icons.flag_outlined,
              _Kind.contact => Icons.phone_callback_outlined,
              _Kind.message => shown[i].incoming ? Icons.south_west : Icons.north_east,
              _Kind.note => Icons.sticky_note_2_outlined,
            },
            child: Semantics(
              container: true,
              label: [
                shown[i].title,
                if (shown[i].detail != null && shown[i].detail!.isNotEmpty) shown[i].detail!,
                formatDateTime(shown[i].at, lang: lang, jalali: jalali),
              ].join('. '),
              excludeSemantics: true,
              child: Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(shown[i].title, style: theme.textTheme.titleSmall),
                    if (shown[i].detail != null && shown[i].detail!.isNotEmpty) Text(shown[i].detail!, style: theme.textTheme.bodyMedium),
                    Text(
                      formatDateTime(shown[i].at, lang: lang, jalali: jalali),
                      style: theme.textTheme.labelSmall?.copyWith(color: cc.fgSubtle),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// One step of the vertical rail: icon node, connector line, content.
class _Rail extends StatelessWidget {
  const _Rail({required this.first, required this.last, required this.icon, required this.child});
  final bool first;
  final bool last;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final cc = xc(context);
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 32,
            child: Column(
              children: [
                Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: first ? cc.brandSubtle : cc.neutralSubtle,
                    shape: BoxShape.circle,
                    border: Border.all(color: first ? cc.brandSubtleFg : cc.neutralBorder),
                  ),
                  child: Icon(icon, size: 14, color: first ? cc.brandSubtleFg : cc.neutralSubtleFg),
                ),
                if (!last) Expanded(child: Container(width: 2, color: cc.border)),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Expanded(child: child),
        ],
      ),
    );
  }
}
