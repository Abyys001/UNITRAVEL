import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:kit_ui/kit_ui.dart' show EmptyState;

import '../../ui/widgets.dart';
import 'admin_providers.dart';
import 'case_tile.dart';
import 'mfa_gate.dart';

/// Server-side lookup of any case by reference or phone fragment.
class AdminSearchScreen extends ConsumerStatefulWidget {
  const AdminSearchScreen({super.key});

  @override
  ConsumerState<AdminSearchScreen> createState() => _AdminSearchScreenState();
}

class _AdminSearchScreenState extends ConsumerState<AdminSearchScreen> {
  final _controller = TextEditingController();
  Timer? _debounce;
  String _q = '';

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String v) {
    _debounce?.cancel();
    // Debounced so typing does not fire one staff query per keystroke.
    _debounce = Timer(const Duration(milliseconds: 350), () {
      if (mounted) setState(() => _q = v.trim());
    });
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    return Scaffold(
      appBar: AppBar(title: Text(l.adminSearchTitle)),
      body: PageBody(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
              child: TextField(
                controller: _controller,
                autofocus: false,
                textInputAction: TextInputAction.search,
                onChanged: _onChanged,
                onSubmitted: (v) => setState(() => _q = v.trim()),
                decoration: InputDecoration(hintText: l.adminSearchHint, prefixIcon: const Icon(Icons.search)),
              ),
            ),
            Expanded(
              child: _q.length < 3
                  ? EmptyState(title: l.adminSearchIntro, iconName: 'search-x')
                  : ref
                        .watch(adminSearchProvider(_q))
                        .when(
                          loading: () => const LoadingList(count: 3),
                          error: (e, _) => AdminErrorView(e, onRetry: () => ref.invalidate(adminSearchProvider(_q))),
                          data: (items) => items.isEmpty
                              ? EmptyState(title: l.adminSearchNone, iconName: 'search-x')
                              : ListView.separated(
                                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                                  itemCount: items.length,
                                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                                  itemBuilder: (_, i) => CaseTile(item: items[i]),
                                ),
                        ),
            ),
          ],
        ),
      ),
    );
  }
}
