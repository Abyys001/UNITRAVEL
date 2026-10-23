import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/providers.dart';
import '../../core/repos.dart';
import '../../core/session.dart';
import '../../models/json.dart';
import '../../models/requests.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';
import '../account/traveller_form.dart';
import '../search/itinerary_screen.dart';

/// Search query (and its passenger slots) behind a search id.
final searchQueryProvider = FutureProvider.autoDispose.family<Json, String>((ref, id) async {
  final j = await ref.watch(apiClientProvider).getJson('/v1/flight-searches/$id', query: {'limit': 1});
  return j.obj('query');
});

/// Request form for a chosen itinerary, or a manual request for a search ([itineraryId] null).
class RequestFormScreen extends ConsumerStatefulWidget {
  const RequestFormScreen({super.key, required this.searchId, this.itineraryId});
  final String searchId;
  final String? itineraryId;

  @override
  ConsumerState<RequestFormScreen> createState() => _RequestFormScreenState();
}

class _RequestFormScreenState extends ConsumerState<RequestFormScreen> {
  var _idempotencyKey = const Uuid().v4();
  final _note = TextEditingController();
  final _flex = TextEditingController();
  final _budget = TextEditingController();
  final Map<int, String> _selected = {};
  bool _notABooking = false;
  bool _privacy = false;
  bool _selfTransfer = false;
  bool _acceptPriceChange = false;
  bool _busy = false;
  Object? _error;
  String? _localError;

  bool get _manual => widget.itineraryId == null;

  @override
  void dispose() {
    _note.dispose();
    _flex.dispose();
    _budget.dispose();
    super.dispose();
  }

  List<String> _slotTypes(Json query) {
    final p = query.objs('passengers');
    return p.isEmpty ? const ['ADT'] : p.map((e) => e.str('type', 'ADT')).toList();
  }

  String _typeLabel(String type) {
    final l = context.l;
    return switch (type) {
      'CHD' => l.typeChild,
      'INF' => l.typeInfant,
      _ => l.typeAdult,
    };
  }

