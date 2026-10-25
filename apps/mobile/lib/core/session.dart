import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/json.dart';
import '../models/me.dart';
import 'api_client.dart';
import 'api_error.dart';
import 'config.dart';
import 'pow.dart';
import 'providers.dart';

enum AuthStatus { booting, signedOut, signedIn }

@immutable
class SessionState {
  const SessionState({required this.status, this.me, this.notice});
  final AuthStatus status;
  final Me? me;

  /// One-shot message for the sign-in screen (e.g. session expired).
  final String? notice;

  bool get isAdminMode => status == AuthStatus.signedIn && (me?.admin ?? false);
}

/// Owns the tokens and `/me`. Implements the 401 recovery contract from ch. 10.5:
/// on `PERMISSIONS_CHANGED` / `TOKEN_EXPIRED` refresh silently, reload `/me`
/// (so admin mode appears or disappears) and let the failed call retry once.
class SessionNotifier extends Notifier<SessionState> implements AuthDelegate {
  static const _meCacheKey = 'me';

  String? _access;
  Future<bool>? _refreshing;

  @override
  String? get accessToken => _access;

  ApiClient get _api => ref.read(apiClientProvider);

  @override
  SessionState build() {
    _api.delegate = this;
    Future.microtask(restore);
    return const SessionState(status: AuthStatus.booting);
  }

  /// Cold start: refresh token -> access token -> `/me`. Falls back to the cached
  /// profile when the network is down so the offline cache stays reachable.
  Future<void> restore() async {
    final refresh = await ref.read(tokenStoreProvider).readRefreshToken();
    if (refresh == null) {
      state = const SessionState(status: AuthStatus.signedOut);
      return;
    }
    final ok = await recover('UNAUTHENTICATED');
    if (ok) return;
    if (state.status == AuthStatus.signedOut) return;
    final cached = ref.read(cacheProvider).get(_meCacheKey);
    if (cached != null && cached.data is Json) {
      state = SessionState(status: AuthStatus.signedIn, me: Me.fromJson(cached.data as Json));
    } else {
      state = const SessionState(status: AuthStatus.signedOut);
    }
  }

  @override
  Future<bool> recover(String code) {
    // Single flight: concurrent 401s share one refresh + `/me` round trip.
    return _refreshing ??= _refreshAndReload().whenComplete(() => _refreshing = null);
  }

  Future<bool> _refreshAndReload() async {
    final store = ref.read(tokenStoreProvider);
    final refresh = await store.readRefreshToken();
    if (refresh == null) {
      await _endSession(notice: null);
      return false;
    }
    try {
      final body = await _api.post(
        '/v1/auth/refresh',
        body: {'refreshToken': refresh},
        auth: false,
      );
      final pair = TokenPair.fromJson(body as Json);
      _access = pair.accessToken;
      await store.writeRefreshToken(pair.refreshToken);
      await loadMe();
      return true;
    } on ApiException catch (e) {
      if (e.isNetwork) return false;
      if (e.status == 401 || e.status == 400 || e.status == 403) {
        await _endSession(notice: 'session_expired');
      }
      return false;
    }
  }

  /// `GET /v1/me` and rebuild navigation state from it.
  Future<Me> loadMe() async {
    // retry: false — this runs inside the refresh itself and must not re-enter it.
    final json = (await _api.send('GET', '/v1/me', retry: false)) as Json;
    final me = Me.fromJson(json);
    await ref.read(cacheProvider).put(_meCacheKey, json);
    state = SessionState(status: AuthStatus.signedIn, me: me);
    return me;
  }

  // --- Sign-in -----------------------------------------------------------

  Future<OtpChallenge> requestOtp(String email) async {
    final deviceId = ref.read(deviceIdProvider);
    final body = <String, dynamic>{
      'channel': 'EMAIL',
      'value': email,
      'deviceId': deviceId,
      'client': 'MOBILE',
    };
    try {
      return OtpChallenge.fromJson(
        (await _api.post('/v1/auth/otp/request', body: body, auth: false)) as Json,
      );
    } on ApiException catch (e) {
      final pow = e.body?['challenge'];
      if (e.code == 'CHALLENGE_REQUIRED' && pow is Map<String, dynamic>) {
        final solution = await solvePow(pow);
        if (solution == null) rethrow;
        return OtpChallenge.fromJson(
          (await _api.post(
            '/v1/auth/otp/request',
            body: {...body, 'challenge': solution},
            auth: false,
          )) as Json,
        );
      }
      rethrow;
    }
  }

