import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_error.dart';
import '../../core/providers.dart';
import '../../models/json.dart';
import '../../models/search.dart';
import '../../ui/widgets.dart';

/// Bottom sheet with type-ahead over `GET /v1/locations?q=` (EN or FA names).
Future<Place?> pickPlace(BuildContext context) => showModalBottomSheet<Place>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (_) => const _PlacePicker(),
);

class _PlacePicker extends ConsumerStatefulWidget {
  const _PlacePicker();

  @override
  ConsumerState<_PlacePicker> createState() => _PlacePickerState();
}

class _PlacePickerState extends ConsumerState<_PlacePicker> {
  final _controller = TextEditingController();
  Timer? _debounce;
  List<Place> _places = const [];
  bool _loading = false;
  Object? _error;
  String _lastQuery = '';

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String text) {
    _debounce?.cancel();
    final q = text.trim();
    if (q.length < 2) {
      setState(() {
        _places = const [];
        _error = null;
        _loading = false;
      });
      return;
    }
    _debounce = Timer(const Duration(milliseconds: 250), () => _search(q));
  }

  Future<void> _search(String q) async {
    _lastQuery = q;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final raw = await ref.read(apiClientProvider).get('/v1/locations', query: {'q': q}, auth: false);
      if (!mounted || q != _lastQuery) return;
      setState(() => _places = (raw as List).whereType<Json>().map(Place.fromJson).toList());
    } on ApiException catch (e) {
      if (mounted && q == _lastQuery) setState(() => _error = e);
    } finally {
      if (mounted && q == _lastQuery) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final lang = context.lang;
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.viewInsetsOf(context).bottom),
      child: SizedBox(
        height: MediaQuery.sizeOf(context).height * 0.8,
        child: PageBody(
          child: Column(
            children: [
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: TextField(
                  controller: _controller,
                  autofocus: true,
                  onChanged: _onChanged,
                  textInputAction: TextInputAction.search,
                  decoration: InputDecoration(
                    labelText: l.searchPlaces,
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: _loading
                        ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)))
                        : null,
                  ),
                ),
              ),
              Expanded(
                child: _error != null
                    ? ErrorBox(_error!, onRetry: () => _search(_controller.text.trim()))
                    : _places.isEmpty
                    ? Center(child: Text(_controller.text.trim().length < 2 ? l.chooseCity : l.noPlaces))
                    : ListView.builder(
                        itemCount: _places.length,
                        itemBuilder: (context, i) {
                          final p = _places[i];
                          return ListTile(
                            leading: Icon(p.kind == 'CITY' ? Icons.location_city : Icons.flight),
                            title: Text(p.name(lang)),
                            subtitle: Text(p.name(lang) == p.nameEn ? p.nameFa : p.nameEn),
                            trailing: LtrText(p.code, style: Theme.of(context).textTheme.labelLarge),
                            onTap: () => Navigator.of(context).pop(p),
                          );
                        },
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
