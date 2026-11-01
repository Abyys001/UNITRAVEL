import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart' show XfamTone;

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart' show needsSecondFactor;
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../l10n/app_localizations.dart';
import '../../models/customers.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'activity_labels.dart';
import 'admin_providers.dart';
import 'mfa_gate.dart';

/// Green dot while a customer was seen in the last few minutes (the server decides `online`), grey otherwise. The label
/// beside it carries the meaning; colour only reinforces it.
class OnlineDot extends StatelessWidget {
  const OnlineDot({super.key, required this.online});
  final bool online;

  @override
  Widget build(BuildContext context) {
    final c = xc(context);
    final l = context.l;
    return Semantics(
      label: online ? l.cuOnline : l.cuOffline,
      child: Container(
        width: 10,
        height: 10,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: online ? c.success : c.fgSubtle,
        ),
      ),
    );
  }
}

String _lastSeen(BuildContext context, CustomerItem c, bool jalali) {
  final l = context.l;
  if (c.online) return l.cuOnline;
  final at = c.lastActiveAt;
  return at == null
      ? l.cuNeverSeen
      : l.cuLastSeen(
          formatDateTime(at.toLocal(), lang: context.lang, jalali: jalali),
        );
}

/// Staff customer list (`customer.read`): online dot, last seen and last screen; contact details arrive masked.
class CustomersScreen extends ConsumerStatefulWidget {
  const CustomersScreen({super.key});

  @override
  ConsumerState<CustomersScreen> createState() => _CustomersScreenState();
}

class _CustomersScreenState extends ConsumerState<CustomersScreen> {
  final _search = TextEditingController();
  final List<CustomerItem> _items = [];
  String _q = '';
  String? _cursor;
  bool _loading = true;
  Object? _error;
  int _gen = 0;

