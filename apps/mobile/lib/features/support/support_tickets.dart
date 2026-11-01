import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart' show XfamTone;
import 'package:uuid/uuid.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/format.dart';
import '../../core/pow.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../l10n/app_localizations.dart';
import '../../models/json.dart';
import '../../models/support.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

String ticketTopicLabel(AppL10n l, String topic) => switch (topic) {
  'BOOKING' => l.stTopicBooking,
  'PAYMENT' => l.stTopicPayment,
  'DOCUMENTS' => l.stTopicDocuments,
  'VISA' => l.stTopicVisa,
  'CARGO' => l.stTopicCargo,
  'ACCOUNT' => l.stTopicAccount,
  'FEEDBACK' => l.stTopicFeedback,
  _ => l.stTopicOther,
};

String ticketStatusLabel(AppL10n l, String status) => switch (status) {
  'PENDING_CUSTOMER' => l.stStatusPending,
  'RESOLVED' => l.stStatusResolved,
  'CLOSED' => l.stStatusClosed,
  _ => l.stStatusOpen,
};

XfamTone ticketTone(String status) => switch (status) {
  'PENDING_CUSTOMER' => XfamTone.warning,
  'RESOLVED' => XfamTone.success,
  'CLOSED' => XfamTone.neutral,
  _ => XfamTone.info,
};

final _phonePattern = RegExp(r'^\+?[0-9 ()-]{6,24}$');
final _emailPattern = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
final _requestRefPattern = RegExp(
  r'^UT-[FCAS]-[0-9A-HJKMNP-TV-Z]{6}$',
  caseSensitive: false,
);

/// Contact form (`POST /v1/support/tickets`, public). After a burst the API asks for a proof of work (`428
/// CHALLENGE_REQUIRED`); it is solved off the UI thread and the same message is sent again with the answer.
class SupportFormScreen extends ConsumerStatefulWidget {
  const SupportFormScreen({super.key});

  @override
  ConsumerState<SupportFormScreen> createState() => _SupportFormState();
}

class _SupportFormState extends ConsumerState<SupportFormScreen> {
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _phone = TextEditingController();
  final _requestRef = TextEditingController();
  final _message = TextEditingController();
  String _topic = 'BOOKING';
  String _idempotencyKey = const Uuid().v4();
  bool _busy = false;
  bool _checking = false;
  String? _error;
  String? _sentRef;

  @override
  void initState() {
    super.initState();
    final me = ref.read(sessionProvider).me;
    if (me != null) {
      _name.text = me.displayName;
      _phone.text = me.phone ?? '';
    }
  }

  @override
  void dispose() {
    for (final c in [_name, _email, _phone, _requestRef, _message]) {
      c.dispose();
    }
    super.dispose();
  }

  bool get _hasContact =>
      _emailPattern.hasMatch(_email.text.trim()) ||
      _phonePattern.hasMatch(_phone.text.trim());
  bool get _refOk =>
      _requestRef.text.trim().isEmpty ||
      _requestRefPattern.hasMatch(_requestRef.text.trim());
  bool get _valid =>
      _name.text.trim().length >= 2 &&
      _hasContact &&
      _refOk &&
      _message.text.trim().length >= 10;

  Map<String, dynamic> _body() {
    final email = _email.text.trim();
    final phone = _phone.text.trim();
    final reqRef = _requestRef.text.trim();
    return {
      'name': _name.text.trim(),
      if (_emailPattern.hasMatch(email)) 'email': email,
      if (_phonePattern.hasMatch(phone)) 'phone': phone,
      'topic': _topic,
      if (reqRef.isNotEmpty) 'requestRef': reqRef.toUpperCase(),
      'message': _message.text.trim(),
      'locale': context.lang,
      'deviceId': ref.read(deviceIdProvider),
    };
  }

