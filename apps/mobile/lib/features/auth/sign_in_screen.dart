import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_error.dart';
import '../../core/errors_l10n.dart';
import '../../core/format.dart';
import '../../core/providers.dart';
import '../../core/session.dart';
import '../../models/me.dart';
import '../../ui/route_arcs.dart';
import '../../ui/theme.dart';
import '../../ui/widgets.dart';

class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  OtpChallenge? _challenge;
  bool _busy = false;
  Object? _error;
  int _resend = 0;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _phone.dispose();
    _code.dispose();
    super.dispose();
  }

  Future<void> _sendCode() async {
    final value = toLatinDigits(_phone.text).replaceAll(RegExp(r'[\s\-()]'), '');
    if (value.length < 6) {
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
      setState(() => _challenge = c);
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
                height: 220,
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
                        Text(l.appName, style: Theme.of(context).textTheme.headlineSmall?.copyWith(color: Colors.white)),
                        const SizedBox(height: 6),
                        Text(l.signInIntro, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: const Color(0xFFD9D2C4))),
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
                      Text(notice, style: TextStyle(color: Brand.brick)),
                      const SizedBox(height: 12),
                    ],
                    if (!awaitingCode) ...[
                      TextField(
                        controller: _phone,
                        enabled: !_busy,
                        keyboardType: TextInputType.phone,
                        autofillHints: const [AutofillHints.telephoneNumber],
                        textDirection: TextDirection.ltr,
                        textAlign: lang == 'fa' ? TextAlign.right : TextAlign.left,
                        inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9۰-۹٠-٩+\s\-()]'))],
                        decoration: InputDecoration(labelText: l.phoneLabel, hintText: l.phoneHint, helperText: l.phoneHelp, helperMaxLines: 2),
                        onSubmitted: (_) => _sendCode(),
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
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 8),
                      Semantics(
                        liveRegion: true,
                        child: Text(errorMessage(l, _error!), style: const TextStyle(color: Brand.brick)),
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
                            child: Text(l.changeNumber),
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
              color: selected ? Brand.copper : Colors.transparent,
              borderRadius: BorderRadius.circular(8),
            ),
            child: ExcludeSemantics(
              child: Text(label, style: TextStyle(color: selected ? Brand.navy : Colors.white, fontWeight: FontWeight.w600)),
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
