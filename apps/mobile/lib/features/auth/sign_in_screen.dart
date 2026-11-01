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
import '../../ui/bento.dart';
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
            padding: EdgeInsets.zero,
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
                    if (notice != null) ...[Text(notice, style: TextStyle(color: Brand.danger)), const SizedBox(height: 12)],
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
                    : Text(
                        _code!,
                        textDirection: TextDirection.ltr,
                        style: const TextStyle(fontFamily: 'monospace', fontSize: 18, letterSpacing: 4),
                      ),
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
  static const _customer = 'neda@student.example';
  static const _owner = 'owner@unitravel.example';
  static const _developer = 'dev@unitravel.example';
  static const _sara = 'sara@unitravel.example';
  static const _cargo = 'cargo@unitravel.example';
  static const _compliance = 'compliance@unitravel.example';

  final _email = TextEditingController();
  bool _on = false;
  bool _showOther = false;
  String? _busyEmail;
  bool _failed = false;

  bool get _busy => _busyEmail != null;

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

  Future<void> _signIn(String email) async {
    final value = email.trim();
    if (value.isEmpty || _busy) return;
    setState(() {
      _busyEmail = value;
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
      if (mounted) setState(() => _busyEmail = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_on) return const SizedBox.shrink();
    final l = context.l;
    final theme = Theme.of(context);
    Widget staff(String label, String email) => Semantics(
      label: '$label, $email',
      button: true,
      excludeSemantics: true,
      child: ActionChip(key: ValueKey('test-sign-in-$email'), label: Text(label), onPressed: _busy ? null : () => _signIn(email)),
    );
    return Container(
      key: const ValueKey('test-sign-in'),
      margin: const EdgeInsets.only(top: 16),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: xc(context).surfaceSunken,
        borderRadius: BorderRadius.circular(Brand.radius),
        border: Border.all(color: xc(context).border),
      ),
      child: AutofillGroup(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Icon(Icons.science_outlined, size: 20, color: accentText(context)),
                const SizedBox(width: 8),
                Expanded(child: Text(l.testSignInTitle, style: theme.textTheme.titleSmall)),
              ],
            ),
            const SizedBox(height: 4),
            Text(l.testSignInHint, style: theme.textTheme.bodySmall),
            const SizedBox(height: 12),
            _TestRoleCard(
              email: _customer,
              icon: Icons.person_outline,
              title: l.testRoleCustomer,
              help: l.testRoleCustomerHelp,
              busy: _busyEmail == _customer,
              onTap: _busy ? null : () => _signIn(_customer),
            ),
            const SizedBox(height: 8),
            _TestRoleCard(
              email: _owner,
              icon: Icons.admin_panel_settings_outlined,
              title: l.roleOwner,
              badge: l.testRoleOwnerBadge,
              help: l.testRoleOwnerHelp,
              owner: true,
              busy: _busyEmail == _owner,
              onTap: _busy ? null : () => _signIn(_owner),
            ),
            const SizedBox(height: 8),
            _TestRoleCard(
              email: _developer,
              icon: Icons.code,
              title: l.testRoleDeveloper,
              help: l.testRoleDeveloperHelp,
              busy: _busyEmail == _developer,
              onTap: _busy ? null : () => _signIn(_developer),
            ),
            const SizedBox(height: 12),
            Text(l.testRoleOtherStaff, style: theme.textTheme.labelMedium),
            const SizedBox(height: 4),
            Wrap(spacing: 6, children: [staff(l.testStaffSara, _sara), staff(l.testStaffCargo, _cargo), staff(l.testStaffCompliance, _compliance)]),
            if (_failed) ...[
              const SizedBox(height: 8),
              Semantics(
                liveRegion: true,
                child: Text(l.testSignInError, style: const TextStyle(color: Brand.danger)),
              ),
            ],
            const Divider(height: 20),
            if (!_showOther)
              TextButton(
                key: const ValueKey('test-sign-in-other'),
                onPressed: () => setState(() => _showOther = true),
                child: Text(l.testSignInOther),
              )
            else ...[
              const SizedBox(height: 4),
              TextField(
                key: const ValueKey('test-sign-in-email'),
                controller: _email,
                enabled: !_busy,
                autofocus: true,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                autocorrect: false,
                textDirection: TextDirection.ltr,
                textAlign: context.lang == 'fa' ? TextAlign.right : TextAlign.left,
                decoration: InputDecoration(labelText: l.testSignInEmail),
                onSubmitted: _signIn,
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                onPressed: _busy ? null : () => _signIn(_email.text),
                child: _busy ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.testSignInSubmit),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// One tap signs in as this role. The owner card is the only dark one, so it cannot be mistaken for a customer account.
class _TestRoleCard extends StatelessWidget {
  const _TestRoleCard({
    required this.email,
    required this.icon,
    required this.title,
    required this.help,
    required this.busy,
    required this.onTap,
    this.badge,
    this.owner = false,
  });

  final String email;
  final IconData icon;
  final String title;
  final String help;
  final String? badge;
  final bool owner;
  final bool busy;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final colors = xc(context);
    final radius = BorderRadius.circular(14);
    final fg = owner ? Colors.white : colors.fg;
    final muted = owner ? Brand.onDarkMuted : colors.fgMuted;
    return Semantics(
      button: true,
      enabled: onTap != null,
      label: [title, ?badge, help, email].join(', '),
      excludeSemantics: true,
      onTap: onTap,
      // Ink paints on the nearest Material; without this one, the panel's own background would hide the card's.
      child: Material(
        type: MaterialType.transparency,
        child: Ink(
          key: ValueKey('test-sign-in-$email'),
          decoration: BoxDecoration(
            gradient: owner ? Brand.gradient : null,
            color: owner ? null : colors.surface,
            borderRadius: radius,
            border: owner ? Border.all(color: Brand.orange, width: 1.5) : Border.all(color: colors.border),
          ),
          child: InkWell(
            borderRadius: radius,
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  CircleAvatar(
                    radius: 20,
                    backgroundColor: owner ? Brand.orange : colors.surfaceSunken,
                    child: Icon(icon, size: 22, color: owner ? Brand.navy950 : colors.fg),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Wrap(
                          spacing: 8,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Text(title, style: theme.textTheme.titleSmall?.copyWith(color: fg)),
                            if (badge != null)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                decoration: BoxDecoration(color: Brand.orange, borderRadius: BorderRadius.circular(999)),
                                child: Text(
                                  badge!,
                                  style: theme.textTheme.labelSmall?.copyWith(color: Brand.navy950, fontWeight: FontWeight.w700),
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(help, style: theme.textTheme.bodySmall?.copyWith(color: muted)),
                        const SizedBox(height: 2),
                        Text(
                          email,
                          textDirection: TextDirection.ltr,
                          style: theme.textTheme.bodySmall?.copyWith(color: muted),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  if (busy)
                    SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: fg))
                  else
                    Icon(chevronIcon(context), color: muted),
                ],
              ),
            ),
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
            decoration: BoxDecoration(color: selected ? Brand.orange : Colors.transparent, borderRadius: BorderRadius.circular(8)),
            child: ExcludeSemantics(
              child: Text(
                label,
                style: TextStyle(color: selected ? Brand.navy950 : Colors.white, fontWeight: FontWeight.w600),
              ),
            ),
          ),
        ),
      );
    }

    return Row(mainAxisSize: MainAxisSize.min, children: [option('en', 'English'), const SizedBox(width: 4), option('fa', 'فارسی')]);
  }
}
