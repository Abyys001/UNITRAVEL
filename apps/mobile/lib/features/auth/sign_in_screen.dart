import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../models/me.dart';
import '../../ui/brand_logo.dart';
import '../../ui/route_arcs.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _email = TextEditingController();
  final _code = TextEditingController();
  OtpChallenge? _challenge;
  DateTime _sentAt = DateTime.now();
  bool _busy = false;
  Object? _error;
  int _resend = 0;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _email.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    final value = _email.text.trim();
    if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$').hasMatch(value)) {
      setState(() => _error = const ApiException(status: 400, code: 'VALIDATION_FAILED', title: ''));
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final c = await ref.read(sessionProvider.notifier).requestOtp(value);
      if (!mounted) return;
      setState(() {
        _challenge = c;
        _sentAt = DateTime.now();
      });
      _startCountdown(c.resendAfterSeconds);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _startCountdown(int seconds) {
    _timer?.cancel();
    setState(() => _resend = seconds);
    _timer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted || _resend <= 1) {
        t.cancel();
        if (mounted) setState(() => _resend = 0);
      } else {
        setState(() => _resend--);
      }
    });
  }

  Future<void> _verify() async {
    final code = toLatinDigits(_code.text).trim();
    if (code.length < 4 || _challenge == null) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).verifyOtp(_challenge!.challengeId, code);
      // The router redirects on the new session state.
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = context.l;
    final session = ref.watch(sessionProvider);
    final lang = context.lang;
    final awaitingCode = _challenge != null;
    final notice = session.notice == 'session_expired' ? l.sessionExpired : null;

    return Scaffold(
      body: SafeArea(
        top: false,
        child: PageBody(
          child: ListView(
            children: [
              RouteArcsHeader(
                height: 270,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Align(
                      alignment: AlignmentDirectional.topEnd,
                      child: SafeArea(child: _LanguageToggle(current: lang)),
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const BrandLogo(onDark: true, markSize: 48),
                        const SizedBox(height: 12),
                        Text(l.signInIntro, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: Brand.onDarkMuted)),
                      ],
                    ),
                  ],
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text(l.signInTitle, style: Theme.of(context).textTheme.titleLarge),
                    const SizedBox(height: 16),
                    if (notice != null) ...[
                      Text(notice, style: TextStyle(color: Brand.danger)),
                      const SizedBox(height: 12),
                    ],
                    if (!awaitingCode) ...[
                      TextField(
                        controller: _email,
                        enabled: !_busy,
                        keyboardType: TextInputType.emailAddress,
                        autofillHints: const [AutofillHints.email],
                        autocorrect: false,
                        textDirection: TextDirection.ltr,
                        textAlign: lang == 'fa' ? TextAlign.right : TextAlign.left,
                        decoration: InputDecoration(labelText: l.emailLabel, hintText: l.emailHint),
                        onSubmitted: (_) => _sendCode(),
                      ),
                      const _TestSignInBox(),
                      const SizedBox(height: 8),
                      Align(
                        alignment: AlignmentDirectional.centerStart,
                        child: TextButton.icon(key: const Key('signin-track'), onPressed: () => context.go('/track'), icon: const Icon(Icons.manage_search), label: Text(l.tkSignInLink)),
                      ),
                    ] else ...[
                      Text(l.codeSentTo(ltr(_challenge!.normalised))),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _code,
                        enabled: !_busy,
                        autofocus: true,
                        keyboardType: TextInputType.number,
                        autofillHints: const [AutofillHints.oneTimeCode],
                        textDirection: TextDirection.ltr,
                        textAlign: TextAlign.center,
                        maxLength: 8,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(letterSpacing: 6),
                        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9۰-۹٠-٩]'))],
                        decoration: InputDecoration(labelText: l.codeLabel, counterText: ''),
                        onSubmitted: (_) => _verify(),
                      ),
                      _DevCodeBox(key: ValueKey(_sentAt), to: _challenge!.normalised, since: _sentAt, onCode: (c) => _code.text = c),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 8),
                      Semantics(
                        liveRegion: true,
                        child: Text(errorMessage(l, _error!), style: const TextStyle(color: Brand.danger)),
                      ),
                    ],
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: _busy ? null : (awaitingCode ? _verify : _sendCode),
                      child: _busy
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                          : Text(awaitingCode ? l.verify : l.sendCode),
                    ),
                    if (awaitingCode) ...[
                      const SizedBox(height: 8),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          TextButton(
                            onPressed: _busy
                                ? null
                                : () {
                                    _timer?.cancel();
                                    setState(() {
                                      _challenge = null;
                                      _code.clear();
                                      _error = null;
                                    });
                                  },
                            child: Text(l.changeEmail),
                          ),
                          TextButton(
                            onPressed: (_busy || _resend > 0) ? null : _sendCode,
                            child: Text(_resend > 0 ? l.resendIn(_resend) : l.resendCode),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Local test helper: polls the local-only email sink for the code and fills it in once. The sink answers 404 outside
/// APP_ENV=local, so the box stays hidden there.
class _DevCodeBox extends ConsumerStatefulWidget {
  const _DevCodeBox({super.key, required this.to, required this.since, required this.onCode});
  final String to;
  final DateTime since;
  final ValueChanged<String> onCode;

  @override
  ConsumerState<_DevCodeBox> createState() => _DevCodeBoxState();
}

class _DevCodeBoxState extends ConsumerState<_DevCodeBox> {
  bool _on = false;
  String? _code;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _poll(0);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<String?> _load() async {
    final msgs = await ref.read(apiClientProvider).get('/v1/dev-sink/email', auth: false) as List<dynamic>;
    final since = widget.since.subtract(const Duration(seconds: 5));
    for (final m in msgs.cast<Map<String, dynamic>>()) {
      if (m['to'] == widget.to && !DateTime.parse(m['at'] as String).isBefore(since)) {
        final code = RegExp(r'\b(\d{6})\b').firstMatch(m['body'] as String)?.group(1);
        if (code != null) return code;
      }
    }
    return null;
  }

  Future<void> _poll(int n) async {
    try {
      final code = await _load();
      if (!mounted) return;
      setState(() {
        _on = true;
        _code = code;
      });
      if (code != null) {
        widget.onCode(code);
        return;
      }
    } catch (_) {
      if (mounted) setState(() => _on = false);
      return;
    }
    if (n < 40) _timer = Timer(const Duration(seconds: 1), () => _poll(n + 1));
  }

  @override
  Widget build(BuildContext context) {
    if (!_on) return const SizedBox.shrink();
    final l = context.l;
    return Container(
      key: const ValueKey('dev-code'),
      margin: const EdgeInsets.only(top: 12),
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      decoration: BoxDecoration(
        color: Brand.orange.withValues(alpha: 0.06),
        border: Border.all(color: Brand.orange.withValues(alpha: 0.6)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(l.devCodeTitle, style: const TextStyle(fontWeight: FontWeight.w600)),
          const SizedBox(height: 4),
          Row(
            children: [
              Expanded(
                child: _code == null
                    ? Text(l.devCodeWaiting)
                    : Text(_code!, textDirection: TextDirection.ltr, style: const TextStyle(fontFamily: 'monospace', fontSize: 18, letterSpacing: 4)),
              ),
              if (_code != null) TextButton(onPressed: () => widget.onCode(_code!), child: Text(l.devCodeRefill)),
            ],
          ),
        ],
      ),
    );
  }
}

/// ADR-0012 testing-phase helper: signs in with an email alone. Shown only while the API reports it enabled.
class _TestSignInBox extends ConsumerStatefulWidget {
  const _TestSignInBox();

  @override
  ConsumerState<_TestSignInBox> createState() => _TestSignInBoxState();
}

class _TestSignInBoxState extends ConsumerState<_TestSignInBox> {
  static const _storeKey = 'ut.test_sign_in_email';
  static const _suggestions = [
    'neda@student.example',
    'owner@unitravel.example',
    'sara@unitravel.example',
    'cargo@unitravel.example',
    'compliance@unitravel.example',
    'dev@unitravel.example',
  ];

  final _email = TextEditingController(text: _suggestions.first);
  bool _on = false;
  bool _busy = false;
  bool _failed = false;

  @override
  void initState() {
    super.initState();
    _probe();
  }

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _probe() async {
    try {
      final enabled = await ref.read(sessionProvider.notifier).testSignInEnabled();
      if (!mounted || !enabled) return;
      setState(() => _on = true);
      final last = await ref.read(secureStorageProvider).read(key: _storeKey);
      if (mounted && last != null && last.isNotEmpty) _email.text = last;
    } catch (_) {
      // Disabled (404), offline or storage unavailable: the box stays hidden or keeps the default email.
    }
  }

  Future<void> _submit() async {
    final value = _email.text.trim();
    if (value.isEmpty || _busy) return;
    setState(() {
      _busy = true;
      _failed = false;
    });
    try {
      await ref.read(sessionProvider.notifier).testSignIn(value);
      try {
        await ref.read(secureStorageProvider).write(key: _storeKey, value: value);
      } catch (_) {}
    } catch (_) {
      if (mounted) setState(() => _failed = true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_on) return const SizedBox.shrink();
    final l = context.l;
    return Container(
      key: const ValueKey('test-sign-in'),
      margin: const EdgeInsets.only(top: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: Brand.orange.withValues(alpha: 0.06),
        border: Border.all(color: Brand.orange.withValues(alpha: 0.6)),
        borderRadius: BorderRadius.circular(12),
      ),
      child: AutofillGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l.testSignInTitle, style: const TextStyle(fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Text(l.testSignInHint, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 10),
            TextField(
              key: const ValueKey('test-sign-in-email'),
              controller: _email,
              enabled: !_busy,
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              autocorrect: false,
              textDirection: TextDirection.ltr,
              textAlign: context.lang == 'fa' ? TextAlign.right : TextAlign.left,
              decoration: InputDecoration(labelText: l.testSignInEmail),
              onSubmitted: (_) => _submit(),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 6,
              runSpacing: 0,
              children: [
                for (final s in _suggestions)
                  ActionChip(
                    label: Text(s, textDirection: TextDirection.ltr, style: const TextStyle(fontSize: 12)),
                    onPressed: _busy ? null : () => setState(() => _email.text = s),
                  ),
              ],
            ),
            if (_failed) ...[
              const SizedBox(height: 8),
              Semantics(liveRegion: true, child: Text(l.testSignInError, style: const TextStyle(color: Brand.danger))),
            ],
            const SizedBox(height: 10),
            OutlinedButton(
              onPressed: _busy ? null : _submit,
              child: _busy
                  ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                  : Text(l.testSignInSubmit),
            ),
          ],
        ),
      ),
    );
  }
}

class _LanguageToggle extends ConsumerWidget {
  const _LanguageToggle({required this.current});
  final String current;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    Widget option(String code, String label) {
      final selected = code == current;
      return Semantics(
        button: true,
        selected: selected,
        label: label,
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: () => ref.read(localeProvider.notifier).set(code),
          child: Container(
            constraints: const BoxConstraints(minHeight: 40, minWidth: 56),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: selected ? Brand.orange : Colors.transparent,
              borderRadius: BorderRadius.circular(8),
            ),
            child: ExcludeSemantics(
              child: Text(label, style: TextStyle(color: selected ? Brand.navy950 : Colors.white, fontWeight: FontWeight.w600)),
            ),
          ),
        ),
      );
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [option('en', 'English'), const SizedBox(width: 4), option('fa', 'فارسی')],
    );
  }
}
