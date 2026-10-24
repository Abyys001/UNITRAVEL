import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/format.dart';
import '../../core/session.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

/// Second-factor check for staff (`MFA_REQUIRED` / `STEP_UP_REQUIRED` on `/v1/admin/*`).
/// Enrols a TOTP factor first when the account has none.
class MfaGate extends ConsumerStatefulWidget {
  const MfaGate({super.key, required this.onVerified});
  final VoidCallback onVerified;

  @override
  ConsumerState<MfaGate> createState() => _MfaGateState();
}

class _MfaGateState extends ConsumerState<MfaGate> {
  final _code = TextEditingController();
  String? _secret;
  bool _busy = false;
  Object? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _enrol() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final res = await ref.read(sessionProvider.notifier).enrolTotp();
      if (mounted) setState(() => _secret = res['secret'] as String?);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    final code = toLatinDigits(_code.text).trim();
    if (code.length != 6) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).verifyTotp(code);
      widget.onVerified();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final me = ref.watch(sessionProvider).me;
    final enrolled = me?.mfaEnrolled.contains('TOTP') ?? false;
    final needsEnrol = !enrolled && _secret == null;
    return Center(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Icon(Icons.verified_user_outlined, size: 48, color: accentText(context)),
            const SizedBox(height: 12),
            Text(l.mfaTitle, style: Theme.of(context).textTheme.headlineSmall, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(enrolled || _secret != null ? (_secret != null ? l.mfaEnrolIntro : l.mfaIntro) : l.mfaIntro, textAlign: TextAlign.center),
            if (_secret != null) ...[
              const SizedBox(height: 16),
              Text(l.mfaSecret, style: Theme.of(context).textTheme.labelMedium),
              Row(
                children: [
                  Expanded(
                    child: Semantics(
                      label: _secret,
                      excludeSemantics: true,
                      child: Text(_secret!, textDirection: TextDirection.ltr, style: Theme.of(context).textTheme.titleMedium?.copyWith(letterSpacing: 1.2)),
                    ),
                  ),
                  IconButton(
                    tooltip: l.copy,
                    icon: const Icon(Icons.copy),
                    onPressed: () async {
                      await Clipboard.setData(ClipboardData(text: _secret!));
                      if (context.mounted) showMessage(context, l.copied);
                    },
                  ),
                ],
              ),
            ],
            const SizedBox(height: 16),
            if (needsEnrol)
              FilledButton(onPressed: _busy ? null : _enrol, child: Text(l.mfaStart))
            else ...[
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                textDirection: TextDirection.ltr,
                textAlign: TextAlign.center,
                maxLength: 6,
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9۰-۹٠-٩]'))],
                style: Theme.of(context).textTheme.titleLarge?.copyWith(letterSpacing: 6),
                decoration: InputDecoration(labelText: l.mfaCode, counterText: ''),
                onSubmitted: (_) => _verify(),
              ),
              const SizedBox(height: 12),
              FilledButton(onPressed: _busy ? null : _verify, child: Text(l.verify)),
            ],
            if (_error != null) ...[
              const SizedBox(height: 12),
              Semantics(
                liveRegion: true,
                child: Text(
                  errorMessage(l, _error!),
                  style: TextStyle(color: xc(context).danger),
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// Error view for admin screens: second-factor gate where that is the problem.
class AdminErrorView extends StatelessWidget {
  const AdminErrorView(this.error, {super.key, required this.onRetry});
  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) => needsSecondFactor(error) ? MfaGate(onVerified: onRetry) : ErrorBox(error, onRetry: onRetry);
}
