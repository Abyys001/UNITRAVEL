import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:kit_ui/kit_ui.dart' show EmptyState;

import '../../core/format.dart';
import '../../models/admin.dart';
import '../../ui/bento.dart';
import '../../ui/brand_logo.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import 'admin_providers.dart';
import 'case_tile.dart';
import 'mfa_gate.dart';
import 'sla.dart';

const queueTabs = ['new', 'mine', 'awaiting', 'quoted', 'reserved'];

/// Triage list: one server tab at a time, plus on-device filters over the loaded page.
class QueueScreen extends ConsumerStatefulWidget {
  const QueueScreen({super.key, this.initialTab = 'new'});
  final String initialTab;

  @override
  ConsumerState<QueueScreen> createState() => _QueueScreenState();
}

class _QueueScreenState extends ConsumerState<QueueScreen> {
  late String _tab = _valid(widget.initialTab);
  bool _urgent = false;
  bool _atRisk = false;
  bool _unassigned = false;
  final _search = TextEditingController();

  static String _valid(String t) => queueTabs.contains(t) ? t : 'new';

  @override
  void didUpdateWidget(QueueScreen old) {
    super.didUpdateWidget(old);
    // Home deep-links (`/admin/queue?tab=mine`) reuse this State inside the shell.
    if (old.initialTab != widget.initialTab) setState(() => _tab = _valid(widget.initialTab));
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  bool get _filtered => _urgent || _atRisk || _unassigned || _search.text.trim().isNotEmpty;

  void _clear() => setState(() {
    _urgent = _atRisk = _unassigned = false;
    _search.clear();
  });

  List<AdminListItem> _apply(List<AdminListItem> items, DateTime now) {
    final q = _search.text.trim().toLowerCase();
    return [
      for (final i in items)
        if ((!_urgent || i.urgent) &&
            (!_unassigned || i.assignee == null) &&
            (!_atRisk || const {SlaLevel.risk, SlaLevel.breached}.contains(slaLevel(status: i.status, due: i.slaDueAt, now: now))) &&
            (q.isEmpty || '${i.ref} ${i.routeLabel} ${i.customer}'.toLowerCase().contains(q)))
          i,
    ];
  }

  Future<void> _reload() async {
    Haptics.tap();
    ref.invalidate(queueSummaryProvider);
    try {
      ref.invalidate(adminCasesProvider(_tab));
      await ref.read(adminCasesProvider(_tab).future);
    } catch (_) {
      // The list renders its own error state.
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lang = context.lang;
    final tabs = {'new': l.tabNew, 'mine': l.tabMine, 'awaiting': l.tabAwaiting, 'quoted': l.tabQuoted, 'reserved': l.tabReserved};
    final counts = ref.watch(queueSummaryProvider).value;
    final countOf = counts == null
        ? const <String, int>{}
        : {'new': counts.newCount, 'mine': counts.mine, 'awaiting': counts.awaiting, 'quoted': counts.quoted, 'reserved': counts.reserved};
    final cases = ref.watch(adminCasesProvider(_tab));
    final now = ref.watch(nowProvider).value ?? DateTime.now();

    return Scaffold(
      appBar: AppBar(
        title: Text(l.queueTitle),
        actions: const [Padding(padding: EdgeInsetsDirectional.only(end: 16), child: BrandLogo(markSize: 28, showPersian: false))],
      ),
      body: PageBody(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: TextField(
                controller: _search,
                textInputAction: TextInputAction.search,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  hintText: l.queueFilterHint,
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _search.text.isEmpty
                      ? null
                      : IconButton(tooltip: l.clear, icon: const Icon(Icons.close), onPressed: () => setState(_search.clear)),
                ),
              ),
            ),
            SizedBox(
              height: 52,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                children: [
                  for (final e in tabs.entries)
                    Padding(
                      padding: const EdgeInsetsDirectional.only(end: 8),
                      child: ChoiceChip(
                        label: Text(countOf[e.key] == null ? e.value : '${e.value} ${digits('${countOf[e.key]}', lang)}'),
                        selected: _tab == e.key,
                        showCheckmark: false,
                        onSelected: (_) {
                          Haptics.select();
                          setState(() => _tab = e.key);
                          // Keep the URL the source of truth so Home deep links to the same tab still apply later.
                          GoRouter.maybeOf(context)?.go('/admin/queue?tab=${e.key}');
                        },
                      ),
                    ),
                ],
              ),
            ),
            SizedBox(
              height: 48,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  _toggle(l.urgent, _urgent, (v) => _urgent = v),
                  _toggle(l.filterAtRisk, _atRisk, (v) => _atRisk = v),
                  _toggle(l.unassigned, _unassigned, (v) => _unassigned = v),
                ],
              ),
            ),
            Expanded(
              child: cases.when(
                skipLoadingOnRefresh: true,
                loading: () => const LoadingList(count: 5),
                error: (e, _) => AdminErrorView(e, onRetry: () => ref.invalidate(adminCasesProvider(_tab))),
                data: (items) {
                  final shown = _apply(items, now);
                  if (items.isEmpty) return _scrollable(EmptyState(title: l.queueEmpty, iconName: 'inbox'));
                  if (shown.isEmpty) {
                    return _scrollable(
                      Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          EmptyState(title: l.queueNoMatch, iconName: 'search-x'),
                          TextButton(onPressed: _clear, child: Text(l.clearFilters)),
                        ],
                      ),
                    );
                  }
                  return RefreshIndicator(
                    onRefresh: _reload,
                    child: ListView.separated(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                      itemCount: shown.length + 1,
                      separatorBuilder: (_, _) => const SizedBox(height: 10),
                      itemBuilder: (context, i) => i == 0
                          ? Text(
                              _filtered ? l.casesShownOf(shown.length, items.length) : l.casesCount(items.length),
                              style: Theme.of(context).textTheme.labelMedium?.copyWith(color: xc(context).fgMuted),
                            )
                          : CaseTile(item: shown[i - 1], swipeToClaim: _tab == 'new'),
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _toggle(String label, bool on, void Function(bool) set) => Padding(
    padding: const EdgeInsetsDirectional.only(end: 8),
    child: FilterChip(
      label: Text(label),
      selected: on,
      onSelected: (v) {
        Haptics.select();
        setState(() => set(v));
      },
    ),
  );

  /// Empty states stay pull-to-refresh capable.
  Widget _scrollable(Widget child) => RefreshIndicator(
    onRefresh: _reload,
    child: LayoutBuilder(
      builder: (_, c) => ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          SizedBox(
            height: c.maxHeight,
            child: Center(child: child),
          ),
        ],
      ),
    ),
  );
}
