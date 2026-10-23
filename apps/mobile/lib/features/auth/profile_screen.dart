import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/session.dart';
import '../../ui/widgets.dart';

/// Shown once after a first sign-in: Latin names exactly as in the passport (ch. 11.2).
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _given = TextEditingController();
  final _surname = TextEditingController();
  final _fa = TextEditingController();
  bool _busy = false;
  Object? _error;

  static final _latin = RegExp(r"^[A-Za-z][A-Za-z '\-]*$");

  @override
  void dispose() {
    _given.dispose();
    _surname.dispose();
    _fa.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).completeProfile(
        given: _given.text.trim(),
        surname: _surname.text.trim(),
        nameFa: _fa.text.trim(),
      );
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    String? latin(String? v) {
      final t = v?.trim() ?? '';
      if (t.isEmpty) return l.fieldRequired;
      return _latin.hasMatch(t) ? null : l.fieldLatin;
    }

    return Scaffold(
      appBar: AppBar(title: Text(l.profileTitle)),
      body: PageBody(
        child: Form(
          key: _formKey,
          child: ListView(
            padding: const EdgeInsets.all(20),
            children: [
              Text(l.profileIntro),
              const SizedBox(height: 16),
              TextFormField(
                controller: _given,
                textDirection: TextDirection.ltr,
                textCapitalization: TextCapitalization.words,
                decoration: InputDecoration(labelText: l.givenNames),
                validator: latin,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _surname,
                textDirection: TextDirection.ltr,
                textCapitalization: TextCapitalization.words,
                decoration: InputDecoration(labelText: l.surname),
                validator: latin,
              ),
              const SizedBox(height: 12),
              TextFormField(controller: _fa, decoration: InputDecoration(labelText: '${l.nameFa} (${l.optional})')),
              if (_error != null) ...[
                const SizedBox(height: 12),
                Text(errorMessage(l, _error!), style: const TextStyle(color: Color(0xFFA4452C))),
              ],
              const SizedBox(height: 20),
              FilledButton(onPressed: _busy ? null : _save, child: Text(l.continueLabel)),
            ],
          ),
        ),
      ),
    );
  }
}