  Future<void> _submit() async {
    final l = context.l;
    final api = ref.read(apiClientProvider);
    final signedIn = ref.read(sessionProvider).status == AuthStatus.signedIn;
    final body = _body();
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      Future<Json> post(Map<String, dynamic> b, String key) async =>
          await api.post(
            '/v1/support/tickets',
            body: b,
            headers: {'Idempotency-Key': key},
            auth: signedIn,
          ) as Json;
      Json created;
      try {
        created = await post(body, _idempotencyKey);
      } on ApiException catch (e) {
        final pow = e.body?['challenge'];
        if (e.code != 'CHALLENGE_REQUIRED' || pow is! Map<String, dynamic>) {
          rethrow;
        }
        if (mounted) setState(() => _checking = true);
        final solution = await solvePow(pow);
        if (solution == null) rethrow;
        created = await post({
          ...body,
          'challenge': solution,
        }, '$_idempotencyKey-pow');
      }
      ref.invalidate(ticketsProvider);
      if (mounted) setState(() => _sentRef = created.str('ref'));
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(l, e));
    } finally {
      if (mounted) {
        setState(() {
          _busy = false;
          _checking = false;
        });
      }
    }
  }

  void _another() => setState(() {
    _sentRef = null;
    _message.clear();
    _idempotencyKey = const Uuid().v4();
  });

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final theme = Theme.of(context);
    final signedIn = ref.watch(sessionProvider).status == AuthStatus.signedIn;
    return Scaffold(
      appBar: AppBar(title: Text(l.stFormTitle)),
      body: PageBody(
        child: ListView(
          padding: navInset(context, const EdgeInsets.all(16)),
          children: [
            if (_sentRef != null)
              AppCard(
                key: const Key('support-sent'),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(l.stSentTitle, style: theme.textTheme.titleMedium),
                    const SizedBox(height: 8),
                    Semantics(
                      liveRegion: true,
                      child: Text(l.stSentBody(_sentRef!)),
                    ),
                    const SizedBox(height: 16),
                    Wrap(
                      spacing: 8,
                      children: [
                        if (signedIn)
                          FilledButton(
                            onPressed: () => context.pushReplacement(
                              '/support/tickets/$_sentRef',
                            ),
                            child: Text(l.stMyTickets),
                          ),
                        TextButton(
                          key: const Key('support-another'),
                          onPressed: _another,
                          child: Text(l.stWriteAnother),
                        ),
                      ],
                    ),
                  ],
                ),
              )
            else ...[
              Text(l.stFormLead),
              const SizedBox(height: 16),
              TextField(
                key: const Key('support-name'),
                controller: _name,
                textInputAction: TextInputAction.next,
                autofillHints: const [AutofillHints.name],
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(labelText: l.stName),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('support-email-field'),
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                textDirection: TextDirection.ltr,
                autofillHints: const [AutofillHints.email],
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(labelText: l.spEmail),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('support-phone-field'),
                controller: _phone,
                keyboardType: TextInputType.phone,
                textDirection: TextDirection.ltr,
                autofillHints: const [AutofillHints.telephoneNumber],
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: l.spPhone,
                  helperText: l.stContactNeeded,
                  helperMaxLines: 2,
                ),
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                key: const Key('support-topic'),
                initialValue: _topic,
                decoration: InputDecoration(labelText: l.stTopic),
                items: [
                  for (final t in supportTopics)
                    DropdownMenuItem(
                      value: t,
                      child: Text(ticketTopicLabel(l, t)),
                    ),
                ],
                onChanged: (v) => setState(() => _topic = v ?? _topic),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('support-request-ref'),
                controller: _requestRef,
                textCapitalization: TextCapitalization.characters,
                textDirection: TextDirection.ltr,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: l.stRequestRef,
                  hintText: l.tkRefHint,
                  errorText: _refOk ? null : l.errValidation,
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                key: const Key('support-message'),
                controller: _message,
                minLines: 4,
                maxLines: 8,
                maxLength: 4000,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  labelText: l.stMessage,
                  helperText: l.stMessageHelp,
                  alignLabelWithHint: true,
                ),
              ),
              const SizedBox(height: 16),
              FilledButton(
                key: const Key('support-submit'),
                onPressed: _busy || !_valid ? null : _submit,
                child: Text(l.stSend),
              ),
              if (_checking)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(l.tkChecking, style: theme.textTheme.bodySmall),
                ),
              if (_error != null)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Semantics(
                    liveRegion: true,
                    child: Text(
                      _error!,
                      key: const Key('support-error'),
                      style: TextStyle(color: theme.colorScheme.error),
                    ),
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}

/// The signed-in customer's own tickets.
class TicketsScreen extends ConsumerWidget {
  const TicketsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final async = ref.watch(ticketsProvider);
    final t = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.stMyTickets),
        actions: [
          IconButton(
            tooltip: l.stWrite,
            icon: const Icon(Icons.edit_outlined),
            onPressed: () => context.push('/support/new'),
          ),
        ],
      ),
      body: PageBody(
        child: async.when(
          loading: () => const LoadingList(count: 3),
          error: (e, _) =>
              ErrorBox(e, onRetry: () => ref.invalidate(ticketsProvider)),
          data: (cached) {
            final items = cached.data;
            return RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(ticketsProvider);
                await ref.read(ticketsProvider.future);
              },
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: navInset(context, const EdgeInsets.all(16)),
                children: [
                  if (cached.staleSince != null)
                    StaleBanner(savedAt: cached.staleSince!),
                  if (items.isEmpty)
                    Padding(
                      key: const Key('tickets-empty'),
                      padding: const EdgeInsets.all(24),
                      child: Text(
                        l.stTicketsEmpty,
                        textAlign: TextAlign.center,
                      ),
                    ),
                  for (final k in items)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: AppCard(
                        key: Key('ticket-${k.ref}'),
                        semanticLabel:
                            '${k.subject}, ${ticketStatusLabel(l, k.status)}, ${k.ref}',
                        onTap: () => context.push('/support/tickets/${k.ref}'),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    k.subject,
                                    style: t.titleSmall,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  const SizedBox(height: 2),
                                  Wrap(
                                    spacing: 8,
                                    children: [
                                      LtrText(
                                        k.ref,
                                        mono: true,
                                        style: t.bodySmall,
                                      ),
                                      Text(
                                        ticketTopicLabel(l, k.topic),
                                        style: t.bodySmall?.copyWith(
                                          color: Brand.steel,
                                        ),
                                      ),
                                      if (k.lastMessageAt != null)
                                        Text(
                                          formatDate(
                                            k.lastMessageAt!.toLocal(),
                                            lang: lang,
                                            jalali: jalali,
                                          ),
                                          style: t.bodySmall?.copyWith(
                                            color: Brand.steel,
                                          ),
                                        ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                            const SizedBox(width: 8),
                            ToneChip(
                              ticketStatusLabel(l, k.status),
                              tone: ticketTone(k.status),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),
            );
          },
        ),
      ),
    );
  }
}