  @override
  void initState() {
    super.initState();
    _load(reset: true);
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load({bool reset = false}) async {
    final gen = reset ? ++_gen : _gen;
    setState(() {
      _loading = true;
      _error = null;
      if (reset) {
        _items.clear();
        _cursor = null;
      }
    });
    try {
      final page = await fetchCustomers(
        ref.read(apiClientProvider),
        q: _q,
        cursor: reset ? null : _cursor,
      );
      if (!mounted || gen != _gen) return;
      setState(() {
        _items.addAll(page.items);
        _cursor = page.nextCursor;
      });
    } catch (e) {
      if (mounted && gen == _gen) setState(() => _error = e);
    } finally {
      if (mounted && gen == _gen) setState(() => _loading = false);
    }
  }

  void _submit(String v) {
    _q = v.trim();
    _load(reset: true);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final t = Theme.of(context).textTheme;
    final c = xc(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.cuTitle)),
      body: PageBody(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              child: TextField(
                key: const Key('customers-search'),
                controller: _search,
                textInputAction: TextInputAction.search,
                onSubmitted: _submit,
                decoration: InputDecoration(
                  prefixIcon: const Icon(Icons.search),
                  hintText: l.cuSearchHint,
                ),
              ),
            ),
            Expanded(
              child: _error != null && _items.isEmpty
                  ? (needsSecondFactor(_error!)
                        ? MfaGate(onVerified: () => _load(reset: true))
                        : ErrorBox(_error!, onRetry: () => _load(reset: true)))
                  : RefreshIndicator(
                      onRefresh: () => _load(reset: true),
                      child: ListView(
                        physics: const AlwaysScrollableScrollPhysics(),
                        padding: navInset(
                          context,
                          const EdgeInsets.fromLTRB(16, 4, 16, 16),
                        ),
                        children: [
                          if (_items.isEmpty && _loading)
                            const SizedBox(
                              height: 240,
                              child: LoadingList(count: 3),
                            ),
                          if (_items.isEmpty && !_loading && _error == null)
                            Padding(
                              key: const Key('customers-empty'),
                              padding: const EdgeInsets.all(24),
                              child: Text(
                                l.cuEmpty,
                                textAlign: TextAlign.center,
                              ),
                            ),
                          for (final it in _items)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: AppCard(
                                key: Key('customer-${it.id}'),
                                semanticLabel:
                                    '${it.displayName}, ${_lastSeen(context, it, jalali)}',
                                onTap: () => context.push(
                                  '/admin/customers/${it.id}',
                                  extra: it,
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Row(
                                      children: [
                                        OnlineDot(online: it.online),
                                        const SizedBox(width: 8),
                                        Expanded(
                                          child: Text(
                                            it.displayName,
                                            style: t.titleSmall,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                        if (it.status == 'SUSPENDED')
                                          ToneChip(
                                            l.cuSuspended,
                                            tone: XfamTone.warning,
                                          ),
                                        if (it.status == 'DELETED')
                                          ToneChip(
                                            l.cuDeleted,
                                            tone: XfamTone.danger,
                                          ),
                                        if (it.verified)
                                          Padding(
                                            padding:
                                                const EdgeInsetsDirectional.only(
                                                  start: 6,
                                                ),
                                            child: ToneChip(
                                              l.cuVerified,
                                              tone: XfamTone.success,
                                            ),
                                          ),
                                      ],
                                    ),
                                    if (it.contact != null)
                                      Padding(
                                        padding: const EdgeInsets.only(top: 2),
                                        child: LtrText(
                                          it.contact!,
                                          style: t.bodySmall?.copyWith(
                                            color: c.fgMuted,
                                          ),
                                        ),
                                      ),
                                    const SizedBox(height: 6),
                                    Wrap(
                                      spacing: 12,
                                      runSpacing: 2,
                                      children: [
                                        Text(
                                          _lastSeen(context, it, jalali),
                                          style: t.bodySmall,
                                        ),
                                        if (it.lastScreen != null)
                                          Text(
                                            l.cuLastScreen(
                                              activityScreenLabel(
                                                l,
                                                it.lastScreen!,
                                              ),
                                            ),
                                            style: t.bodySmall?.copyWith(
                                              color: c.fgMuted,
                                            ),
                                          ),
                                        Text(
                                          l.cuOpenRequests(
                                            digits('${it.openRequests}', lang),
                                          ),
                                          style: t.bodySmall?.copyWith(
                                            color: c.fgMuted,
                                          ),
                                        ),
                                        Text(
                                          l.cuSignIns(
                                            digits('${it.signInCount}', lang),
                                          ),
                                          style: t.bodySmall?.copyWith(
                                            color: c.fgMuted,
                                          ),
                                        ),
                                      ],
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          if (_error != null && _items.isNotEmpty)
                            ErrorBox(_error!, onRetry: _load),
                          if (_cursor != null && _error == null)
                            Center(
                              child: TextButton(
                                key: const Key('customers-more'),
                                onPressed: _loading ? null : _load,
                                child: Text(l.loadMore),
                              ),
                            ),
                        ],
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// One customer: header from the list row (when opened from it) and the activity timeline from
/// `GET /v1/admin/customers/:id/activity`: screen names, sign-in and sign-out only, never content.
class CustomerDetailScreen extends ConsumerWidget {
  const CustomerDetailScreen({
    super.key,
    required this.customerId,
    this.customer,
  });
  final String customerId;
  final CustomerItem? customer;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = context.l;
    final lang = context.lang;
    final jalali = ref.watch(calendarJalaliProvider);
    final async = ref.watch(customerActivityProvider(customerId));
    final t = Theme.of(context).textTheme;
    final c = xc(context);
    final cu = customer;
    return Scaffold(
      appBar: AppBar(title: Text(cu?.displayName ?? l.cuTitle)),
      body: PageBody(
        child: async.when(
          loading: () => const LoadingList(count: 3),
          error: (e, _) => e is ApiException && e.status == 404
              ? Center(child: Text(l.errNotFound))
              : AdminErrorView(
                  e,
                  onRetry: () =>
                      ref.invalidate(customerActivityProvider(customerId)),
                ),
          data: (a) => RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(customerActivityProvider(customerId));
              await ref.read(customerActivityProvider(customerId).future);
            },
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: navInset(context, const EdgeInsets.all(16)),
              children: [
                if (cu != null)
                  AppCard(
                    key: const Key('customer-header'),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            OnlineDot(online: cu.online),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                _lastSeen(context, cu, jalali),
                                style: t.titleSmall,
                              ),
                            ),
                          ],
                        ),
                        if (cu.contact != null)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: LtrText(cu.contact!),
                          ),
                        if (cu.lastScreen != null)
                          Text(
                            l.cuLastScreen(
                              activityScreenLabel(l, cu.lastScreen!),
                            ),
                            style: t.bodySmall?.copyWith(color: c.fgMuted),
                          ),
                      ],
                    ),
                  ),
                const SizedBox(height: 8),
                Text(
                  l.cuSessions(
                    digits('${a.activeSessions}', lang),
                    digits('${a.totalSessions}', lang),
                  ),
                  key: const Key('customer-sessions'),
                  style: t.bodyMedium,
                ),
                if (!a.trackingEnabled)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      l.cuTrackingOff,
                      key: const Key('customer-tracking-off'),
                      style: t.bodySmall?.copyWith(color: c.warningSubtleFg),
                    ),
                  ),
                SectionTitle(l.cuActivity),
                Text(
                  l.cuRetention(digits('${a.retentionDays}', lang)),
                  style: t.bodySmall?.copyWith(color: c.fgMuted),
                ),
                const SizedBox(height: 8),
                if (a.entries.isEmpty)
                  Padding(
                    key: const Key('activity-empty'),
                    padding: const EdgeInsets.all(16),
                    child: Text(l.cuActivityEmpty, textAlign: TextAlign.center),
                  ),
                for (final e in a.entries)
                  Padding(
                    key: Key('activity-${e.id}'),
                    padding: const EdgeInsets.symmetric(vertical: 6),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Padding(
                          padding: const EdgeInsets.only(top: 3),
                          child: Icon(
                            _icon(e.kind),
                            size: 16,
                            color: c.fgMuted,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(_title(l, e), style: t.bodyMedium),
                              Text(
                                [
                                  if (e.occurredAt != null)
                                    formatDateTime(
                                      e.occurredAt!.toLocal(),
                                      lang: lang,
                                      jalali: jalali,
                                    ),
                                  if (e.client != null) e.client!,
                                ].join(sep(lang)),
                                style: t.bodySmall?.copyWith(color: c.fgMuted),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  static IconData _icon(String kind) => switch (kind) {
    'SIGN_IN' => Icons.login,
    'SIGN_OUT' => Icons.logout,
    _ => Icons.visibility_outlined,
  };

  static String _title(AppL10n l, ActivityEntry e) {
    final screen = e.screen == null ? '' : activityScreenLabel(l, e.screen!);
    final withRef = e.ref == null ? screen : '$screen · ${e.ref}';
    return switch (e.kind) {
      'SIGN_IN' => l.cuKindSignIn,
      'SIGN_OUT' => l.cuKindSignOut,
      _ => l.cuKindView(withRef),
    };
  }
}
