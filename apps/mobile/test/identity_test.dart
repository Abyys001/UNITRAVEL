import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:unitravel_mobile/l10n/app_localizations_en.dart';
import 'package:unitravel_mobile/l10n/app_localizations_fa.dart';
import 'package:unitravel_mobile/features/account/details_screen.dart';
import 'package:unitravel_mobile/ui/patterns.dart';
import 'package:unitravel_mobile/models/identity.dart';
import 'package:unitravel_mobile/models/me.dart';
import 'package:unitravel_mobile/models/my_details.dart';
import 'package:unitravel_mobile/models/requests.dart';

Map<String, dynamic> _traveller(String status, {Map<String, dynamic>? reason, Map<String, dynamic>? scan}) => {
  'id': 't1',
  'title': 'MS',
  'givenNames': 'NEDA',
  'surname': 'TEST',
  'nameFa': null,
  'dateOfBirth': '1998-05-02',
  'genderOnDocument': 'F',
  'nationality': 'IR',
  'relationship': 'SELF',
  'documentComplete': true,
  'document': {'type': 'PASSPORT', 'last4': '5432', 'issuingCountry': 'IR', 'expiryDate': '2031-01-01'},
  'verification': {'status': status, 'confirmedAt': null, 'reviewHash': 'a' * 64, 'reason': reason, 'scan': scan},
};

void main() {
  group('identity verification views (ADR-0005)', () {
    test('every status parses and unknown codes fall back to unverified', () {
      for (final s in VerificationStatus.values) {
        expect(Traveller.fromJson(_traveller(s.code)).verification.status, s);
      }
      expect(VerificationStatus.parse('SOMETHING_NEW'), VerificationStatus.unverified);
    });

    test('the customer model carries the last four characters, the reason text and the scan name, nothing more', () {
      final t = Traveller.fromJson(
        _traveller(
          'CORRECTION_REQUIRED',
          reason: {'code': 'NAME_MISMATCH', 'text': 'Check the surname'},
          scan: {'documentId': 'd1', 'filename': 'passport.jpg', 'scanStatus': 'CLEAN'},
        ),
      );
      expect(t.document!.last4, '5432');
      expect(t.verification.reason!.text, 'Check the surname');
      expect(t.verification.scanFilename, 'passport.jpg');
      final src = File('lib/models/identity.dart').readAsStringSync();
      expect(src, isNot(contains("'number'")));
      expect(src, isNot(contains('reviewerUserId')));
      expect(src, isNot(contains('reviewerName')));
    });

    test('every status has a label and help text in both languages', () {
      for (final l in [AppL10nEn(), AppL10nFa()]) {
        for (final s in VerificationStatus.values) {
          expect(verificationLook(l, s).$2, isNotEmpty);
          expect(verificationHelp(l, s), isNotEmpty);
        }
        for (final code in [
          'UNREADABLE_SCAN',
          'NAME_MISMATCH',
          'NUMBER_MISMATCH',
          'DOB_MISMATCH',
          'NATIONALITY_MISMATCH',
          'EXPIRY_MISMATCH',
          'EXPIRED_DOCUMENT',
          'NOT_A_PASSPORT',
          'SCAN_INCOMPLETE',
          'OTHER',
        ]) {
          expect(reasonLabel(l, code), isNotEmpty);
        }
      }
    });

    test('My details parses the optional address, contact methods and the own traveller', () {
      final d = MyDetails.fromJson({
        'givenNamesLatin': 'Neda',
        'surnameLatin': 'Test',
        'nameFa': null,
        'contactTimePref': null,
        'address': {'line1': '1 Test Street', 'line2': null, 'city': 'London', 'postcode': 'SW1A 1AA', 'country': 'GB'},
        'identities': [
          {'id': 'i1', 'type': 'PHONE', 'value': '+447700900010', 'verified': true},
          {'id': 'i2', 'type': 'EMAIL', 'value': 'a@example.test', 'verified': false},
        ],
        'self': _traveller('VERIFIED'),
      });
      expect(d.address!.toJson(), {'line1': '1 Test Street', 'city': 'London', 'postcode': 'SW1A 1AA', 'country': 'GB'});
      expect(d.identities.map((i) => i.verified), [true, false]);
      expect(d.self!.verification.status, VerificationStatus.verified);
      expect(MyDetails.fromJson({'address': null, 'identities': [], 'self': null}).address, isNull);
    });

    test('the request form offers add-and-verify only when the phone is not verified', () {
      Map<String, dynamic> me(String? verifiedAt) => {
        'id': 'u1',
        'displayName': 'N',
        'permissions': [],
        'roles': [],
        'permVersion': 1,
        'surfaces': {'admin': false},
        'mfa': {'level': 0, 'enrolled': []},
        'flags': {},
        'identities': [
          {'id': 'i1', 'type': 'PHONE', 'value': '+98912', 'verifiedAt': verifiedAt, 'isPrimary': true},
        ],
      };
      expect(Me.fromJson(me('2026-10-01T00:00:00.000Z')).phoneVerified, isTrue);
      expect(Me.fromJson(me(null)).phoneVerified, isFalse);
    });
  });
}
