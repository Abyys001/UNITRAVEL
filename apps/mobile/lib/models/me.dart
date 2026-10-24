import 'json.dart';

class Me {
  const Me({
    required this.id,
    required this.displayName,
    required this.preferredLocale,
    required this.calendar,
    required this.permissions,
    required this.roles,
    required this.permVersion,
    required this.phone,
    required this.contactIdentityId,
    required this.givenNamesLatin,
    required this.surnameLatin,
    required this.nameFa,
    required this.onDuty,
    required this.admin,
    required this.mfaLevel,
    required this.mfaEnrolled,
    required this.flags,
    this.phoneVerified = true,
  });

  final String id;
  final String displayName;
  final String preferredLocale;
  final String calendar;
  final List<String> permissions;
  final List<String> roles;
  final int permVersion;
  final String? phone;
  final String? contactIdentityId;
  final String? givenNamesLatin;
  final String? surnameLatin;
  final String? nameFa;
  final bool onDuty;

  /// `surfaces.admin` — chooses admin mode (ch. 10.5).
  final bool admin;
  final int mfaLevel;
  final List<String> mfaEnrolled;
  final Map<String, bool> flags;

  /// False when the account has no verified phone yet; the request form then offers add-and-verify inline.
  final bool phoneVerified;

  bool get isJalali => calendar == 'JALALI';
  bool get cargoEnabled => flags['cargo.enabled'] ?? true;

  factory Me.fromJson(Json j) {
    final identities = j.objs('identities');
    final phone = identities.where((i) => i.str('type') == 'PHONE').firstOrNull;
    final contact = phone ?? identities.firstOrNull;
    final profile = j.objOrNull('profile');
    final mfa = j.obj('mfa');
    return Me(
      id: j.str('id'),
      displayName: j.str('displayName'),
      preferredLocale: j.str('preferredLocale', 'en'),
      calendar: j.str('calendar', 'GREGORIAN'),
      permissions: j.strs('permissions'),
      roles: j.strs('roles'),
      permVersion: j.integer('permVersion'),
      phone: phone?.strOrNull('value'),
      phoneVerified: phone?.strOrNull('verifiedAt') != null,
      contactIdentityId: contact?.strOrNull('id'),
      givenNamesLatin: profile?.strOrNull('givenNamesLatin'),
      surnameLatin: profile?.strOrNull('surnameLatin'),
      nameFa: profile?.strOrNull('nameFa'),
      onDuty: j.flag('onDuty'),
      admin: j.obj('surfaces').flag('admin'),
      mfaLevel: mfa.integer('level'),
      mfaEnrolled: mfa.strs('enrolled'),
      flags: {
        for (final e in j.obj('flags').entries)
          if (e.value is bool) e.key: e.value as bool,
      },
    );
  }
}

class TokenPair {
  const TokenPair({required this.accessToken, required this.refreshToken, this.accessExpiresAt});
  final String accessToken;
  final String refreshToken;
  final DateTime? accessExpiresAt;

  factory TokenPair.fromJson(Json j) => TokenPair(
    accessToken: j.str('accessToken'),
    refreshToken: j.str('refreshToken'),
    accessExpiresAt: parseDate(j['accessExpiresAt']),
  );
}

class OtpChallenge {
  const OtpChallenge({required this.challengeId, required this.resendAfterSeconds, required this.normalised});
  final String challengeId;
  final int resendAfterSeconds;
  final String normalised;

  factory OtpChallenge.fromJson(Json j) => OtpChallenge(
    challengeId: j.str('challengeId'),
    resendAfterSeconds: j.integer('resendAfterSeconds', 60),
    normalised: j.str('normalised'),
  );
}

class VerifyResult {
  const VerifyResult({required this.isNewUser, required this.needsProfile, required this.mfaRequired, required this.mfaEnrolmentRequired, this.tokens});
  final bool isNewUser;
  final bool needsProfile;
  final bool mfaRequired;
  final bool mfaEnrolmentRequired;
  final TokenPair? tokens;

  factory VerifyResult.fromJson(Json j) => VerifyResult(
    isNewUser: j.flag('isNewUser'),
    needsProfile: j.flag('needsProfile'),
    mfaRequired: j.flag('mfaRequired'),
    mfaEnrolmentRequired: j.flag('mfaEnrolmentRequired'),
    tokens: j.objOrNull('tokens') == null ? null : TokenPair.fromJson(j.obj('tokens')),
  );
}