  Future<void> _submit(Json query, bool needsSelfTransfer) async {
    final l = context.l;
    final types = _slotTypes(query);
    if (_selected.length < types.length) {
      setState(() => _localError = l.needTraveller);
      return;
    }
    if (!_notABooking || !_privacy || (needsSelfTransfer && !_selfTransfer)) {
      setState(() => _localError = l.needAcks);
      return;
    }
    final me = ref.read(sessionProvider).me;
    if (me?.contactIdentityId == null) return;
    setState(() {
      _busy = true;
      _error = null;
      _localError = null;
    });
    final budget = double.tryParse(_budget.text.trim().replaceAll(',', '.'));
    try {
      final body = <String, dynamic>{
        'kind': _manual ? 'MANUAL' : 'ITINERARY',
        'searchId': widget.searchId,
        if (!_manual) 'itineraryId': widget.itineraryId,
        if (_manual) 'query': query,
        if (_manual)
          'manual': {
            if (_flex.text.trim().isNotEmpty) 'flexibility': _flex.text.trim(),
            if (budget != null) 'budget': {'amountMinor': (budget * 100).round(), 'currency': 'GBP'},
          },
        'travellers': [
          for (var i = 0; i < types.length; i++) {'travellerId': _selected[i], 'passengerType': types[i]},
        ],
        'contactIdentityId': me!.contactIdentityId,
        if (_note.text.trim().isNotEmpty) 'note': _note.text.trim(),
        if (_acceptPriceChange) 'acceptPriceChange': true,
        'acknowledgements': {
          'notABooking': true,
          'privacy': true,
          if (needsSelfTransfer) 'selfTransfer': true,
        },
      };
      final res = await ref.read(apiClientProvider).post(
        '/v1/flight-requests',
        body: body,
        headers: {'Idempotency-Key': _idempotencyKey},
      ) as Json;
      ref.invalidate(requestsProvider);
      if (mounted) context.go('/search/done/${res.str('ref')}');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The supplier price moved since the search: the customer decides whether to continue (ch. 11.3).
  /// A changed body needs a fresh idempotency key.
  Future<void> _acceptNewPrice(Json query, bool needsSelfTransfer) {
    _acceptPriceChange = true;
    _idempotencyKey = const Uuid().v4();
    return _submit(query, needsSelfTransfer);
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final queryAsync = ref.watch(searchQueryProvider(widget.searchId));
    final travellers = ref.watch(travellersProvider);
    final itinerary = widget.itineraryId == null ? null : ref.watch(itineraryProvider(widget.itineraryId!)).value;
    final needsSelfTransfer = itinerary?.itinerary.separateTickets ?? false;

    return Scaffold(
      appBar: AppBar(title: Text(_manual ? l.manualFormTitle : l.requestFormTitle)),
      body: PageBody(
        child: queryAsync.when(
          loading: () => const LoadingList(count: 3),
          error: (e, _) => ErrorBox(e, onRetry: () => ref.invalidate(searchQueryProvider(widget.searchId))),
          data: (query) {
            final types = _slotTypes(query);
            final list = travellers.value ?? const <Traveller>[];
            return ListView(
              padding: const EdgeInsets.all(16),
              children: [
                SectionTitle(l.whoIsTravelling),
                if (list.isEmpty) Padding(padding: const EdgeInsets.only(bottom: 8), child: Text(l.noTravellers)),
                for (var i = 0; i < types.length; i++)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: DropdownButtonFormField<String>(
                      key: ValueKey('traveller-$i-${list.length}'),
                      initialValue: _selected[i],
                      isExpanded: true,
                      decoration: InputDecoration(labelText: l.travellerForType(i + 1, _typeLabel(types[i]))),
                      items: [for (final t in list) DropdownMenuItem(value: t.id, child: Text(t.fullName))],
                      onChanged: (v) => setState(() {
                        if (v != null) _selected[i] = v;
                      }),
                    ),
                  ),
                Align(
                  alignment: AlignmentDirectional.centerStart,
                  child: TextButton.icon(
                    icon: const Icon(Icons.person_add_alt),
                    label: Text(l.addTraveller),
                    onPressed: () async {
                      final t = await showTravellerSheet(context);
                      if (t != null && mounted) {
                        setState(() {
                          for (var i = 0; i < types.length; i++) {
                            if (!_selected.containsKey(i)) {
                              _selected[i] = t.id;
                              break;
                            }
                          }
                        });
                      }
                    },
                  ),
                ),
                if (_manual) ...[
                  const SizedBox(height: 8),
                  TextField(controller: _flex, decoration: InputDecoration(labelText: l.flexibility, hintText: l.flexibilityHint)),
                  const SizedBox(height: 12),
                  TextField(controller: _budget, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: l.budget)),
                ],
                const SizedBox(height: 12),
                TextField(controller: _note, maxLines: 3, maxLength: 2000, decoration: InputDecoration(labelText: '${l.noteLabel} (${l.optional})')),
                const SizedBox(height: 8),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _notABooking,
                  onChanged: (v) => setState(() => _notABooking = v ?? false),
                  title: Text(l.ackNotBooking),
                ),
                CheckboxListTile(
                  contentPadding: EdgeInsets.zero,
                  controlAffinity: ListTileControlAffinity.leading,
                  value: _privacy,
                  onChanged: (v) => setState(() => _privacy = v ?? false),
                  title: Text(l.ackPrivacy),
                ),
                if (needsSelfTransfer)
                  CheckboxListTile(
                    contentPadding: EdgeInsets.zero,
                    controlAffinity: ListTileControlAffinity.leading,
                    value: _selfTransfer,
                    onChanged: (v) => setState(() => _selfTransfer = v ?? false),
                    title: Text(l.ackSelfTransfer),
                  ),
                if (_localError != null || _error != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Semantics(
                      liveRegion: true,
                      child: Text(_localError ?? errorMessage(l, _error!), style: const TextStyle(color: Brand.brick)),
                    ),
                  ),
                const SizedBox(height: 16),
                if (_error is ApiException && (_error as ApiException).code == 'PRICE_CHANGED')
                  FilledButton(
                    onPressed: _busy ? null : () => _acceptNewPrice(query, needsSelfTransfer),
                    child: Text(l.acceptNewPrice),
                  )
                else
                  FilledButton(
                    onPressed: _busy ? null : () => _submit(query, needsSelfTransfer),
                    child: Text(_busy ? l.submitting : l.submitRequest),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class ConfirmationScreen extends StatelessWidget {
  const ConfirmationScreen({super.key, required this.requestRef});
  final String requestRef;

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    return Scaffold(
      appBar: AppBar(title: Text(l.confirmationTitle), automaticallyImplyLeading: false),
      body: PageBody(
        child: ListView(
          padding: const EdgeInsets.all(24),
          children: [
            const Icon(Icons.check_circle_outline, size: 56, color: Brand.moss),
            const SizedBox(height: 16),
            Text(l.confirmationTitle, style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(l.confirmationBody, textAlign: TextAlign.center),
            const SizedBox(height: 20),
            AppCard(
              child: Column(
                children: [
                  Text(l.referenceLabel, style: Theme.of(context).textTheme.bodySmall),
                  const SizedBox(height: 4),
                  Semantics(
                    label: '${l.referenceLabel} $requestRef',
                    child: LtrText(requestRef, style: Theme.of(context).textTheme.headlineSmall?.copyWith(letterSpacing: 1.5, color: Brand.copperDark)),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            FilledButton(onPressed: () => context.go('/requests/$requestRef'), child: Text(l.viewRequest)),
            const SizedBox(height: 8),
            OutlinedButton(onPressed: () => context.go('/search'), child: Text(l.newSearch)),
          ],
        ),
      ),
    );
  }
}