/// One ticket: the thread (staff notes never arrive in this payload) and a reply box while the thread is open.
class TicketScreen extends ConsumerStatefulWidget {
  const TicketScreen({super.key, required this.ticketRef});
  final String ticketRef;

  @override
  ConsumerState<TicketScreen> createState() => _TicketScreenState();
}

class _TicketScreenState extends ConsumerState<TicketScreen> {
  final _reply = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final l = context.l;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(apiClientProvider)
          .post(
            '/v1/support/tickets/${widget.ticketRef}/messages',
            body: {'body': _reply.text.trim()},
            headers: {'Idempotency-Key': const Uuid().v4()},
          );
      _reply.clear();
      ref.invalidate(ticketProvider(widget.ticketRef));
      ref.invalidate(ticketsProvider);
    } catch (e) {
      if (mounted) setState(() => _error = errorMessage(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final async = ref.watch(ticketProvider(widget.ticketRef));
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.scrSupportTicket)),
      body: PageBody(
        child: async.when(
          loading: () => const LoadingList(count: 2),
          error: (e, _) => e is ApiException && e.status == 404
              ? Center(child: Text(l.stNotFound))
              : ErrorBox(
                  e,
                  onRetry: () =>
                      ref.invalidate(ticketProvider(widget.ticketRef)),
                ),
          data: (k) => ListView(
            padding: navInset(context, const EdgeInsets.all(16)),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(k.subject, style: theme.textTheme.titleMedium),
                  ),
                  ToneChip(
                    ticketStatusLabel(l, k.status),
                    tone: ticketTone(k.status),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Wrap(
                spacing: 8,
                children: [
                  LtrText(k.ref, mono: true, style: theme.textTheme.bodySmall),
                  Text(
                    ticketTopicLabel(l, k.topic),
                    style: theme.textTheme.bodySmall,
                  ),
                  if (k.requestRef != null)
                    GestureDetector(
                      onTap: () => context.push('/requests/${k.requestRef}'),
                      child: Text(
                        l.stAboutRequest(k.requestRef!),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: Brand.royal,
                        ),
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              for (final m in k.messages)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: Align(
                    alignment: m.fromCustomer
                        ? AlignmentDirectional.centerEnd
                        : AlignmentDirectional.centerStart,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 520),
                      child: AppCard(
                        key: Key('msg-${m.id}'),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              [
                                m.fromCustomer ? l.stYou : m.authorName,
                                if (m.createdAt != null)
                                  formatDateTime(
                                    m.createdAt!.toLocal(),
                                    lang: lang,
                                    jalali: jalali,
                                  ),
                              ].join(sep(lang)),
                              style: theme.textTheme.labelSmall?.copyWith(
                                color: Brand.steel,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(m.body),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              if (k.canReply) ...[
                const SizedBox(height: 8),
                TextField(
                  key: const Key('ticket-reply'),
                  controller: _reply,
                  minLines: 2,
                  maxLines: 6,
                  maxLength: 4000,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(labelText: l.stReplyHint),
                ),
                const SizedBox(height: 8),
                Align(
                  alignment: AlignmentDirectional.centerEnd,
                  child: FilledButton(
                    key: const Key('ticket-send'),
                    onPressed: _busy || _reply.text.trim().isEmpty
                        ? null
                        : _send,
                    child: Text(l.stReplySend),
                  ),
                ),
                if (_error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Semantics(
                      liveRegion: true,
                      child: Text(
                        _error!,
                        style: TextStyle(color: theme.colorScheme.error),
                      ),
                    ),
                  ),
              ] else
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(
                    l.stClosedNote,
                    key: const Key('ticket-closed'),
                    style: theme.textTheme.bodySmall,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