  Future<VerifyResult> verifyOtp(String challengeId, String code) async {
    final res = VerifyResult.fromJson(
      (await _api.post(
        '/v1/auth/otp/verify',
        body: {
          'challengeId': challengeId,
          'code': code,
          'deviceId': ref.read(deviceIdProvider),
          'client': 'MOBILE',
        },
        auth: false,
      )) as Json,
    );
    final tokens = res.tokens;
    if (tokens != null) await _adopt(tokens);
    return res;
  }

  /// ADR-0012: staging-only sign-in with an email and no code. The API answers 404 when the switch is off.
  Future<bool> testSignInEnabled() async {
    final res = await _api.get('/v1/auth/test-sign-in', auth: false) as Json;
    return res['enabled'] == true;
  }

  Future<void> testSignIn(String email) async {
    final res = VerifyResult.fromJson(
      (await _api.post(
        '/v1/auth/test-sign-in',
        body: {'email': email, 'deviceId': ref.read(deviceIdProvider), 'client': 'MOBILE'},
        auth: false,
      )) as Json,
    );
    final tokens = res.tokens;
    if (tokens != null) await _adopt(tokens);
  }

  Future<void> _adopt(TokenPair tokens) async {
    _access = tokens.accessToken;
    await ref.read(tokenStoreProvider).writeRefreshToken(tokens.refreshToken);
    final me = await loadMe();
    // A signed-in user's saved language wins over the device default.
    if (me.preferredLocale != ref.read(localeProvider).languageCode) {
      await ref.read(localeProvider.notifier).set(me.preferredLocale);
    }
    unawaited(_registerDevice());
  }

  Future<void> completeProfile({required String given, required String surname, String? nameFa}) async {
    await _api.patch('/v1/me', body: {
      'givenNamesLatin': given,
      'surnameLatin': surname,
      if (nameFa != null && nameFa.isNotEmpty) 'nameFa': nameFa,
    });
    await loadMe();
  }

  // --- Staff second factor ----------------------------------------------

  Future<Json> enrolTotp() async => (await _api.post('/v1/auth/mfa/totp/enrol')) as Json;

  Future<void> verifyTotp(String code) async {
    await _api.post('/v1/auth/mfa/totp/verify', body: {'type': 'TOTP', 'code': code});
    await loadMe();
  }

  // --- Profile ------------------------------------------------------------

  Future<void> updateMe(Map<String, Object?> patch) async {
    await _api.patch('/v1/me', body: patch);
    await loadMe();
  }

  Future<void> signOut() async {
    try {
      await _api.post('/v1/auth/logout', retry: false);
    } on ApiException {
      // Local sign-out must succeed even when the server cannot be reached.
    }
    await _endSession();
  }

  Future<void> _endSession({String? notice}) async {
    _access = null;
    await ref.read(tokenStoreProvider).clear();
    await ref.read(cacheProvider).clear();
    state = SessionState(status: AuthStatus.signedOut, notice: notice);
  }

  Future<void> _registerDevice() async {
    if (!kIsWeb || !AppConfig.registerPlaceholderPush) return;
    try {
      final id = ref.read(deviceIdProvider).replaceAll('-', '');
      await _api.post('/v1/me/devices', body: {
        'platform': 'WEB',
        'pushProvider': 'EXPO',
        'pushToken': 'ExponentPushToken[web-placeholder-$id]',
        'appVersion': '0.1.0',
      });
    } on ApiException {
      // Push registration is best effort; the inbox works without it.
    }
  }
}

final sessionProvider = NotifierProvider<SessionNotifier, SessionState>(SessionNotifier.new);

/// Calendar preference of the signed-in user (Gregorian before sign-in).
final calendarJalaliProvider = Provider<bool>(
  (ref) => ref.watch(sessionProvider.select((s) => s.me?.isJalali ?? false)),
);
